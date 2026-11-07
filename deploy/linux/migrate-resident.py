#!/usr/bin/env python3
"""Prepare retained state for Updater, or remove verified obsolete native files."""
import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import socket
import subprocess
import time
import urllib.request

ROOT = pathlib.Path('/srv/flamoris/apps/flamoris-2d-cli')
UNIT = 'flamoris2d-lime.service'


def run(*args):
    return subprocess.run(list(args), check=True, capture_output=True)


def cleanup_hub(apply):
    if os.geteuid() != 0 or socket.gethostname().split('.')[0] != 'decopon':
        raise ValueError('Run Hub cleanup with sudo on DECO PON')
    # Live MCP verification precedes deletion; use the same official-client verifier.
    spec = importlib.util.spec_from_file_location('setup', pathlib.Path(__file__).with_name('setup-2d-lime.py'))
    setup = importlib.util.module_from_spec(spec); spec.loader.exec_module(setup)
    script = "from flamoris_mcp_hub.config import load_upstreams,config_dir;import json;print(json.dumps(next(c.model_dump() for c in load_upstreams(config_dir()) if c.id=='flamoris2d-lime')))"
    registration = run('docker', 'exec', 'flamoris-mcp-hub', 'python', '-c', script).stdout
    checked = subprocess.run(['docker','exec','-i','flamoris-mcp-hub','python','-c',setup.VERIFY], input=registration,capture_output=True,timeout=30)
    if checked.returncode: raise ValueError('Verify the active 2D Hub connection before cleanup')
    current = json.loads(run('docker','inspect','flamoris-mcp-hub').stdout)[0]
    ids = run('docker','ps','-aq').stdout.decode().split()
    if not ids: return
    import re
    candidates = []
    for container in json.loads(run('docker','inspect',*ids).stdout):
        name = container['Name'].lstrip('/')
        if not re.fullmatch(r'flamoris-mcp-hub-(?:before-2d-[0-9a-f]{12}|2d-failed-[0-9a-f]{8}|2d-candidate-[0-9a-f]{12})',name): continue
        if container['State']['Running'] or container['Image'] != current['Image']: continue
        if container.get('Mounts') != current.get('Mounts'): continue
        candidates.append((container['Id'],name))
    print(json.dumps({'changes':apply,'stoppedContainers':[name for _,name in candidates]}))
    if apply:
        for identifier,_ in candidates: run('docker','rm',identifier)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'cleanup'])
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--hub', action='store_true', help='Clean only stopped 2D Hub swap containers on DECO PON')
    parser.add_argument('--port', type=int, default=8774)
    args = parser.parse_args()
    if not args.apply and not args.hub:
        print(json.dumps({'changes': False, 'action': args.action, 'retained': str(ROOT / 'state')})); return
    if args.hub:
        cleanup_hub(args.apply)
        return
    if os.geteuid() != 0 or socket.gethostname().split('.')[0] != 'lime':
        raise ValueError('Run with sudo on LIME')
    spec = importlib.util.spec_from_file_location('native_setup', pathlib.Path(__file__).with_name('setup-2d-lime.py'))
    native = importlib.util.module_from_spec(spec); spec.loader.exec_module(native)
    native.no_links(ROOT)
    state = ROOT / 'state'
    record = ROOT / 'config/native-migration.json'
    native.no_links(state); native.no_links(record)
    if args.action == 'prepare':
        if record.exists():
            print(json.dumps({'prepared': True, 'retained': True})); return
        setting = pathlib.Path('/etc/flamoris/flamoris2d-lime.env')
        native.no_links(setting)
        old = native.values(setting.read_text())
        endpoint = native.endpoint_from_existing(old['HUB_ENDPOINT'])
        credential = old['FLAMORIS_HUB_CREDENTIAL']; native.append_credential('', credential)
        if not (state / 'initial.fl2d').is_file(): raise ValueError('Native startup project is missing')
        # The backup includes the source, checkpoints, render receipts and history.
        backup = ROOT / ('native-backup-' + time.strftime('%Y%m%d-%H%M%S'))
        backup.mkdir(mode=0o700)
        run('systemctl', 'stop', UNIT)
        try:
            for path in state.rglob('*'):
                if path.is_symlink(): raise ValueError('Linked workspace requires manual migration')
            shutil.copytree(state, backup / 'state')
            shutil.copy2(setting, backup / 'native.env')
            native.atomic(state / 'connection.json', json.dumps({'endpoint': endpoint, 'credential': credential}).encode(), uid=10001, gid=10001)
            for path in [state, *state.rglob('*')]:
                os.chown(path, 10001, 10001)
                path.chmod(0o700 if path.is_dir() else 0o600)
            native.atomic(record, json.dumps({'backup': str(backup), 'source': native.SOURCE, 'phase': 'prepared'}).encode())
            run('systemctl', 'disable', UNIT)
        except Exception:
            # Preserve all copies; the original service is only restarted after ownership is restored.
            import pwd
            account = pwd.getpwnam('flamoris-2d')
            for path in [state, *state.rglob('*')]: os.chown(path, account.pw_uid, account.pw_gid)
            run('systemctl', 'start', UNIT)
            raise
        print(json.dumps({'prepared': True, 'backup': str(backup), 'updaterApplication': 'flamoris-2d-cli'}))
        return
    if not record.exists(): raise ValueError('Migration record is required')
    migration = json.loads(record.read_text())
    observed = json.loads(run('docker', 'inspect', 'flamoris-2d-cli').stdout)[0]
    if not observed['State']['Running'] or not any(m.get('Source') == str(state) and m.get('Destination') == '/data/state' for m in observed['Mounts']):
        raise ValueError('Managed container must be running with the retained workspace')
    with urllib.request.urlopen(f'http://127.0.0.1:{args.port}/healthz', timeout=5) as response:
        healthy = json.load(response)
    if healthy.get('hubConnected') is not True: raise ValueError('Complete Hub registration before cleanup')
    active = subprocess.run(['systemctl', 'is-active', '--quiet', UNIT]).returncode == 0
    if active: raise ValueError('Native service must be stopped')
    source = migration['source']
    if source != native.SOURCE: raise ValueError('Unexpected legacy release; no deletion')
    binary = ROOT / 'bin'
    unit = pathlib.Path('/etc/systemd/system') / UNIT
    release = ROOT / 'releases' / source
    archive = ROOT / 'packages' / (source + '.tar.gz')
    for path in (unit, release, archive): native.no_links(path)
    if binary.is_symlink():
        if binary.resolve() != release: raise ValueError('Unexpected legacy binary path')
    elif binary.exists(): raise ValueError('Unexpected legacy binary path')
    if unit.exists() and unit.read_text() != native.UNIT_TEXT: raise ValueError('Service unit differs; no deletion')
    if release.exists(): native.verify_release(release)
    if archive.exists():
        with archive.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != native.ARCHIVE_SHA256: raise ValueError('Legacy archive differs')
    if binary.is_symlink(): binary.unlink()
    if unit.exists(): unit.unlink(); run('systemctl', 'daemon-reload')
    if release.exists(): shutil.rmtree(release)
    archive.unlink(missing_ok=True)
    print(json.dumps({'cleaned': True, 'retainedState': str(state), 'retainedRollbackBackup': migration['backup']}))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print('Migration stopped: ' + (str(error) if isinstance(error, ValueError) else type(error).__name__))
        raise SystemExit(1)
