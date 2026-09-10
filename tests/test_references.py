import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from datetime import datetime, timezone
import tempfile
import json
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from science import frame_baseline, image_plane_geometry, SCALES
from space_weather import parse_symh, parse_lyman, SpaceWeather

class BaselineAndGeometryTests(unittest.TestCase):
    def test_baseline_uses_all_valid_fov_pixels_and_retains_negative_values(self):
        class C:
            def get(self,fid):return dict(timestamp='2026-03-15T00:00:00Z',channel='WFI')
            def read(self,fid):return np.array([[1000,-1000],[9000,np.nan]]),np.ones((2,2),bool),np.array([[False,False],[True,False]])
        baseline=frame_baseline(C(),'first')
        self.assertEqual(baseline['mean_kR'],0)
        self.assertEqual(baseline['valid_pixels'],2)
        self.assertEqual(frame_baseline(C(),'first',False)['mean_kR'],3)

    def test_image_plane_intersects_earth_and_preserves_row_orientation(self):
        g=dict(spacecraft_position=np.array([0.,0.,-637000.]),spacecraft_attitude=[0,0,0,1],cam_attitude=[0,0,0,1],cam_focal_length=[1000.,-1000.],cam_ctr=[2.,2.],cam_skew=0.)
        plane=image_plane_geometry(g,[5,5])
        points=np.array(plane['image_plane_corners_re'])
        np.testing.assert_allclose(points[:,2],0,atol=1e-10)
        np.testing.assert_allclose(points.mean(axis=0),0,atol=1e-10)
        self.assertGreater(points[0,1],points[3,1])
        self.assertAlmostEqual(np.linalg.norm(points[1]-points[0]),.5)
        for limits in SCALES.values():self.assertAlmostEqual(10**limits[1]/1000,270)

class ContextDataTests(unittest.TestCase):
    def test_symh_missing_value_and_negative_storm_are_distinct(self):
        data=parse_symh(dict(status={'code':1200},parameters=[{'name':'Time'},{'name':'SYM_H','fill':'99999'}],data=[['2026-03-15T00:00:00Z',-35],['2026-03-15T00:01:00Z',99999]]))
        self.assertEqual(data[0]['y'],-35)
        self.assertIsNone(data[1]['y'])
        self.assertEqual(data[1]['x']-data[0]['x'],60000)

    def test_lyman_daily_centers_units_and_missing_values(self):
        p={'composite_lyman_alpha':dict(parameters=['time','irradiance'],metadata={'time':{'units':'milliseconds since 1970-01-01'},'irradiance':{'units':'W/m^2','missing_value':'-9999'}},data=[[1773576000000,.00771],[1773662400000,-9999]])}
        d=parse_lyman(p)
        self.assertAlmostEqual(d[0]['y'],7.71)
        self.assertEqual(d[0]['x'],1773576000000)
        self.assertIsNone(d[1]['y'])
        p['composite_lyman_alpha']['metadata']['irradiance']['units']='unknown'
        with self.assertRaises(ValueError):parse_lyman(p)

    def test_network_failure_is_not_replaced_with_fake_data(self):
        with tempfile.TemporaryDirectory() as tmp,patch('space_weather.urlopen',side_effect=TimeoutError):
            w=SpaceWeather(Path(tmp))
            d=w.series('symh','2026-03-15','2026-03-15')
            self.assertEqual(d['data'],[])
            self.assertEqual(d['status'],'unavailable')
            self.assertIn('no values substituted',d['error'])
            self.assertFalse(d['stale'])

    def test_cached_rows_are_filtered_to_utc_days(self):
        with tempfile.TemporaryDirectory() as tmp:
            w=SpaceWeather(Path(tmp))
            rows=[{'x':int(datetime(2026,3,day,12,tzinfo=timezone.utc).timestamp()*1000),'y':7.7} for day in [14,15,16]]
            (Path(tmp)/'lyman-2026-03.json').write_text(json.dumps(dict(data=rows,fetched_at='2026-09-08T00:00:00Z')))
            with patch('space_weather.urlopen',side_effect=AssertionError('Must use cache')):
                d=w.series('lyman','2026-03-15','2026-03-15')
            self.assertEqual(d['data'],[rows[1]])
            self.assertEqual(d['cadence'],'daily mean')
