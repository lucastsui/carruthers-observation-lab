#!/usr/bin/env python3
"""Local watchdog and existing Better Stack heartbeat; no Spark dependency."""
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import time
from urllib.request import Request, urlopen

import run_server as storage

URL = 'https://nightglow.tail2214e5.ts.net'
TS = ['/usr/local/libexec/observationlab/tailscale',
      '--socket=/var/run/observationlab-tailscale.sock']
LABELS = ('org.carruthers.observation-lab', 'org.carruthers.gateway')

def request(url, body=None, method=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    data = json.dumps(body).encode() if body is not None else None
    with urlopen(Request(url, data=data, headers=headers, method=method), timeout=15) as response:
        content = response.read()
        return json.loads(content) if content else {}

def main():
    os.umask(0o077)
    # During the transition Spark remains the sole owner of monitoring until
    # its app services are disabled and the coordinator publishes this marker.
    if not (storage.ROOT / 'independent-active').is_file():
        return
    credentials_path = storage.ROOT / 'private/monitor.json'
    mode = credentials_path.stat().st_mode & 0o777
    if mode & 0o077 or credentials_path.is_symlink():
        raise RuntimeError('Monitoring credentials must be private to lucastsui')
    credentials = json.loads(credentials_path.read_text())
    problems = []
    device = None
    state = None
    previous = {}
    try:
        device = storage.volume_info()
        os.chdir(storage.VOLUME)
        storage.verify_marker(device)
        storage.make_directory(Path('carruthers/state/monitor'), device)
        state = Path('carruthers/state/monitor/health.json')
        if state.exists() or state.is_symlink():
            storage.check_path(state, device)
            previous = json.loads(state.read_text())
        disk = shutil.disk_usage('.')
        if disk.free / disk.total < .2:
            problems.append('Observation volume below 20% free')
    except Exception:
        problems.append('Observation volume unavailable')
        device = None
        state = None
    healthy = False
    try:
        health = request('http://127.0.0.1:8765/health')
        healthy = health.get('status') == 'ok' and health.get('frames') == 1794
    except Exception:
        pass
    if not healthy:
        problems.append('Application unavailable')
    services = {}
    for label in LABELS:
        try:
            output = subprocess.check_output(['/bin/launchctl', 'print', 'system/' + label], text=True, timeout=5)
            pid = re.search(r'^\s*pid = (\d+)$', output, re.MULTILINE)
            runs = re.search(r'^\s*runs = (\d+)$', output, re.MULTILINE)
            services[label] = dict(pid=int(pid[1]) if pid else None,
                                   runs=int(runs[1]) if runs else 0)
            if not pid:
                problems.append('Service inactive: ' + label)
        except subprocess.SubprocessError:
            problems.append('Service missing: ' + label)
    try:
        network = json.loads(subprocess.check_output(TS + ['status', '--json'], text=True, timeout=10))
        funnel = json.loads(subprocess.check_output(TS + ['funnel', 'status', '--json'], text=True, timeout=10))
        if network['BackendState'] != 'Running' or not funnel.get('AllowFunnel', {}).get('nightglow.tail2214e5.ts.net:443'):
            problems.append('Public Tailscale connection unavailable')
    except Exception:
        problems.append('Public Tailscale connection unavailable')
    failures = 0 if healthy else previous.get('failures', 0) + 1
    last_restart = previous.get('last_restart', 0)
    # User-owned system jobs can be signalled by their UID; launchd restarts
    # them. Verify their UID and executable before sending a targeted signal.
    if device is not None and failures >= 3 and time.time() - last_restart > 900:
        for label, service in services.items():
            pid = service['pid']
            if not pid:
                continue
            try:
                command = subprocess.check_output(['/bin/ps', '-p', str(pid), '-o', 'uid=', '-o', 'command='], text=True)
                script = 'run_server.py' if label.endswith('observation-lab') else 'run_gateway.py'
                if command.strip().startswith(str(os.getuid()) + ' ') and str(storage.ROOT / 'app/deploy/nightglow' / script) in command:
                    os.kill(pid, signal.SIGTERM)
            except (ProcessLookupError, subprocess.SubprocessError):
                pass
        last_restart = time.time()
    events = [event for event in previous.get('crash_events', []) if time.time() - event['time'] < 600]
    for label, service in services.items():
        delta = max(0, service['runs'] - previous.get('services', {}).get(label, service)['runs'])
        if delta:
            events.append(dict(time=time.time(), label=label, count=delta))
        if sum(event['count'] for event in events if event['label'] == label) >= 3:
            problems.append('Repeated restarts: ' + label)
    token = credentials.get('BETTERSTACK_API_TOKEN')
    monitor = credentials.get('BETTERSTACK_MONITOR_ID')
    synced = previous.get('synced_url', '')
    if token and monitor and synced != URL:
        try:
            request(f'https://uptime.betterstack.com/api/v2/monitors/{monitor}',
                    {'url': URL + '/health'}, 'PATCH', token)
            synced = URL
        except Exception:
            problems.append('Could not update external monitoring URL')
    heartbeat = credentials.get('BETTERSTACK_HEARTBEAT_URL')
    if heartbeat:
        try:
            target = heartbeat.rstrip('/') + ('/fail' if problems else '')
            data = '; '.join(problems).encode() if problems else None
            with urlopen(Request(target, data=data), timeout=15) as response:
                response.read(1024)
        except Exception:
            problems.append('Could not contact external heartbeat')
    report = dict(time=time.time(), problems=problems, failures=failures,
                  last_restart=last_restart, services=services, crash_events=events,
                  public_url=URL, synced_url=synced,
                  external_monitor_configured=bool(token and monitor and heartbeat))
    if state is not None and storage.volume_info() == device:
        temporary = state.with_name('.health-' + secrets.token_hex(12) + '.tmp')
        with temporary.open('x') as output:
            json.dump(report, output, indent=2)
        temporary.replace(state)
    import syslog
    syslog.openlog('observationlab-monitor')
    syslog.syslog(syslog.LOG_INFO if not problems else syslog.LOG_WARNING,
                  'Healthy' if not problems else '; '.join(problems))

if __name__ == '__main__':
    main()
