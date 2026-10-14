"""Independent V2 format fixtures: TT/UTC, masks, geometry and duplicate releases."""
from datetime import datetime
from pathlib import Path
import shutil
import tempfile
import unittest
import numpy as np
from netCDF4 import Dataset
from l1c_time import observation_times
from science import Catalogue, measure_frame


def fixture(root):
    path = Path(root) / 'CARRUTHERS_GCI-WFI_L1C_20260401_v1.3.nc'
    with Dataset(path, 'w') as ds:
        for name, size in [('time', 2), ('row', 512), ('col', 512), ('xyz', 3), ('quat', 4), ('xy', 2)]:
            ds.createDimension(name, size)
        ns = int((datetime(2026, 4, 1) - datetime(2000, 1, 1, 12)).total_seconds()) * 10**9
        for name in ['time', 'epoch']:
            v = ds.createVariable(name, 'i8', ('time',))
            v[:] = [ns, ns + 3600 * 10**9]
            v.units = 'nanoseconds since 2000-01-01T12:00:00'
            v.TIME_SCALE = 'TT'
        ds.Date_Start = '2026-04-01T00:00:00'
        ds.Date_End = '2026-04-01T01:00:00'
        ds.Data_version = '1.3'
        for name, dim, values in [
            ('spacecraft_position', 'xyz', [0, 0, 1500000]),
            ('spacecraft_attitude', 'quat', [0, 0, 0, 1]),
            ('cam_attitude', 'quat', [0, 0, 0, 1]),
            ('cam_focal_length', 'xy', [1500, 1500]),
            ('cam_ctr', 'xy', [256, 256]), ('earth_loc', 'xy', [256, 256]),
        ]:
            ds.createVariable(name, 'f8', ('time', dim))[:] = [values, values]
        ds.createVariable('cam_skew', 'f8', ('time',))[:] = 0
        ds.createVariable('t_int', 'f8', ('time',))[:] = 60
        raw = np.full((2, 512, 512), np.nan)
        raw[:, 250:260, 250:260] = 1000
        raw[:, 255, 255] = -1000
        raw[:, 254, 254] = 9000
        ds.createVariable('images', 'f8', ('time', 'row', 'col'), fill_value=np.nan)[:] = raw
        mask = np.zeros(raw.shape, dtype=np.int8)
        mask[:, 254, 254] = 1
        ds.createVariable('mask_interpolation', 'i1', ('time', 'row', 'col'))[:] = mask
    return path


class ReleaseTests(unittest.TestCase):
    def test_tt2000_is_converted_to_utc_including_date_rollover(self):
        with tempfile.TemporaryDirectory() as root:
            fixture(root)
            c = Catalogue(Path(root))
            self.assertEqual(c.frames[0]['timestamp'], '2026-03-31T23:58:50.816Z')
            self.assertEqual(c.frames[1]['timestamp'], '2026-04-01T00:58:50.816Z')
            self.assertEqual(c.frames[1]['epoch_ms'] - c.frames[0]['epoch_ms'], 3600000)
            self.assertEqual(c.frames[0]['source_release'], 'Illinois Data Bank V2')
            self.assertIn('TT2000', c.frames[0]['time_basis'])

    def test_missing_fov_uses_finite_pixels_without_losing_negative_values(self):
        with tempfile.TemporaryDirectory() as root:
            fixture(root)
            c = Catalogue(Path(root)); frame = c.frames[0]
            raw, fov, interpolation = c.read(frame['id'])
            np.testing.assert_array_equal(fov, np.isfinite(raw))
            roi = dict(kind='rectangle', x1=-100, x2=100, y1=-100, y2=100)
            result = measure_frame(c, frame['id'], roi)
            self.assertEqual(result['valid_pixels'], 99)
            self.assertEqual(result['nonpositive_pixels'], 1)
            self.assertAlmostEqual(result['mean_kR'], 97/99)
            self.assertEqual(result['selected_pixels'], 512*512)
            self.assertAlmostEqual(result['coverage'], 99/(512*512))
            self.assertEqual(result['mask_basis'], frame['mask_basis'])

    def test_duplicate_release_and_invalid_registration_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            path = fixture(root)
            other = Path(root)/'duplicate'; other.mkdir(); shutil.copy2(path, other/path.name)
            with self.assertRaisesRegex(ValueError, 'Duplicate observation'):
                Catalogue(Path(root))
            (other/path.name).unlink()
            with Dataset(path, 'a') as ds: ds['earth_loc'][:] = 250
            with self.assertRaisesRegex(ValueError, 'registered image geometry'):
                Catalogue(Path(root))

    def test_legacy_milliseconds_of_day_remain_unchanged(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)/'legacy.nc'
            with Dataset(path, 'w') as ds:
                ds.createDimension('time', 2)
                v=ds.createVariable('time', 'f8', ('time',)); v[:]=[0,696000]; v.units='ms'
            with Dataset(path) as ds: times, basis, release=observation_times(ds, '20260302')
            self.assertEqual(times.tolist(), [1772409600000,1772410296000])
            self.assertEqual(release, 'Illinois Data Bank V1')

    def test_conflicting_coordinates_and_unknown_units_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            path=fixture(root)
            with Dataset(path,'a') as ds: ds['epoch'][0] += 1000000000
            with Dataset(path) as ds, self.assertRaisesRegex(ValueError, 'time and epoch disagree'):
                observation_times(ds, '20260401')
            with Dataset(path,'a') as ds: ds['time'].units='unknown'
            with Dataset(path) as ds, self.assertRaisesRegex(ValueError, 'Unsupported L1C time'):
                observation_times(ds, '20260401')


if __name__ == '__main__': unittest.main()
