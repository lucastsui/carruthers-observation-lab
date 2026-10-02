"""Private credential verification and bounded, revocable browser sessions."""
import hmac
import json
import os
from pathlib import Path
import secrets
import stat
import threading
import time

from argon2 import PasswordHasher, extract_parameters
from argon2.exceptions import VerificationError
from argon2.low_level import Type


class Authentication:
    lifetime = 8 * 60 * 60

    def __init__(self, credential_file):
        path = Path(credential_file)
        metadata = path.lstat()
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid()
                or stat.S_IMODE(metadata.st_mode) != 0o600):
            raise ValueError('Authentication file must be owner-only (0600), owned by the service user')
        credential = json.loads(path.read_text())
        self.username = credential['username']
        self.password_hash = credential['password_hash']
        if not isinstance(self.username, str) or not self.username or len(self.username) > 256:
            raise ValueError('Invalid authentication username')
        parameters = extract_parameters(self.password_hash)
        if parameters.type != Type.ID:
            raise ValueError('Authentication requires an Argon2id password hash')
        self.hasher = PasswordHasher()
        self.sessions = {}
        self.lock = threading.Lock()
        self.verifiers = threading.BoundedSemaphore(2)

    def verify(self, username, password):
        try:
            matches = self.hasher.verify(self.password_hash, password)
        except VerificationError:
            matches = False
        return hmac.compare_digest(username.encode(), self.username.encode()) and matches

    def create_session(self):
        now = time.monotonic()
        token = secrets.token_urlsafe(32)
        with self.lock:
            self.sessions = {key: expiry for key, expiry in self.sessions.items() if expiry > now}
            if len(self.sessions) >= 128:
                del self.sessions[next(iter(self.sessions))]
            self.sessions[token] = now + self.lifetime
        return token

    def authenticated(self, token):
        with self.lock:
            if self.sessions.get(token, 0) > time.monotonic():
                return True
            self.sessions.pop(token, None)
        return False

    def revoke(self, token):
        with self.lock:
            self.sessions.pop(token, None)
