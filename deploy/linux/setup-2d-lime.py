#!/usr/bin/env python3
"""Install the reviewed LIME bundle, then register its separate DECO PON route.

No changes without --apply. Run from the normal operator account via sudo.
Credentials remain in private files or subprocess stdin, never terminal output.
"""
import argparse
import hashlib
import copy
import http.client
import json
import os
import pathlib
import pwd
import re
import secrets
import shlex
import shutil
import socket
import subprocess
import tarfile
import tempfile
import time
from urllib.parse import quote, urlsplit, urlunsplit

REPOSITORY = "flamoris-jp/flamoris-2D"
RUN_ID = "42356734679"
SOURCE = "d14d450dec2498603aa85db9f65864236bd4cba2"
ARCHIVE_SHA256 = "e72b07e8095f5f711dea170ae0a3a22bea0889a4db4cb834777915a69b6a369d"
ROOT = pathlib.Path("/srv/flamoris/apps/flamoris-2d-cli")
HUB_ROOT = pathlib.Path("/srv/flamoris/apps/flamoris-mcp-hub")
KEY = "FLAMORIS2D_LIME_CONNECTOR_TOKEN"
UNIT = "flamoris2d-lime.service"
SETTING = pathlib.Path("/etc/flamoris/flamoris2d-lime.env")
UNIT_DIRECTORY = pathlib.Path("/etc/systemd/system")
KACHINCO_SETTING = pathlib.Path("/srv/flamoris/apps/flamoris-kachinco-cli/config/runtime.env")
READS = {"mcp.context", "live.context", "live.dispositions", "cli.preview_frame", "cli.render_status"}
TOP = "FLAMORIS-2D-linux-x64"
UNIT_TEXT = """[Unit]
Description=FLAMORIS 2D headless LIME MCP service
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=flamoris-2d
Group=flamoris-2d
WorkingDirectory=/srv/flamoris/apps/flamoris-2d-cli/state
EnvironmentFile=/etc/flamoris/flamoris2d-lime.env
ExecStart=/srv/flamoris/apps/flamoris-2d-cli/bin/flamoris2d mcp /srv/flamoris/apps/flamoris-2d-cli/state/initial.fl2d --workspace /srv/flamoris/apps/flamoris-2d-cli/state/workspace --permission edit --hub ${HUB_ENDPOINT}
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/flamoris/apps/flamoris-2d-cli/state
MemoryMax=2G
TasksMax=128

[Install]
WantedBy=multi-user.target
"""

# Same public native New/Serialize ABI used by NativeWorkspace.NewAsync.
# This creates a normal empty document, without test fixtures or a second model.
BOOTSTRAP = r'''
import ctypes,datetime,json,os,sys
r=json.load(sys.stdin);lib=ctypes.CDLL(r['library'])
major=ctypes.c_int32();minor=ctypes.c_int32()
if lib.fl2d_abi_version(ctypes.byref(major),ctypes.byref(minor)) or major.value!=1 or minor.value<5:raise RuntimeError('Native ABI mismatch')
buffer=ctypes.c_void_p;size=ctypes.c_uint32;pointer=ctypes.POINTER(size)
source=lib.fl2d_source_project_json;source.argtypes=[ctypes.c_char_p,size,buffer,size,pointer];source.restype=ctypes.c_int32
serialize=lib.fl2d_session_document_json;serialize.argtypes=[buffer,ctypes.c_char_p,size,buffer,size,pointer];serialize.restype=ctypes.c_int32
create=lib.fl2d_session_create;create.argtypes=[ctypes.c_char_p,size,ctypes.POINTER(buffer)];create.restype=ctypes.c_int32
destroy=lib.fl2d_session_destroy;destroy.argtypes=[buffer];destroy.restype=None
def query(function,prefix,request):
 payload=json.dumps(request,separators=(',',':')).encode();length=size()
 if function(*prefix,payload,len(payload),None,0,ctypes.byref(length))!=7 or not 0<length.value<=134217729:raise RuntimeError('Native sizing failed')
 output=ctypes.create_string_buffer(length.value);copied=size()
 if function(*prefix,payload,len(payload),output,len(output),ctypes.byref(copied)) or copied.value!=len(output) or output.raw[-1]!=0:raise RuntimeError('Native read failed')
 result=json.loads(output.raw[:-1])
 if 'error' in result:raise RuntimeError('Native document rejected')
 return result['value']
project=query(source,[],{'kind':'blank','source':{'width':1920,'height':1080},'options':{'projectName':'LIME 2D'}})['project']
payload=json.dumps(project,separators=(',',':')).encode();session=buffer()
if create(payload,len(payload),ctypes.byref(session)):raise RuntimeError('Native session failed')
try:
 now=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
 document=query(serialize,[session],{'now':now,'createdAt':now,'modifiedAt':now,'renderAssets':[]})
 with os.fdopen(os.open(r['output'],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb') as f:
  f.write(json.dumps(document,separators=(',',':')).encode());f.flush();os.fsync(f.fileno())
finally:destroy(session)
'''


