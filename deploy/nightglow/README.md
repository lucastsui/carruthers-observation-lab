# Nightglow independent deployment

The independent deployment serves `https://nightglow.tail2214e5.ts.net` through
Tailscale Funnel → nightglow nginx (`127.0.0.1:8765`) → Python backend
(`127.0.0.1:8766`). Spark and the coordinating Mac are not part of this route.
Activation completed September 18, 2026. Public validation and Spark retirement
reports passed; Spark app services are stopped and disabled. Its static monitor
service is stopped and its triggering timer is disabled. The obsolete restricted
Spark relay SSH key has been revoked; other SSH access remains unchanged.

## Runtime and storage

Application root: `/Users/lucastsui/Applications/ObservationLab`.
Python is isolated in `runtime/venv`; nginx 1.30.5 is in `runtime/nginx`.
The nginx release archive's official detached signature was verified before use.
The system Tailscale binaries are under `/usr/local/libexec/observationlab` and
use `/var/db/observationlab-tailscale`, with socket
`/var/run/observationlab-tailscale.sock`.

The external APFS volume `/Volumes/Observation Data` has UUID
`279D3C74-134E-4772-A3C3-EE64D76B70F7` and a 1 TB quota. Observations are in
`carruthers/L1C`; state and rotating logs in `carruthers/state`; cache and temporary
files in `carruthers/cache`. The internal SSD holds the app, runtime and private
monitoring credentials. Existing Time Machine storage and original data copies
are retained. Saved analyses remain browser IndexedDB data, scoped to the public
URL; changing the URL does not transfer them.

The supervisors verify the volume UUID and dataset marker before writes and
periodically while running. They use a working directory pinned to the mounted
volume, reject symlinked/cross-filesystem storage paths, and stop their child
process groups if the volume disappears. They never create a replacement mount
point on the internal SSD. Python workers inherit the external temporary path.
The catalogue contains 1,794 frames from 62 SHA-256-verified NetCDF files.

## Login-independent disk access

Logout testing on September 18 exposed a macOS privacy requirement: the dedicated
Python executable needs Full Disk Access to open the external drive after a fresh
system-service start while nobody is logged in. A process that was already
running may retain access, so a warm logout check alone is insufficient.

On nightglow, enable System Settings → Privacy & Security → Full Disk Access for:
`/Users/lucastsui/Applications/ObservationLab/Observation Lab Runtime.app`.
The settings picker rejected the standalone executable, so `package_runtime.py`
packages the same CPython executable and standard library in a named, ad-hoc
signed app bundle. The virtualenv interpreter link points to its executable;
installed scientific dependencies and launchd service paths remain unchanged.
This permission must be granted through macOS's supported privacy interface; do
not edit the TCC database or disable system protections. Recheck this permission
when replacing the runtime binary or changing its path.

The app and gateway verify UUID, APFS identity and writability at startup, allowing
up to 30 seconds for Disk Arbitration to respond. Once running, they check the
pinned filesystem device, actual mount point and dataset marker every 10 seconds
without repeated diskutil calls. This avoids logout-time disk-service pauses
stopping a healthy application, while still stopping on storage loss or changed
identity. Missing/inaccessible/corrupt markers remain fatal.

Logout-independent operation was verified September 18, 2026 after Full Disk
Access was enabled for the packaged runtime. With the console still at the login
screen, both app supervisors restarted with new PIDs and loaded all 1,794 frames.
Public checks through the global Funnel relay passed for both cameras' previews,
contours, newly spawned analyses, CSV/JSON exports, visitor privacy, reference
charts, origin rejection and upload limits. The watchdog reported no problems.
Reports at the application root are `logout-fresh-start.json`,
`logged-out-public-validation.json` and `logout-final-health.json`. A reboot is a
separate check and remains untested.

## System services

- `org.carruthers.tailscaled`: root-owned Tailscale daemon, persistent Funnel.
- `org.carruthers.observation-lab`: backend supervisor as `lucastsui` (UID 504).
- `org.carruthers.gateway`: nginx supervisor as `lucastsui`.
- `org.carruthers.monitor`: once-per-minute watchdog as `lucastsui`.

These are system LaunchDaemons and do not depend on a GUI login. Actual operation
through a reboot has not been tested. FileVault is off; existing AC power settings
disable system and disk sleep. Keep nightglow, its external drive and internet
connection available. Tailscale device-key renewal remains normal administration (current expiry:
March 17, 2027).
Do not reconnect the old desktop Tailscale client while the system daemon runs.

The gateway preserves a 1 MiB request limit, request/connection limits, and
loopback-only backend binding. The app permits only configured public origins,
requires POST Origin to match Host, and retains visitor-scoped jobs and downloads.
Numerical library threads and worker concurrency remain bounded. Analyses have a
300-second deadline on nightglow. Backend and gateway logs rotate at 10 MiB with
five backups. Startup errors go to macOS syslog; launchd output goes to /dev/null.

Monitoring starts only after `independent-active` exists. Credentials are private
mode 0600 in `private/monitor.json`; values must never appear in diagnostics.
The watchdog checks the dataset volume, free space, application, system jobs and
Funnel configuration. It reports to the existing Better Stack monitor/heartbeat
and can restart only verified user-owned app supervisors. Its report is
`/Volumes/Observation Data/carruthers/state/monitor/health.json`.

## One-time activation

`deploy/Make Nightglow Independent.command` prepares Spark's existing monitoring
credentials for encrypted transfer, arms a conditional stand-down, then invokes
`install_independent.sh` on nightglow. Administrator authentication occurs in
Terminal for each machine. Passwords are not collected by the application.

The installer requires a successful staged validation, backs up the two replaced
backend files under `before-independent`, drains existing analyses, replaces the
staging jobs with system jobs, checks the loopback gateway and enables Funnel.
On installation error it restores the existing backend route. It does not stop
Spark. Do not blindly rerun a one-time installer after an error; inspect its
reports and backup first.

The coordinator then uses public DNS and forces curl through a global public
address to prove public access independently of its tailnet membership. It tests
both cameras, previews, contours, analyses, CSV/JSON, reference charts, visitor
privacy and gateway limits. Only a passed report allows Spark's app services to
be stopped and disabled. Then the coordinator publishes the stable origin and
enables nightglow's monitor. Original datasets and old configuration backups are
retained, but the old temporary Cloudflare URL stops serving after retirement.

`validate_public.py` repeats public functional validation. Staging source/report
are under `independent-staging`; coordinator reports are under
`.local/nightglow-independent`. Test code never invokes the installers.

Funnel public DNS took approximately six minutes to appear during activation.
Tailscale Funnel imposes bandwidth limits; these do not change the app features.
See https://tailscale.com/docs/features/tailscale-funnel for service limits.
