#!/bin/bash
# Root-owned, delayed recovery if the coordinator cannot verify the Spark relay.
set -euo pipefail
ROOT=/Users/lucastsui/Applications/ObservationLab
CONFIRM="$ROOT/runtime/tailscale-staging/cutover-confirmed"
TOKEN="$1"
sleep 420
if [[ -f "$CONFIRM" && $(cat "$CONFIRM") == "$TOKEN" ]]; then exit 0; fi
/bin/launchctl bootout system/org.carruthers.tailscaled || true
APP=/Applications/Tailscale.app/Contents/MacOS/Tailscale
/bin/launchctl asuser 504 /usr/bin/sudo -u lucastsui "$APP" set --hostname=nightglow
# No flags preserves every desktop-client preference already on this profile.
/bin/launchctl asuser 504 /usr/bin/sudo -u lucastsui "$APP" up
echo 'Restored desktop Tailscale because gateway verification was not confirmed.'
