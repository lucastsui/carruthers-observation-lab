#!/usr/bin/env python3
"""Retire only Spark's app services after the verified nightglow handoff."""
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

ROOT = Path('/home/anaclast/carruthers-nightglow')
URL = 'https://nightglow.tail2214e5.ts.net'
UNITS = ['carruthers-monitor.timer', 'carruthers-monitor.service',
         'carruthers-tunnel.service', 'carruthers-gateway.service',
         'carruthers-nightglow-relay.service', 'carruthers.service']

def main():
    token = sys.argv[1]
    deadline = time.monotonic() + 1800
    while time.monotonic() < deadline:
        try:
            ready = json.loads((ROOT / 'independent-ready.json').read_text())
            if ready['token'] == token and ready['status'] == 'passed' and ready['url'] == URL:
                break
        except (OSError, ValueError, KeyError):
            pass
        time.sleep(2)
    else:
        raise SystemExit('No verified handoff received; Spark services remain running')
    with urllib.request.urlopen(URL + '/health', timeout=30) as response:
        health = json.load(response)
    if health.get('status') != 'ok' or health.get('frames') != 1794:
        raise SystemExit('Nightglow failed the final health check; Spark unchanged')
    # Stop monitoring first, so it cannot restore a retired service or revert
    # the external monitor URL after nightglow becomes responsible for it.
    subprocess.run(['systemctl', 'disable', '--now', 'carruthers-monitor.timer'], check=True)
    subprocess.run(['systemctl', 'stop', 'carruthers-monitor.service'], check=True)
    subprocess.run(['systemctl', 'disable', '--now', *UNITS[2:]], check=True)
    for unit in UNITS:
        if subprocess.run(['systemctl', 'is-active', '--quiet', unit]).returncode == 0:
            raise RuntimeError('Service remained active: ' + unit)
    report = dict(status='stopped', token=token, url=URL, units=UNITS, time=time.time())
    path = Path('/run/carruthers-independent.json')
    path.write_text(json.dumps(report) + '\n')
    path.chmod(0o644)
    print('Spark app services disabled; original files retained.', flush=True)

if __name__ == '__main__':
    main()
