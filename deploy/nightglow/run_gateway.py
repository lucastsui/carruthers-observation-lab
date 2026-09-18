#!/usr/bin/env python3
"""Supervise the loopback gateway, with verified external state and bounded logs."""
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import pwd
import selectors
import signal
import subprocess
import sys
import time

import run_server as storage

stopping = False

def stop(*_):
    global stopping
    stopping = True

def main():
    if os.getuid() != pwd.getpwnam('lucastsui').pw_uid:
        raise RuntimeError('Gateway must run as lucastsui')
    os.umask(0o077)
    device = storage.volume_info()
    os.chdir(storage.VOLUME)
    if os.stat('.').st_dev != device:
        raise RuntimeError('Observation volume changed')
    storage.verify_marker(device)
    for directory in ('carruthers/state/gateway', 'carruthers/state/logs',
                      'carruthers/cache/nginx/client', 'carruthers/cache/nginx/proxy'):
        storage.make_directory(Path(directory), device)
    log = Path('carruthers/state/logs/gateway.log')
    for path in [log] + [Path(str(log) + '.' + str(i)) for i in range(1, 6)]:
        if path.exists() or path.is_symlink():
            storage.check_path(path, device)
    logger = logging.getLogger('gateway')
    logger.setLevel(logging.INFO)
    handler = RotatingFileHandler(log, maxBytes=10*1024*1024, backupCount=5)
    handler.setFormatter(logging.Formatter('%(asctime)s %(message)s'))
    logger.addHandler(handler)
    config = Path(sys.argv[1]) if len(sys.argv) > 1 else storage.ROOT / 'app/deploy/nightglow/nginx.conf'
    command = [str(storage.ROOT / 'runtime/nginx/sbin/nginx'), '-p', '.',
               '-e', 'stderr', '-c', str(config), '-g', 'daemon off;']
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, stop)
    child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             start_new_session=True)
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    next_storage = time.monotonic() + 10
    try:
        while not stopping:
            if time.monotonic() >= next_storage:
                storage.verify_running_storage(device)
                next_storage = time.monotonic() + 10
            for key, _ in selector.select(timeout=1):
                chunk = os.read(key.fd, 8192)
                if chunk:
                    logger.info('%s', chunk.decode('utf-8', errors='replace').rstrip())
                else:
                    selector.unregister(key.fileobj)
            if child.poll() is not None:
                return child.returncode or 1
        return 0
    finally:
        storage.terminate(child)
        selector.close()
        child.stdout.close()
        handler.close()

if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        import syslog
        syslog.openlog('observationlab-gateway')
        syslog.syslog(syslog.LOG_ERR, str(exc)[:1500])
        sys.exit(1)
