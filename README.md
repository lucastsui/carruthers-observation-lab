# Observation Lab — Carruthers research app

The public app runs independently on Nightglow at <https://nightglow.tail2214e5.ts.net>.
For storage, monitoring and operation while logged out, see [deploy/nightglow/README.md](deploy/nightglow/README.md).
The local launcher remains available; [deploy/README.md](deploy/README.md) records the retired Spark deployment.

Double-click **Launch Observation Lab.command** in the Carruthers folder. It opens
<http://127.0.0.1:8765> in your browser. Keep its Terminal window open; press
Control+C in that window when finished. Launching it again reuses the running app.

This version reads your existing March 2026 L1C v1.3 collection: 633 WFI frames and
1,161 NFI frames, in 62 files. Source observations remain in
`../code and data/L1C`. The public deployment reads a verified copy on Nightglow's
external Observation Data volume and serves requested results through Tailscale Funnel.

## A short demo for Brian and John

1. The app opens on **WFI, March 15**, with the **4.5–5.5 Earth-radius annulus**.
   Click **Run time-series analysis** to calculate the initial 22-frame brightness curve. The first
   mean is approximately **5.05536 kR** and the last is **5.08641 kR**.
2. Use the slider or previous/next buttons. Click the image to focus it, then use
   the mouse wheel or left/right arrows. Space or the play button starts and pauses
   playback. The rate is frames per second, independently of observation cadence.
3. Try **2× / 4× zoom**. Rings mark projected distance from Earth. Changing the
   display limits affects the image colors; it does not affect measurements.
   Drag the two handles on the **Radiance · kR** scale bar to set the minimum and maximum
   brightness limits. The image updates automatically, with no Apply button.
   **Reset scale** restores the selected camera's default brightness display limits.
4. Choose an **annulus, annular sector, rectangle, or single pixel** with the shape
   buttons. Hover over a button or focus it with the keyboard to see its name;
   the selected shape stays highlighted. Drag on the image
   or enter coordinates. Coordinates use Earth radii: x right, y up. An annular
   sector starts at 0° on the right and increases toward the top of the image.
5. Choose an interval in **UTC**. Region, camera, interval and interpolation-mask
   changes cancel outdated time-series work. Click **Run time-series analysis**
   when the selection is ready. The curve uses actual reported timestamps. Click a point to view
   that observation. **Cancel** stops the time calculation; click **Run time-series analysis** to submit again. Frame scrubbing does not recalculate the time curve.
6. Switch to **NFI**. The viewer selects the closest available observation time.
   WFI and NFI use their own geometry and brightness scales.
7. Inspect the current frame's **radial profile** beside the viewer. It averages
   full annuli around Earth, independently of the selected region. Its CSV includes
   bin bounds, values and valid pixel coverage.
8. Download **CSV**, or **JSON (data + recipe)** for values and calculation provenance.
   **Save** stores a copy in this browser and website origin. Open **Collection & saved** in the header to
   restore the selection and results after restarting the app.

While a changed selection is being measured, the time panel shows its update
status. Previous-selection curves and exports are hidden until matching results
arrive. Loading a saved analysis restores its recipe and values without repeating
the calculation. The current-frame measurement and full-annulus radial profile
refresh automatically when playback is paused.

## Window layout

The workbench fills the browser viewport. The image scales to the space left
between its timestamp and playback controls, preserving its square aspect ratio.
Camera and time controls sit in the top bar. **Region** and **Display** share one
card, with both sets of controls always visible; short windows place them beside
each other within that card. The time curve and radial profile sit beside the viewer. Short windows use
**Through time / Radial profile** tabs, and narrow windows use **Viewer / Controls /
Results** tabs. Reference notes and saved analyses open separately, without
extending the main page. Saved lists are paginated. Extremely small windows or
large text enlargement retain overflow access within controls and reference dialogs.

## Scientific conventions

- Numeric L1C image values are interpreted as Rayleighs, following Clarke's
  clarification: **kR = R / 1000**, with no extra 4π conversion.
- Logarithmic image display limits default to **WFI 0.01–270 kR** and **NFI 1–270 kR**.
  Both use the `gist_heat` color map. Nonpositive values cannot appear on the log
  display, but finite negative values are retained in measurements.
- Earth is projected using spacecraft position, spacecraft and camera attitudes,
  and camera intrinsics. The registered arrays are **never shifted again**.
  Earth projects to (256, 256) for these WFI files and (512, 512) for NFI, in
  zero-based array coordinates. The March `earth_loc` field is not used to recenter.
- Projected distances use 6,370 km per Earth radius and the near-nadir estimate
  `abs(focal_length_pixels) * 6370 / spacecraft_distance_km`. This is an approximate
  image-plane distance, not a 3D location. The stored `plate_scale` units are
  inconsistent with the actual geometry in this collection.
