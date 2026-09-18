#!/bin/bash
# Run with sudo on the Spark after the nightglow system daemon is installed.
# Keeps the existing Cloudflare tunnel, URL, and original backend for rollback.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run with sudo on the Spark.' >&2; exit 1; }
ROOT=/home/anaclast/carruthers-nightglow
BACKUP=/etc/carruthers/before-nightglow
UNIT=carruthers-nightglow-relay.service
MONITOR=/opt/carruthers/app/deploy/monitor.py
DROPIN=/etc/systemd/system/carruthers-monitor.service.d/nightglow.conf
USER_UID=$(id -u anaclast)
for file in relay.py "$UNIT" monitor.py; do test -f "$ROOT/$file"; done
test -s "$ROOT/validation.json"
# The coordinator must have tested the private relay with the complete dataset.
python3 - "$ROOT/validation.json" <<'PY'
import json,sys
v=json.load(open(sys.argv[1]))
assert v['status']=='passed' and v['frames']==1794 and v['files']==62
PY
test ! -e "$BACKUP" || { echo 'A migration backup already exists; inspect it before reinstalling.' >&2; exit 1; }
test ! -e "$DROPIN"
grep -q 'proxy_pass http://127.0.0.1:8766;' /etc/carruthers/nginx.conf

install -d -m 0700 "$BACKUP"
cp -p /etc/carruthers/nginx.conf "$BACKUP/nginx.conf"
cp -p "$MONITOR" "$BACKUP/monitor.py"
rollback_on_failure() {
    echo 'Activation failed; restoring the Spark backend.' >&2
    cp -p "$BACKUP/nginx.conf" /etc/carruthers/nginx.conf
    cp -p "$BACKUP/monitor.py" "$MONITOR"
    rm -f "$DROPIN"
    systemctl daemon-reload
    systemctl reload carruthers-gateway.service || true
    systemctl disable --now "$UNIT" || true
}
trap rollback_on_failure ERR

# Release the staging relay's loopback port before starting the system service.
runuser -u anaclast -- env XDG_RUNTIME_DIR="/run/user/$USER_UID" \
    systemctl --user disable --now "$UNIT" || true
install -o root -g root -m 0644 "$ROOT/$UNIT" "/etc/systemd/system/$UNIT"
systemd-analyze verify "/etc/systemd/system/$UNIT"
systemctl daemon-reload
systemctl enable --now "$UNIT"
python3 - <<'PY'
import json,time,urllib.request
for i in range(45):
    try:
        with urllib.request.urlopen('http://127.0.0.1:18766/health',timeout=3) as r:
            d=json.load(r)
        if d['status']=='ok' and d['frames']==1794: break
    except Exception: pass
    time.sleep(2)
else: raise SystemExit('Nightglow did not become healthy; gateway was not switched')
PY

python3 - <<'PY'
from pathlib import Path
p=Path('/etc/carruthers/nginx.conf')
s=p.read_text()
assert s.count('proxy_pass http://127.0.0.1:8766;')==1
p.write_text(s.replace('proxy_pass http://127.0.0.1:8766;', 'proxy_pass http://127.0.0.1:18766;'))
PY
systemctl reload carruthers-gateway.service
python3 - <<'PY'
import json,time,urllib.request
for i in range(15):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8765/health',timeout=3) as r: d=json.load(r)
        if d['status']=='ok' and d['frames']==1794: break
    except Exception: pass
    time.sleep(1)
else: raise SystemExit('Gateway validation failed')
PY
install -o root -g root -m 0644 "$ROOT/monitor.py" "$MONITOR"
# The watchdog has ProtectHome=yes. Give it root-only copies of this restricted
# forwarding key instead of weakening its home-directory sandbox.
install -o root -g root -m 0600 /home/anaclast/.ssh/carruthers-nightglow /etc/carruthers/nightglow-monitor-key
install -o root -g root -m 0644 /home/anaclast/.ssh/carruthers-nightglow-known-hosts /etc/carruthers/nightglow-known-hosts
install -d -m 0755 "$(dirname "$DROPIN")"
printf '[Service]\nEnvironment=CARRUTHERS_REMOTE_BACKEND=nightglow\n' > "$DROPIN"
systemctl daemon-reload
systemctl start carruthers-monitor.service
trap - ERR
echo 'Gateway now routes to nightglow. Cloudflare URL and original Spark backend preserved.'
cat /run/carruthers-tunnel/public-url
