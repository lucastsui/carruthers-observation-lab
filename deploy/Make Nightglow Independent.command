#!/bin/bash
# Two interactive sudo authentications; credentials are never printed or saved here.
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=/Users/lucastsui/Applications/ObservationLab
SPARK=/home/anaclast/carruthers-nightglow
RESULT="$(dirname "$SCRIPT_DIR")/.local/nightglow-independent/production.json"
echo 'Prepare the Spark monitoring handoff (Spark administrator password):'
ssh -t -o BatchMode=yes anaclast@100.73.106.98 \
  "sudo /bin/bash $SPARK/prepare_independent.sh"
ssh -o BatchMode=yes lucastsui@nightglow "umask 077; mkdir -p $ROOT/private; chmod 0700 $ROOT/private"
scp -3 -B -p "anaclast@100.73.106.98:$SPARK/monitor-transfer.json" \
  "lucastsui@nightglow:$ROOT/private/monitor.json"
ssh -o BatchMode=yes anaclast@100.73.106.98 "rm -f $SPARK/monitor-transfer.json"
echo 'Install the independent gateway (lucastsui login password on nightglow):'
ssh -t -o BatchMode=yes lucastsui@nightglow \
  "sudo /bin/bash $ROOT/independent-staging/app/deploy/nightglow/install_independent.sh"
echo 'Checking the public internet route, analyses, exports, privacy and request limits...'
python3 "$SCRIPT_DIR/nightglow/validate_public.py" "$RESULT"
TOKEN=$(ssh -o BatchMode=yes anaclast@100.73.106.98 "cat $SPARK/independent-token")
[[ "$TOKEN" =~ ^[0-9a-f-]{36}$ ]]
printf '{"status":"passed","url":"https://nightglow.tail2214e5.ts.net","token":"%s"}\n' "$TOKEN" | \
  ssh -o BatchMode=yes anaclast@100.73.106.98 "umask 077; cat > $SPARK/independent-ready.json"
echo 'Waiting for Spark app services to stop...'
for attempt in {1..60}; do
  if ssh -o BatchMode=yes anaclast@100.73.106.98 \
    "python3 -c 'import json; d=json.load(open(\"/run/carruthers-independent.json\")); assert d[\"status\"]==\"stopped\" and d[\"token\"]==\"$TOKEN\"'" 2>/dev/null; then
    ssh -o BatchMode=yes lucastsui@nightglow /bin/bash <<'REMOTE'
set -euo pipefail
ROOT=/Users/lucastsui/Applications/ObservationLab
umask 077
printf '%s\n' 'https://nightglow.tail2214e5.ts.net' > "$ROOT/public-url.independent"
mv "$ROOT/public-url.independent" "$ROOT/public-url"
touch "$ROOT/independent-active"
cd "$ROOT/app/deploy/nightglow"
"$ROOT/runtime/venv/bin/python" -B monitor.py
REMOTE
    echo 'Nightglow is independent. Public site: https://nightglow.tail2214e5.ts.net'
    echo 'Spark app services are disabled; original data copies are retained.'
    exit 0
  fi
  sleep 2
done
echo 'Spark retirement was not confirmed; leave the machines online for inspection.' >&2
exit 1
