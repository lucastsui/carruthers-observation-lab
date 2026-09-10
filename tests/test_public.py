import os
import http.cookiejar
import json
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace

BASE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(BASE))
from public_jobs import PublicJobs, RequestError
from public_server import BoundedServer, public_handler
from science import Catalogue
from server import METHOD

def blocked_worker(root, recipe, pipe):
    time.sleep(30)

class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        frame=dict(id='one',channel='WFI',timestamp='2026-03-15T00:00:00Z',epoch_ms=1)
        self.c=SimpleNamespace(root=Path(self.temp.name),get=lambda _:frame)
        self.jobs=PublicJobs(self.c,Path(self.temp.name)/'analyses',METHOD,timeout=10,worker=blocked_worker)
        self.body=dict(frame_ids=['one'],roi=dict(kind='annulus',inner=4.5,outer=5.5))
    def tearDown(self): self.jobs.close(); self.temp.cleanup()
    def test_queue_bound_ownership_and_cancel(self):
        self.jobs.set_owner('a'); first=self.jobs.start(self.body)
        for _ in range(50):
            if self.jobs.status(first['id'])['status']=='running': break
            time.sleep(.02)
        for i in range(10):
            self.jobs.set_owner(str(i)); j=self.jobs.start(self.body)
            self.assertEqual(j['status'],'queued')
        self.jobs.set_owner('overflow')
        with self.assertRaises(RequestError) as e: self.jobs.start(self.body)
        self.assertEqual(e.exception.status,429)
        with self.assertRaises(RequestError): self.jobs.cancel(first['id'])
        self.jobs.set_owner('a'); self.jobs.cancel(first['id'])
        for _ in range(100):
            if self.jobs.status(first['id'])['status']=='cancelled': break
            time.sleep(.02)
        self.assertEqual(self.jobs.status(first['id'])['status'],'cancelled')
        self.jobs.set_owner('0'); self.assertIn(self.jobs.status(next(j['id'] for j in self.jobs.jobs.values() if j['_owner']=='0'))['status'],('running','queued'))
    def test_timeout_releases_worker(self):
        self.jobs.timeout=.2; self.jobs.set_owner('a'); j=self.jobs.start(self.body)
        for _ in range(100):
            value=self.jobs.status(j['id'])
            if value['status']=='error': break
            time.sleep(.03)
        self.assertEqual(value['status'],'error')
        self.assertIn('limit',value['error'])
    def test_browsing_only(self):
        (Path(self.temp.name)/'browsing-only').touch()
        self.jobs.set_owner('a')
        with self.assertRaises(RequestError) as e:self.jobs.start(self.body)
        self.assertEqual(e.exception.status,503)

@unittest.skipUnless((Path(os.environ.get('CARRUTHERS_DATA_DIR', BASE.parent/'code and data/L1C'))).is_dir(),'Dataset unavailable')
class PublicApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(); root=Path(cls.temp.name)
        cls.c=Catalogue(Path(os.environ.get('CARRUTHERS_DATA_DIR', BASE.parent/'code and data/L1C')))
        cls.jobs=PublicJobs(cls.c,root/'analyses',METHOD)
        cls.origin=root/'url';cls.origin.write_text('https://test-carruthers.trycloudflare.com')
        cls.httpd=BoundedServer(('127.0.0.1',0),public_handler(cls.c,cls.jobs,BASE/'dist/client',cls.origin,b'test-secret'))
        cls.thread=threading.Thread(target=cls.httpd.serve_forever,daemon=True);cls.thread.start()
        cls.url=f'http://127.0.0.1:{cls.httpd.server_port}'
    @classmethod
    def tearDownClass(cls):cls.httpd.shutdown();cls.httpd.server_close();cls.jobs.close();cls.temp.cleanup()
    def test_actual_science_and_private_jobs(self):
        browser=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        def req(path,body=None,headers=None):
            h={'Content-Type':'application/json','X-Carruthers-Local':'1'};h.update(headers or {})
            return browser.open(urllib.request.Request(self.url+path,data=json.dumps(body).encode() if body is not None else None,headers=h),timeout=15)
        with req('/health') as r:self.assertEqual(json.load(r)['frames'],1794)
        frames=[f['id'] for f in self.c.frames if f['channel']=='WFI' and f['timestamp'].startswith('2026-03-15')]
        with req('/api/jobs',dict(frame_ids=frames,roi=dict(kind='annulus',inner=4.5,outer=5.5))) as r:j=json.load(r)
        for _ in range(200):
            with req('/api/jobs?id='+j['id']+'&rows=1') as r:result=json.load(r)
            if result['status'] in ('complete','error'):break
            time.sleep(.1)
        self.assertEqual(result['status'],'complete',result)
        self.assertEqual(len(result['rows']),22)
        self.assertEqual(set(result['rows'][0]['circularity']), {'1', '3'})
        self.assertEqual(result['method']['circularity']['sensitivity_factors'], [.95, 1., 1.05])
        self.assertEqual(result['rows'][0]['circularity']['3']['status'], 'ok')
        self.assertAlmostEqual(result['rows'][0]['mean_kR'],5.055363316796408,places=12)
        with req('/api/export?id='+j['id']) as r:self.assertIn(b'mean_kR',r.read())
        other=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with self.assertRaises(urllib.error.HTTPError) as e:other.open(self.url+'/api/jobs?id='+j['id'])
        self.assertEqual(e.exception.code,404)
        for path,headers in [('/api/saved',{}),('/api/catalogue',{'Host':'evil.example'}),('/api/catalogue',{'Origin':'https://evil.example'}),('/../public_server.py',{})]:
            with self.subTest(path=path),self.assertRaises(urllib.error.HTTPError):req(path,headers=headers)
        with req('/api/jobs',dict(frame_ids=frames,roi=dict(kind='annulus',inner=4.5,outer=5.5))) as r:
            self.assertTrue(json.load(r)['reused'])
        with req('/api/jobs',dict(frame_ids=frames[:2],roi=dict(kind='paired_sectors',angle_width=60))) as r:
            paired=json.load(r)
        for _ in range(200):
            with req('/api/jobs?id='+paired['id']+'&rows=1') as r:result=json.load(r)
            if result['status'] in ('complete','error'):break
            time.sleep(.1)
        self.assertEqual(result['status'],'complete',result)
        self.assertEqual(result['total'],2)
        self.assertEqual(len(result['rows']),2)
        self.assertEqual(set(result['rows'][0]['regions']),{'dawn','dusk'})
        self.assertNotEqual(result['rows'][0]['regions']['dawn']['mean_kR'],result['rows'][0]['regions']['dusk']['mean_kR'])

if __name__=='__main__':unittest.main()
