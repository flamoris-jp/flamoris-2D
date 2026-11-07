import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('recovery', ROOT / 'deploy/linux/recover-resident.py')
RECOVERY = importlib.util.module_from_spec(spec); spec.loader.exec_module(RECOVERY)


class RecoveryTests(unittest.TestCase):
    def test_restore_refuses_overwrite_and_links_and_checks_every_retained_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = root / 'retired'; source.mkdir()
            (source / 'workspace').mkdir(); (source / 'workspace/project.fl2d').write_bytes(b'checkpoint')
            (source / 'connection.json').write_bytes(b'private fixture')
            target = root / 'state'; target.mkdir()
            (target / 'existing').write_bytes(b'keep')
            with self.assertRaises(ValueError): RECOVERY.restore_state(source, target)
            self.assertEqual((target / 'existing').read_bytes(), b'keep')
            (target / 'existing').unlink()
            (source / 'link').symlink_to(source / 'connection.json')
            with self.assertRaises(ValueError): RECOVERY.restore_state(source, target)
            self.assertFalse(any(target.iterdir()))
            (source / 'link').unlink()
            with patch.object(RECOVERY.os, 'chown'):
                RECOVERY.restore_state(source, target)
            self.assertEqual(RECOVERY.fingerprints(source), RECOVERY.fingerprints(target))
            self.assertEqual((target / 'connection.json').stat().st_mode & 0o777, 0o600)

    def test_bootstrap_refuses_unprotected_runtime_before_importing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); (root / 'site-packages').mkdir()
            (root / 'site-packages').chmod(0o777)
            with patch.object(RECOVERY, 'RUNTIME', root), self.assertRaises(ValueError):
                RECOVERY.load_runtime()


if __name__ == '__main__': unittest.main()
