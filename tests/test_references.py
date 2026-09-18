import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from datetime import datetime, timezone
import tempfile
import json
import io
import os
import time
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from science import frame_baseline, image_plane_geometry, SCALES
from space_weather import parse_dst, parse_symh, parse_lyman, SpaceWeather

DST_MONTH = datetime(2026, 3, 1, tzinfo=timezone.utc)
DST_TEXT = (Path(__file__).parent / 'fixtures/dst-kyoto-provisional-202603.txt').read_text()


class DstDataTests(unittest.TestCase):
    def test_kyoto_month_values_and_utc_hour_centers(self):
        rows = parse_dst(DST_TEXT, DST_MONTH)
        self.assertEqual(len(rows), 31*24)
        self.assertEqual(rows[0], {'x': 1772325000000, 'y': -17})
        self.assertEqual(rows[-1], {'x': 1774999800000, 'y': -3})
        self.assertTrue(all(b['x']-a['x'] == 3600000 for a, b in zip(rows, rows[1:])))
        self.assertEqual([row['y'] for row in rows[14*24:15*24]],
                         [-22, -18, -16, -15, -17, -21, -27, -24, -21, -17, -23, -24,
                          -20, -19, -19, -17, -17, -18, -19, -20, -26, -36, -35, -25])
        self.assertEqual(rows[21*24+22]['y'], -105)

    def test_base_offset_and_missing_values_are_not_confused(self):
        lines = DST_TEXT.splitlines()
        # A 200 nT base: negative, missing, zero and positive hourly values.
        lines[0] = lines[0][:16] + '   2' + '-2359999-200-195' + lines[0][36:116] + ' 777'
        rows = parse_dst('\n'.join(lines), DST_MONTH)
        self.assertEqual([row['y'] for row in rows[:4]], [-35, None, 0, 5])
        self.assertEqual(len(rows), 744)  # The daily mean must not become a 25th hour.

    def test_invalid_partial_wrong_month_and_duplicate_records_fail_closed(self):
        lines = [line for line in DST_TEXT.splitlines() if line.startswith('DST')]
        for text in ('<html>Temporarily unavailable</html>',
                     '\n'.join(lines[:-1]), '\n'.join(lines + [lines[0]]),
                     DST_TEXT.replace('DST2603', 'DST2604'),
                     DST_TEXT.replace('PPX1', 'RRX0'), lines[0][:-1]):
            with self.subTest(text=text[:30]), self.assertRaises(ValueError):
                parse_dst(text, DST_MONTH)

    def test_month_fetch_cache_and_day_filter_use_dst_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            weather = SpaceWeather(Path(tmp))
            with patch('space_weather.urlopen', return_value=io.BytesIO(DST_TEXT.encode())) as request:
                series = weather.series('dst', '2026-03-15', '2026-03-15')
            self.assertEqual(request.call_args.args[0].full_url,
                             'https://wdc.kugi.kyoto-u.ac.jp/dst_provisional/202603/dst2603.for.request')
            self.assertEqual(series['data'][0], {'x': 1773534600000, 'y': -22})
            self.assertEqual(series['data'][-1], {'x': 1773617400000, 'y': -25})
            self.assertEqual(len(series['data']), 24)
            self.assertEqual(series['cadence'], 'hourly mean')
            self.assertEqual(series['data_version'], 'provisional')
            self.assertEqual(series['units'], 'nT')
            self.assertFalse(series['stale'])
            with patch('space_weather.urlopen', side_effect=AssertionError('Must use monthly cache')):
                self.assertEqual(weather.series('dst', '2026-03-15', '2026-03-15')['data'], series['data'])

    def test_source_failure_returns_stale_dst_without_overwriting_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            weather = SpaceWeather(Path(tmp))
            with patch('space_weather.urlopen', return_value=io.BytesIO(DST_TEXT.encode())):
                original = weather.series('dst', '2026-03-15', '2026-03-15')
            path = Path(tmp) / 'dst-2026-03.json'
            cached = path.read_bytes()
            os.utime(path, (time.time()-90000, time.time()-90000))
            with patch('space_weather.urlopen', return_value=io.BytesIO(b'<html>Unavailable</html>')):
                series = weather.series('dst', '2026-03-15', '2026-03-15')
            self.assertEqual(series['data'], original['data'])
            self.assertEqual(series['fetched_at'], original['fetched_at'])
            self.assertTrue(series['stale'])
            self.assertIn('showing cached observations', series['error'])
            self.assertEqual(path.read_bytes(), cached)

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
            # A former SYM-H cache must never stand in for unavailable Dst.
            (Path(tmp)/'symh-2026-03.json').write_text(json.dumps(dict(data=[{'x':1773534600000,'y':-999}])))
            d=w.series('dst','2026-03-15','2026-03-15')
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
