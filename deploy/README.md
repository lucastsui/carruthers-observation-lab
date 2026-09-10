# Spark deployment

Observation Lab runs on the DGX Spark. Its public URL is the current Cloudflare Quick Tunnel address in `/run/carruthers-tunnel/public-url`. SSH uses Tailscale. The app, gateway and tunnel listen on no LAN/public HTTP socket: cloudflared forwards outbound tunnel traffic to `127.0.0.1:8765`, and the bounded nginx gateway forwards to Python on `127.0.0.1:8766`.

## Limits and behavior

- Public, anonymous browsing and analysis; no researcher account or upload/admin interface. Browser cookies identify temporary analysis ownership, not authenticated people.
- Region includes a **Dawn + Dusk** shape alongside annulus, sector, rectangle and point. It selects two filled pies from Earth center to the image edges, centered left/right in the image. One opening angle (1–180°) controls both; dragging any angular edge handle changes both together. A single queued analysis measures the pies separately and plots labeled green Dawn / pink Dusk curves. Paired CSV exports have two rows per frame with a `region` column; JSON includes each region's statistics and the shared recipe. The old dashed dawn/dusk guides have been removed.
- **Contour circularity** adds 1 kR / 3 kR time-series curves to the scrolling results card. Departure is 100 × geometric circle-fit RMS residual / fitted radius, sampled at 512 equal arc-length positions on the unique closed high-radiance contour enclosing Earth. The center is free; coordinates/radii use projected Earth radii. Contours are unsmoothed and use the analysis validity/interpolation mask, independently of ROI. Bands span three fixed thresholds (95%, 100%, 105% of each nominal level); they are threshold-sensitivity ranges, not confidence intervals. Open, ambiguous, unresolved and failed-fit contours are missing values. A valid nominal contour still plots if its band is unavailable. The chart supports frame selection and a dedicated CSV with statuses, fitted geometry, threshold variants and method metadata; the analysis JSON includes all circularity data.
- The **Analyze** button at the top-right of the image starts work. The right-hand plots share one card that scrolls independently of the image and controls. One heavy job runs globally, with ten waiting; each browser session may have one running and one waiting. A job uses one camera within one calendar month, at most 1,500 frames. The worker process is terminated after 120 seconds. Cancellation frees its slot. Excess traffic returns 429/503 with retry information.
- Two image/measurement workers with at most ten admitted requests including active workers. HTTP server: 32 concurrent requests; gateway: 30 requests/second globally, burst 60, 32 connections, 1 MiB request bodies. Anonymous cookie limits discourage accidental overload; a visitor can replace cookies, so global limits remain the resource boundary.
- App: 4 CPU cores, 8 GiB RAM including its children, no GPU/device access, 64 tasks. Gateway and tunnel each: one CPU core and 256 MiB RAM. The app runs under a dedicated non-login system user with read-only code and observations.
- App disk cache: 1 GiB temporary filesystem; `/tmp`: 2 GiB; gateway temporary files: 64 MiB. In-memory previews and analysis result caches: 64 MiB each. At most 100 recent jobs, expiring after one hour. Namespace journal: approximately 500 MiB persistent / 50 MiB runtime, 14 days, rate limited; systemd journal rotation may briefly exceed the nominal limit by an active journal file.
- Saves live in the visitor's IndexedDB. CSV/JSON exports are generated in the browser. A Quick Tunnel URL change creates a different browser origin, so download results you want to retain. The server keeps no durable analysis results.
- systemd starts services at boot and restarts crashes with backoff. An independent minute timer checks app readiness, services, disk space, repeated crashes and stuck work. It attempts recovery after three unavailable checks, at most once per 15 minutes.
- Emergency browsing-only switch: `sudo touch /var/lib/carruthers/browsing-only`; remove it to accept new jobs. To stop existing work immediately, restart `carruthers.service` after creating the flag.
- No backups by decision. Source code is recoverable from GitHub; original public data are recoverable from the University of Illinois archive. `dataset-manifest.json` records filenames, byte sizes, original SHA-256 values and the source DOI. The archive blocks this automated client's access (HTTP 403), so automated redownload is not verified.

Cloudflare Quick Tunnel supplies HTTPS and an outbound connection without a paid domain. It is a testing service with no uptime guarantee; its URL changes on tunnel recreation. The accountless tunnel does not provide a configurable zone WAF, Turnstile policy or per-site Cloudflare rate-limit rules. Local queues and limits protect the Spark; they do not guarantee availability under application-layer abuse. Quick Tunnels have a 200 in-flight-request limit and do not support SSE; this app polls jobs.

## Install / update

1. Build with Node 22.13+ using `npm ci`, `npm run check`, `npm run build`. Transfer source and `dist/client` into `/opt/carruthers/app`. Exclude `.git`, `node_modules`, `.local`, `.env*` and observations.
2. Put the existing collection in `/srv/carruthers/L1C`. Verify it using `python3 deploy/verify_dataset.py /srv/carruthers/L1C`.
3. Run `sudo bash /opt/carruthers/app/deploy/install.sh`. The script is for an ARM64 Ubuntu Spark and uses the dedicated gateway service; it does not replace unrelated nginx sites or Tailscale Funnel routes.
4. Before enabling the SSH firewall, schedule a two-minute rollback: `sudo systemd-run --unit=carruthers-firewall-rollback --on-active=2min /usr/bin/systemctl stop carruthers-firewall.service`. Start `carruthers-firewall.service`, verify a NEW Tailscale SSH login works, then stop the rollback timer and enable the firewall service. The separate nftables table restricts port 22 to Tailscale/loopback without replacing Docker/Tailscale tables.
5. For code updates, replace the app directory contents, rebuild, run checks and restart `carruthers.service`. Restart the gateway or tunnel only if their configuration changed. Restarting the tunnel changes the public address.

