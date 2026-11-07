import hashlib
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

SOURCE = pathlib.Path(__file__).resolve().parents[2] / "deploy/linux/setup-2d-lime.py"
SPEC = importlib.util.spec_from_file_location("flamoris2d_setup", SOURCE)
SETUP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SETUP)
TOKEN = "testOnlyCredential" + "x" * 48


def catalog():
    names = sorted(SETUP.READS | {"command.scene.rename_node", "cli.project_save", "cli.render_start", "cli.render_cancel"})
    names += ["query.fixture_" + str(i) for i in range(184-len(names))]
    assert len(names) == 184
    return {"id": "flamoris2d-lime", "namespace": "flamoris2d_lime", "transport": "reverse-websocket",
            "product_id": "flamoris.2d", "connector_token_env": SETUP.KEY,
            "tools": [{"name": name, "input_schema": {"type": "object"}, "annotations": {
                "readOnlyHint": name in SETUP.READS or name.startswith("query."),
                "destructiveHint": not (name in SETUP.READS or name.startswith("query.")), "openWorldHint": False}}
                for name in names]}


class SetupTests(unittest.TestCase):
    def test_endpoint_derives_only_dedicated_route_and_preserves_front_door(self):
        self.assertEqual(SETUP.endpoint_from_existing("wss://hub.example:443/prefix/desktop/kachinco-lime"),
                         "wss://hub.example:443/prefix/desktop/flamoris2d-lime")
        for value in ["ws://hub.example/desktop/x", "wss://name:secret@hub.example/desktop/x",
                      "wss://hub.example/desktop/x?token=value", "wss://hub.example/desktop/x/other"]:
            with self.assertRaises(ValueError):
                SETUP.endpoint_from_existing(value)

    def test_credential_append_preserves_existing_bytes_and_is_idempotent(self):
        original = "# retained\nEXISTING_TOKEN=unrelated\nPORT=8769\n"
        updated = SETUP.append_credential(original, TOKEN)
        self.assertTrue(updated.startswith(original))
        self.assertEqual(SETUP.append_credential(updated, TOKEN), updated)
        with self.assertRaises(ValueError):
            SETUP.append_credential(updated, TOKEN + "other")
        with self.assertRaises(ValueError):
            SETUP.append_credential("PORT=1\nPORT=2\n", TOKEN)

    def test_catalog_annotations_preserve_schemas_and_do_not_grant_edits_as_reads(self):
        raw = catalog()
        result = SETUP.descriptor(raw)
        self.assertEqual(raw, result)
        self.assertEqual([t["input_schema"] for t in raw["tools"]], [t["input_schema"] for t in result["tools"]])
        tools = {tool["name"]: tool for tool in result["tools"]}
        self.assertTrue(tools["cli.preview_frame"]["annotations"]["readOnlyHint"])
        self.assertTrue(tools["cli.project_save"]["annotations"]["destructiveHint"])
        raw["namespace"] = "flamoris2d"
        with self.assertRaises(ValueError):
            SETUP.descriptor(raw)

    def test_bad_archive_digest_and_traversal_do_not_publish_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            archive = root / "input.tar.gz"
            with tarfile.open(archive, "w:gz") as bundle:
                member = tarfile.TarInfo("../escaped")
                member.size = 4
                bundle.addfile(member, io.BytesIO(b"test"))
            destination = root / "destination"
            destination.mkdir()
            with self.assertRaises(ValueError):
                SETUP.extract_verified(archive, destination)
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            with patch.object(SETUP, "ARCHIVE_SHA256", digest), self.assertRaises(ValueError):
                SETUP.extract_verified(archive, destination)
            self.assertEqual(list(destination.iterdir()), [])
            self.assertFalse((root / "escaped").exists())

    def test_symlinked_configuration_path_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "actual").mkdir()
            (root / "link").symlink_to(root / "actual", target_is_directory=True)
            with self.assertRaises(ValueError):
                SETUP.no_links(root / "link" / "runtime.env")

    def test_verified_stage_is_traversable_by_the_dedicated_service_account(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            archive = root / "input.tar.gz"
            with tarfile.open(archive, "w:gz") as bundle:
                member = tarfile.TarInfo(SETUP.TOP + "/flamoris2d")
                member.size = 4
                member.mode = 0o755
                bundle.addfile(member, io.BytesIO(b"test"))
                content = (hashlib.sha256(b"test").hexdigest()+"  flamoris2d\n").encode()
                inventory = tarfile.TarInfo(SETUP.TOP + "/SHA256SUMS.txt")
                inventory.size = len(content)
                bundle.addfile(inventory, io.BytesIO(content))
            destination = root / "stage"
            destination.mkdir(mode=0o700)
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            with patch.object(SETUP, "ARCHIVE_SHA256", digest):
                SETUP.extract_verified(archive, destination)
            self.assertEqual(destination.stat().st_mode & 0o777, 0o755)
            self.assertTrue((destination / SETUP.TOP / "flamoris2d").stat().st_mode & 0o111)

    def test_container_dotenv_uses_real_newlines_and_never_prints_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "runtime.env"
            path.write_text("EXISTING_TOKEN=untouched\n")
            environment = os.environ.copy()
            environment["FLAMORIS_MCP_HUB_ENV_FILE"] = str(path)
            request = {"key": SETUP.KEY, "credential": TOKEN, "uid": os.getuid(), "gid": os.getgid(), "action": "write"}
            for _ in range(2):
                result = subprocess.run([sys.executable, "-c", SETUP.CONTAINER_ENV], env=environment,
                                        input=json.dumps(request), text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn(TOKEN, result.stdout + result.stderr)
            self.assertEqual(path.read_text(), "EXISTING_TOKEN=untouched\n" + SETUP.KEY + "=" + TOKEN + "\n")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_failed_hub_restart_restores_existing_descriptor_and_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "config").mkdir()
            (root / "mcps").mkdir()
            runtime = root / "config/runtime.env"
            original_env = "PORT=8769\nEXISTING_TOKEN=untouched\n"
            runtime.write_text(original_env)
            registration = SETUP.descriptor(catalog())
            target = root / "mcps/flamoris2d-lime.yaml"
            original_catalog = json.dumps(registration, separators=(",", ":")).encode()
            target.write_bytes(original_catalog)
            connection = root / "connection.json"
            connection.write_text(json.dumps({"source": SETUP.SOURCE, "archiveSha256": SETUP.ARCHIVE_SHA256,
                                             "credential": TOKEN, "descriptor": registration}))
            connection.chmod(0o600)

            def fake_run(arguments, **kwargs):
                if arguments[:2] == ["docker", "inspect"]:
                    return types.SimpleNamespace(stdout=json.dumps([{"Config": {"Env": []}, "Mounts": []}]).encode(), returncode=0)
                if arguments[:2] == ["docker", "restart"]:
                    if kwargs.get("check", True):
                        raise RuntimeError("restart failure")
                if arguments[-2:] in [["id", "-u"], ["id", "-g"]]:
                    return types.SimpleNamespace(stdout=b"10001", returncode=0)
                if arguments[-1] == SETUP.CONTAINER_ENV:
                    return types.SimpleNamespace(stdout=b'{"path":"/app/.env"}', returncode=0)
                return types.SimpleNamespace(stdout=b"{}", returncode=0)

            with patch.object(SETUP, "HUB_ROOT", root), patch.object(SETUP, "run", fake_run), \
                 patch.object(SETUP.socket, "gethostname", return_value="decopon"), self.assertRaises(RuntimeError):
                SETUP.hub(types.SimpleNamespace(connection=str(connection)), types.SimpleNamespace(pw_dir=str(root)))
            self.assertEqual(runtime.read_text(), original_env)
            self.assertEqual(target.read_bytes(), original_catalog)
            self.assertTrue(connection.exists())

    def test_default_cli_is_read_only_plan(self):
        result = subprocess.run([sys.executable, str(SOURCE), "lime"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertFalse(json.loads(result.stdout)["changes"])

    def test_verifier_uses_official_http_client_without_disclosing_credentials(self):
        try:
            import httpx2 as httpx
        except ImportError:
            import httpx
        import mcp.types
        registration = SETUP.descriptor(catalog())
        calls = []

        async def handle(request):
            self.assertEqual(request.headers["authorization"], "Bearer " + TOKEN)
            message = json.loads(request.content)
            method = message["method"]
            calls.append(method)
            if method == "notifications/initialized":
                return httpx.Response(202)
            if method == "initialize":
                value = {"protocolVersion": message["params"]["protocolVersion"], "capabilities": {"tools": {}},
                         "serverInfo": {"name": "test-hub", "version": "1"}}
            elif method == "tools/list":
                value = {"tools": [{"name": "flamoris2d_lime." + item["name"], "inputSchema": item["input_schema"]}
                                   for item in registration["tools"]]}
            elif method == "tools/call":
                self.assertEqual(message["params"]["name"], "flamoris2d_lime.mcp.context")
                value = {"content": [{"type": "text", "text": json.dumps({"productId": "flamoris.2d",
                         "permission": "edit", "hasDocument": True, "runtimeId": "test-runtime"})}]}
            else:
                self.fail("Verifier sent an unexpected operation: " + method)
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": message["id"], "result": value})

        real_client = httpx.AsyncClient
        def client(**kwargs):
            return real_client(**kwargs, transport=httpx.MockTransport(handle))
        configuration = types.ModuleType("flamoris_mcp_hub.config")
        configuration.env_file = lambda: pathlib.Path("/nonexistent-2d-test-env")
        with patch.dict(sys.modules, {"flamoris_mcp_hub": types.ModuleType("flamoris_mcp_hub"),
                                      "flamoris_mcp_hub.config": configuration}), \
             patch.dict(os.environ, {"FLAMORIS_MCP_HUB_CLIENT_TOKEN": TOKEN}), \
             patch.object(httpx, "AsyncClient", client), patch.object(sys, "stdin", io.StringIO(json.dumps(registration))):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                exec(compile(SETUP.VERIFY, "hub-readonly-verifier", "exec"), {})
        self.assertNotIn(TOKEN, output.getvalue())
        self.assertTrue(json.loads(output.getvalue())["connected"])
        self.assertEqual(calls, ["initialize", "notifications/initialized", "tools/list", "tools/call"])

    def test_effects_cannot_relabel_a_checkpoint_as_read_only(self):
        raw = catalog()
        next(t for t in raw["tools"] if t["name"] == "cli.project_save")["annotations"]["readOnlyHint"] = True
        with self.assertRaises(ValueError):
            SETUP.descriptor(raw)

    def test_inventory_rejects_modified_or_added_runtime_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root/"flamoris2d").write_bytes(b"original")
            (root/"SHA256SUMS.txt").write_text(hashlib.sha256(b"original").hexdigest()+"  flamoris2d\n")
            SETUP.verify_release(root)
            (root/"extra.dll").write_bytes(b"unexpected")
            with self.assertRaises(ValueError): SETUP.verify_release(root)
            (root/"extra.dll").unlink()
            (root/"flamoris2d").write_bytes(b"changed")
            with self.assertRaises(ValueError): SETUP.verify_release(root)

    def test_lime_install_preserves_workspace_and_reuses_the_runtime_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            app = root/"app";release = app/"releases"/SETUP.SOURCE
            release.mkdir(parents=True)
            registration = catalog()
            files = {"flamoris2d":b"test", "flamoris2d-lime.json":json.dumps(registration).encode()}
            for name,data in files.items(): (release/name).write_bytes(data)
            (release/"SHA256SUMS.txt").write_text("".join(hashlib.sha256(data).hexdigest()+"  "+name+"\n" for name,data in files.items()))
            archive=root/"bundle.tar.gz";archive.write_bytes(b"reviewed archive")
            previous=root/"kachinco.env";previous.write_text("KACHINCO_HUB_ENDPOINT=wss://hub.example/prefix/desktop/kachinco-lime\n")
            setting=root/"settings/2d.env";units=root/"units";units.mkdir()
            operator=types.SimpleNamespace(pw_name="operator",pw_uid=os.getuid(),pw_gid=os.getgid(),pw_dir=str(root))
            account=types.SimpleNamespace(pw_name="flamoris-2d",pw_uid=os.getuid(),pw_gid=os.getgid())
            calls=[]
            def command(arguments,**kwargs):
                calls.append(arguments)
                if arguments[:2]==["docker","inspect"]:return types.SimpleNamespace(returncode=1,stdout=b"")
                if arguments[-1]=="mcp-catalog":return types.SimpleNamespace(returncode=0,stdout=json.dumps(registration).encode())
                if arguments[-1]==SETUP.BOOTSTRAP:
                    pathlib.Path(json.loads(kwargs['data'])['output']).write_text('{"normalBlank":true}')
                return types.SimpleNamespace(returncode=0,stdout=b"{}")
            args=types.SimpleNamespace(archive=str(archive),hub_endpoint=None,input=None)
            with patch.object(SETUP,"ROOT",app),patch.object(SETUP,"SETTING",setting),patch.object(SETUP,"UNIT_DIRECTORY",units), \
                 patch.object(SETUP,"KACHINCO_SETTING",previous),patch.object(SETUP,"ARCHIVE_SHA256",hashlib.sha256(archive.read_bytes()).hexdigest()), \
                 patch.object(SETUP,"run",command),patch.object(SETUP,"as_operator",lambda *a,**kw:types.SimpleNamespace(returncode=0)), \
                 patch.object(SETUP.socket,"gethostname",return_value="lime"),patch.object(SETUP.pwd,"getpwnam",return_value=account):
                with contextlib.redirect_stdout(io.StringIO()):SETUP.lime(args,operator)
                first=SETUP.values(setting.read_text())
                self.assertIn("FLAMORIS_HUB_CREDENTIAL",first)
                self.assertNotIn(SETUP.KEY,first)
                saved=app/"state/workspace/project.fl2d";saved.parent.mkdir();saved.write_bytes(b"authored motion")
                with contextlib.redirect_stdout(io.StringIO()):SETUP.lime(args,operator)
                self.assertEqual(SETUP.values(setting.read_text()),first)
                self.assertEqual(saved.read_bytes(),b"authored motion")
                connection=json.loads((root/"flamoris2d-lime-connect.json").read_text())
                self.assertEqual(connection['credential'],first['FLAMORIS_HUB_CREDENTIAL'])
                self.assertEqual(connection['endpoint'],'wss://hub.example/prefix/desktop/flamoris2d-lime')
                self.assertEqual(sum(c[-1]==SETUP.BOOTSTRAP for c in calls),1)
    @unittest.skipUnless(os.environ.get("FLAMORIS2D_TEST_ARCHIVE"), "Set FLAMORIS2D_TEST_ARCHIVE for reviewed native bundle acceptance")
    def test_reviewed_native_bundle_bootstraps_an_ordinary_source_independent_project(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            stage = root / "runtime";stage.mkdir()
            release = SETUP.extract_verified(pathlib.Path(os.environ["FLAMORIS2D_TEST_ARCHIVE"]), stage)
            registration = SETUP.descriptor(json.loads((release/"flamoris2d-lime.json").read_text()))
            observed = subprocess.run([str(release/"flamoris2d"), "mcp-catalog"],capture_output=True,text=True,check=True)
            self.assertEqual(SETUP.descriptor(json.loads(observed.stdout)), registration)
            initial = root / "initial.fl2d"
            request = json.dumps({"library":str(release/"libFlamoris2D.Core.Native.so"),"output":str(initial)})
            created = subprocess.run([sys.executable,"-c",SETUP.BOOTSTRAP],input=request,capture_output=True,text=True)
            self.assertEqual(created.returncode,0,created.stderr)
            before = initial.read_bytes()
            inspected = subprocess.run([str(release/"flamoris2d"),"inspect",str(initial)],capture_output=True,text=True,check=True)
            state = json.loads(inspected.stdout)
            self.assertEqual(state["summary"]["canvas"],{"width":1920,"height":1080})
            self.assertEqual(state["keyArts"],[])
            retry = subprocess.run([sys.executable,"-c",SETUP.BOOTSTRAP],input=request,capture_output=True,text=True)
            self.assertNotEqual(retry.returncode,0)
            self.assertEqual(initial.read_bytes(),before)


if __name__ == "__main__":
    unittest.main()
