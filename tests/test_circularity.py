import sys
import unittest
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from circularity import fit_circle, resample_closed, circularity_arrays


class CircularityTests(unittest.TestCase):
    def test_circle_departure_is_zero_and_offset_is_separate(self):
        theta = np.linspace(0, 2*np.pi, 512, endpoint=False)
        points = 7*np.column_stack([np.cos(theta), np.sin(theta)])+[2., -3.]
        fit = fit_circle(points)
        self.assertLess(fit['departure_pct'], 1e-10)
        self.assertAlmostEqual(fit['radius_re'], 7.)
        self.assertAlmostEqual(fit['center_offset_re'], np.sqrt(13))

    def test_ellipse_departure_matches_direct_symmetric_reference_and_scale(self):
        theta = np.linspace(0, 2*np.pi, 10001)
        line = np.column_stack([3*np.cos(theta), 2*np.sin(theta)])
        points = resample_closed(line)
        radius = np.linalg.norm(points, axis=1)
        expected = 100*radius.std()/radius.mean()
        fit = fit_circle(points)
        self.assertAlmostEqual(fit['departure_pct'], expected, places=7)
        shifted = fit_circle(points*4+[17., -9.])
        self.assertAlmostEqual(fit['departure_pct'], shifted['departure_pct'], places=8)
        self.assertGreater(fit['departure_pct'], 10.)

    def test_resampling_does_not_overweight_dense_vertices(self):
        square = np.array([[0.,0.],[1.,0.],[1.,1.],[0.,1.],[0.,0.]])
        dense = np.vstack([np.column_stack([np.linspace(0,1,100),np.zeros(100)]), square[2:]])
        np.testing.assert_allclose(resample_closed(square), resample_closed(dense), atol=1e-12)

    def scene(self):
        y, x = np.mgrid[:129, :129]
        raw = 1000*(5-np.hypot(x-64., y-64.)/10)
        frame = dict(shape=[129,129], earth_xy=[64.,64.], pixels_per_re=10.)
        return raw, np.ones(raw.shape, bool), np.zeros(raw.shape, bool), frame

    def test_threshold_bands_and_real_raster_circle(self):
        result = circularity_arrays(*self.scene())
        for key, radius in [('1',4.), ('3',2.)]:
            value = result[key]
            self.assertEqual(value['status'], 'ok')
            self.assertLess(value['departure_pct'], .05)
            self.assertAlmostEqual(value['radius_re'], radius, places=2)
            self.assertEqual([v['threshold_kR'] for v in value['variants']], [float(key)*f for f in (.95,1.,1.05)])
            self.assertLessEqual(value['sensitivity_low_pct'], value['departure_pct'])
            self.assertGreaterEqual(value['sensitivity_high_pct'], value['departure_pct'])

    def test_masked_and_interpolated_breaks_are_not_bridged(self):
        raw, fov, interp, frame = self.scene()
        interp[:65,64] = True
        excluded = circularity_arrays(raw, fov, interp, frame)
        self.assertTrue(all(v['departure_pct'] is None for v in excluded.values()))
        included = circularity_arrays(raw, fov, interp, frame, False)
        self.assertTrue(all(v['status']=='ok' for v in included.values()))
        fov[:65,64] = False
        self.assertTrue(all(v['departure_pct'] is None for v in circularity_arrays(raw,fov,interp,frame,False).values()))

    def test_missing_sensitivity_does_not_remove_a_valid_nominal_contour(self):
        raw, fov, interp, frame = self.scene()
        y,x=np.mgrid[:129,:129]
        fov &= np.hypot(x-64.,y-64.) < 41.5
        value = circularity_arrays(raw,fov,interp,frame)['1']
        self.assertEqual(value['status'],'ok')
        self.assertIsNone(value['sensitivity_low_pct'])
        self.assertIsNone(value['sensitivity_high_pct'])

    def test_multiple_enclosing_contours_are_flagged_as_ambiguous(self):
        raw, fov, interp, frame = self.scene()
        y,x=np.mgrid[:129,:129]
        radius=np.hypot(x-64.,y-64.)
        raw=np.where((radius<10) | ((radius>20) & (radius<30)),5000.,0.)
        result=circularity_arrays(raw,fov,interp,frame)
        self.assertTrue(all(v['status']=='ambiguous' for v in result.values()))

    def test_out_of_frame_contours_have_no_fabricated_score(self):
        raw, fov, interp, frame = self.scene()
        raw += 6000
        self.assertTrue(all(v['departure_pct'] is None for v in circularity_arrays(raw,fov,interp,frame).values()))

if __name__=='__main__': unittest.main()
