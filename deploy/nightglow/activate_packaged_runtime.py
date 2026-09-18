#!/usr/bin/env python3
"""Activate the approved runtime bundle through the existing virtualenv path."""
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import time
import urllib.request

ROOT = Path('/Users/lucastsui/Applications/ObservationLab')
BUNDLE = ROOT / 'Observation Lab Runtime.app'
LABELS = {'org.carruthers.observation-lab': 'run_server.py',
          'org.carruthers.gateway': 'run_gateway.py'}


def health():
    with urllib.request.urlopen('http://127.0.0.1:8765/health', timeout=3) as response:
        return json.load(response)


def supervisor_pid(label):
    output = subprocess.check_output(['/bin/launchctl', 'print', 'system/' + label], text=True)
    pid = int(re.search(r'^\s*pid = (\d+)$', output, re.MULTILINE)[1])
    command = subprocess.check_output(['/bin/ps', '-p', str(pid), '-o', 'uid=',
                                       '-o', 'command='], text=True).strip()
    if (not command.startswith(str(os.getuid()) + ' ')
            or str(ROOT / 'app/deploy/nightglow' / LABELS[label]) not in command):
        raise RuntimeError('Supervisor identity changed: ' + label)
    return pid


def swap_link(path, target):
    temporary = path.with_name('.python-' + secrets.token_hex(8))
    temporary.symlink_to(target)
    temporary.replace(path)


def main():
    os.umask(0o077)
    subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(BUNDLE)], check=True)
    executable = ROOT / 'runtime/venv/bin/python'
    if not executable.is_symlink():
        raise RuntimeError('Expected the existing virtualenv interpreter symlink')
    original = os.readlink(executable)
    target = BUNDLE / 'Contents/MacOS/python3.12'
    if executable.resolve() == target:
        raise SystemExit('Packaged runtime already active; inspect before repeating')
    for _ in range(150):
        status = health()
        if not status['running'] and not status['queued']:
            break
        time.sleep(2)
    else:
        raise SystemExit('Analyses remain active; runtime unchanged')
    before = {label: supervisor_pid(label) for label in LABELS}
    with (ROOT / 'before-runtime-bundle.json').open('x') as output:
        json.dump({'interpreter_target': original, 'supervisors': before}, output)
    swap_link(executable, target)
    try:
        subprocess.run([str(executable), '-B', '-c',
                        'import numpy,netCDF4,matplotlib,astropy,contourpy'], check=True)
        for pid in before.values():
            os.kill(pid, signal.SIGTERM)
        for _ in range(120):
            try:
                after = {label: supervisor_pid(label) for label in LABELS}
                status = health()
                if (all(after[label] != before[label] for label in LABELS)
                        and status['status'] == 'ok' and status['frames'] == 1794):
                    break
            except Exception:
                pass
            time.sleep(1)
        else:
            raise RuntimeError('Fresh app services did not recover')
    except Exception:
        swap_link(executable, original)
        for label in LABELS:
            try:
                os.kill(supervisor_pid(label), signal.SIGTERM)
            except Exception:
                pass
        raise
    report = {'status': 'passed', 'bundle': str(BUNDLE), 'before': before,
              'after': after, 'frames': status['frames'], 'time': time.time()}
    (ROOT / 'runtime-bundle-activation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
