import os
import csv
import io
import json
import sys
import unittest
from pathlib import Path
import numpy as np
from PIL import Image
from netCDF4 import Dataset

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))
from science import Catalogue, earth_geometry, image_plane_geometry, pointing_deviation_deg, rotation, measure_arrays, measure_frame, selection_mask, validate_roi, paired_sectors, paired_masks


class ArrayScienceTests(unittest.TestCase):
    def setUp(self):
        self.frame = dict(shape=[5, 5], earth_xy=[2., 2.], pixels_per_re=1., channel='WFI')

    def test_negative_values_are_retained_and_masks_are_applied(self):
        raw = np.ones((5, 5))*1000
        raw[2, 2], raw[2, 3], raw[1, 2], raw[1, 3] = -1000, 3000, np.nan, 9000
        fov = np.ones((5, 5), bool)
        interp = np.zeros((5, 5), bool)
        interp[1, 3] = True
        roi = validate_roi(dict(kind='rectangle', x1=0, x2=2, y1=0, y2=2))
        result = measure_arrays(raw, fov, interp, self.frame, roi)
        self.assertEqual(result['mean_kR'], 1.0)
        self.assertEqual(result['median_kR'], 1.0)
        self.assertEqual(result['nonpositive_pixels'], 1)
        self.assertEqual(result['valid_pixels'], 2)
        self.assertEqual(result['selected_pixels'], 4)
        self.assertEqual(result['coverage'], .5)
        include = measure_arrays(raw, fov, interp, self.frame, roi, False)
        self.assertAlmostEqual(include['mean_kR'], 11/3)
        fov[2, 3] = False
        masked = measure_arrays(raw, fov, interp, self.frame, roi)
        self.assertEqual(masked['mean_kR'], -1)

    def test_ring_and_sector_boundaries(self):
        ring = selection_mask(self.frame, dict(kind='annulus', inner=1, outer=2))
        self.assertEqual(int(ring.sum()), 8)
        sector = selection_mask(self.frame, dict(kind='sector', inner=1, outer=2, angle_start=0, angle_end=90))
        self.assertEqual(int(sector.sum()), 2)
        self.assertTrue(sector[2, 3])  # right, start inclusive
        self.assertTrue(sector[1, 3])  # upper-right
        self.assertFalse(sector[1, 2])  # top, end exclusive
        wrap = selection_mask(self.frame, dict(kind='sector', inner=1, outer=2, angle_start=270, angle_end=450))
        self.assertEqual(int(wrap.sum()), 4)

    def test_point_orientation_and_outside_raster(self):
        point = selection_mask(self.frame, dict(kind='point', x=1, y=1))
        self.assertEqual(np.argwhere(point).tolist(), [[1, 3]])
        outside = measure_arrays(np.ones((5, 5)), np.ones((5, 5), bool), np.zeros((5, 5), bool), self.frame, dict(kind='point', x=100, y=100))
        self.assertIsNone(outside['mean_kR'])
        self.assertEqual(outside['coverage'], 0)

    def test_paired_sectors_keep_opposite_pixels_and_missing_values_separate(self):
        roi = validate_roi(dict(kind='paired_sectors', angle_width=60))
        raw = np.full((5, 5), 7000.)
        raw[:, :2] = -1000.
        fov, interp = np.ones((5, 5), bool), np.zeros((5, 5), bool)
        result = measure_arrays(raw, fov, interp, self.frame, roi)
        self.assertEqual(result['regions']['dawn']['mean_kR'], -1.)
        self.assertEqual(result['regions']['dusk']['mean_kR'], 7.)
        self.assertEqual(result['mean_kR'], 31/9)
        interp[:, 2:] = True
        result = measure_arrays(raw, fov, interp, self.frame, roi)
        self.assertIsNone(result['regions']['dusk']['mean_kR'])
        self.assertEqual(result['regions']['dusk']['coverage'], 0)
        self.assertEqual(result['regions']['dawn']['mean_kR'], -1.)
        self.assertEqual(measure_arrays(raw, fov, interp, self.frame, roi, False)['regions']['dusk']['mean_kR'], 7.)

    def test_paired_maximum_angle_partitions_full_raster_without_overlap(self):
        roi = dict(kind='paired_sectors', angle_width=180)
        dawn, dusk = [selection_mask(self.frame, part) for part in paired_sectors(roi, self.frame).values()]
        self.assertFalse((dawn & dusk).any())
        np.testing.assert_array_equal(dawn | dusk, np.ones(self.frame['shape'], bool))
        for cx in (2., 2.-2**-51, 2.+2**-50):
            frame = dict(self.frame, earth_xy=[cx, 2.])
            np.testing.assert_array_equal(selection_mask(frame, roi), np.ones((5, 5), bool))
            result = measure_arrays(np.ones((5, 5)), np.ones((5, 5), bool), np.zeros((5, 5), bool), frame, roi)
            self.assertEqual(result['selected_pixels'], 25)
            self.assertEqual(sum(r['selected_pixels'] for r in result['regions'].values()), 25)
        for width in (0, 181, float('nan')):
            with self.assertRaises(ValueError):
                validate_roi(dict(roi, angle_width=width))

    def test_paired_annular_bounds_mirror_and_masked_statistics(self):
        roi = validate_roi(dict(kind='paired_annular_sectors', inner=1, outer=2, angle_start=-45, angle_end=45))
        masks = paired_masks(self.frame, roi)
        self.assertEqual(np.argwhere(masks['dusk']).tolist(), [[2, 3], [3, 3]])
        self.assertEqual(np.argwhere(masks['dawn']).tolist(), [[1, 1], [2, 1]])
        np.testing.assert_array_equal(masks['dawn'], masks['dusk'][::-1, ::-1])
        self.assertFalse((masks['dawn'] & masks['dusk']).any())
        raw = np.full((5, 5), 100000.)  # outside the four selected pixels must not contribute
        raw[1, 1], raw[2, 1], raw[2, 3], raw[3, 3] = -1000, 3000, 5000, 9000
        fov, interp = np.ones((5, 5), bool), np.zeros((5, 5), bool)
        interp[3, 3] = True
        result = measure_arrays(raw, fov, interp, self.frame, roi)
        self.assertEqual(result['regions']['dawn']['mean_kR'], 1)
        self.assertEqual(result['regions']['dawn']['nonpositive_pixels'], 1)
        self.assertEqual(result['regions']['dusk']['mean_kR'], 5)
        self.assertEqual(result['regions']['dusk']['coverage'], .5)
        self.assertEqual(result['mean_kR'], 7/3)
        self.assertEqual(measure_arrays(raw, fov, interp, self.frame, roi, False)['regions']['dusk']['mean_kR'], 7)
        fov[2, 3] = False
        self.assertIsNone(measure_arrays(raw, fov, interp, self.frame, roi)['regions']['dusk']['mean_kR'])

    def test_paired_annular_half_open_partition_and_validation(self):
        roi = dict(kind='paired_annular_sectors', inner=1, outer=2, angle_start=-90, angle_end=90)
        for cx in (2., 2.-2**-51, 2.+2**-50):
            frame = dict(self.frame, earth_xy=[cx, 2.])
            dawn, dusk = paired_masks(frame, roi).values()
            self.assertFalse((dawn & dusk).any())
            np.testing.assert_array_equal(dawn | dusk, selection_mask(frame, dict(kind='annulus', inner=1, outer=2)))
        for patch in (dict(inner=-1), dict(outer=1), dict(angle_start=-91), dict(angle_end=91),
                      dict(angle_end=-90), dict(angle_start=float('nan'))):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                validate_roi(dict(roi, **patch))

    def test_geometry_signed_axis_and_scale(self):
        g = dict(spacecraft_position=np.array([0., 0., 637000.]),
                 spacecraft_attitude=[0, 0, 0, 1], cam_attitude=[0, 0, 0, 1],
                 cam_focal_length=np.array([1000., -1000.]), cam_ctr=np.array([256., 256.]), cam_skew=0.)
        center, scale = earth_geometry(g)
        self.assertEqual(center, [256., 256.])
        self.assertEqual(scale, 10.)

    def test_invalid_selections_are_rejected(self):
        for roi in [None, {}, dict(kind='annulus', inner=2, outer=1),
                    dict(kind='point', x=float('nan'), y=0),
                    dict(kind='sector', inner=1, outer=2, angle_start=90, angle_end=0)]:
            with self.subTest(roi=roi), self.assertRaises(ValueError):
                validate_roi(roi)

    def test_pointing_deviation_uses_spacecraft_to_earth_direction(self):
        for direction, expected in [([3, 0, 0], 180), ([-3, 0, 0], 0),
                                    ([0, 2, 0], 90), ([-1, 1, 0], 45)]:
            self.assertAlmostEqual(pointing_deviation_deg(direction, [10, 0, 0]), expected)
        for bad in ([0, 0, 0], [float('nan'), 0, 1], [1, 0]):
            with self.assertRaises(ValueError):
                pointing_deviation_deg(bad, [1, 0, 0])
            with self.assertRaises(ValueError):
                pointing_deviation_deg([1, 0, 0], bad)

    def test_camera_boresight_sign_and_rotation_order(self):
        # Camera +90° about X sends -Z to +Y; body +90° about Z sends +Y to -X.
        half = 2 ** -.5
        g = dict(spacecraft_position=np.array([1000000., 0., 0.]),
                 spacecraft_attitude=[0, 0, half, half], cam_attitude=[half, 0, 0, half],
                 cam_focal_length=[1000., 1000.], cam_ctr=[256., 256.], cam_skew=0.)
        np.testing.assert_allclose(image_plane_geometry(g, [512, 512])['camera_boresight_gcrs'],
                                   [-1, 0, 0], atol=1e-14)


