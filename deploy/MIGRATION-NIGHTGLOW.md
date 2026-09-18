# Nightglow independent hosting — September 18, 2026

The user selected `https://nightglow.tail2214e5.ts.net` as the new public address.
Independent hosting is live. Administrator activation, public DNS/TLS, full
functional checks and Spark retirement all succeeded. Nightglow monitoring
reports no problems and the external monitor now watches the stable URL.

The live route is Tailscale Funnel → nightglow nginx → nightglow backend
→ the external 1 TB Observation Data volume. Neither Spark nor the coordinating
Mac is required for the running website. Nightglow also owns the existing
Better Stack monitoring integration. Both computers' original data copies are
retained. Browser-saved analyses at the old Cloudflare URL do not automatically
appear at the new URL.

Staging validation passed for all 1,794 frames / 62 files, both cameras' previews,
contours, analyses, CSV/JSON exports, visitor isolation, reference charts, origin
checks and upload limits. Eight API/queue/origin tests passed. Monitor tests
covered activation gating, healthy state, missing-drive alerts and external URL
synchronization; retirement tests covered ordering and refusal on bad health.
The new gateway uses nginx 1.30.5, verified against its official release signature.

Spark’s backend, nginx, relay and temporary tunnel are disabled and stopped.
Its monitoring timer is disabled and the static monitor service is stopped.
The tunnel has a failed exit status following its stop, but has no running
process and is disabled. The obsolete restricted Spark SSH relay key was removed
from nightglow; a private authorized-keys backup preserves rollback options.
All unrelated SSH keys remain. Public checks used the global Funnel relay
199.38.181.54, bypassing private Tailscale resolution. A browser WFI analysis of
22 frames also completed with both reference charts and contour circularity.
Reports are retained under `.local/nightglow-independent` on this Mac and
`independent-public-validation.json` under the nightglow application root.

See [nightglow/README.md](nightglow/README.md) for the final architecture,
installation sequence and operating paths. Do not rerun older activation scripts
against an existing migration. An actual reboot remains untested.

## Verified operation while logged out

Logout testing exposed two problems: repeated Disk Arbitration requests could
time out during logout, and macOS denied fresh background Python processes
access to the external drive. Running storage checks now use the pinned device,
mount point and verified dataset marker; full UUID/APFS checks remain at startup
with a 30-second timeout. Three storage-guard regression tests passed.

The existing CPython executable and standard library are packaged in
`/Users/lucastsui/Applications/ObservationLab/Observation Lab Runtime.app`.
The user enabled Full Disk Access for this signed bundle through System Settings.
The existing virtualenv now points to that executable; scientific dependencies
and system-service paths are unchanged. The original runtime remains available
for rollback. Eight API/queue/origin tests passed with the packaged interpreter.

On September 18, 2026, the website survived logout. While Nightglow remained at
the login screen, both app services then started fresh with new process IDs and
loaded all 1,794 frames. Public tests through the global Funnel relay passed for
WFI and NFI analyses, previews, contours, CSV/JSON exports, reference data,
visitor privacy, origin restrictions and upload limits. The console was still
logged out afterward, all three persistent services were running, and monitoring
reported no problems. Nightglow, its external drive and internet connection must
remain available; a desktop login is unnecessary. A reboot is still untested.

Evidence is stored under `.local/nightglow-independent` on this Mac and the
application root on Nightglow: `runtime-bundle-activation.json`,
`logout-fresh-start.json`, `logged-out-public-validation.json`, and
`logout-final-health.json`.

The following records the completed earlier data/network migration; its Spark
and old-URL descriptions apply to that earlier phase.

---

# Nightglow migration — September 18, 2026

The data migration is live. The public site routes through the Spark gateway to
nightglow's system LaunchDaemon, reading observations from the external volume.
Administrator activation and system Tailscale cutover completed September 18,
2026. Public analysis and export checks pass through the new connection.

## Storage

- External APFS volume: `/Volumes/Observation Data`, UUID
  `279D3C74-134E-4772-A3C3-EE64D76B70F7`.
- Quota: 1,000,000,000,000 bytes (1 TB, displayed as about 931 GiB).
  This caps usage; capacity is shared with the existing APFS container, without
  reserving 1 TB in advance.
- Original `Nightglow Backup` volume and Time Machine snapshots are preserved.
- Observations: `/Volumes/Observation Data/carruthers/L1C`.
- Server state and rotating logs: `carruthers/state` on that volume.
- Reference cache, Matplotlib cache and temporary files: `carruthers/cache`.
- Application and isolated Python 3.12 environment:
  `/Users/lucastsui/Applications/ObservationLab` on the internal SSD.

Saved analyses retain their existing browser IndexedDB behavior and privacy.
They are not automatically uploaded to the server. Keeping the current public
origin preserves access to those saves. CSV/JSON downloads work as before.
Original observation copies on this Mac and the Spark are retained.

## Public access

The existing Cloudflare URL is preserved:
`https://laboratories-correct-jpeg-crowd.trycloudflare.com`.

Requests follow Cloudflare → Spark nginx → loopback SSH relay over Tailscale →
nightglow Python backend → external observations. Nightglow performs the science
calculations. The Spark remains the public gateway, so both computers and the
external drive must be available. No source-data HTTP download route is added.

The Spark relay listens only at `127.0.0.1:18766`; nightglow listens only at
`127.0.0.1:8766`. Its dedicated SSH key is limited to the Spark Tailscale address,
forwarding to the backend, and fixed origin/storage-status commands. The verified
nightglow SSH host key is pinned. If the Cloudflare Quick Tunnel changes its URL,
the relay updates nightglow's allowed origin. As before, a new public origin does
not inherit browser IndexedDB saves.

