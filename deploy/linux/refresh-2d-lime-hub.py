#!/usr/bin/env python3
"""Refresh only the existing 2D LIME descriptor; retain credentials and rollback."""
import argparse
import fcntl
import hashlib
import json
import os
import pathlib
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.request

ROOT = pathlib.Path('/srv/flamoris/apps/flamoris-mcp-hub')
TARGET = ROOT / 'mcps/flamoris2d-lime.yaml'
CONTAINER = 'flamoris-mcp-hub'
TOOLS = {'cli.source_upload_' + name for name in ('begin', 'write', 'finish', 'cancel')}
VALIDATE = r'''
import json,sys,yaml
from flamoris_mcp_hub.config import UpstreamConfig,load_upstreams,config_dir
request=json.load(sys.stdin);candidate=request['candidate'];old=yaml.safe_load(request['previous'])
expected={'id':'flamoris2d-lime','namespace':'flamoris2d_lime','product_id':'flamoris.2d','transport':'reverse-websocket','connector_token_env':'FLAMORIS2D_LIME_CONNECTOR_TOKEN'}
if any(old.get(k)!=v or candidate.get(k)!=v for k,v in expected.items()):raise RuntimeError('Upstream identity differs')
if {k:v for k,v in old.items() if k!='tools'}!={k:v for k,v in candidate.items() if k!='tools'}:raise RuntimeError('Upstream settings differ')
added={'cli.source_upload_'+name for name in ('begin','write','finish','cancel')}
before={t['name']:t for t in old['tools']};after={t['name']:t for t in candidate['tools']}
if len(after)!=188 or len(candidate['tools'])!=188 or len(before)!=len(old['tools']) or len(before) not in (184,188):raise RuntimeError('Unexpected tool count')
if len(before)==184 and set(after)-set(before)!=added:raise RuntimeError('Unexpected added tools')
if not added<=set(after) or any(after.get(name)!=tool for name,tool in before.items()):raise RuntimeError('Existing tool changed')
for name in added:
 if after[name].get('annotations')!={'readOnlyHint':False,'destructiveHint':True,'openWorldHint':False}:raise RuntimeError('Unexpected upload effects')
serialized=yaml.safe_dump(candidate,sort_keys=False,allow_unicode=True)
if json.loads(json.dumps(yaml.safe_load(serialized)))!=candidate:raise RuntimeError('Schema YAML round trip differs')
d=UpstreamConfig.model_validate(yaml.safe_load(serialized))
for upstream in load_upstreams(config_dir()):
 if upstream.id!=d.id and upstream.namespace==d.namespace:raise RuntimeError('Namespace conflict')
print(json.dumps({'yaml':serialized}))
'''
VERIFY = "\nimport asyncio,inspect,json,os,sys\ntry:\n import httpx2 as httpx\nexcept ImportError:\n import httpx\nfrom dotenv import load_dotenv\nfrom flamoris_mcp_hub.config import env_file\nfrom mcp import ClientSession\nfrom mcp.types import PaginatedRequestParams\nfrom mcp.client.streamable_http import streamable_http_client\nload_dotenv(env_file(),override=False)\nexpected=json.load(sys.stdin)\nasync def main():\n port=os.environ.get('FLAMORIS_MCP_HUB_PORT','8769')\n headers={'Authorization':'Bearer '+os.environ['FLAMORIS_MCP_HUB_CLIENT_TOKEN']}\n async with httpx.AsyncClient(headers=headers,timeout=20,trust_env=False) as http:\n  url='http://127.0.0.1:'+port+'/mcp'\n  transport=streamable_http_client(url,http_client=http) if 'http_client' in inspect.signature(streamable_http_client).parameters else streamable_http_client(url,headers=headers)\n  async with transport as (read,write,*_):\n   async with ClientSession(read,write) as session:\n    await session.initialize()\n    actual={};cursor=None;seen=set()\n    while True:\n     pagination={'cursor':cursor} if 'cursor' in inspect.signature(session.list_tools).parameters else {'params':PaginatedRequestParams(cursor=cursor)}\n     page=(await session.list_tools(**pagination)).model_dump(by_alias=True)\n     for t in page['tools']:\n      if t['name'] in actual:raise RuntimeError('Duplicate tool')\n      actual[t['name']]=t\n     cursor=page.get('nextCursor')\n     if not cursor:break\n     if cursor in seen or len(seen)>64:raise RuntimeError('Invalid tool pagination')\n     seen.add(cursor)\n    for tool in expected['tools']:\n     public=expected['namespace']+'.'+tool['name']\n     if public not in actual or actual[public]['inputSchema']!=tool['input_schema']:raise RuntimeError('Catalog mismatch')\n    result=(await session.call_tool(expected['namespace']+'.mcp.context',{})).model_dump(by_alias=True)\n    if result.get('isError'):raise RuntimeError('Upstream not ready')\n    value=json.loads(next(x['text'] for x in result['content'] if x['type']=='text'))\n    if value.get('productId')!='flamoris.2d' or value.get('permission')!='edit' or not value.get('hasDocument'):raise RuntimeError('Unexpected host')\n    print(json.dumps({'connected':True,'toolCount':len(expected['tools']),'permission':value['permission'],\n                     'hasDocument':value['hasDocument'],'runtimeId':value['runtimeId']}))\nasyncio.run(main())\n"


