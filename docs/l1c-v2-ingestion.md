# Illinois L1C release V2

CEDA supports the [October 8, 2026 Illinois Data Bank release](https://databank.illinois.edu/datasets/IDB-6347878), DOI [10.13012/B2IDB-1805186_V2](https://doi.org/10.13012/B2IDB-1805186_V2). This is a new archive release, while the NetCDF filenames still say `v1.3`. It replaces the original March release and adds later observations in nine weekly archives. CEDA must not index both releases together: filenames overlap and measurements would be duplicated.

The download is staged separately on Nightglow's external observation volume. Every archive is checked for its published byte length, read through gzip/tar integrity checks, and assigned a SHA-256. Extracted file sizes and SHA-256 values are recorded in the deployment manifest. These are locally calculated integrity hashes, not checksums independently supplied by the producer. Original V1 observations are retained outside the active catalogue.

The nine archives contain 124 NetCDF files totaling 92,629,994,712 bytes. Their file dates run from March 1 through May 2, 2026; no April 2 files are supplied. CEDA retains this gap rather than filling it with synthetic observations.

## Reader changes

- **Format:** the files use regular NetCDF4 instead of NetCDF4 Classic. The existing netCDF4 library reads both.
- **Time:** V2 `time` and `epoch` contain identical integer nanoseconds since 2000-01-01 12:00:00, with `TIME_SCALE=TT`. `l1c_time.py` follows that declaration and converts TT2000 to UTC with Astropy, retaining millisecond precision. `Date_Start` and `Date_End` match the unconverted TT clock; they are checked in that scale. In 2026 the UTC labels are 69.184 seconds earlier than treating those coordinate values as UTC. A sample compared with V1 matches V1's displayed clock before this conversion. This exposes a producer time-scale ambiguity: CEDA follows V2's explicit TT declaration, but independent confirmation of the original acquisition clock is still needed. The original V1 milliseconds-of-day reader is unchanged.
- **Geometry:** V2 `earth_loc` now agrees with registered camera geometry. CEDA continues projecting the supplied camera/spacecraft geometry, checks agreement with the header and registered raster center, and does not translate images. Pixel scale continues to come from focal length and spacecraft distance; the supplied `plate_scale` values are not substituted.
- **Missing pixels:** V2 omits `mask_fov` and supplies invalid image pixels as NaN. Its reader uses the finite radiance footprint; the legacy reader still uses the explicit FOV mask. Interpolation masks remain separate. Negative finite radiances are retained, despite `VALIDMIN=0` metadata. Coverage is still valid pixel centers divided by all selected centers inside the raster, so missing pixels do not disappear from the denominator.
- **Units:** radiance remains Rayleighs, converted to kR by dividing by 1,000. The new metadata explicitly describes emission integrated over 4π steradians. No additional 4π factor is applied.
- **Provenance:** catalogue frames and measured rows record release, time interpretation and mask interpretation. Source fingerprints change with the new files. Method version `carruthers-local-1.4` identifies the reader update; original saved analysis values are not rewritten.

The dashboard derives its collection date range from the loaded frames. Reference-data requests are allowed within that range, using the existing limit of 63 days per request. Orbit paths are labeled as the observation trajectory rather than March only.

## Validation

`tests/test_l1c_release.py` independently checks TT-to-UTC conversion across a date boundary, legacy time decoding, negative values, missing/interpolated pixels, coverage, duplicate-release rejection and registration checks. The original March numerical regression fixtures remain in place. The release audit on Nightglow checks all file metadata and representative first/last frame reads, direct-array region means, previews and contours before activation.