def run(arguments, *, data=None, check=True, timeout=60):
    result = subprocess.run(arguments, input=data, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError("Command failed: " + str(arguments[0]))
    return result


def values(text):
    result = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key, separator, value = stripped.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or key in result:
            raise ValueError("Invalid/duplicate environment setting")
        tokens = shlex.split(value, comments=True)
        result[key] = tokens[0] if len(tokens) == 1 else ("" if not tokens else value)
    return result


def append_credential(text, token):
    if not re.fullmatch(r"[A-Za-z0-9_-]{40,128}", token):
        raise ValueError("Invalid connector credential")
    old = values(text)
    if KEY in old:
        if old[KEY] != token:
            raise ValueError("An existing 2D credential differs; no automatic rotation")
        return text
    return text + ("" if not text or text.endswith("\n") else "\n") + KEY + "=" + token + "\n"


def endpoint_from_existing(endpoint):
    parsed = urlsplit(endpoint)
    if (parsed.scheme != "wss" or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or "/desktop/" not in parsed.path):
        raise ValueError("Supply a dedicated WSS --hub-endpoint; existing endpoint is not suitable")
    prefix, _, identifier = parsed.path.rpartition("/desktop/")
    if not identifier or "/" in identifier:
        raise ValueError("Invalid existing desktop route")
    return urlunsplit((parsed.scheme, parsed.netloc, prefix + "/desktop/flamoris2d-lime", "", ""))


def descriptor(raw):
    raw = json.loads(json.dumps(raw))
    if (raw.get("id") != "flamoris2d-lime" or raw.get("namespace") != "flamoris2d_lime"
            or raw.get("product_id") != "flamoris.2d" or raw.get("transport") != "reverse-websocket"
            or raw.get("connector_token_env") != KEY or len(raw.get("tools", [])) != 184):
        raise ValueError("Unexpected reviewed 2D descriptor")
    names = [tool["name"] for tool in raw["tools"]]
    if len(set(names)) != 184 or not {"cli.preview_frame", "cli.project_save", "cli.render_start", "mcp.context"}.issubset(names):
        raise ValueError("Invalid 2D tool set")
    for tool in raw["tools"]:
        query = tool["name"] in READS or tool["name"].startswith("query.")
        expected = {"readOnlyHint": query, "destructiveHint": not query, "openWorldHint": False}
        if tool.get("annotations") != expected:
            raise ValueError("Unexpected tool effects in reviewed descriptor")
    return raw


def no_links(path):
    for parent in [path, *path.parents]:
        if parent.is_symlink():
            raise ValueError("Deployment path must not contain symbolic links")


def atomic(path, content, mode=0o600, uid=0, gid=0):
    no_links(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name("." + path.name + "." + secrets.token_hex(8))
    try:
        with temporary.open("xb") as output:
            os.fchmod(output.fileno(), mode)
            if os.geteuid() == 0:
                os.fchown(output.fileno(), uid, gid)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def extract_verified(archive, destination):
    with archive.open("rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != ARCHIVE_SHA256:
            raise ValueError("Bundle digest mismatch; nothing installed")
    with tarfile.open(archive) as bundle:
        members = bundle.getmembers()
        if len(members) > 1000 or sum(member.size for member in members) > 512 * 1024 * 1024:
            raise ValueError("Bundle size limit")
        for member in members:
            name = pathlib.PurePosixPath(member.name)
            if (name.is_absolute() or ".." in name.parts or not name.parts or name.parts[0] != TOP
                    or not (member.isdir() or member.isfile())):
                raise ValueError("Unsafe bundle member")
        bundle.extractall(destination, filter="data")
    # Python's data filter deliberately discards directory modes. The staging
    # directory starts 0700; the dedicated service account must traverse it.
    destination.chmod(0o755)
    for directory in destination.rglob("*"):
        if directory.is_dir():
            directory.chmod(0o755)
    release = destination / TOP
    if not (release / "flamoris2d").is_file():
        raise ValueError("Executable missing")
    verify_release(release)
    return release


def verify_release(release):
    inventory = release / "SHA256SUMS.txt"
    if not inventory.is_file() or inventory.stat().st_size > 1024 * 1024:
        raise ValueError("Bundle inventory missing")
    seen = set()
    for line in inventory.read_text().splitlines():
        digest, name = line.split("  ", 1)
        relative = pathlib.PurePosixPath(name)
        if (not re.fullmatch(r"[0-9a-f]{64}", digest) or relative.is_absolute() or ".." in relative.parts
                or name in seen or not name or str(relative) != name):
            raise ValueError("Invalid bundle inventory")
        seen.add(name)
        target = release / name
        no_links(target)
        with target.open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != digest:
                raise ValueError("Installed runtime checksum mismatch")
    actual = {str(p.relative_to(release)) for p in release.rglob("*") if p.is_file() and p != inventory}
    if actual != seen:
        raise ValueError("Installed runtime inventory differs")


def operator():
    user = os.environ.get("SUDO_USER", "")
    if not user or user == "root":
        raise ValueError("Run via sudo from your normal authenticated GitHub operator account")
    return pwd.getpwnam(user)


def as_operator(user, arguments, **kwargs):
    return run(["runuser", "-u", user.pw_name, "--", *arguments], **kwargs)


def lime(args, user):
    if socket.gethostname().split(".")[0].lower() != "lime":
        raise ValueError("The lime phase must run on LIME")
    no_links(ROOT)
    ROOT.mkdir(parents=True, exist_ok=True)
    ROOT.chmod(0o755)
    docker = run(["docker", "inspect", "flamoris-2d-cli"], check=False)
    if docker.returncode == 0:
        raise ValueError("A Docker 2D installation exists; do not install a second host")
    setting = SETTING
    no_links(setting)
    old = values(setting.read_text()) if setting.exists() else {}
    if args.hub_endpoint:
        endpoint = endpoint_from_existing(args.hub_endpoint)
    elif "HUB_ENDPOINT" in old:
        endpoint = endpoint_from_existing(old["HUB_ENDPOINT"])
    else:
        previous = KACHINCO_SETTING
        endpoint = endpoint_from_existing(values(previous.read_text()).get("KACHINCO_HUB_ENDPOINT", ""))
    token = old.get("FLAMORIS_HUB_CREDENTIAL") or secrets.token_urlsafe(48)
    append_credential("", token)
    cache = ROOT / "packages"
    cache.mkdir(parents=True, exist_ok=True)
    archive = pathlib.Path(args.archive).resolve() if args.archive else cache / (SOURCE + ".tar.gz")
    if not archive.exists():
        as_operator(user, ["gh", "auth", "status"])
        temporary = pathlib.Path(tempfile.mkdtemp(prefix="2d-download-"))
        os.chown(temporary, user.pw_uid, user.pw_gid)
        try:
            as_operator(user, ["gh", "run", "download", RUN_ID, "--repo", REPOSITORY,
                               "--name", "FLAMORIS-2D-linux-x64", "--dir", str(temporary)], timeout=180)
            shutil.copyfile(temporary / "FLAMORIS-2D-linux-x64.tar.gz", archive)
            archive.chmod(0o600)
        finally:
            shutil.rmtree(temporary)
    release = ROOT / "releases" / SOURCE
    if not release.exists():
        staged = pathlib.Path(tempfile.mkdtemp(prefix=".2d-", dir=cache))
        try:
            unpacked = extract_verified(archive, staged)
            release.parent.mkdir(parents=True, exist_ok=True)
            release.parent.chmod(0o755)
            unpacked.rename(release)
        finally:
            if staged.exists():
                shutil.rmtree(staged)
    else:
        with archive.open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != ARCHIVE_SHA256:
                raise ValueError("Cached bundle digest mismatch")
        verify_release(release)
    registration = descriptor(json.loads((release / "flamoris2d-lime.json").read_text()))
    observed = json.loads(run([str(release / "flamoris2d"), "mcp-catalog"]).stdout)
    if descriptor(observed) != registration:
        raise ValueError("Installed executable does not match reviewed catalog")
    unit = UNIT_DIRECTORY / UNIT
    unit_bytes = UNIT_TEXT.encode()
    if unit.exists() and unit.read_bytes() != unit_bytes:
        raise ValueError("Existing service unit differs; no automatic replacement")
    binary = ROOT / "bin"
    if binary.exists() and not binary.is_symlink():
        raise ValueError("Existing non-managed bin directory; no automatic replacement")
    try:
        account = pwd.getpwnam("flamoris-2d")
    except KeyError:
        run(["useradd", "--system", "--user-group", "--home-dir", str(ROOT / "state"),
             "--shell", "/usr/sbin/nologin", "flamoris-2d"])
        account = pwd.getpwnam("flamoris-2d")
    state = ROOT / "state"
    no_links(state)
    state.mkdir(exist_ok=True)
    os.chown(state, account.pw_uid, account.pw_gid)
    state.chmod(0o700)
    initial = state / "initial.fl2d"
    no_links(initial)
    if args.input and (initial.exists() or (state / "workspace/project.fl2d").exists()):
        raise ValueError("Existing workspace retained; --input is only for first setup")
    if not initial.exists():
        if args.input:
            temporary = pathlib.Path(tempfile.mkdtemp(prefix="2d-import-"))
            os.chown(temporary, user.pw_uid, user.pw_gid)
            try:
                imported = temporary / "initial.fl2d"
                as_operator(user, [str(release / "flamoris2d"), "import", args.input, "--output", str(imported)])
                atomic(initial, imported.read_bytes(), uid=account.pw_uid, gid=account.pw_gid)
            finally:
                shutil.rmtree(temporary)
        else:
            run(["runuser", "-u", account.pw_name, "--", "python3", "-c", BOOTSTRAP],
                data=json.dumps({"library": str(release / "libFlamoris2D.Core.Native.so"), "output": str(initial)}).encode())
    run(["runuser", "-u", account.pw_name, "--", str(release / "flamoris2d"), "inspect", str(initial)])
    run(["runuser", "-u", account.pw_name, "--", str(release / "flamoris2d"), "--help"])
    link = ROOT / (".bin-" + secrets.token_hex(8))
    link.symlink_to(release)
    os.replace(link, binary)
    atomic(setting, ("HUB_ENDPOINT=" + endpoint + "\nFLAMORIS_HUB_CREDENTIAL=" + token + "\n").encode())
    atomic(unit, unit_bytes, 0o644)
    connection = pathlib.Path(user.pw_dir) / "flamoris2d-lime-connect.json"
    atomic(connection, json.dumps({"version": 1, "source": SOURCE, "archiveSha256": ARCHIVE_SHA256,
           "endpoint": endpoint, "credential": token, "descriptor": registration}, indent=2).encode(),
           uid=user.pw_uid, gid=user.pw_gid)
    run(["systemctl", "daemon-reload"])
    run(["systemctl", "enable", "--now", UNIT])
    run(["systemctl", "is-active", "--quiet", UNIT])
    copied = as_operator(user, ["scp", "-q", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
                                  str(connection), user.pw_name + "@decopon:flamoris2d-lime-connect.json"],
                         check=False, timeout=25).returncode == 0
    print(json.dumps({"installed": True, "active": True, "source": SOURCE,
                      "hubSetupPending": True, "privateBundleCopiedToDecopon": copied}))
    if not copied:
        print("Copy the private file using: scp ~/flamoris2d-lime-connect.json " + user.pw_name + "@decopon:flamoris2d-lime-connect.json")


def replacement_config(observed, token):
    """Recreate the installed host-network Hub with its exact image/settings."""
    host = copy.deepcopy(observed["HostConfig"])
    if host.get("NetworkMode") != "host" or host.get("AutoRemove"):
        raise ValueError("Hub replacement requires retained host-network container")
    if host.get("VolumesFrom") or host.get("Links") or host.get("ContainerIDFile"):
        raise ValueError("Dependent container configuration requires manual review")
    if any(isinstance(v, str) and v.startswith("container:") for v in host.values()):
        raise ValueError("Shared container namespaces require manual review")
    if any(mount["Type"] != "bind" for mount in observed.get("Mounts", [])):
        raise ValueError("Non-bind data mounts require manual review")
    config = copy.deepcopy(observed["Config"])
    environment = list(config.get("Env") or [])
    if any(value.split("=", 1)[0] == KEY for value in environment):
        raise ValueError("Replacement must not overwrite an existing credential")
    config["Env"] = environment + [KEY + "=" + token]
    # Host networking derives its hostname from the host namespace.
    config.pop("Hostname", None)
    if config.get("Domainname"):
        raise ValueError("Custom domain name requires manual review")
    config["Image"] = observed["Image"]  # immutable installed image, never pull a tag
    config["HostConfig"] = host
    return config


def create_replacement(name, config):
    # Docker Engine ContainerCreate accepts Config + HostConfig as JSON.
    # Secrets never enter process arguments or output.
    endpoint = run(["docker", "context", "inspect", "--format",
                    "{{.Endpoints.docker.Host}}"]).stdout.decode().strip()
    if os.environ.get("DOCKER_HOST") or os.environ.get("DOCKER_CONTEXT"):
        raise ValueError("Use the local default Docker context")
    if endpoint not in ("unix:///var/run/docker.sock", "unix:///run/docker.sock"):
        raise ValueError("Hub replacement requires the local Docker socket")

    class LocalDocker(http.client.HTTPConnection):
        def connect(self):
            self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.sock.settimeout(self.timeout)
            self.sock.connect(endpoint[len("unix://"):])

    connection = LocalDocker("localhost", timeout=60)
    try:
        connection.request("POST", "/containers/create?name=" + quote(name, safe=""),
                           body=json.dumps(config).encode(),
                           headers={"Content-Type": "application/json"})
        response = connection.getresponse()
        payload = response.read(1024 * 1024)
        if response.status != 201:
            raise RuntimeError("Docker container creation failed (HTTP " + str(response.status) + ")")
        return json.loads(payload)["Id"]
    finally:
        connection.close()


def restore_container(observed, candidate):
    """Restore the original retained container by immutable ID after a failed swap."""
    original = observed["Id"]
    if candidate:
        run(["docker", "rm", "--force", candidate], check=False)
    current = json.loads(run(["docker", "inspect", original]).stdout)[0]
    name = observed["Name"].lstrip("/")
    if current["Name"] != observed["Name"]:
        run(["docker", "rename", original, name])
    policy = observed["HostConfig"].get("RestartPolicy") or {"Name": "no"}
    restart = policy.get("Name") or "no"
    if restart == "on-failure" and policy.get("MaximumRetryCount"):
        restart += ":" + str(policy["MaximumRetryCount"])
    run(["docker", "update", "--restart=" + restart, original])
    if observed["State"]["Running"] and not current["State"]["Running"]:
        run(["docker", "start", original])


VALIDATE = r'''
import json,sys,yaml
from flamoris_mcp_hub.config import UpstreamConfig,load_upstreams,config_dir
raw=json.load(sys.stdin)
serialized=yaml.safe_dump(raw,sort_keys=False,allow_unicode=True)
decoded=yaml.safe_load(serialized)
if json.dumps(raw,sort_keys=True)!=json.dumps(decoded,sort_keys=True):
 raise SystemExit('Catalog YAML round trip changed the schema')
d=UpstreamConfig.model_validate(decoded)
for old in load_upstreams(config_dir()):
 if (old.id==d.id or old.namespace==d.namespace) and old.model_dump()!=d.model_dump():
  raise SystemExit('Existing upstream conflicts; no overwrite')
print(json.dumps({'validated':True,'tools':len(d.tools),'yaml':serialized}))
'''

VERIFY = r'''
import asyncio,inspect,json,os,sys
try:
 import httpx2 as httpx
except ImportError:
 import httpx
from dotenv import load_dotenv
from flamoris_mcp_hub.config import env_file
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
load_dotenv(env_file(),override=False)
expected=json.load(sys.stdin)
async def main():
 port=os.environ.get('FLAMORIS_MCP_HUB_PORT','8769')
 headers={'Authorization':'Bearer '+os.environ['FLAMORIS_MCP_HUB_CLIENT_TOKEN']}
 async with httpx.AsyncClient(headers=headers,timeout=20,trust_env=False) as http:
  url='http://127.0.0.1:'+port+'/mcp'
  transport=streamable_http_client(url,http_client=http) if 'http_client' in inspect.signature(streamable_http_client).parameters else streamable_http_client(url,headers=headers)
  async with transport as (read,write,*_):
   async with ClientSession(read,write) as session:
    await session.initialize()
    actual={};cursor=None;seen=set()
    while True:
     page=(await session.list_tools(cursor=cursor)).model_dump(by_alias=True)
     for t in page['tools']:
      if t['name'] in actual:raise RuntimeError('Duplicate tool')
      actual[t['name']]=t
     cursor=page.get('nextCursor')
     if not cursor:break
     if cursor in seen or len(seen)>64:raise RuntimeError('Invalid tool pagination')
     seen.add(cursor)
    for tool in expected['tools']:
     public=expected['namespace']+'.'+tool['name']
     if public not in actual or actual[public]['inputSchema']!=tool['input_schema']:raise RuntimeError('Catalog mismatch')
    result=(await session.call_tool(expected['namespace']+'.mcp.context',{})).model_dump(by_alias=True)
    if result.get('isError'):raise RuntimeError('Upstream not ready')
    value=json.loads(next(x['text'] for x in result['content'] if x['type']=='text'))
    if value.get('productId')!='flamoris.2d' or value.get('permission')!='edit' or not value.get('hasDocument'):raise RuntimeError('Unexpected host')
    print(json.dumps({'connected':True,'toolCount':len(expected['tools']),'permission':value['permission'],
                     'hasDocument':value['hasDocument'],'runtimeId':value['runtimeId']}))
asyncio.run(main())
'''


def hub(args, user):
    if socket.gethostname().split(".")[0].lower() != "decopon":
        raise ValueError("The hub phase must run on DECO PON")
    path = pathlib.Path(args.connection or (pathlib.Path(user.pw_dir) / "flamoris2d-lime-connect.json"))
    no_links(path)
    if path.stat().st_mode & 0o077 or path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError("Connection file must be private (chmod 600), at most 2 MiB")
    connection = json.loads(path.read_text())
    if connection.get("source") != SOURCE or connection.get("archiveSha256") != ARCHIVE_SHA256:
        raise ValueError("Unexpected deployment source")
    registration = descriptor(connection["descriptor"])
    token = connection["credential"]
    container = "flamoris-mcp-hub"
    observed = json.loads(run(["docker", "inspect", container]).stdout)[0]
    current_env = dict(value.split("=", 1) for value in observed["Config"].get("Env", []) if "=" in value)
    if current_env.get(KEY) not in (None, token):
        raise ValueError("Container has a different 2D credential; no takeover")
    runtime = HUB_ROOT / "config/runtime.env"
    no_links(runtime)
    old_env = runtime.read_text()
    updated = append_credential(old_env, token)
    target = HUB_ROOT / "mcps/flamoris2d-lime.yaml"
    no_links(target)
    previous_target = target.read_bytes() if target.exists() else None
    validated = run(["docker", "exec", "-i", container, "python", "-c", VALIDATE],
                    data=json.dumps(registration).encode())
    registration_bytes = json.loads(validated.stdout)["yaml"].encode()
    needs_replacement = KEY not in current_env
    replacement = replacement_config(observed, token) if needs_replacement else None
    backups = HUB_ROOT / "config" / ("2d-setup-backup-" + time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3))
    backups.mkdir(mode=0o700)
    atomic(backups / "runtime.env", old_env.encode())
    candidate = None
    candidate_name = container + "-2d-candidate-" + secrets.token_hex(6)
    old_name = container + "-before-2d-" + secrets.token_hex(6)
    stage = "retain configuration"
    # The inspect snapshot includes credentials: keep it root-only, never print it.
    atomic(backups / "container.json", json.dumps(observed).encode())
    try:
        atomic(runtime, updated.encode(), mode=runtime.stat().st_mode & 0o777,
               uid=runtime.stat().st_uid, gid=runtime.stat().st_gid)
        atomic(target, registration_bytes, mode=0o644)
        if needs_replacement:
            stage = "create replacement container"
            candidate = create_replacement(candidate_name, replacement)
            stage = "confirm installed container"
            current = run(["docker", "inspect", "--format", "{{.Id}}", container]).stdout.decode().strip()
            if current != observed["Id"]:
                raise RuntimeError("Hub changed during setup")
            stage = "retain original restart policy"
            run(["docker", "update", "--restart=no", observed["Id"]])
            stage = "stop installed Hub"
            run(["docker", "stop", "--time", "30", observed["Id"]], timeout=60)
            stage = "retain original container"
            run(["docker", "rename", observed["Id"], old_name])
            stage = "name replacement container"
            run(["docker", "rename", candidate, container])
            stage = "start replacement Hub"
            run(["docker", "start", candidate], timeout=60)
        else:
            stage = "restart Hub"
            run(["docker", "restart", "--time", "30", container], timeout=60)
        deadline = time.monotonic() + 240
        stage = "verify Hub startup and LIME connection"
        while time.monotonic() < deadline:
            state = json.loads(run(["docker", "inspect", container]).stdout)[0]["State"]
            if state.get("Restarting") or not state.get("Running"):
                raise RuntimeError("Hub exited during verification")
            verified = run(["docker", "exec", "-i", container, "python", "-c", VERIFY],
                           data=json.dumps(registration).encode(), check=False, timeout=25)
            if verified.returncode == 0:
                print(verified.stdout.decode().strip())
                path.unlink()
                if needs_replacement:
                    # Keep the stopped original for operator rollback; do not delete it.
                    print("Previous stopped Hub retained as " + old_name)
                return
            print("Waiting for the LIME connector; no editing request is being sent.", flush=True)
            time.sleep(10)
        raise RuntimeError("Hub or LIME connector did not pass verification within four minutes")

    except Exception:
        atomic(runtime, old_env.encode())
        if previous_target is not None:
            atomic(target, previous_target, mode=0o644)
        elif not target.exists() or target.read_bytes() == registration_bytes:
            target.unlink(missing_ok=True)
        try:
            if needs_replacement:
                restore_container(observed, candidate or candidate_name)
            else:
                run(["docker", "restart", "--time", "30", container])
        except Exception:
            raise RuntimeError("Hub setup failed at " + stage + "; container restoration needs inspection") from None
        raise RuntimeError("Hub setup failed at " + stage + "; previous container/settings restored") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role", choices=["lime", "hub"])
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--archive")
    parser.add_argument("--input", help="Optional artwork/.fl2d to import on first LIME setup; default is a native empty project")
    parser.add_argument("--hub-endpoint")
    parser.add_argument("--connection")
    args = parser.parse_args()
    if not args.apply:
        print(json.dumps({"role": args.role, "changes": False, "artifactRun": RUN_ID,
                          "source": SOURCE, "archiveSha256": ARCHIVE_SHA256}))
        return
    if os.geteuid() != 0:
        raise ValueError("Use sudo from the normal operator account")
    user = operator()
    (lime if args.role == "lime" else hub)(args, user)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError, KeyError, subprocess.SubprocessError) as error:
        # Only our bounded messages are printable; never echo subprocess payload/traceback.
        detail = str(error) if type(error) in (RuntimeError, ValueError) else type(error).__name__
        print("Setup stopped: " + detail)
        raise SystemExit(1)
