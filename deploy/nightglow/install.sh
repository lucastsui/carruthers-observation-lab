#!/bin/bash
# Run explicitly as administrator. This script never invokes sudo.
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
ROOT=/Users/lucastsui/Applications/ObservationLab
DEPLOY="$ROOT/app/deploy/nightglow"
LABEL=org.carruthers.observation-lab
DEST="/Library/LaunchDaemons/$LABEL.plist"
TEMP_LABEL=org.carruthers.observation-lab
[[ $# == 0 ]] || { echo 'Usage: install.sh (service labels are fixed)' >&2; exit 2; }
[[ $EUID == 0 ]] || { echo 'Run this installer as administrator.' >&2; exit 1; }
[[ $(/usr/bin/id -u lucastsui) == 504 ]] || { echo 'Unexpected lucastsui UID' >&2; exit 1; }
[[ -x "$ROOT/runtime/venv/bin/python" && -f "$ROOT/app/public_server.py" && -f "$DEPLOY/run_server.py" ]]
/usr/bin/python3 -B - "$DEPLOY" <<'PY'
import json,os,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import run_server as supervisor
device=supervisor.volume_info()
os.chdir(supervisor.VOLUME)
supervisor.verify_marker(device)
PY
# Enforce normal per-account permissions on this new data volume only.
/usr/sbin/diskutil enableOwnership '/Volumes/Observation Data'
/usr/sbin/chown lucastsui:staff '/Volumes/Observation Data/carruthers' '/Volumes/Observation Data/carruthers/state' '/Volumes/Observation Data/carruthers/cache'
/bin/chmod 0700 '/Volumes/Observation Data/carruthers/state' '/Volumes/Observation Data/carruthers/cache'
/usr/bin/plutil -lint "$DEPLOY/$LABEL.plist"
# Do all file/preflight work before stopping a service. Preserve an existing URL.
if [[ ! -e "$ROOT/public-url" && ! -L "$ROOT/public-url" ]]; then
    (umask 022; set -o noclobber; printf '%s\n' 'https://laboratories-correct-jpeg-crowd.trycloudflare.com' > "$ROOT/public-url")
    /usr/sbin/chown lucastsui:staff "$ROOT/public-url"
fi
[[ -f "$ROOT/public-url" && ! -L "$ROOT/public-url" ]]
# The root-owned plist launches a user-owned wrapper exclusively as lucastsui.
STAGED=$(/usr/bin/mktemp /Library/LaunchDaemons/.observationlab.XXXXXX)
trap '/bin/rm -f "$STAGED"' EXIT
/usr/bin/install -o root -g wheel -m 0644 "$DEPLOY/$LABEL.plist" "$STAGED"
for domain in user/504 gui/504; do
    if /bin/launchctl print "$domain/$TEMP_LABEL" >/dev/null 2>&1; then
        /bin/launchctl disable "$domain/$TEMP_LABEL"
        /bin/launchctl bootout "$domain/$TEMP_LABEL"
    fi
done
if /bin/launchctl print "system/$LABEL" >/dev/null 2>&1; then
    /bin/launchctl bootout "system/$LABEL"
fi
/bin/mv -f "$STAGED" "$DEST"
/bin/launchctl enable "system/$LABEL"
/bin/launchctl bootstrap system "$DEST"
/usr/bin/python3 - <<'PY'
import json,time,urllib.request
for attempt in range(60):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8766/health',timeout=3) as response:
            result=json.load(response)
        if result['status']=='ok' and result['frames']==1794: break
    except Exception: pass
    time.sleep(2)
else: raise SystemExit('System service installed, but health check failed. Do not switch the Spark gateway.')
PY
/bin/launchctl print "system/$LABEL"
echo 'Installed and healthy. System launchd will start the backend before GUI login.'
