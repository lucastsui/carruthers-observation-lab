#!/bin/bash
# Root exports only this app's monitoring configuration and arms its retirement.
set -euo pipefail
[[ $EUID == 0 && $# == 0 ]]
ROOT=/home/anaclast/carruthers-nightglow
[[ ! -e /run/carruthers-independent.json ]]
python3 - <<'PY'
import json,os,pwd,shlex,uuid
from pathlib import Path
root=Path('/home/anaclast/carruthers-nightglow')
allowed={'BETTERSTACK_API_TOKEN','BETTERSTACK_MONITOR_ID','BETTERSTACK_HEARTBEAT_URL'}
values={}
for line in Path('/etc/carruthers/monitor.env').read_text().splitlines():
 if not line.strip() or line.lstrip().startswith('#'): continue
 key,sep,value=line.partition('=')
 if sep and key.strip() in allowed:
  parts=shlex.split(value,comments=False)
  if len(parts)!=1: raise SystemExit('Unsupported monitoring environment value')
  values[key.strip()]=parts[0]
if set(values)!=allowed or not all(values.values()):
 raise SystemExit('Expected existing Better Stack monitoring configuration')
account=pwd.getpwnam('anaclast')
for name,content in [('monitor-transfer.json',json.dumps(values)),('independent-token',str(uuid.uuid4()))]:
 path=root/name
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'w') as output: output.write(content+'\n')
 os.chown(path,account.pw_uid,account.pw_gid)
print('Monitoring credentials prepared for encrypted transfer; no values printed.')
PY
install -d -m 0755 /usr/local/libexec/carruthers
install -o root -g root -m 0644 "$ROOT/stand_down.py" /usr/local/libexec/carruthers/stand_down.py
TOKEN=$(cat "$ROOT/independent-token")
systemd-run --unit=carruthers-independent-handoff --property=RuntimeMaxSec=1900 \
  /usr/bin/python3 /usr/local/libexec/carruthers/stand_down.py "$TOKEN"
echo 'Spark stays online until the new public site passes validation.'