- Selections test pixel centers with lower bounds included and upper bounds
  excluded. Single-pixel selections use the nearest pixel in each frame, at a
  fixed projected coordinate. Source row 0 stays at the top of the display.
- All measurements exclude nonfinite pixels and pixels outside `mask_fov`.
  Interpolated pixels are excluded by default; the switch and saved recipe record
  that choice. Coverage is valid / selected pixel centers **inside the raster**;
  it does not count parts of a region extending beyond the raster.
- Flags are preserved and shown, but flagged frames are not silently removed.
  The reported time is filename UTC date plus `time` in milliseconds of day;
  the app does not assume that this is the exposure midpoint. Exposure duration
  is shown separately.
- `spatial_std_kR` is spatial pixel dispersion, **not an uncertainty on the mean**.
  The meaning of `image_uncertainty` needs validation before drawing error bars.
  These are exploratory line-of-sight brightness measurements, not local density
  retrievals or evidence for a particular physical cause.

The earlier diagnosis and teaching example remain in
`../code and data/diagnostics/centering/Diagnosis.md` and
`../code and data/diagnostics/brightness_example/`.

## Where the code and results live

| Location | Purpose |
| --- | --- |
| `app/page.tsx` | Date/camera controls, playback and application state |
| `components/observation-viewer.tsx` | Image display, zoom, overlays and mouse selection |
| `components/analysis-controls.tsx` | Measurement controls, charts and exports |
| `components/display-controls.tsx` | Zoom, rings and the two-handle logarithmic brightness slider |
| `hooks/use-analysis.ts` | Current-frame requests, extraction progress and saved results |
| `lib/auto-analysis.ts` | Explicit submission, job cancellation and stale-response protection |
| `science.py` | NetCDF frame reads, geometry, masking and numeric measurements |
| `server.py` | Local API, cancellable extraction jobs and saved analysis files |
| `launcher.py` | Starts/reuses the local app and opens the browser |
| `lib/saved.ts` | Browser IndexedDB saves and CSV/JSON downloads |
| `public_server.py`, `public_jobs.py` | Public request limits, visitor job ownership, bounded queue and process deadline |
| `.local/app.log` | Local service log |
| `tests/` | Array science, regression and API integration checks |

Exported JSON includes exact frame identifiers, source filenames, source size/mtime
fingerprints, data version, region parameters, masks and a method version. The
source fingerprint detects replacement of an indexed file; it is not a SHA checksum
of the file contents. Source changes require an app restart to rebuild the catalogue.

## Storage and local operation

The service listens only on **127.0.0.1**. It serves the built interface and requested
previews, with no route to download arbitrary source files. It has no external
fonts, analytics, cloud storage, account system or network collaboration. Only public
reference observations are fetched from LASP and NASA; source images stay local. Host and
Origin checks prevent ordinary cross-origin requests and DNS rebinding. This is
not an authorization boundary against other processes running on your computer.

Startup reads small metadata arrays. Image reads select one frame at a time,
without loading a whole day or month. NetCDF access is serialized to protect the
HDF5 library; rendering and measurements happen outside the read lock. PNG caching
is bounded to 64 MiB in the service, and the browser preloads the next frame.
Only one range extraction runs at a time; up to 12 recent jobs remain in memory.
Save results you want to keep in your browser, or download CSV/JSON. Public deployment limits are described in `deploy/README.md`.

Only March 2026 v1.3 files are indexed. Later months or processing versions need
their geometry and metadata checked before enabling them. The Spark hosts public anonymous access. Researcher accounts and shared storage are future work.

Code and local output are separated. `.gitignore` excludes source observation
formats, local results, videos and scientific raster exports. Do not copy
confidential observations into `public/`, a source archive or a Git repository.
The deployment directory contains the Spark service configuration and the original data checksum manifest.

## Development and rebuilding

The installed application uses the existing Python environment in
`../code and data/.venv`. Node.js is only needed to change/rebuild the interface.
Normal use runs the static interface through Python, with no Node or SSR server.

```sh
# Rebuild the interface after editing it.
npm ci
npm run check
npm run build
node --experimental-strip-types --test tests/*.test.ts

# Run locally without automatically opening a browser.
./"Launch Carruthers.command" --no-browser

# Science and local API tests, using the existing dataset.
"../code and data/.venv/bin/python" -m unittest discover -s tests -v
```

For development, run `server.py` with the scientific Python environment, and run
`npm run dev` in another terminal. The development preview is
<http://127.0.0.1:5173> and proxies `/api` to port 8765. The usual launcher uses
the built interface at port 8765 and requires no package downloads.

