import http.client
import json
import os
from pathlib import Path
import secrets
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest

from argon2 import PasswordHasher
from auth import Authentication
from public_server import BoundedServer, public_handler

ORIGIN = 'https://nightglow.tail2214e5.ts.net'


class AuthenticationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = secrets.token_urlsafe(24)
        cls.encoded = PasswordHasher().hash(cls.password)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.credential = root / 'auth.json'
        self.credential.write_text(json.dumps(dict(username='test-user', password_hash=self.encoded)))
        self.credential.chmod(0o600)
        self.auth = Authentication(self.credential)
        origin = root / 'origin'
        origin.write_text(ORIGIN)
        static = root / 'static'
        static.mkdir()
        (static / 'index.html').write_text('protected application')
        (static / 'script.js').write_text('protected script')
        self.catalogue_calls = 0
        def public():
            self.catalogue_calls += 1
            return {'frames': [{'id': 'protected-observation'}]}
        catalogue = SimpleNamespace(root=root, frames=[{}], public=public)
        jobs = SimpleNamespace(local_dir=root/'analyses', set_owner=lambda _: None,
                               health=lambda: dict(worker_alive=True, stuck=False))
        self.server = BoundedServer(('127.0.0.1', 0),
            public_handler(catalogue, jobs, static, origin, b'test', auth=self.auth))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def request(self, path, body=None, cookie='', headers=None, method=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        h = {'Host': ORIGIN[8:], 'Origin': ORIGIN, 'Cookie': cookie,
             'Content-Type': 'application/json', 'X-Carruthers-Local': '1'}
        h.update(headers or {})
        connection.request(method or ('GET' if body is None else 'POST'), path,
                           json.dumps(body) if body is not None else None, h)
        response = connection.getresponse()
        result = response.status, response.getheaders(), response.read()
        connection.close()
        return result

    def login(self):
        status, headers, _ = self.request('/api/auth/login',
            dict(username='test-user', password=self.password))
        self.assertEqual(status, 200)
        cookie = next(value for key, value in headers if key.lower() == 'set-cookie' and value.startswith('__Host-ceda_auth='))
        for flag in ('Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=28800'):
            self.assertIn(flag, cookie)
        return cookie.split(';')[0]

    def test_gate_login_logout_and_expiry(self):
        status, headers, body = self.request('/')
        self.assertEqual(status, 303)
        self.assertIn(('Location', '/login'), headers)
        status, headers, body = self.request('/login')
        self.assertEqual(status, 200)
        self.assertIn(b'Carruthers Exploratory Data Analysis (CEDA)', body)
        self.assertNotIn(b'protected application', body)
        self.assertIn(('Cache-Control', 'no-store'), headers)
        for path in ('/api/catalogue', '/api/preview?id=x', '/api/export?id=x',
                     '/script.js', '/index.rsc', '/private/auth.json', '/auth.json'):
            self.assertEqual(self.request(path)[0], 401, path)
        self.assertEqual(self.request('/api/jobs', {})[0], 401)
        self.assertEqual(self.catalogue_calls, 0)
        self.assertEqual(self.request('/health')[0], 200)
        self.assertEqual(self.request('/api/auth/login', dict(username='test-user', password='wrong'))[0], 401)
        self.assertEqual(self.request('/api/auth/login', dict(username='unknown', password=self.password))[0], 401)
        cookie = self.login()
        self.assertEqual(self.request('/login', cookie=cookie)[0], 303)
        self.assertEqual(self.request('/', cookie=cookie)[2], b'protected application')
        self.assertEqual(self.request('/script.js', cookie=cookie)[0], 200)
        self.assertEqual(self.request('/api/auth/session', cookie=cookie)[0], 200)
        self.assertEqual(self.request('/api/catalogue', cookie=cookie)[0], 200)
        self.assertEqual(self.catalogue_calls, 1)
        self.assertEqual(self.request('/api/auth/session', cookie=cookie+'tampered')[0], 401)
        self.assertEqual(self.request('/api/auth/logout', {}, cookie)[0], 200)
        self.assertEqual(self.request('/api/catalogue', cookie=cookie)[0], 401)
        cookie = self.login()
        token = cookie.split('=', 1)[1]
        self.auth.sessions[token] = time.monotonic() - 1
        self.assertEqual(self.request('/api/catalogue', cookie=cookie)[0], 401)

    def test_request_validation_and_global_throttle(self):
        credentials = dict(username='test-user', password=self.password)
        for headers in ({'Origin': 'https://evil.example'}, {'Origin': ''},
                        {'Sec-Fetch-Site': 'cross-site'}, {'Host': 'evil.example'}):
            self.assertEqual(self.request('/api/auth/login', credentials, headers=headers)[0], 403)
        self.assertEqual(self.request('/api/auth/login')[0], 405)
        self.assertEqual(self.request('/api/auth/login', credentials, headers={'Content-Type': 'text/plain'})[0], 400)
        for body in ([], {}, {'username': [], 'password': 'x'}, {'username': 'x', 'password': 'x'*9000}):
            self.assertEqual(self.request('/api/auth/login', body)[0], 400)
        # Reject beyond budget even if every request has a different/no visitor cookie.
        for _ in range(10):
            self.assertEqual(self.request('/api/auth/login', dict(username='x', password='wrong'))[0], 401)
        self.assertEqual(self.request('/api/auth/login', credentials)[0], 429)

    def test_credential_permissions_and_session_restart(self):
        token = self.auth.create_session()
        self.assertTrue(self.auth.authenticated(token))
        self.assertFalse(Authentication(self.credential).authenticated(token))
        self.credential.chmod(0o644)
        with self.assertRaises(ValueError): Authentication(self.credential)
        self.credential.unlink()
        with self.assertRaises(FileNotFoundError): Authentication(self.credential)


if __name__ == '__main__':
    unittest.main()