def run(args, data=None, check=True, timeout=60):
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError('Deployment command failed: ' + args[0])
    return result


def no_links(path):
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise ValueError('Symbolic links are not accepted')


def atomic(path, data, mode=0o644):
    no_links(path)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            os.fchmod(output.fileno(), mode)
            output.write(data); output.flush(); os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        pathlib.Path(temporary).unlink(missing_ok=True)


def download(name, maximum):
    url = 'https://github.com/flamoris-jp/flamoris-2D/releases/download/cli-v0.1.2/' + name
    with urllib.request.urlopen(url, timeout=60) as response:
        content = response.read(maximum + 1)
    if len(content) > maximum:
        raise ValueError('Release asset exceeds its bound')
    return content


def candidate():
    manifest = download('SHA256SUMS', 65536).decode('ascii')
    matches = [line.split()[0] for line in manifest.splitlines()
               if len(line.split()) == 2 and line.split()[1] == 'flamoris2d-lime.json']
    raw = download('flamoris2d-lime.json', 2 * 1024 * 1024)
    if len(matches) != 1 or hashlib.sha256(raw).hexdigest() != matches[0]:
        raise ValueError('Descriptor checksum differs')
    return json.loads(raw)


def refresh(apply):
    if os.geteuid() != 0 or socket.gethostname().split('.')[0].lower() != 'decopon':
        raise ValueError('Run with sudo on DECO PON')
    no_links(TARGET)
    metadata = TARGET.stat()
    if metadata.st_uid != 0 or metadata.st_mode & 0o022:
        raise ValueError('Expected a root-owned protected descriptor')
    lock_path = ROOT / 'config/2d-refresh.lock'
    no_links(lock_path)
    with lock_path.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        previous = TARGET.read_bytes()
        registration = candidate()
        payload = json.dumps({'candidate': registration, 'previous': previous.decode()}).encode()
        checked = run(['docker', 'exec', '-i', CONTAINER, 'python', '-c', VALIDATE], payload)
        updated = json.loads(checked.stdout)['yaml'].encode()
        if not apply:
            print(json.dumps({'validated': True, 'changes': False, 'toolCount': 188}))
            return
        place(previous, updated, metadata.st_mode & 0o777, registration)


def place(previous, updated, mode, registration):
    backup = TARGET.with_name(TARGET.name + '.before-cli-0.1.2-' + time.strftime('%Y%m%d-%H%M%S') + '-' + secrets.token_hex(3))
    atomic(backup, previous, 0o600)
    if TARGET.read_bytes() != previous:
        raise RuntimeError('Descriptor changed before placement')
    try:
        atomic(TARGET, updated, mode)
        run(['docker', 'restart', '--time', '30', CONTAINER], timeout=90)
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            checked = run(['docker', 'exec', '-i', CONTAINER, 'python', '-c', VERIFY],
                          json.dumps(registration).encode(), check=False, timeout=25)
            if checked.returncode == 0:
                print(checked.stdout.decode().strip())
                print('Previous descriptor retained: ' + str(backup))
                return
            time.sleep(5)
        raise RuntimeError('New 188-tool connector did not pass verification')
    except Exception:
        atomic(TARGET, previous, mode)
        run(['docker', 'restart', '--time', '30', CONTAINER], timeout=90)
        raise RuntimeError('Refresh failed; previous descriptor restored') from None



if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    try:
        refresh(parser.parse_args().apply)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        # Raw command output and configuration can contain credentials.
        raise SystemExit('2D Hub refresh stopped; no credentials are printed. Check the release, running CLI and retained descriptor.') from None
