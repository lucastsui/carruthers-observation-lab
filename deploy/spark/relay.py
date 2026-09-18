#!/usr/bin/env python3
"""Keep the loopback SSH relay and permitted public origin synchronized."""
import signal
import subprocess
import time
from pathlib import Path

SSH = ['/usr/bin/ssh', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
       '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10',
       '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
       '-o', 'UserKnownHostsFile=/home/anaclast/.ssh/carruthers-nightglow-known-hosts',
       '-i', '/home/anaclast/.ssh/carruthers-nightglow']
TARGET = 'lucastsui@100.118.4.122'
origin = Path('/run/carruthers-tunnel/public-url')
stopping = False

def stop(*_):
    global stopping
    stopping = True

def sync():
    try:
        subprocess.run(SSH + [TARGET, 'sync-origin'], input=origin.read_bytes(),
                       check=True, timeout=20, stdout=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError) as exc:
        print(f'Origin synchronization failed: {type(exc).__name__}', flush=True)
        return False
    return True

if __name__ == '__main__':
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    if not sync():
        raise SystemExit(1)
    child = subprocess.Popen(SSH + ['-N', '-T', '-o', 'ExitOnForwardFailure=yes',
        '-L', '127.0.0.1:18766:127.0.0.1:8766', TARGET])
    try:
        next_sync = time.monotonic() + 30
        while not stopping and child.poll() is None:
            time.sleep(1)
            if time.monotonic() >= next_sync:
                sync()
                next_sync = time.monotonic() + 30
    finally:
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
    raise SystemExit(0 if stopping else 1)