## Monitoring and email

Better Stack's free Uptime service is active under `lucastsu@bu.edu`. The public monitor and the Spark heartbeat both report healthy. The existing team-scoped Uptime API token, monitor ID and heartbeat URL are installed in `/etc/carruthers/monitor.env`, owned by root with mode 0600; credentials are not stored in this repository.

The [public HTTPS monitor](https://uptime.betterstack.com/team/t596700/monitors/4916571) checks `<current-url>/health` every 5 minutes, with a 15-minute sustained failure threshold and 3-minute recovery period. The [Spark heartbeat](https://uptime.betterstack.com/team/t596700/heartbeats/492203) expects a ping every 60 seconds with 15 minutes of grace for missing pings. Explicit `/fail` reports create an incident immediately. Both send email to primary responder Lucas Tsui at `lucastsu@bu.edu`; call, SMS, push and further escalation are disabled. The account uses the free plan with no payment method added.

For recovery or migration, the root-only environment file has these keys:

```text
BETTERSTACK_API_TOKEN=...
BETTERSTACK_MONITOR_ID=...
BETTERSTACK_HEARTBEAT_URL=...
```

The watchdog automatically updates the external monitor when the tunnel address changes, and pings/fails the heartbeat for local health. It sends only health messages and the public health URL. Restart `carruthers-monitor.service` after configuration. Inspect `/var/lib/carruthers-monitor/health.json` for whether external monitoring is configured and URL synchronization succeeded. Both were verified on September 10, 2026. A website test alert was received in the BU mailbox through browser testing. A controlled heartbeat failure created incident `1013648651` and resolved automatically after a healthy watchdog ping; both the failure and recovery emails were verified in the BU mailbox. The research app stayed available throughout the test.

## Verification

`npm run check`, the production build, 21 TypeScript tests and 34 Python tests pass locally; all 34 Python tests also pass on the Spark. Paired-region checks cover separate numeric values, missing/interpolated pixels, a 180° full-raster partition without overlap, both cameras against individual-sector extraction, public jobs, and labeled CSV exports. Circularity checks cover analytic circles/ellipses, translation/scale invariance, arc-length sampling, masks, ambiguous/open contours, sensitivity gaps, ROI independence and exported values. The Python tests accept `CARRUTHERS_DATA_DIR` for a deployed dataset. Repository-wide lint has pre-existing component/accessibility and hook-dependency findings; the changed standalone research/export and chart/display TypeScript files pass targeted lint.

The circularity chart was verified through computer use on the public tunnel, including independent card scrolling, threshold bands, clicking a point to select its observation, and CSV/JSON downloads. All 1,266 circularity CSV rows matched the 633-frame WFI JSON export, including missing values and fitted geometry. There were 485 valid 1 kR and 597 valid 3 kR contours. With circularity enabled, a full March NFI analysis at the maximum paired opening of 180° completed all 1,161 frames in approximately 97.8 seconds under the existing 120-second limit; it yielded no valid 1 kR contours and seven valid 3 kR contours. These incomplete-contour gaps are preserved. The app reported healthy with no running or queued work afterward. Timings below describe earlier analyses without circularity.

The paired selector was verified through computer use on the public tunnel: the icon is in the Region shape row, both filled pies reach the image edges, and dragging one handle changes the shared opening angle. A full March WFI paired analysis completed for 633 frames. Browser CSV (1,266 labeled rows) and JSON downloads matched every Dawn and Dusk mean; the angle-only recipe no longer requires an outer radius. After computing the paired geometry once per frame and fixing floating-point boundary gaps, the maximum 180° opening completed all 1,161 NFI frames in 36.8 seconds through the public API. Every raster pixel belonged to exactly one pie in every frame, and the earlier 45° sample means were preserved exactly.

All 62 deployed files (45,702,685,970 bytes) matched the original SHA-256 manifest. Browser testing on the public tunnel produced CSV and JSON for all 22 WFI observations on March 15, plus a complete March WFI CSV with 633 rows. A full-month NFI analysis of 1,161 frames completed through the deployed API in about 20 seconds with the configured limits. The first/last annulus means were 5.055363316796408 / 5.0864138765212 kR, matching the local calculation. Crash recovery, Tailscale SSH after firewall activation, read-only observations and effective 1 GiB cache / 2 GiB temporary mounts were checked on the Spark.

## Operations

```sh
ssh anaclast@100.73.106.98
cat /run/carruthers-tunnel/public-url
curl --fail http://127.0.0.1:8765/health
sudo systemctl status carruthers carruthers-gateway carruthers-tunnel carruthers-monitor.timer
sudo journalctl --namespace=carruthers --since='10 minutes ago'
sudo cat /var/lib/carruthers-monitor/health.json
```

SSH password/key policy and Tailscale device-key expiry are separate from website access. Keep the Mac and Spark signed into Tailscale and retain a working SSH key. Existing Funnel ports 443→8000, 8443→8001 (Groove), and 10443→8080 are unrelated to this deployment and are preserved.

Future BU Shibboleth/SAML can be added at the gateway/application boundary after registration with BU. It is not configured now.
