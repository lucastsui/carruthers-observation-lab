#!/bin/bash
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'Run with sudo on the Spark.' >&2; exit 1; }
BACKUP=/etc/carruthers/before-nightglow
test -f "$BACKUP/nginx.conf"
test -f "$BACKUP/monitor.py"
systemctl start carruthers.service
curl --fail --silent http://127.0.0.1:8766/health >/dev/null
cp -p "$BACKUP/nginx.conf" /etc/carruthers/nginx.conf
cp -p "$BACKUP/monitor.py" /opt/carruthers/app/deploy/monitor.py
rm -f /etc/systemd/system/carruthers-monitor.service.d/nightglow.conf
systemctl daemon-reload
systemctl reload carruthers-gateway.service
systemctl disable --now carruthers-nightglow-relay.service
systemctl start carruthers-monitor.service
echo 'Original Spark backend restored; no observation files deleted.'
