import os
import csv
import io
import json
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))
from science import Catalogue
from server import JobManager, make_handler, measure_frame


@unittest.skipUnless((Path(os.environ.get('CARRUTHERS_DATA_DIR', BASE.parent / 'code and data/L1C'))).is_dir(), 'Dataset is not installed')
class LocalServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = Path(cls.temp.name)
        cls.c = Catalogue(Path(os.environ.get('CARRUTHERS_DATA_DIR', BASE.parent / 'code and data/L1C')))
        cls.jobs = JobManager(cls.c, root / 'analyses')
        static = root / 'static'
        static.mkdir()
        (static / 'index.html').write_text('<html>Local test fixture</html>')
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(cls.c, cls.jobs, static))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'
        cls.http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        cls.frames = [f for f in cls.c.frames if f['channel'] == 'WFI' and f['timestamp'].startswith('2026-03-15')]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def request(self, path, body=None, headers=None):
        h = {'Content-Type': 'application/json', 'X-Carruthers-Local': '1'}
        h.update(headers or {})
        req = urllib.request.Request(self.url+path, data=json.dumps(body).encode() if body is not None else None, headers=h)
        return self.http.open(req, timeout=20)

    def jrequest(self, path, body=None):
        with self.request(path, body) as response:
            return json.load(response)

    def body(self):
        return dict(frame_ids=[f['id'] for f in self.frames], roi=dict(kind='annulus', inner=4.5, outer=5.5), exclude_interpolated=True)

    def wait_job(self, jid):
        for _ in range(200):
            result = self.jrequest('/api/jobs?id='+jid+'&rows=1')
            if result['status'] not in ('queued', 'running', 'cancelling'):
                return result
            time.sleep(.02)
        self.fail('Job did not finish')

    def test_local_access_and_source_isolation(self):
        self.assertEqual(self.jrequest('/api/health')['frames'], 1794)
        for path, headers in [('/api/catalogue', {'Host': 'attacker.example'}),
                              ('/api/catalogue', {'Origin': 'https://attacker.example'}),
                              ('/../server.py', {}), ('/%2e%2e/server.py', {}),
                              ('/L1C/2603/'+self.frames[0]['source'].split('/')[-1], {})]:
            with self.subTest(path=path, headers=headers), self.assertRaises(urllib.error.HTTPError) as error:
                self.request(path, headers=headers)
            self.assertIn(error.exception.code, (403, 404))
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.request('/api/jobs', self.body(), {'X-Carruthers-Local': ''})
        self.assertEqual(error.exception.code, 403)

    def test_extraction_export_and_persistence(self):
        job = self.jrequest('/api/jobs', self.body())
        result = self.wait_job(job['id'])
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(len(result['rows']), 22)
        self.assertAlmostEqual(result['baseline']['mean_kR'], 0.5542657961872612, places=12)
        self.assertEqual(result['baseline']['frame_id'], self.frames[0]['id'])
        self.assertAlmostEqual(result['rows'][0]['mean_kR'], 5.055363316796408, places=12)
        with self.request('/api/export?id='+job['id']) as response:
            rows = list(csv.DictReader(io.StringIO(response.read().decode())))
            self.assertIn('attachment', response.headers['Content-Disposition'])
        self.assertEqual(len(rows), 22)
        self.assertAlmostEqual(float(rows[0]['baseline_mean_kR']), result['baseline']['mean_kR'])
        self.assertEqual(rows[0]['method_version'], 'carruthers-local-1.3')
        self.assertEqual(rows[0]['exclude_interpolated'], 'True')
        self.assertEqual(json.loads(rows[0]['roi_json'])['inner'], 4.5)
        self.jrequest('/api/save', {'id': job['id'], 'title': 'Regression analysis'})
        restarted = JobManager(self.c, self.jobs.local_dir)
        self.assertEqual(restarted.saved()[0]['title'], 'Regression analysis')
        self.assertEqual(restarted.load(job['id'])['rows'], result['rows'])
        with self.request('/api/export?id='+job['id']+'&saved=1&format=json') as response:
            self.assertEqual(json.load(response)['recipe'], result['recipe'])

    def test_cancel_and_concurrent_preview(self):
        def slower(*a, **kw):
            time.sleep(.03)
            return measure_frame(*a, **kw)
        with patch('server.measure_frame', side_effect=slower):
            job = self.jrequest('/api/jobs', self.body())
            with self.assertRaises(urllib.error.HTTPError):
                self.jrequest('/api/jobs', self.body())
            with ThreadPoolExecutor(max_workers=3) as pool:
                responses = list(pool.map(lambda f: self.request('/api/preview?id='+f['id']).read(), self.frames[:3]))
            self.assertTrue(all(r.startswith(b'\x89PNG') for r in responses))
            self.jrequest('/api/cancel', {'id': job['id']})
            result = self.wait_job(job['id'])
            self.assertEqual(result['status'], 'cancelled')
            self.assertLess(result['completed'], result['total'])
        with self.assertRaises(urllib.error.HTTPError):
            self.jrequest('/api/save', {'id': job['id']})

    def test_invalid_inputs_and_nfi_measurement(self):
        for body in [dict(frame_ids=[], roi={}), dict(frame_ids=[self.frames[0]['id']]*2, roi={}),
                     dict(frame_ids=['missing'], roi={}), dict(frame_ids=[self.frames[0]['id']], roi=None)]:
            with self.subTest(body=body), self.assertRaises(urllib.error.HTTPError) as error:
                self.jrequest('/api/jobs', body)
            self.assertEqual(error.exception.code, 400)
        nfi = next(f for f in self.c.frames if f['channel'] == 'NFI')
        sample = self.jrequest('/api/measure', dict(frame_id=nfi['id'], roi=dict(kind='sector', inner=4.5, outer=5.5, angle_start=0, angle_end=90)))
        self.assertEqual(sample['channel'], 'NFI')
        self.assertGreater(sample['valid_pixels'], 0)
        self.assertEqual(len(sample['profile']), 80)

    def test_model_contour_endpoint(self):
        fid = self.frames[0]['id']
        result = self.jrequest('/api/model-contours?id='+fid+'&model=Z15MIN&irradiance=6&exclude=0')
        self.assertEqual(result['frame_id'], fid)
        self.assertEqual(result['model'], 'Z15MIN')
        self.assertFalse(result['exclude_interpolated'])
        self.assertEqual(result['units'], 'kR')
        self.assertTrue(result['contours'])
        for query in ('id=missing', 'id='+fid+'&model=bad', 'id='+fid+'&irradiance=nan'):
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.jrequest('/api/model-contours?'+query)
            self.assertEqual(error.exception.code, 400)


if __name__ == '__main__':
    unittest.main()
