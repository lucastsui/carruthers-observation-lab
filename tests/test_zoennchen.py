import json
import os
from pathlib import Path
import unittest

import numpy as np
from matplotlib.path import Path as Polygon
from netCDF4 import Dataset

from science import Catalogue, GEOMETRY_NAMES, RE_KM, read_array
from zoennchen import (ModelOverlays, conservative_mask, density, gse_basis,
                       pixel_rays, scattering_rate, shell_column)

BASE = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get('CARRUTHERS_DATA_DIR', BASE.parent/'code and data/L1C'))


class ZoennchenMathTests(unittest.TestCase):
    def test_independent_exospy_density_fixture(self):
        fixture = json.loads((BASE/'tests/fixtures/zoennchen-2015.json').read_text())
        points = np.array(fixture['points_gse_re'])
        for model, expected in fixture['density_cm3'].items():
            np.testing.assert_allclose(density(model, points), expected, rtol=3e-14)

    def test_angular_mean_matches_published_radial_profile(self):
        z, weights = np.polynomial.legendre.leggauss(12)
        phi = np.arange(32)*2*np.pi/32
        xyz = np.stack(np.broadcast_arrays(np.sqrt(1-z[:, None]**2)*np.cos(phi),
                       np.sqrt(1-z[:, None]**2)*np.sin(phi), z[:, None]), axis=-1)
        for model, c, k in [('Z15MIN', 12264.1, 2.87646), ('Z15MAX', 16840.9, 2.74640)]:
            for r in [3., 5., 8.]:
                mean = np.sum(density(model, xyz*r).mean(axis=1)*weights)/2
                self.assertAlmostEqual(mean, c*r**(-k), places=11)

    def test_constant_density_analytic_chord_phase_and_units(self):
        position = np.array([0., 0., 20.])
        ray = np.array([[.2, 0., -np.sqrt(.96)]])  # impact distance exactly 4 Re
        actual = shell_column(position, ray, 'Z15MAX', density_fn=lambda p: np.full(p.shape[:-1], 100.))[0]
        expected = 100*2*np.sqrt(8**2-4**2)*RE_KM*1e5*(11/12+.2**2/4)
        self.assertAlmostEqual(actual/expected, 1., places=13)
        radiance_per_sr = expected*.002/(4*np.pi)
        photons_per_kr = 1e9/(4*np.pi)
        self.assertAlmostEqual(actual*.002/1e9, radiance_per_sr/photons_per_kr, places=12)

    def test_inner_missed_and_backward_rays_are_missing(self):
        result = shell_column(np.array([0., 0., 20.]),
                    np.array([[0., 0., -1.], [1., 0., 0.], [.2, 0., np.sqrt(.96)]]), 'Z15MAX')
        self.assertTrue(np.isnan(result).all())

    def test_geometric_shadow_removes_direct_light(self):
        # A thin H cloud on the Earth–Sun line is dark on the nightside and lit
        # on the dayside. Both rays have impact distance 5 Re.
        cloud = lambda p: np.where(np.abs(p[..., 2]) < .5, 100., 0.)
        ray = np.array([[0., 0., 1.]])
        dark = shell_column(np.array([-5., 0., -20.]), ray, 'Z15MAX', density_fn=cloud)[0]
        light = shell_column(np.array([5., 0., -20.]), ray, 'Z15MAX', density_fn=cloud)[0]
        self.assertEqual(dark, 0.)
        self.assertGreater(light, 0.)
        uniform = shell_column(np.array([-5., 0., -20.]), ray, 'Z15MAX',
                               density_fn=lambda p: np.full(p.shape[:-1], 100.))[0]
        expected = 100*(2*np.sqrt(64-25)-2)*RE_KM*1e5*(11/12)
        self.assertAlmostEqual(uniform/expected, 1., places=13)

    def test_coarse_mask_preserves_small_invalid_holes(self):
        valid = np.ones((17, 17), bool)
        valid[7, 7] = False
        xy = np.arange(0., 17., 4.)
        mask = conservative_mask(valid, xy, xy)
        self.assertFalse(mask[2, 2])
        self.assertTrue(mask[0, 0])

    def test_irradiance_units_and_power_law(self):
        # Exactly 1e11 photons cm^-2 s^-1 at 121.6 nm.
        irradiance = 1e11*1e4*(6.62607015e-34*299792458)/121.6e-9*1e3
        self.assertAlmostEqual(scattering_rate(irradiance), 3.47e-4, places=16)
        self.assertAlmostEqual(scattering_rate(2*irradiance)/scattering_rate(irradiance), 2**1.21)


