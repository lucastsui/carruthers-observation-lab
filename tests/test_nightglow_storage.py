"""Keep running through disk-service pauses, but fail closed on storage loss."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    'nightglow_storage', Path(__file__).resolve().parents[1] /
    'deploy/nightglow/run_server.py')
storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storage)


class RunningStorageTests(unittest.TestCase):
    def check(self, *, mounted=True, symlink=False, mount_device=42,
              cwd_device=42, marker_error=None):
        def stat(path):
            return SimpleNamespace(st_dev=cwd_device if str(path) == '.' else mount_device)

        with patch.object(Path, 'is_symlink', return_value=symlink), \
             patch.object(storage.os.path, 'ismount', return_value=mounted), \
             patch.object(storage.os, 'stat', side_effect=stat), \
             patch.object(storage, 'verify_marker', side_effect=marker_error,
                          return_value={'status': 'verified'}) as marker, \
             patch.object(storage.subprocess, 'check_output',
                          side_effect=AssertionError('Runtime check must not call diskutil')):
            result = storage.verify_running_storage(42)
            marker.assert_called_once_with(42)
            return result

    def test_running_check_does_not_depend_on_disk_arbitration(self):
        self.assertEqual(self.check(), {'status': 'verified'})

    def test_missing_replaced_or_redirected_mount_is_rejected(self):
        for args in ({'mounted': False}, {'symlink': True},
                     {'mount_device': 43}, {'cwd_device': 43}):
            with self.subTest(args=args), self.assertRaises(RuntimeError):
                self.check(**args)

    def test_missing_invalid_or_inaccessible_marker_is_rejected(self):
        for error in (FileNotFoundError('missing'), RuntimeError('invalid marker'),
                      PermissionError('drive access denied')):
            with self.subTest(error=type(error)), self.assertRaises(type(error)):
                self.check(marker_error=error)


if __name__ == '__main__':
    unittest.main()