## Final activation

The initial activation used `deploy/Activate Nightglow.command` interactively on
this Mac. Both administrator authentications and installers completed. Do not
rerun the Spark installer against an existing migration backup.

1. Nightglow's installer checks the dataset verification report, enables normal
   file ownership on the new volume, replaces only our staging user service with
   a system LaunchDaemon, and waits for a healthy backend. The daemon runs as
   `lucastsui`, with label `org.carruthers.observation-lab`.
2. The Spark installer requires the successful integration-test report, starts
   the system relay, backs up its gateway/monitor configuration, switches nginx,
   and updates the existing watchdog to check nightglow storage and the relay.
   It keeps the original backend running for rollback. Failure restores the old
   gateway configuration.

System LaunchDaemon installation requires administrator authentication. The
temporary login-session service used for testing is not a substitute for startup before
login. Actual reboot/login-independent operation is not tested by rebooting the
shared Mac during this migration. Existing power settings already disable system
and disk sleep on AC; they are left unchanged.

**Unattended networking:** the standalone Tailscale desktop client does not run
before login; the open-source system daemon does, per Tailscale's
[variant comparison](https://tailscale.com/docs/concepts/macos-variants).
Tailscale 1.102.4 was built from the official release module using verified Go
1.27.1. An isolated userspace staging client, with incoming connections blocked,
was authenticated as `nightglow-service`, IP `100.118.4.122`.

`Activate Nightglow Network.command` first arms a Spark cutover service, then
installs the system Tailscale daemon through the independently verified LAN SSH
route `128.197.64.27` with the existing `nightglow` host-key pin. It moves the
authenticated state into root-only `/var/db/observationlab-tailscale`, installs
root-owned binaries under `/usr/local/libexec/observationlab`, and enables
`org.carruthers.tailscaled`. It disconnects the desktop client, renaming its node
`nightglow-desktop` for recovery, and names the new system node `nightglow`.

The Spark only changes its relay and storage watchdog to the new IP after SSH
host verification, external storage checks, and a separate forwarded HTTP health
check pass. An automatic seven-minute rollback restores desktop Tailscale unless
the coordinating script confirms the gateway cutover. Passwords go directly to
SSH/sudo. The old desktop account is retained, disconnected, for recovery; it
must not be reconnected while the system VPN is active.

The network cutover is complete: the system daemon is running and the Spark's
relay and watchdog use `100.118.4.122`. `ssh lucastsui@nightglow` resolves to the
new IP and succeeds. The original desktop client is stopped. The final installer
reported an error because its `tailscale up --timeout` call omitted existing
non-default settings; the daemon was already running and the automatic Spark
cutover had passed. The coordinator verified both SSH and public HTTP through
the new route and wrote the confirmation token, cancelling rollback. The source
installer now supplies the required flags. Do not rerun the one-time installers.
No reboot or GUI logout has been performed; operation through an actual reboot
remains untested.

The system daemon leaves macOS DNS settings unchanged (`accept-dns=false`);
the app uses explicit peer addresses. Other tailnet devices can resolve the new
node name through their own Tailscale DNS. The new device retains normal key
expiry; renewal remains part of routine Tailscale administration.

## Validation and operation

`nightglow/verify_migration.py` verifies all observation SHA-256 hashes against
the original manifest and restores original timestamps to preserve frame IDs.
It publishes `carruthers/dataset-verified.json` on the external drive only after
all checks pass. The startup supervisor checks its schema, volume UUID and
manifest digest on startup and during operation.

`spark/validate_migration.py` compares the live and staged backends: frame IDs,
frontend, both cameras, measurement results, previews, contours, exports,
circularity, full-month NFI processing and visitor isolation. Its report is
`/home/anaclast/carruthers-nightglow/validation.json` on the Spark.

The supervisor stops the backend if the expected volume disappears, and restarts
an unhealthy backend through launchd. It checks storage before startup writes;
spawned Python workers explicitly use external temporary storage. It does not
create a replacement mount directory on the internal disk. Keep the drive
connected and avoid renaming or replacing its directories while serving.

The existing bounded worker queue and request limits remain. Linux systemd's
original hard CPU/RAM limits do not transfer to macOS; concurrency and numerical
library thread limits are retained. Logs rotate at 10 MiB with five backups.
Nightglow uses a 300-second analysis deadline because the full-month NFI analysis
with circularity exceeded the original 120-second deadline on the external disk.
The default remains 120 seconds for other deployments. Scientific calculations
and the user interface are unchanged.

Validation completed: all 62 SHA-256 values and frame identities matched;
all 34 existing tests passed across the initial run and API rerun (the first API
run exceeded its 20-second test deadline during the concurrent checksum scan).
After the deadline configuration change, all four public API/queue tests passed
again. The complete 1,161-frame NFI paired/circularity analysis took 181.19 seconds.
Both live reference series were available and fresh. Reports are retained under
`.local/nightglow-migration` on the coordinating Mac.

After production activation, HTTPS checks passed for the 1,794-frame catalogue,
preview, a spawned two-frame analysis with the expected measurements, and CSV
and JSON exports. The first probe omitted the existing `X-Carruthers-Local`
request header and correctly received 403; the browser-equivalent request passed.
The app runs in launchd's system domain as `lucastsui`; normal ownership is
enabled on the new volume. The Spark relay is enabled in systemd and its existing
watchdog completed successfully with the remote-backend configuration.

To restore the original public backend after activation, run on the Spark:

```sh
sudo bash /home/anaclast/carruthers-nightglow/rollback.sh
```

This restores the backed-up gateway and monitor; it does not delete data or
restart the Cloudflare tunnel.
