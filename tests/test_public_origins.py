import http.client
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest

from public_server import BoundedServer, public_handler, valid_public_origin

URL = 'https://nightglow.tail2214e5.ts.net'
OLD = 'https://old-carruthers.trycloudflare.com'

class OriginTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.origin = root / 'origin'
        self.origin.write_text(OLD)
        catalogue = SimpleNamespace(root=root, frames=[{}])
        jobs = SimpleNamespace(local_dir=root/'analyses', set_owner=lambda _: None,
            health=lambda: dict(worker_alive=True, stuck=False))
        self.server = BoundedServer(('127.0.0.1', 0),
            public_handler(catalogue, jobs, root, self.origin, b'test', [URL]))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def request(self, host, origin, method='POST'):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        connection.request(method, '/health', headers={'Host': host, 'Origin': origin})
        response = connection.getresponse()
        value = (response.status, response.getheader('Set-Cookie'), json.loads(response.read()))
        connection.close()
        return value

    def test_stable_and_old_origins_during_transition(self):
        for origin in (URL, OLD):
            status, cookie, body = self.request(origin.removeprefix('https://'), origin)
            self.assertEqual(status, 200)
            self.assertIn('; Secure', cookie)
            self.assertEqual(body['status'], 'ok')

    def test_cross_origin_post_and_lookalike_host_rejected(self):
        for host, origin in [(URL[8:], OLD), (OLD[8:], URL),
                             (URL[8:] + '.evil.example', URL),
                             (URL[8:], 'https://other.tail2214e5.ts.net')]:
            self.assertEqual(self.request(host, origin)[0], 403)

    def test_cutover_revokes_old_origin(self):
        self.origin.write_text(URL)
        self.assertEqual(self.request(URL[8:], URL)[0], 200)
        self.assertEqual(self.request(OLD[8:], OLD)[0], 403)

    def test_invalid_configured_origins(self):
        for origin in ['http://nightglow.tail2214e5.ts.net', URL + '/', URL + ':443',
                       URL + '@evil.example', URL + '.evil.example',
                       'https://other.tail2214e5.ts.net']:
            self.assertFalse(valid_public_origin(origin))

if __name__ == '__main__':
    unittest.main()