@unittest.skipUnless((Path(os.environ.get('CARRUTHERS_DATA_DIR', BASE.parent / 'code and data/L1C'))).is_dir(), 'Dataset is not installed')
class RealDataRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalogue = Catalogue(Path(os.environ.get('CARRUTHERS_DATA_DIR', BASE.parent / 'code and data/L1C')))

    def test_collection_and_registered_centers(self):
        c = self.catalogue
        self.assertEqual(c.file_count, 62)
        self.assertEqual(len(c.frames), 1794)
        self.assertEqual(sum(f['channel'] == 'WFI' for f in c.frames), 633)
        for f in c.frames:
            np.testing.assert_allclose(f['earth_xy'], [256, 256] if f['channel'] == 'WFI' else [512, 512], atol=1e-8)

    def test_all_march15_wfi_values_match_prior_independent_extraction(self):
        frames = [f for f in self.catalogue.frames if f['channel'] == 'WFI' and f['timestamp'].startswith('2026-03-15')]
        with (BASE / 'tests/fixtures/wfi_5re_brightness_20260315.csv').open() as f:
            expected = list(csv.DictReader(f))
        self.assertEqual(len(frames), 22)
        self.assertEqual(len(frames), len(expected))
        for frame, prior in zip(frames, expected):
            value = measure_frame(self.catalogue, frame['id'], dict(kind='annulus', inner=4.5, outer=5.5))
            self.assertAlmostEqual(value['mean_kR'], float(prior['mean_brightness_kR']), places=12)
            self.assertEqual(value['valid_pixels'], int(prior['valid_pixels']))

    def test_camera_pointing_matches_verified_march_geometry(self):
        for frame in self.catalogue.frames:
            # The physical solar-cell face is body +Y and must be sunward.
            panel = rotation(frame['spacecraft_attitude']) @ np.array([0., 1., 0.])
            to_sun = np.array(frame['sun_position_km']) - np.array(frame['spacecraft_position_km'])
            self.assertGreater(np.dot(panel, to_sun / np.linalg.norm(to_sun)), .9)
            self.assertLess(np.dot(-panel, frame['spacecraft_position_km']), 0)
            self.assertTrue(np.isfinite(frame['earth_pointing_deviation_deg']))
            self.assertGreaterEqual(frame['earth_pointing_deviation_deg'], 0)
            self.assertLessEqual(frame['earth_pointing_deviation_deg'], 180)
            self.assertAlmostEqual(np.linalg.norm(frame['camera_boresight_gcrs']), 1)
            # Forward camera rays must point toward Earth, not away from it.
            self.assertLess(np.dot(frame['camera_boresight_gcrs'], frame['spacecraft_position_km']), 0)
        # Independent check in the camera image plane: the registered Earth
        # center's offset from the calibrated principal point gives tan(theta),
        # without reusing the world-space boresight or attitude transforms.
        calibration = {}
        for frame in self.catalogue.frames:
            path = self.catalogue.paths[frame['id']]
            if path not in calibration:
                with Dataset(path) as ds:
                    calibration[path] = {n: np.array(ds[n][:]) for n in
                                         ('cam_ctr', 'cam_focal_length', 'cam_skew')}
            g, i = calibration[path], frame['frame_index']
            cx, cy = g['cam_ctr'][i]
            fx, fy = g['cam_focal_length'][i]
            ex, ey = frame['earth_xy']
            yn = (ey-cy)/fy
            xn = (ex-cx-g['cam_skew'][i]*yn)/fx
            expected = np.degrees(np.arctan(np.hypot(xn, yn)))
            self.assertAlmostEqual(frame['earth_pointing_deviation_deg'], expected, places=10)
        inspected = next(f for f in self.catalogue.frames if f['channel'] == 'WFI'
                         and f['timestamp'] == '2026-03-16T23:40:35Z')
        self.assertAlmostEqual(inspected['earth_pointing_deviation_deg'], 0.3502259493, places=9)

    def test_paired_real_data_matches_each_individual_sector_and_csv(self):
        from server import export_csv, METHOD
        roi = dict(kind='paired_sectors', angle_width=70)
        for channel in ('WFI', 'NFI'):
            frame = next(f for f in self.catalogue.frames if f['channel'] == channel)
            pair = measure_frame(self.catalogue, frame['id'], roi)
            for name, sector in paired_sectors(roi, frame).items():
                individual = measure_frame(self.catalogue, frame['id'], sector)
                for key, value in pair['regions'][name].items():
                    self.assertEqual(value, individual[key])
            result = dict(rows=[pair], recipe=dict(roi=roi, exclude_interpolated=True), method=METHOD)
            rows = list(csv.DictReader(io.StringIO(export_csv(result).decode())))
            self.assertEqual([r['region'] for r in rows], ['dawn', 'dusk'])
            for row in rows:
                self.assertEqual(float(row['mean_kR']), pair['regions'][row['region']]['mean_kR'])

    def test_paired_annular_real_data_and_csv_match_independent_sector_extraction(self):
        from server import export_csv, METHOD
        roi = validate_roi(dict(kind='paired_annular_sectors', inner=3, outer=6, angle_start=-35, angle_end=20))
        for channel in ('WFI', 'NFI'):
            frame = next(f for f in self.catalogue.frames if f['channel'] == channel)
            for exclude in (True, False):
                pair = measure_frame(self.catalogue, frame['id'], roi, exclude)
                for name, start, end in [('dawn', 145, 200), ('dusk', -35, 20)]:
                    individual = measure_frame(self.catalogue, frame['id'], dict(kind='sector', inner=3, outer=6, angle_start=start, angle_end=end), exclude)
                    for key, value in pair['regions'][name].items():
                        self.assertEqual(value, individual[key])
                result = dict(rows=[pair], recipe=dict(roi=roi, exclude_interpolated=exclude), method=METHOD)
                rows = list(csv.DictReader(io.StringIO(export_csv(result).decode())))
                self.assertEqual([r['region'] for r in rows], ['dawn', 'dusk'])
                for row in rows:
                    self.assertEqual(json.loads(row['roi_json']), roi)
                    self.assertEqual(float(row['mean_kR']), pair['regions'][row['region']]['mean_kR'])

    def test_circularity_uses_full_contours_and_preserves_radiance(self):
        frame = next(f for f in self.catalogue.frames if f['channel']=='WFI')
        first = measure_frame(self.catalogue, frame['id'], dict(kind='annulus', inner=4.5, outer=5.5), include_circularity=True)
        paired = measure_frame(self.catalogue, frame['id'], dict(kind='paired_sectors', angle_width=45), include_circularity=True)
        fast = measure_frame(self.catalogue, frame['id'], dict(kind='annulus', inner=4.5, outer=5.5))
        self.assertEqual(first['circularity'], paired['circularity'])
        self.assertEqual(first['mean_kR'], fast['mean_kR'])
        self.assertNotIn('circularity', fast)
        for value in first['circularity'].values():
            self.assertEqual(value['status'], 'ok')
            self.assertLessEqual(value['sensitivity_low_pct'], value['departure_pct'])
            self.assertGreaterEqual(value['sensitivity_high_pct'], value['departure_pct'])

    def test_both_cameras_render_and_display_scale_does_not_change_measurement(self):
        for channel, size, scale in [('WFI', 512, [1, 5.4]), ('NFI', 1024, [3, 5.2])]:
            frame = next(f for f in self.catalogue.frames if f['channel'] == channel and f['timestamp'].startswith('2026-03-15'))
            roi = dict(kind='annulus', inner=4.5, outer=5.5)
            before = measure_frame(self.catalogue, frame['id'], roi, profile=True)
            png = self.catalogue.preview(frame['id'], *scale)
            self.assertEqual(Image.open(io.BytesIO(png)).size, (size, size))
            alternate = self.catalogue.preview(frame['id'], -1., 3.)
            self.assertNotEqual(png, alternate)
            after = measure_frame(self.catalogue, frame['id'], roi)
            self.assertEqual(before['mean_kR'], after['mean_kR'])
            self.assertEqual(len(before['profile']), 80)
            self.assertGreater(before['valid_pixels'], 0)


if __name__ == '__main__':
    unittest.main()
