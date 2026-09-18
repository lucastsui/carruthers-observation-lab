#!/usr/bin/env python3
"""Wait for the authenticated nightglow daemon, then move the existing relay."""
import ipaddress
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

OLD = '100.104.95.9'
ROOT = Path('/home/anaclast/carruthers-nightglow')
REPORT = Path('/run/carruthers-headless.json')
BACKUP = Path('/etc/carruthers/before-headless')
RELAY = ROOT / 'relay.py'
MONITOR = Path('/opt/carruthers/app/deploy/monitor.py')

def main():
    target = str(ipaddress.IPv4Address(sys.argv[1]))
    if ipaddress.ip_address(target) not in ipaddress.ip_network('100.64.0.0/10') or target == OLD:
        raise SystemExit('Expected the new Tailscale IPv4 address')
    ssh = ['/usr/bin/ssh', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
           '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=3',
           '-o', 'UserKnownHostsFile=/etc/carruthers/nightglow-known-hosts',
           '-i', '/etc/carruthers/nightglow-monitor-key']
    destination = 'lucastsui@' + target
    # Authentication was staged with incoming connections blocked. Nothing is
    # switched until the real system daemon accepts the pinned SSH connection.
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        try:
            value = subprocess.check_output(ssh + [destination, 'storage-status'],
                                           timeout=6, stderr=subprocess.DEVNULL)
            storage = json.loads(value)
            if storage['total'] > 0 and storage['free'] > 0:
                break
        except (OSError, ValueError, KeyError, subprocess.SubprocessError):
            pass
        time.sleep(2)
    else:
        raise SystemExit('New nightglow connection did not become available; relay unchanged')
    BACKUP.mkdir(mode=0o700, exist_ok=False)
    for source in (RELAY, MONITOR):
        shutil.copy2(source, BACKUP / source.name)
    try:
        # Verify the HTTP backend through a separate SSH forward before cutover.
        tunnel = subprocess.Popen(ssh + ['-N', '-T', '-o', 'ExitOnForwardFailure=yes',
            '-L', '127.0.0.1:18767:127.0.0.1:8766', destination],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(30):
                if tunnel.poll() is not None:
                    raise RuntimeError('Preflight SSH forward exited')
                try:
                    with urllib.request.urlopen('http://127.0.0.1:18767/health', timeout=2) as r:
                        health = json.load(r)
                    if health['status'] == 'ok' and health['frames'] == 1794:
                        break
                except (OSError, ValueError, KeyError):
                    pass
                time.sleep(1)
            else:
                raise RuntimeError('New network route failed backend health check')
        finally:
            tunnel.terminate()
            try:
                tunnel.wait(timeout=5)
            except subprocess.TimeoutExpired:
                tunnel.kill()
                tunnel.wait()
        for path in (RELAY, MONITOR):
            source = path.read_text()
            if source.count(OLD) != 1:
                raise RuntimeError('Unexpected current relay or monitor target')
            path.write_text(source.replace(OLD, target))
        subprocess.run(['systemctl', 'restart', 'carruthers-nightglow-relay.service'], check=True)
        for _ in range(40):
            try:
                with urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=2) as r:
                    health = json.load(r)
                if health['status'] == 'ok' and health['frames'] == 1794:
                    break
            except (OSError, ValueError, KeyError):
                pass
            time.sleep(1)
        else:
            raise RuntimeError('Relay failed health check after network cutover')
        subprocess.run(['systemctl', 'start', 'carruthers-monitor.service'], check=True)
        REPORT.write_text(json.dumps(dict(status='passed', target=target,
            frames=1794, checked_at=time.time())) + '\n')
        REPORT.chmod(0o644)
        print('Network cutover passed: ' + target, flush=True)
    except BaseException:
        for path in (RELAY, MONITOR):
            shutil.copy2(BACKUP / path.name, path)
        subprocess.run(['systemctl', 'restart', 'carruthers-nightglow-relay.service'])
        raise

if __name__ == '__main__':
    main()
