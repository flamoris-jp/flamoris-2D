#!/usr/bin/env python3
"""Reproduce the existing native-directory rejection, then migrate via real Updater/Docker."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
from unittest.mock import patch

from flamoris_update_core.wire import digest, dumps
from flamoris_updater_adapters.managed import Catalog, Manager, Start
from flamoris_updater_adapters.journal import Journal

REPO = Path(__file__).resolve().parents[2]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, REPO / path)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


RECOVERY = module('recovery', 'deploy/linux/recover-resident.py')
NATIVE = module('native', 'deploy/linux/setup-2d-lime.py')


def verify(catalog_path):
    assert os.geteuid() == 0 and os.environ.get('GITHUB_ACTIONS') == 'true'
    catalog = Catalog.model_validate_json(catalog_path.read_bytes())
    recipe = catalog.recipes[0]
    assert digest(dumps(recipe)) == RECOVERY.RECIPE
    with tempfile.TemporaryDirectory(prefix='2d-existing-native-') as directory:
        base = Path(directory); root = base / 'apps' / RECOVERY.APP
        (root / 'config').mkdir(parents=True); (root / 'state').mkdir()
        (root / 'state').chmod(0o777)
        manager = Manager(base / 'control', root.parent)
        manager.catalog = lambda refresh=False: catalog
        manager.accept_catalog(catalog)
        def download(url, limit, destination, expected):
            source = catalog_path.parent / url.rsplit('/',1)[1]
            with source.open('rb') as stream:
                import hashlib
                assert 'sha256:' + hashlib.file_digest(stream,'sha256').hexdigest() == expected
            shutil.copyfile(source,destination)
        manager._download = download
        image = catalog_path.parent / 'linux-amd64--image.tar'
        subprocess.run(['docker','load','--input',str(image)],check=True,stdout=subprocess.DEVNULL)
        subprocess.run(['docker','run','--rm','--network','none','--entrypoint','/app/flamoris2d',
                        '--mount',f'type=bind,src={root}/state,dst=/seed',RECOVERY.IMAGE,
                        'new','--output','/seed/initial.fl2d'],check=True)
        (root / 'state/connection.json').write_text(json.dumps({'endpoint':'wss://127.0.0.1:9/desktop/flamoris2d-ci',
                                                              'credential':'fixture_'+'a'*48}))
        (root / 'state/receipts').mkdir(); (root / 'state/receipts/retained').write_bytes(b'history')
        backup = root / 'native-backup-fixture'; backup.mkdir(mode=0o700)
        shutil.copytree(root / 'state',backup / 'state')
        (root / 'config/native-migration.json').write_text(json.dumps({'phase':'prepared','source':NATIVE.SOURCE,'backup':str(backup)}))
        unit = base / 'native.service'; unit.write_text(NATIVE.UNIT_TEXT)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); port = sock.getsockname()[1]
        job = manager.start('install',Start(application_id=RECOVERY.APP,release='0.1.1',
                          request_key='existing-native-test',settings={'PORT':str(port),'HUB_ENDPOINT':'','HUB_TOKEN':''}))
        manager.run_job(job['job_id'])
        rejected = manager.journal.get('managed_job',job['job_id'])
        assert (rejected['phase'],rejected['step'],rejected['error']) == ('recovery_required','install','not_empty'), rejected
        assert Journal(base / 'control/installer').get('initial_install',RECOVERY.APP) is None
        before = RECOVERY.fingerprints(root / 'state')
        def systemctl(*args):
            assert args[0] == 'systemctl'
            return b'inactive\n' if args[1] == 'show' else b''
        try:
            with patch.object(RECOVERY,'ROOT',root), patch.object(RECOVERY,'UNIT_PATH',unit), patch.object(RECOVERY,'command',side_effect=systemctl):
                # Refuse prior installer effects even when the outer error appears recoverable.
                original_get = Journal.get
                def prior_effect(journal,kind,identity,db=None):
                    if kind == 'initial_install': return {'phase':'intent','step':'files'}
                    return original_get(journal,kind,identity,db)
                with patch.object(Journal,'get',prior_effect):
                    try: RECOVERY.inspect_job(manager,job['job_id'])
                    except ValueError: pass
                    else: raise AssertionError('Effectful install must not be replayed')
                result = RECOVERY.recover(manager,job['job_id'],True)
            assert result['phase'] == 'succeeded', result
            retired = Path(result['retained'])
            assert RECOVERY.fingerprints(retired / 'state') == before
            assert all(RECOVERY.fingerprints(root / 'state')[k] == v for k,v in before.items())
            installed = manager.journal.get('managed_app',RECOVERY.APP)
            assert installed['phase'] == 'succeeded'
            final = manager.journal.get('managed_job',job['job_id'])
            assert final['recovered_failure']['error'] == 'not_empty'
            assert (retired / backup.name / 'state/initial.fl2d').exists()
            assert json.loads((root / 'config/native-migration.json').read_text())['legacyRoot'] == str(retired)
            print(json.dumps({'existing_native_migration':'passed','retained_files':len(before),'hub_verified':False}))
        finally:
            subprocess.run(['docker','logs','--tail','20',RECOVERY.APP],check=False)
            subprocess.run(['docker','rm','--force',RECOVERY.APP],check=False,stdout=subprocess.DEVNULL)


if __name__ == '__main__': verify(Path(sys.argv[1]))
