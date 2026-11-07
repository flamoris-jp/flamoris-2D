import contextlib
import importlib.util
import io
import json
import os
import pathlib
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result

ENTRY = module('entry', 'product/packaging/updater-entrypoint.py')
PACKAGE = module('package', 'product/packaging/package-updater.py')
MIGRATE = module('migration', 'deploy/linux/migrate-resident.py')
NATIVE = module('native', 'deploy/linux/setup-2d-lime.py')


class ResidentTests(unittest.TestCase):
    def test_cleanup_uses_retired_root_and_retains_both_state_copies(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory) / 'app'; root.mkdir()
            (root/'config').mkdir(); (root/'state').mkdir(); (root/'state/project').write_bytes(b'current')
            legacy = root.with_name(root.name+'-native-retired-fixture'); legacy.mkdir()
            backup = legacy/'native-backup-fixture'; backup.mkdir()
            (legacy/'state').mkdir(); (legacy/'state/project').write_bytes(b'retired')
            (backup/'checkpoint').write_bytes(b'backup')
            release = legacy/'releases'/NATIVE.SOURCE; release.mkdir(parents=True)
            (release/'SHA256SUMS.txt').write_text('')
            (legacy/'bin').symlink_to(root/'releases'/NATIVE.SOURCE)
            unit = legacy/'unit'; unit.write_text(NATIVE.UNIT_TEXT)
            (root/'config/native-migration.json').write_text(json.dumps({'source':NATIVE.SOURCE,'backup':str(backup),'legacyRoot':str(legacy)}))
            observed = {'State':{'Running':True},'Mounts':[{'Source':str(root/'state'),'Destination':'/data/state'}]}
            with patch.object(MIGRATE,'ROOT',root), patch.object(MIGRATE,'UNIT_PATH',unit), \
                 patch.object(MIGRATE.os,'geteuid',return_value=0), \
                 patch.object(MIGRATE.socket,'gethostname',return_value='lime'), \
                 patch.object(MIGRATE,'run',return_value=types.SimpleNamespace(stdout=json.dumps([observed]).encode())), \
                 patch.object(MIGRATE.subprocess,'run',return_value=types.SimpleNamespace(returncode=1)), \
                 patch.object(MIGRATE.urllib.request,'urlopen',return_value=io.BytesIO(b'{"hubConnected":true}')), \
                 patch.object(sys,'argv',['migration','cleanup','--apply']), contextlib.redirect_stdout(io.StringIO()):
                MIGRATE.main()
            self.assertFalse((legacy/'bin').is_symlink()); self.assertFalse(unit.exists()); self.assertFalse(release.exists())
            self.assertEqual((root/'state/project').read_bytes(),b'current')
            self.assertEqual((legacy/'state/project').read_bytes(),b'retired')
            self.assertEqual((backup/'checkpoint').read_bytes(),b'backup')

    def test_retained_credential_stays_private_and_unsafe_inputs_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); retained = root / 'connection.json'
            credential = 'fixture-' + 'x' * 48
            retained.write_text(json.dumps({'endpoint':'wss://host/desktop/flamoris2d-lime','credential':credential}))
            retained.chmod(0o600)
            self.assertEqual(ENTRY.settings({}, root), ('wss://host/desktop/flamoris2d-lime',credential))
            with self.assertRaises(ValueError): ENTRY.settings({'FLAMORIS2D_HUB_TOKEN':'bad\ncredential'},root)
            retained.chmod(0o644)
            with self.assertRaises(ValueError): ENTRY.settings({},root)

    def test_package_preserves_state_boundary_and_does_not_embed_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); image = root/'image.tar'; image.write_bytes(b'fixture')
            recipe = PACKAGE.package(image,'sha256:'+'a'*64,'b'*40,root/'out')
            self.assertEqual(recipe['application']['mounts'],[{'source':'${root}/state','target':'/data/state','read_only':False}])
            self.assertEqual(recipe['application']['container_name'],'flamoris-2d-cli')
            self.assertNotIn('flamoris-kachinco',json.dumps(recipe))
            self.assertTrue(all(not s.get('required',False) for s in recipe['settings'] if s['key'] in ('HUB_ENDPOINT','HUB_TOKEN')))

    def test_cleanup_requires_connection_and_validates_every_file_before_deletion(self):
        for connected in (False,True):
            with self.subTest(connected=connected), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory); (root/'config').mkdir(); (root/'state').mkdir()
                (root/'config/native-migration.json').write_text(json.dumps({'source':NATIVE.SOURCE,'backup':'retained'}))
                release = root/'releases'/NATIVE.SOURCE; release.mkdir(parents=True)
                binary = root/'bin'; binary.symlink_to(release)
                unit = root/'unit'; unit.write_text('unrelated service')
                observed = {'State':{'Running':True},'Mounts':[{'Source':str(root/'state'),'Destination':'/data/state'}]}
                response = io.BytesIO(json.dumps({'hubConnected':connected}).encode())
                with patch.object(MIGRATE,'ROOT',root), patch.object(MIGRATE,'UNIT_PATH',unit), \
                     patch.object(MIGRATE.os,'geteuid',return_value=0), \
                     patch.object(MIGRATE.socket,'gethostname',return_value='lime'), \
                     patch.object(MIGRATE,'run',return_value=types.SimpleNamespace(stdout=json.dumps([observed]).encode())), \
                     patch.object(MIGRATE.subprocess,'run',return_value=types.SimpleNamespace(returncode=1)), \
                     patch.object(MIGRATE.urllib.request,'urlopen',return_value=response), \
                     patch.object(sys,'argv',['migration','cleanup','--apply']):
                    with self.assertRaises(ValueError): MIGRATE.main()
                self.assertTrue(binary.is_symlink()); self.assertTrue(unit.exists()); self.assertTrue(release.exists())

if __name__ == '__main__': unittest.main()
