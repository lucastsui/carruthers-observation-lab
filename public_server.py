#!/usr/bin/env python3
"""Public deployment adapter, behind the loopback nginx request gateway."""
import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from collections import OrderedDict
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from science import Catalogue
from server import make_handler, METHOD, BASE
from public_jobs import PublicJobs, RequestError


class Limits:
    def __init__(self):
        self.entries = OrderedDict()
        self.lock = threading.Lock()

    def take(self, key, count, seconds=60):
        now = time.monotonic()
        with self.lock:
            tokens, last = self.entries.pop(key, (count, now))
            tokens = min(count, tokens+(now-last)*count/seconds)
            ok = tokens >= 1
            self.entries[key] = (tokens-1 if ok else tokens, now)
            while len(self.entries)>10000: self.entries.popitem(last=False)
            return ok


class BoundedServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 32
    def __init__(self, *args):
        self.slots = threading.BoundedSemaphore(32)
        super().__init__(*args)
    def get_request(self):
        sock, address = super().get_request()
        sock.settimeout(10)
        return sock, address
    def process_request(self, request, address):
        if not self.slots.acquire(False):
            try: request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\nRetry-After: 5\r\n\r\n')
            finally: self.shutdown_request(request)
            return
        try: super().process_request(request,address)
        except Exception: self.slots.release(); raise
    def process_request_thread(self, request, address):
        try: super().process_request_thread(request,address)
        finally: self.slots.release()
    def handle_error(self, request, address):
        # Peer disconnects are routine and should not fill the log.
        print('Request failed or timed out', flush=True)


def valid_public_origin(value):
    return bool(re.fullmatch(r'https://[a-z0-9-]+\.trycloudflare\.com', value)
                or value == 'https://nightglow.tail2214e5.ts.net')