For a new installation, create a Python virtual environment in `.venv` and install
`requirements-local.txt`, then build the interface. Set `CARRUTHERS_DATA_DIR` to
an approved local L1C folder when the default sibling path is unsuitable.

The pinned Sites starter build/development dependencies currently have npm audit
advisories. They are not used as the delivered Python/static server. Review and
update the toolchain before enabling an external Node/SSR deployment. No server
deployment configuration has been added.

The optional browser WebMCP read tool reports the current visible workspace state
when supported. Its live registration could not be verified in this browser;
normal app use does not require it. The original September 5 release did not have browser interaction/visual QA;
validation covers compilation, real-array regression and local API workflows.

Validation on September 5, 2026: 12 Python science/API tests and 13 TypeScript
selection and automatic-update tests passed, including rapid edits, cancellation,
late responses, saved results and connection retries. All 1,794 registered Earth projections matched
their expected raster centers. The 22 March 15 WFI annulus means reproduced the
earlier independent CSV to within 8.9e-16 kR. Reading and measuring the same annulus
through all 633 WFI frames took about 4.1 seconds; all 1,161 NFI frames took about
12.6 seconds on this Mac. These are observed local timings, not guarantees for
other computers, selections or future datasets.


## September 8 radiance, reference series, and 3D update

- Image colors use logarithmic radiance with tick marks in kR and a 270 kR
  default upper limit for both cameras. Display changes do not alter measurements.
- Contours default to actual radiance levels (1, 3, 10, 30, 60, 100, 200, 270 kR
  when present), calculated from original arrays with the current pixel mask.
  Choose radius contours or hide contours using **Contours**. The blue 1 Rᴇ
  boundary remains visible. The array is never recentered.
- Dawn/left and dusk/right guides are 45° wide, centered at 180° and 0° in the
  displayed image. The matching buttons select those annular sectors. These
  labels follow the requested image convention; they are not an attitude-derived
  magnetic local-time coordinate transformation.
- The radial profile uses logarithmic radiance. Nonpositive bins remain in
  exported data and are omitted from the logarithmic plot.
- The gold dashed baseline is the average of all valid FOV pixels in the first
  image of the selected camera and interval, respecting the interpolation mask.
  It is independent of the selected ROI and stays constant while scrubbing.
  It is computed from `/api/baseline`, not from a logarithmic image or colorbar.
  Time-series JSON/CSV exports include the baseline value and its source frame.
- The top-right time panel aligns three plots on exactly the same UTC limits:
  selected-region radiance, 1-minute **SYM-H** in nT from WDC Kyoto via NASA
  CDAWeb `OMNI_HRO_1MIN`, and daily **Composite Solar Lyman-alpha** irradiance
  from LASP LISIRD. Irradiance is shown in mW/m² at 1 AU (source W/m² × 1000).
  Daily values occupy their UTC day without inventing subdaily changes. Missing
  values and gaps are retained. SYM-H is not silently replaced by hourly Dst.
  Reference data are cached by month under `.local/space-weather`, refreshed after
  24 hours when requested. Offline cached data are identified as stale; unavailable
  observations are not synthesized. Source links are available above each plot.
- Choose **3D orbit** to rotate, zoom, and pan Earth, the measured March spacecraft
  trajectory, the current calibrated image plane, and WFI/NFI view frusta. The
  second camera's frustum uses its nearest frame within two hours. The current
  image plane intersects Earth and is perpendicular to the Earth–spacecraft
  direction; its corners are calibrated pixel-ray intersections, in GCRS Rᴇ.
  Texture row orientation is preserved. This is a 2D line-of-sight observation
  plane, not a surface map or a reconstructed hydrogen volume.
- The orbit view uses per-frame spacecraft vectors from NetCDF and analytic
  Astropy/ERFA Sun vectors. It is rotated to a Sun-aligned frame using the J2000
  ecliptic normal. The available March trajectory is shown, without extrapolating
  a complete halo orbit. **Overview** compresses spacecraft distances by 0.45;
  **True spacecraft distance** uses one scale for Earth, images, and spacecraft
  position. The Sun's displayed distance and Sun/spacecraft glyph sizes are
  schematic. L1 is marked at approximately 1.5 million km. The video reference is
  NASA SVS 14887 / 5419; the actual observation texture comes from the local data.

New implementation files: `space_weather.py`, `hooks/use-reference-data.ts`,
`components/context-chart.tsx`, `components/orbit-viewer.tsx`, `lib/display.ts`,
`lib/orbit.ts`. New scientific dependencies are pinned in `requirements-local.txt`.
The interface adds Three.js and its TypeScript types. Local source/UI backups are
in `.local/change-backups/20260908/`.
