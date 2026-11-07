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
