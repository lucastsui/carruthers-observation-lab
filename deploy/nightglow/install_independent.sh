#!/bin/bash
# Install nightglow's gateway and watchdog, then expose the tested app via Funnel.
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
[[ $EUID == 0 && $# == 0 ]]
ROOT=/Users/lucastsui/Applications/ObservationLab
STAGE="$ROOT/independent-staging"
DEPLOY="$ROOT/app/deploy/nightglow"
PYTHON="$ROOT/runtime/venv/bin/python"
TS=(/usr/local/libexec/observationlab/tailscale --socket=/var/run/observationlab-tailscale.sock)
BACKUP="$ROOT/before-independent"
[[ ! -e "$BACKUP" ]]
"$PYTHON" - "$STAGE/validation.json" "$ROOT/private/monitor.json" <<'PY'
import json,os,sys
report=json.load(open(sys.argv[1]))
if report.get('status')!='passed' or report.get('frames')!=1794:
 raise SystemExit('Staging validation must pass first')
path=sys.argv[2]
if os.path.islink(path) or os.stat(path).st_mode & 0o077:
 raise SystemExit('Monitoring credentials are not private')
credentials=json.load(open(path))
if not all(credentials.get(k) for k in ('BETTERSTACK_API_TOKEN','BETTERSTACK_MONITOR_ID','BETTERSTACK_HEARTBEAT_URL')):
 raise SystemExit('Monitoring credentials are incomplete')
PY
"${TS[@]}" serve status --json | "$PYTHON" -c 'import json,sys; d=json.load(sys.stdin); assert not d,"An existing Tailscale service needs review before this installer runs"'
"$PYTHON" - <<'PY'
import json,time,urllib.request
for _ in range(160):
 with urllib.request.urlopen('http://127.0.0.1:8766/health',timeout=5) as r: d=json.load(r)
 if d['running']==0 and d['queued']==0: break
 time.sleep(2)
else: raise SystemExit('Active analyses did not finish; backend left unchanged')
PY
mkdir -m 0700 "$BACKUP"
cp -p "$ROOT/app/public_server.py" "$BACKUP/public_server.py"
cp -p "$DEPLOY/run_server.py" "$BACKUP/run_server.py"
rollback() {
  echo 'Independent activation failed; restoring the existing app route.' >&2
  "${TS[@]}" funnel --bg --https=443 off || true
  launchctl bootout system/org.carruthers.gateway || true
  launchctl bootout system/org.carruthers.monitor || true
  cp -p "$BACKUP/public_server.py" "$ROOT/app/public_server.py"
  cp -p "$BACKUP/run_server.py" "$DEPLOY/run_server.py"
  launchctl kickstart -k system/org.carruthers.observation-lab || true
}
trap rollback ERR
install -o lucastsui -g staff -m 0644 "$STAGE/app/public_server.py" "$ROOT/app/public_server.py"
for file in run_server.py run_gateway.py monitor.py nginx.conf; do
  install -o lucastsui -g staff -m 0644 "$STAGE/app/deploy/nightglow/$file" "$DEPLOY/$file"
done
chown lucastsui:staff "$ROOT/private/monitor.json"
chmod 0600 "$ROOT/private/monitor.json"
for label in org.carruthers.gateway.staging org.carruthers.independent-staging; do
  if launchctl print "gui/504/$label" >/dev/null 2>&1; then launchctl bootout "gui/504/$label"; fi
done
for label in org.carruthers.gateway org.carruthers.monitor; do
  install -o root -g wheel -m 0644 "$STAGE/app/deploy/nightglow/$label.plist" "/Library/LaunchDaemons/$label.plist"
  plutil -lint "/Library/LaunchDaemons/$label.plist"
  launchctl enable "system/$label"
  launchctl bootstrap system "/Library/LaunchDaemons/$label.plist"
done
launchctl kickstart -k system/org.carruthers.observation-lab
"$PYTHON" - <<'PY'
import json,time,urllib.request
for _ in range(90):
 try:
  req=urllib.request.Request('http://127.0.0.1:8765/health',headers={'Host':'nightglow.tail2214e5.ts.net','Origin':'https://nightglow.tail2214e5.ts.net'})
  with urllib.request.urlopen(req,timeout=3) as r: d=json.load(r)
  if d['status']=='ok' and d['frames']==1794: break
 except Exception: pass
 time.sleep(1)
else: raise SystemExit('New gateway or app origin check failed')
PY
"${TS[@]}" funnel --bg --yes http://127.0.0.1:8765
"${TS[@]}" funnel status --json | "$PYTHON" -c 'import json,sys; d=json.load(sys.stdin); assert d.get("AllowFunnel",{}).get("nightglow.tail2214e5.ts.net:443"),"Funnel was not enabled"'
trap - ERR
echo 'Nightglow public gateway installed. Spark remains online until public validation passes.'
