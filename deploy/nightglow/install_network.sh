#!/bin/bash
# Run over the independently verified LAN SSH route, with sudo.
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
[[ $EUID == 0 && $# == 1 ]]
ROOT=/Users/lucastsui/Applications/ObservationLab
BUILD="$ROOT/runtime/tailscale-build"
STAGE="$ROOT/runtime/tailscale-staging"
STATE=/var/db/observationlab-tailscale
BIN=/usr/local/libexec/observationlab
LABEL=org.carruthers.tailscaled
PLIST="/Library/LaunchDaemons/$LABEL.plist"
APP=/Applications/Tailscale.app/Contents/MacOS/Tailscale
TS="$BUILD/bin/tailscale"
[[ ! -e "$STATE" && ! -e "$PLIST" ]]
/usr/bin/shasum -a 256 -c "$BUILD/binaries.sha256"
"$TS" --socket="$STAGE/tailscaled.sock" status --json | "$ROOT/runtime/venv/bin/python" -c '
import ipaddress,json,sys
d=json.load(sys.stdin); expected=sys.argv[1]
if d.get("BackendState")!="Running" or expected not in d.get("TailscaleIPs",[]):
 raise SystemExit("The staged connection must be authenticated first")
if ipaddress.ip_address(expected) not in ipaddress.ip_network("100.64.0.0/10"):
 raise SystemExit("Expected a Tailscale address")
' "$1"
PID=$(cat "$STAGE/daemon.pid")
[[ "$PID" =~ ^[0-9]+$ ]]
/bin/ps -p "$PID" -o command= | /usr/bin/grep -F -- "$BUILD/bin/tailscaled --tun=userspace-networking --statedir=$STAGE" >/dev/null
/bin/kill -TERM "$PID"
for i in {1..30}; do /bin/kill -0 "$PID" 2>/dev/null || break; sleep 1; done
if /bin/kill -0 "$PID" 2>/dev/null; then echo 'Staging daemon did not stop' >&2; exit 1; fi
/usr/bin/install -d -o root -g wheel -m 0700 "$STATE"
/usr/bin/install -o root -g wheel -m 0600 "$STAGE/tailscaled.state" "$STATE/tailscaled.state"
/usr/bin/install -d -o root -g wheel -m 0755 "$BIN"
for file in tailscale tailscaled; do /usr/bin/install -o root -g wheel -m 0755 "$BUILD/bin/$file" "$BIN/$file"; done
/usr/bin/install -o root -g wheel -m 0755 "$ROOT/app/deploy/nightglow/rollback_network.sh" "$BIN/rollback_network.sh"
TOKEN=$(/usr/bin/uuidgen)
printf '%s\n' "$TOKEN" > "$STAGE/cutover-token"
/usr/sbin/chown lucastsui:staff "$STAGE/cutover-token"
/bin/rm -f "$STAGE/cutover-confirmed"
/usr/bin/python3 - "$PLIST" "$STATE/rollback.plist" "$TOKEN" <<'PY'
import plistlib,sys
def write(path,label,args):
 with open(path,'wb') as f:
  plistlib.dump(dict(Label=label,ProgramArguments=args,RunAtLoad=True,
    StandardOutPath='/dev/null',StandardErrorPath='/dev/null',
    **({'KeepAlive':True,'ThrottleInterval':10} if label=='org.carruthers.tailscaled' else {})),f)
write(sys.argv[1],'org.carruthers.tailscaled',[
 '/usr/local/libexec/observationlab/tailscaled',
 '--statedir=/var/db/observationlab-tailscale',
 '--socket=/var/run/observationlab-tailscale.sock','--tun=utun'])
write(sys.argv[2],'org.carruthers.network-rollback',[
 '/bin/bash','/usr/local/libexec/observationlab/rollback_network.sh',sys.argv[3]])
PY
/bin/chmod 0644 "$PLIST" "$STATE/rollback.plist"
/bin/launchctl bootstrap system "$STATE/rollback.plist"
# Keep the desktop account available for automatic rollback, with a distinct name.
/bin/launchctl asuser 504 /usr/bin/sudo -u lucastsui "$APP" set --hostname=nightglow-desktop
/bin/launchctl asuser 504 /usr/bin/sudo -u lucastsui "$APP" down
/bin/launchctl enable "system/$LABEL"
/bin/launchctl bootstrap system "$PLIST"
for i in {1..30}; do [[ -S /var/run/observationlab-tailscale.sock ]] && break; sleep 1; done
"$BIN/tailscale" --socket=/var/run/observationlab-tailscale.sock set --hostname=nightglow --shields-up=false
"$BIN/tailscale" --socket=/var/run/observationlab-tailscale.sock up --timeout=60s --accept-dns=false --hostname=nightglow
"$BIN/tailscale" --socket=/var/run/observationlab-tailscale.sock ip -4
echo 'System Tailscale started. Automatic rollback remains armed until the Spark relay is verified.'
