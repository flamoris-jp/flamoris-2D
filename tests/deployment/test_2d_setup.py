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
import yaml
from jsonschema import Draft202012Validator
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
    def test_failure_diagnostics_redact_current_and_retained_credentials(self):
        retained = "retained-secret-" + "y" * 32
        raw = ("TypeError: unexpected cursor\n" + TOKEN + "\n" + retained).encode()
        output = SETUP.redact_diagnostic(raw, [TOKEN, retained])
        self.assertIn("unexpected cursor", output)
        self.assertNotIn(TOKEN, output)
        self.assertNotIn(retained, output)

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

    def test_hub_yaml_preserves_tiny_numbers_and_validates_the_serialized_catalog(self):
        registration = catalog()
        # Reproduce JSON's valid exponent spelling becoming a YAML 1.1 string.
        registration["tools"][0]["input_schema"] = {
            "type":"object", "properties": {
                "weight": {"type":"number", "minimum":5e-324},
                "exponentText": {"type":"string", "const":"5e-324"}}}
        self.assertIsInstance(yaml.safe_load(json.dumps(registration))["tools"][0]["input_schema"]
                              ["properties"]["weight"]["minimum"], str)
        class Model:
            @staticmethod
            def model_validate(raw):
                for tool in raw["tools"]:
                    Draft202012Validator.check_schema(tool["input_schema"])
                return types.SimpleNamespace(id=raw["id"], namespace=raw["namespace"], tools=raw["tools"])
        configuration = types.ModuleType("flamoris_mcp_hub.config")
        configuration.UpstreamConfig = Model
        configuration.load_upstreams = lambda directory: []
        configuration.config_dir = lambda: pathlib.Path("/unused")
        with patch.dict(sys.modules, {"flamoris_mcp_hub":types.ModuleType("flamoris_mcp_hub"),
                                      "flamoris_mcp_hub.config":configuration}), \
             patch.object(sys, "stdin", io.StringIO(json.dumps(registration))):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                exec(compile(SETUP.VALIDATE, "installed-hub-yaml-validation", "exec"), {})
        serialized = json.loads(output.getvalue())["yaml"]
        loaded = yaml.safe_load(serialized)
        self.assertEqual(loaded, registration)
        self.assertIsInstance(loaded["tools"][0]["input_schema"]["properties"]["weight"]["minimum"], float)
        for tool in loaded["tools"]:
            Draft202012Validator.check_schema(tool["input_schema"])

    def test_replacement_preserves_image_mounts_security_and_existing_credentials(self):
        observed = self.container()
        before = json.dumps(observed, sort_keys=True)
        result = SETUP.replacement_config(observed, TOKEN)
        self.assertEqual(result["Image"], observed["Image"])
        self.assertEqual(result["HostConfig"], observed["HostConfig"])
        self.assertEqual(result["Env"], ["EXISTING_TOKEN=retained", SETUP.KEY + "=" + TOKEN])
        self.assertEqual(result["Cmd"], observed["Config"]["Cmd"])
        self.assertNotIn("Hostname", result)
        self.assertEqual(json.dumps(observed, sort_keys=True), before)
        for update in [{"AutoRemove": True}, {"NetworkMode": "bridge"}, {"PidMode": "container:other"}]:
            altered = self.container()
            altered["HostConfig"].update(update)
            with self.assertRaises(ValueError):
                SETUP.replacement_config(altered, TOKEN)

    @staticmethod
    def container():
        return {"Id": "original-id", "Name": "/flamoris-mcp-hub", "Image": "sha256:installed",
                "State": {"Running": True},
                "Config": {"Env": ["EXISTING_TOKEN=retained"], "Image": "mutable-tag",
                           "Hostname": "decopon", "Cmd": ["python", "-m", "hub"],
                           "Labels": {"updater": "retained"}},
                "HostConfig": {"NetworkMode": "host", "ReadonlyRootfs": True,
                               "RestartPolicy": {"Name": "unless-stopped"},
                               "CapDrop": ["ALL"], "SecurityOpt": ["no-new-privileges"],
                               "Binds": ["/host/mcps:/app/config/mcps:ro"]},
                "Mounts": [{"Type": "bind", "Source": "/host/mcps", "Destination": "/app/config/mcps", "RW": False}]}

    def test_engine_create_sends_credential_only_in_private_http_body(self):
        captured = {}
        class Response:
            status = 201
            def read(self, limit): return b'{"Id":"candidate-id"}'
        def request(client, method, path, body, headers):
            captured.update(method=method, path=path, payload=json.loads(body), headers=headers)
        with patch.object(SETUP, "run", return_value=types.SimpleNamespace(stdout=b"unix:///var/run/docker.sock\n")), \
             patch.dict(os.environ, {"DOCKER_HOST": "", "DOCKER_CONTEXT": ""}), \
             patch.object(SETUP.http.client.HTTPConnection, "request", request), \
             patch.object(SETUP.http.client.HTTPConnection, "getresponse", return_value=Response()):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                identifier = SETUP.create_replacement("candidate", SETUP.replacement_config(self.container(), TOKEN))
        self.assertEqual(identifier, "candidate-id")
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["path"], "/containers/create?name=candidate")
        self.assertEqual(captured["payload"]["Env"][-1], SETUP.KEY + "=" + TOKEN)
        self.assertNotIn(TOKEN, output.getvalue())

    def test_failed_replacement_restores_original_container_descriptor_and_runtime(self):
        for fail_stage in ("create", "start", "crash", "timeout"):
            with self.subTest(fail_stage=fail_stage), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                (root / "config").mkdir(); (root / "mcps").mkdir()
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
                original = self.container()
                calls = []
                swapped = False
                def command(arguments, **kwargs):
                    nonlocal swapped
                    calls.append(arguments)
                    if arguments[:2] == ["docker", "inspect"]:
                        if "--format" in arguments:
                            return types.SimpleNamespace(stdout=b"original-id\n", returncode=0)
                        state = self.container()
                        if swapped and fail_stage == "crash":
                            state["State"] = {"Running": False, "Restarting": True}
                        return types.SimpleNamespace(stdout=json.dumps([state]).encode(), returncode=0)
                    if arguments[-1] == SETUP.VALIDATE:
                        return types.SimpleNamespace(stdout=json.dumps({"yaml":yaml.safe_dump(registration)}).encode(),returncode=0)
                    if arguments[-1] == SETUP.VERIFY:
                        return types.SimpleNamespace(stdout=b"",returncode=1)
                    if arguments == ["docker", "start", "candidate-id"]:
                        if fail_stage == "start": raise RuntimeError("simulated candidate startup failure")
                        swapped = True
                    return types.SimpleNamespace(stdout=b"{}", returncode=0)
                def create(name, config):
                    if fail_stage == "create": raise RuntimeError("simulated create failure")
                    return "candidate-id"
                with patch.object(SETUP, "HUB_ROOT", root), patch.object(SETUP, "run", command), \
                     patch.object(SETUP, "create_replacement", create), \
                     patch.object(SETUP.socket, "gethostname", return_value="decopon"), \
                     patch.object(SETUP.time, "monotonic", side_effect=([0, 241] if fail_stage == "timeout" else [0, 1])), \
                     self.assertRaises(RuntimeError):
                    SETUP.hub(types.SimpleNamespace(connection=str(connection)), types.SimpleNamespace(pw_dir=str(root)))
                self.assertEqual(runtime.read_text(), original_env)
                self.assertEqual(target.read_bytes(), original_catalog)
                self.assertTrue(connection.exists())
                self.assertTrue(any(c[:3] == ["docker", "rm", "--force"] for c in calls))
                self.assertFalse(any("/app/.env" in str(c) for c in calls))

    def test_restore_renames_and_starts_retained_original_by_id(self):
        original = self.container()
        stopped = self.container()
        stopped["Name"] = "/retained-original"; stopped["State"]["Running"] = False
        calls = []
        def command(arguments, **kwargs):
            calls.append(arguments)
            return types.SimpleNamespace(stdout=json.dumps([stopped]).encode(), returncode=0)
        with patch.object(SETUP, "run", command):
            SETUP.restore_container(original, "candidate-id")
        self.assertEqual(calls, [["docker", "rm", "--force", "candidate-id"],
                               ["docker", "inspect", "original-id"],
                               ["docker", "rename", "original-id", "flamoris-mcp-hub"],
                               ["docker", "update", "--restart=unless-stopped", "original-id"],
                               ["docker", "start", "original-id"]])

    @unittest.skipUnless(os.environ.get("FLAMORIS2D_TEST_DOCKER"), "Explicit Docker boundary acceptance")
    def test_real_readonly_container_recreation_preserves_settings_and_adds_environment(self):
        image = "python:3.12-slim"
        prefix = "fl2d-env-test-" + os.urandom(6).hex()
        original = replacement = None
        with tempfile.TemporaryDirectory() as directory:
            pathlib.Path(directory).chmod(0o755)
            pathlib.Path(directory, "retained").write_text("mount retained")
            try:
                original = subprocess.check_output(["docker", "run", "-d", "--name", prefix,
                    "--read-only", "--network", "host", "--cap-drop", "ALL", "--user", "10001:10001",
                    "--security-opt", "no-new-privileges", "--restart", "unless-stopped",
                    "--label", "fl2d.acceptance=retained", "--env", "EXISTING_TOKEN=retained",
                    "--mount", "type=bind,src=" + directory + ",dst=/acceptance,readonly",
                    image, "python", "-c", "import time;time.sleep(300)"], text=True).strip()
                observed = json.loads(subprocess.check_output(["docker", "inspect", original]))[0]
                replacement = SETUP.create_replacement(prefix + "-new", SETUP.replacement_config(observed, TOKEN))
                subprocess.run(["docker", "start", replacement], check=True, capture_output=True)
                probe = subprocess.check_output(["docker", "exec", replacement, "python", "-c",
                    "import os,pathlib;print(os.environ['EXISTING_TOKEN']);print(os.environ['" + SETUP.KEY +
                    "']);print(pathlib.Path('/acceptance/retained').read_text())"], text=True)
                self.assertEqual(probe.splitlines(), ["retained", TOKEN, "mount retained"])
                actual = json.loads(subprocess.check_output(["docker", "inspect", replacement]))[0]
                self.assertEqual(actual["Image"], observed["Image"])
                for key in ("ReadonlyRootfs", "RestartPolicy", "CapDrop", "SecurityOpt", "NetworkMode"):
                    self.assertEqual(actual["HostConfig"][key], observed["HostConfig"][key])
                self.assertEqual(actual["Config"]["Labels"], observed["Config"]["Labels"])
                self.assertEqual(actual["Config"]["User"], observed["Config"]["User"])
            finally:
                for identifier in (replacement, original):
                    if identifier: subprocess.run(["docker", "rm", "-f", identifier], capture_output=True)

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
                cursor = message.get("params", {}).get("cursor")
                self.assertIn(cursor, (None, "second-page"))
                page = registration["tools"][:92] if cursor is None else registration["tools"][92:]
                value = {"tools": [{"name": "flamoris2d_lime." + item["name"], "inputSchema": item["input_schema"]}
                                   for item in page]}
                if cursor is None:
                    value["nextCursor"] = "second-page"
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
        self.assertEqual(calls, ["initialize", "notifications/initialized", "tools/list", "tools/list", "tools/call"])

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

