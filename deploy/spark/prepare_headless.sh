#!/bin/bash
# Run interactively with sudo. Arm cutover before disconnecting the old VPN.
set -euo pipefail
[[ $EUID == 0 && $# == 1 ]]
ROOT=/home/anaclast/carruthers-nightglow
TARGET=$(python3 - "$1" <<'PY'
import ipaddress,sys
ip=ipaddress.IPv4Address(sys.argv[1])
if ip not in ipaddress.ip_network('100.64.0.0/10') or str(ip)=='100.104.95.9':
    raise SystemExit('Invalid new Tailscale address')
print(ip)
PY
)
test ! -e /etc/carruthers/before-headless
test ! -e /run/carruthers-headless.json
systemctl is-active --quiet carruthers-nightglow-relay.service
# New IP uses the same machine's SSH host key, obtained over authenticated SSH.
ssh-keygen -F "$TARGET" -f "$ROOT/headless-known-hosts" >/dev/null
install -o root -g root -m 0644 "$ROOT/headless-known-hosts" /etc/carruthers/nightglow-known-hosts
install -o anaclast -g anaclast -m 0600 "$ROOT/headless-known-hosts" /home/anaclast/.ssh/carruthers-nightglow-known-hosts
install -d -m 0755 /usr/local/libexec/carruthers
install -o root -g root -m 0644 "$ROOT/activate_headless.py" /usr/local/libexec/carruthers/activate_headless.py
systemd-run --unit=carruthers-headless-cutover --property=RuntimeMaxSec=720 \
  /usr/bin/python3 /usr/local/libexec/carruthers/activate_headless.py "$TARGET"
echo 'Gateway cutover armed; it waits for the verified new connection.'