@unittest.skipUnless(DATA.is_dir(), 'Dataset is not installed')
class ZoennchenFrameTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalogue = Catalogue(DATA)
        cls.overlays = ModelOverlays(cls.catalogue)

    def test_both_camera_geometry_and_quadrature_convergence(self):
        c = self.catalogue
        report = []
        for channel in ['WFI', 'NFI']:
            frames = [f for f in c.frames if f['channel'] == channel]
            for frame in [frames[0], frames[len(frames)//2], frames[-1]]:
                with Dataset(c.paths[frame['id']]) as ds:
                    ds.set_auto_mask(False)
                    geom = {n: read_array(ds[n], frame['frame_index']) for n in GEOMETRY_NAMES}
                cx, cy = frame['earth_xy']
                center_ray = pixel_rays(geom, np.array(cx), np.array(cy))
                position = np.array(frame['spacecraft_position_km'])
                np.testing.assert_allclose(center_ray, -position/np.linalg.norm(position), atol=2e-14)
                basis = gse_basis(frame)
                np.testing.assert_allclose(basis @ basis.T, np.eye(3), atol=5e-16)
                sun = np.array(frame['sun_position_km'])
                np.testing.assert_allclose(basis @ (sun/np.linalg.norm(sun)), [1, 0, 0], atol=3e-16)
                # Rays across radius and azimuth, not just a single scan direction.
                radius, azimuth = np.meshgrid(np.linspace(3.05, 7.95, 24), np.linspace(0, 2*np.pi, 32, endpoint=False))
                x = cx+frame['pixels_per_re']*radius*np.cos(azimuth)
                y = cy+frame['pixels_per_re']*radius*np.sin(azimuth)
                rays = pixel_rays(geom, x, y).reshape(-1, 3) @ basis.T
                pos = basis @ position / RE_KM
                for model in ['Z15MIN', 'Z15MAX']:
                    a = shell_column(pos, rays, model, samples=64)
                    b = shell_column(pos, rays, model, samples=128)
                    np.testing.assert_allclose(a, b, rtol=1e-7, equal_nan=True)
                    report.append(float(np.nanmax(np.abs(a/b-1))))
        self.assertLess(max(report), 1e-7)

    def test_contours_cache_validation_and_both_cameras(self):
        for channel in ['WFI', 'NFI']:
            f = next(f for f in self.catalogue.frames if f['channel'] == channel and f['timestamp'].startswith('2026-03-15'))
            result = self.overlays.get(f['id'])
            self.assertEqual(result['frame_id'], f['id'])
            self.assertEqual(result['domain_re'], [3, 8])
            self.assertAlmostEqual(result['brightness_scale'], 4*np.pi)
            self.assertTrue(result['contours'])
            self.assertTrue(result['clip_paths'])
            x, y, column, _ = self.overlays.columns(f['id'], 'Z15MAX')
            raw, fov, interpolation = self.catalogue.read(f['id'])
            supported = conservative_mask(fov & np.isfinite(raw) & ~interpolation, x, y) & np.isfinite(column)
            unscaled = column[supported]*scattering_rate(6)/1e9
            np.testing.assert_allclose(result['brightness_range_kR'],
                np.array([unscaled.min(), unscaled.max()])*4*np.pi, rtol=1e-14)
            xx, yy = np.meshgrid((x[:-1]+x[1:])/2+.5, (y[:-1]+y[1:])/2+.5)
            points = np.column_stack([xx.ravel(), yy.ravel()])
            visible = np.zeros(len(points), bool)
            for ring in result['clip_paths']:
                self.assertEqual(ring[0], ring[-1])
                visible ^= Polygon(ring).contains_points(points)
            cells = supported[:-1, :-1] & supported[1:, :-1] & supported[:-1, 1:] & supported[1:, 1:]
            np.testing.assert_array_equal(visible.reshape(cells.shape), cells)
            self.assertIs(self.overlays.get(f['id']), result)
            columns = self.overlays.columns.cache_info().misses
            changed = self.overlays.get(f['id'], irradiance_mw=7)
            self.assertEqual(self.overlays.columns.cache_info().misses, columns)
            self.assertGreater(changed['brightness_range_kR'][1], result['brightness_range_kR'][1])
            for level in result['contours']:
                for path in level['paths']:
                    xy = np.array(path)
                    self.assertTrue(np.isfinite(xy).all())
                    self.assertTrue((xy >= 0).all())
                    self.assertTrue((xy[:, 0] <= f['shape'][1]).all())
                    self.assertTrue((xy[:, 1] <= f['shape'][0]).all())
            with Dataset(self.catalogue.paths[f['id']]) as ds:
                ds.set_auto_mask(False)
                geometry = {n: read_array(ds[n], f['frame_index']) for n in GEOMETRY_NAMES}
            basis = gse_basis(f)
            position = basis @ np.array(f['spacecraft_position_km'])/RE_KM
            # Check contour locations against direct finer LOS integration,
            # including faint levels at the strongest allowed illumination.
            for irradiance in [6., 15.]:
                contour_result = self.overlays.get(f['id'], irradiance_mw=irradiance)
                for level in contour_result['contours']:
                    xy = np.concatenate([np.array(p) for p in level['paths']])[::4]-.5
                    rays = pixel_rays(geometry, xy[:, 0], xy[:, 1]) @ basis.T
                    exact = shell_column(position, rays, 'Z15MAX', samples=128)*scattering_rate(irradiance)/1e9*4*np.pi
                    np.testing.assert_allclose(exact, level['level_kR'], rtol=.02)
        for model, irradiance in [('bad', 6), ('Z15MIN', float('nan')), ('Z15MIN', 0), ('Z15MIN', 100)]:
            with self.assertRaises(ValueError):
                self.overlays.get(f['id'], model, irradiance)


if __name__ == '__main__':
    unittest.main()
