#!/bin/bash
# Administrator passwords are entered into SSH/sudo, never stored.
set -euo pipefail
LAN=128.197.64.27
NIGHT=/Users/lucastsui/Applications/ObservationLab
SSH_LAN=(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o HostKeyAlias=nightglow "lucastsui@$LAN")
NEW_IP=$("${SSH_LAN[@]}" "$NIGHT/runtime/tailscale-build/bin/tailscale --socket=$NIGHT/runtime/tailscale-staging/tailscaled.sock ip -4")
[[ "$NEW_IP" =~ ^100\.[0-9]+\.[0-9]+\.[0-9]+$ ]]
echo 'Prepare the Spark to switch automatically when the new connection is healthy:'
ssh -t -o BatchMode=yes anaclast@100.73.106.98 \
  "sudo /bin/bash /home/anaclast/carruthers-nightglow/prepare_headless.sh '$NEW_IP'"
echo 'Install the nightglow system Tailscale service using its independent LAN route:'
ssh -t -o BatchMode=yes -o StrictHostKeyChecking=yes -o HostKeyAlias=nightglow "lucastsui@$LAN" \
  "sudo /bin/bash $NIGHT/app/deploy/nightglow/install_network.sh '$NEW_IP'"
echo 'Waiting for the verified Spark relay cutover...'
for attempt in {1..90}; do
  if ssh -o BatchMode=yes anaclast@100.73.106.98 \
    "python3 -c 'import json; d=json.load(open(\"/run/carruthers-headless.json\")); assert d[\"status\"]==\"passed\" and d[\"target\"]==\"$NEW_IP\"'" 2>/dev/null; then
    "${SSH_LAN[@]}" "cp $NIGHT/runtime/tailscale-staging/cutover-token $NIGHT/runtime/tailscale-staging/cutover-confirmed"
    curl --fail --silent --show-error https://laboratories-correct-jpeg-crowd.trycloudflare.com/health
    printf '\n%s\n' 'Network cutover verified; automatic rollback cancelled. System Tailscale is ready for boot without GUI login.'
    exit 0
  fi
  sleep 2
done
echo 'Cutover was not confirmed. Nightglow will restore its desktop VPN automatically after seven minutes.' >&2
exit 1
