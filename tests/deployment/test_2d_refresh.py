import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / 'deploy/linux/refresh-2d-lime-hub.py'
spec = importlib.util.spec_from_file_location('refresh_2d', SCRIPT)
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)


class RefreshTests(unittest.TestCase):
    def test_release_descriptor_digest_is_required(self):
        payload = b'{"tools":[]}'
        import hashlib
        manifest = (hashlib.sha256(payload).hexdigest() + '  flamoris2d-lime.json\n').encode()
        with patch.object(refresh, 'download', side_effect=[manifest, payload]):
            self.assertEqual(refresh.candidate(), {'tools': []})
        with patch.object(refresh, 'download', side_effect=[manifest, payload + b' ']):
            with self.assertRaises(ValueError):
                refresh.candidate()

    def test_success_retains_previous_descriptor(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'flamoris2d-lime.yaml'
            path.write_bytes(b'previous')
            replies = [subprocess.CompletedProcess([], 0), subprocess.CompletedProcess([], 0, stdout=b'{"connected":true}')]
            with patch.object(refresh, 'TARGET', path), patch.object(refresh, 'run', side_effect=replies):
                refresh.place(b'previous', b'candidate', 0o644, {'tools': []})
            self.assertEqual(path.read_bytes(), b'candidate')
            self.assertEqual([p.read_bytes() for p in path.parent.glob('*.before-*')], [b'previous'])

    def test_failed_verification_restores_and_restarts_previous(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'flamoris2d-lime.yaml'
            path.write_bytes(b'previous')
            with patch.object(refresh, 'TARGET', path), patch.object(refresh, 'run') as run, patch.object(refresh.time, 'monotonic', side_effect=[0, 181]):
                with self.assertRaisesRegex(RuntimeError, 'previous descriptor restored'):
                    refresh.place(b'previous', b'candidate', 0o644, {})
            self.assertEqual(path.read_bytes(), b'previous')
            self.assertEqual(run.call_count, 2)

    def test_concurrent_descriptor_write_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'flamoris2d-lime.yaml'
            path.write_bytes(b'external writer')
            with patch.object(refresh, 'TARGET', path), patch.object(refresh, 'run') as run:
                with self.assertRaisesRegex(RuntimeError, 'changed before placement'):
                    refresh.place(b'previous', b'candidate', 0o644, {})
            self.assertEqual(path.read_bytes(), b'external writer')
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
