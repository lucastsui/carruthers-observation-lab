#!/bin/bash
# Run interactively on the coordinating Mac after validation is complete.
# Passwords go directly to sudo in SSH; they are not recorded in this script.
set -euo pipefail
printf '%s\n' 'This activates the tested data migration and app services. The existing desktop Tailscale client remains; networking before login still needs a separate system-daemon setup.'
printf '%s\n' 'Install the nightglow background service (nightglow administrator password):'
ssh -t -o BatchMode=yes lucastsui@nightglow \
  'sudo /bin/bash /Users/lucastsui/Applications/ObservationLab/app/deploy/nightglow/install.sh'
printf '%s\n' 'Activate the Spark gateway relay (Spark administrator password):'
ssh -t -o BatchMode=yes anaclast@100.73.106.98 \
  'sudo /bin/bash /home/anaclast/carruthers-nightglow/install.sh'
printf '%s\n' 'Checking public site:'
curl --fail --silent --show-error https://laboratories-correct-jpeg-crowd.trycloudflare.com/health
printf '\n%s\n' 'Activation finished. Original observation copies and Time Machine backups are retained.'
