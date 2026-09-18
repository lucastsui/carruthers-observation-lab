#!/usr/bin/env python3
"""Restricted command for the Spark's dedicated forwarding key on nightglow."""
import json
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path('/Users/lucastsui/Applications/ObservationLab')
command = os.environ.get('SSH_ORIGINAL_COMMAND', '')
if command == 'sync-origin':
    value = sys.stdin.buffer.read(257).decode('ascii').strip()
    if not re.fullmatch(r'https://[a-z0-9-]+\.trycloudflare\.com', value):
        raise SystemExit('Invalid origin')
    target = ROOT / 'public-url'
    if not target.exists() or target.read_text().strip() != value:
        temporary = target.with_suffix('.tmp')
        temporary.write_text(value + '\n')
        temporary.replace(target)
elif command == 'storage-status':
    sys.path.insert(0, str(ROOT / 'app/deploy/nightglow'))
    import subprocess
    import plistlib
    volume = Path('/Volumes/Observation Data')
    info = plistlib.loads(subprocess.check_output(['/usr/sbin/diskutil', 'info', '-plist', str(volume)]))
    if info.get('VolumeUUID') != '279D3C74-134E-4772-A3C3-EE64D76B70F7' or not os.path.ismount(volume):
        raise SystemExit('Observation volume unavailable')
    usage = shutil.disk_usage(volume)
    print(json.dumps(dict(total=usage.total, used=usage.used, free=usage.free)))
else:
    raise SystemExit('Only origin synchronization and storage status are permitted')