def public_handler(catalogue, jobs, static, origin_file, secret, extra_origins=(), auth=None):
    parent = make_handler(catalogue, jobs, static)
    limits = Limits()
    compute = threading.BoundedSemaphore(2)
    waiting = threading.BoundedSemaphore(10)
    context_slots = threading.BoundedSemaphore(2)
    class Handler(parent):
        def auth_cookie(self):
            local = self.headers.get('Host', '').split(':')[0] in ('localhost', '127.0.0.1')
            name = 'ceda_auth' if local else '__Host-ceda_auth'
            try:
                cookie = SimpleCookie(self.headers.get('Cookie', ''))
                token = cookie[name].value if name in cookie else ''
            except Exception:
                token = ''
            return name, token, '' if local else '; Secure'

        def authenticate_request(self, path, post):
            name, token, secure = self.auth_cookie()
            if path in ('/api/auth/login', '/api/auth/logout'):
                if not post:
                    self.send_json({'error': 'POST required'}, 405)
                    return False
                if (self.headers.get('X-Carruthers-Local') != '1'
                        or self.headers.get('Content-Type', '').split(';')[0] != 'application/json'):
                    self.send_json({'error': 'JSON request required'}, 400)
                    return False
                try:
                    length = int(self.headers.get('Content-Length', '0'))
                    if not 0 < length <= 8192:
                        raise ValueError()
                    body = json.loads(self.rfile.read(length))
                    if not isinstance(body, dict):
                        raise ValueError()
                except (ValueError, UnicodeError):
                    self.send_json({'error': 'Invalid login request'}, 400)
                    return False
                if path == '/api/auth/logout':
                    auth.revoke(token)
                    self.auth_set_cookie = f'{name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{secure}'
                    self.send_json({'ok': True})
                    return False
                username, password = body.get('username'), body.get('password')
                if (not isinstance(username, str) or not isinstance(password, str)
                        or not 1 <= len(username) <= 256 or not 1 <= len(password) <= 1024):
                    self.send_json({'error': 'Enter your user and password.'}, 400)
                    return False
                # Global budget: a caller cannot evade it by discarding cookies.
                if not limits.take('login', 10) or not auth.verifiers.acquire(False):
                    self.limited = True
                    self.send_json({'error': 'Too many sign-in attempts. Please wait a minute and try again.'}, 429)
                    return False
                try:
                    valid = auth.verify(username, password)
                finally:
                    auth.verifiers.release()
                if not valid:
                    self.send_json({'error': 'Incorrect user or password.'}, 401)
                    return False
                auth.revoke(token)
                token = auth.create_session()
                self.auth_set_cookie = f'{name}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={auth.lifetime}{secure}'
                self.send_json({'ok': True})
                return False
            if not auth.authenticated(token):
                if not post and path in ('/', '/index.html'):
                    self.send_data(200, (BASE / 'login.html').read_bytes(), 'text/html; charset=utf-8')
                else:
                    self.send_json({'error': 'Please sign in to continue.'}, 401)
                return False
            if path == '/api/auth/session':
                self.send_json({'authenticated': True, 'username': auth.username})
                return False
            return True

        def allowed(self):
            if getattr(self, '_checked', False): return True
            self.new_cookie = None
            host = self.headers.get('Host','')
            try: public = Path(origin_file).read_text().strip()
            except OSError: public = ''
            if not valid_public_origin(public): public = ''
            public_origins = {public, *extra_origins} - {''}
            local = host.split(':')[0] in ('localhost','127.0.0.1')
            if not local and host not in {urlparse(value).netloc for value in public_origins}:
                self.send_json({'error':'Unrecognized website address'},403); return False
            origin = self.headers.get('Origin')
            allowed = public_origins | {'http://127.0.0.1:8765','http://localhost:8765', 'http://127.0.0.1:5173', f'http://127.0.0.1:{self.server.server_port}'}
            if origin and origin not in allowed or self.command=='POST' and not local and origin != 'https://' + host:
                self.send_json({'error':'Cross-origin request rejected'},403); return False
            if self.command=='POST' and self.headers.get('Sec-Fetch-Site')=='cross-site':
                self.send_json({'error':'Cross-site request rejected'},403); return False
            token = ''
            try:
                cookie = SimpleCookie(self.headers.get('Cookie',''))
                token = cookie['carruthers_session'].value if 'carruthers_session' in cookie else ''
                sid, stamp, signature = token.split('.')
                valid = bool(re.fullmatch(r'[a-f0-9]{32}',sid)) and 0 <= time.time()-int(stamp) < 86400 and hmac.compare_digest(signature, hmac.new(secret,f'{sid}.{stamp}'.encode(),hashlib.sha256).hexdigest())
            except Exception: valid = False
            if not valid:
                sid, stamp = secrets.token_hex(16), str(int(time.time()))
                token = f'{sid}.{stamp}.'+hmac.new(secret,f'{sid}.{stamp}'.encode(),hashlib.sha256).hexdigest()
                self.new_cookie = f'carruthers_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400'+('' if local else '; Secure')
            self.sid = sid
            jobs.set_owner(sid)
            self._checked = True
            return True

        def end_headers(self):
            if getattr(self,'new_cookie',None): self.send_header('Set-Cookie',self.new_cookie)
            if getattr(self,'auth_set_cookie',None): self.send_header('Set-Cookie',self.auth_set_cookie)
            if getattr(self,'limited',False): self.send_header('Retry-After','10')
            super().end_headers()

        def dispatch(self, post=False):
            self._checked = False
            self.limited = False
            self.auth_set_cookie = None
            if not self.allowed(): return
            path = urlparse(self.path).path
            if path in ('/health','/api/health'):
                health = jobs.health()
                ready = bool(catalogue.frames) and catalogue.root.is_dir() and health['worker_alive'] and not health['stuck']
                return self.send_json(dict(app='carruthers-observation-lab', status='ok' if ready else 'unhealthy', frames=len(catalogue.frames), **health),200 if ready else 503)
            if auth is not None and not self.authenticate_request(path, post):
                return
            if path in ('/api/save','/api/saved') or path=='/api/export' and parse_qs(urlparse(self.path).query).get('saved')==['1']:
                return self.send_json({'error':'Saved analyses are stored in your browser.'},404)
            category = 'submit' if path=='/api/jobs' and post else 'measure' if path=='/api/measure' else 'browse'
            if not limits.take((self.sid,category), {'submit':6,'measure':120,'browse':600}[category]):
                self.limited=True
                return self.send_json({'error':'Too many requests. Please wait briefly and retry.'},429)
            if path=='/api/context':
                q=parse_qs(urlparse(self.path).query)
                if not all(re.fullmatch(r'2026-03-\d{2}',q.get(k,[''])[0]) for k in ('start','end')):
                    return self.send_json({'error':'Reference series are enabled for March 2026.'},400)
                if not context_slots.acquire(False):
                    self.limited=True
                    return self.send_json({'error':'Reference data are busy; retry shortly.'},429)
            is_compute = path in ('/api/measure','/api/preview','/api/baseline','/api/contours')
            acquired = False
            if is_compute:
                if not waiting.acquire(False):
                    self.limited=True
                    return self.send_json({'error':'Image workers are busy. Retry shortly.'},429)
                acquired=compute.acquire(timeout=3)
                if not acquired:
                    waiting.release(); self.limited=True
                    return self.send_json({'error':'Image workers are busy. Retry shortly.'},429)
            try:
                return super().do_POST() if post else super().do_GET()
            finally:
                if is_compute and acquired: compute.release(); waiting.release()
                if path=='/api/context': context_slots.release()

        def do_GET(self): return self.dispatch()
        def do_POST(self): return self.dispatch(True)
    return Handler


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--data',type=Path,required=True)
    parser.add_argument('--port',type=int,default=8766)
    parser.add_argument('--state',type=Path,default=Path('/var/lib/carruthers'))
    parser.add_argument('--origin-file',default='/run/carruthers-tunnel/public-url')
    parser.add_argument('--auth-file',type=Path,required=True,help='Private 0600 JSON with username and Argon2id password_hash')
    parser.add_argument('--extra-origin',action='append',default=[],help='Additional approved origin during migration')
    parser.add_argument('--job-timeout',type=float,default=120,help='Analysis deadline in seconds (1–600; default 120)')
    args=parser.parse_args()
    if not 1 <= args.job_timeout <= 600:
        parser.error('--job-timeout must be between 1 and 600 seconds')
    if any(not valid_public_origin(value) for value in args.extra_origin):
        parser.error('--extra-origin must be an approved HTTPS website origin')
    from auth import Authentication
    auth = Authentication(args.auth_file)
    args.state.mkdir(parents=True,exist_ok=True)
    key=args.state/'session-key'
    if not key.exists():
        fd=os.open(key,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as f: f.write(secrets.token_bytes(32))
    catalogue=Catalogue(args.data)
    if not catalogue.frames: raise RuntimeError('No validated observation frames found')
    jobs=PublicJobs(catalogue,args.state/'analyses',METHOD,timeout=args.job_timeout)
    server=BoundedServer(('127.0.0.1',args.port),public_handler(catalogue,jobs,BASE/'dist/client',args.origin_file,key.read_bytes(),args.extra_origin,auth))
    print(f'Ready: {len(catalogue.frames)} frames on 127.0.0.1:{args.port}',flush=True)
    try: server.serve_forever()
    finally: server.server_close(); jobs.close()

if __name__=='__main__': main()
