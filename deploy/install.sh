#!/usr/bin/env bash
# Run as root after placing built code in /opt/carruthers/app and data in /srv/carruthers/L1C.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
cd /opt/carruthers/app
[[ -f dist/client/index.html && -d /srv/carruthers/L1C/2603 ]] || { echo 'Built interface or dataset missing.' >&2; exit 1; }
apt-get update -qq
apt-get install -y nginx python3-venv nftables
id carruthers >/dev/null 2>&1 || useradd --system --home /var/lib/carruthers --shell /usr/sbin/nologin carruthers
id carruthers-tunnel >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin carruthers-tunnel
python3 -m venv /opt/carruthers/venv
/opt/carruthers/venv/bin/pip install -r requirements-local.txt
if [[ ! -x /usr/local/bin/cloudflared ]]; then
    curl --fail --location --output /var/tmp/carruthers-cloudflared https://github.com/cloudflare/cloudflared/releases/download/2026.9.0/cloudflared-linux-arm64
    echo '98aca3173f73248fad6180fc75dade2d186a6e54fa807e088108cb4345de8efe  /var/tmp/carruthers-cloudflared' | sha256sum --check
    install -m 0755 /var/tmp/carruthers-cloudflared /usr/local/bin/cloudflared
fi
install -d -m 0755 /etc/carruthers
install -m 0644 deploy/nginx.conf deploy/nginx-main.conf /etc/carruthers/
install -m 0644 deploy/carruthers-firewall.nft /etc/carruthers/firewall.nft
install -m 0644 deploy/journald-carruthers.conf /etc/systemd/journald@carruthers.conf
install -m 0644 deploy/carruthers*.service deploy/carruthers-monitor.timer /etc/systemd/system/
chown -R root:root /opt/carruthers/app /srv/carruthers/L1C
chmod -R a+rX,go-w /opt/carruthers/app /srv/carruthers/L1C
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/carruthers*.service /etc/systemd/system/carruthers-monitor.timer
systemctl enable carruthers.service carruthers-gateway.service carruthers-tunnel.service carruthers-monitor.timer
systemctl restart carruthers.service carruthers-gateway.service carruthers-tunnel.service
systemctl start carruthers-monitor.timer
echo 'App and tunnel started. Test a NEW Tailscale SSH connection before enabling carruthers-firewall.service.'
