# Zoennchen brightness overlay

The WFI/NFI **2D image** view can display dashed cyan model contours independently
of the observed brightness/radius contours. Controls select solar maximum,
solar minimum or Off, set opacity, and set reference solar Lyman-alpha irradiance
(1–15 mW/m², default 6). Number edits apply on blur or Enter. The density presets
are empirical reference states, not fits to Carruthers data. Irradiance is a fixed
user input, not automatically taken from the observation date's LISIRD series.

## Scientific definition

`zoennchen.py` implements Zoennchen et al. (2015), equations 6–9 and Tables 1–2:
[doi:10.5194/angeo-33-413-2015](https://angeo.copernicus.org/articles/33/413/2015/).
Solar minimum represents TWINS 2008/2010; solar maximum represents near-maximum
2012. The normalized spherical harmonics include the Condon–Shortley phase and
the paper's sqrt(4π) factor. Density is in atoms/cm³. The 2024 density revision
is not part of this initial overlay.

The displayed quantity is **only the single-scattering brightness contributed
by hydrogen at geocentric distances 3–8 Rᴇ**. Rays passing within 3 Rᴇ are masked;
the outer integration boundary is exactly 8 Rᴇ, without extrapolation. In
particular, a small value near the outer edge is a consequence of this truncation,
not an assertion that the real exosphere ends there. No full-image model residual
is calculated. This approximation must not be described as the full brightness
prediction or the paper's multiple-scattering-corrected radiance calculation.

For normalized observer-to-scene direction d in GSE, the phase factor is
`P = 11/12 + d_x²/4`. Brightness in kR is
`B = 10^-9 g ∫ P n_H ds`, where ds is in cm. The conversion to g follows
[EXOSpy's single-scattering method](https://www.frontiersin.org/journals/astronomy-and-space-sciences/articles/10.3389/fspas.2023.1082150/full):
convert band-integrated irradiance to photon flux F in photons/cm²/s at 121.6 nm,
then `g = 3.47e-4 (F/1e11)^1.21 s^-1`.
The 4π in the Rayleigh definition cancels the isotropic emissivity denominator;
no additional 4π is applied to model brightness or observed stored Rayleighs.

Direct illumination is zero inside Earth's nightside cylindrical geometric
shadow. Integration intervals split analytically at shadow boundaries, preventing
quadrature error at an on/off discontinuity. Absorption/penumbra, geocoronal
re-emission, multiple scattering, interplanetary background and instrument PSF
are omitted. These limitations apply even outside 3 Rᴇ, especially near the
Sun–Earth axis. See the paper's Section 5 for the required radiative transfer.

## Alignment, masking and caching

The selected frame's NetCDF intrinsics and scalar-last passive attitudes define
each pixel ray. Outward is camera -Z, with the existing rotation convention;
registered arrays are never translated or recentered with `earth_loc`.
GCRS vectors are rotated to a Sun-aligned frame using Astropy's per-frame apparent
Sun vector and ERFA's IAU 2006 mean ecliptic pole of date (`ecm06`). This uses the
GCRS/ICRS axis approximation; the existing metadata interpretation, including its
documented ecliptic-north uncertainty, remains a limit on registration. Model and
display share CEDA's 6,370 km Earth radius.

An image-aligned grid, capped at 257×257, covers the projected shell. Each valid
ray uses 64-point Gauss–Legendre integration on each illuminated segment, batched
to limit memory. FOV, nonfinite and optional interpolation masks are applied
conservatively over each grid point's pixel footprint. Finite negatives remain
valid. Contours use B² interpolation to resolve the square-root behavior near
the outer tangent; this preserves the brightness level sets. SVG positions use
the same +0.5 pixel-center offset as observed contours.

`GET /api/model-contours?id=…&model=Z15MAX&irradiance=6&exclude=1` returns contours
and method/illumination/domain metadata. Inputs are bounded; the public endpoint
uses normal authentication and compute limits. A per-service lock avoids duplicate
work, with 24 cached column images and 64 contour responses. Illumination/mask
changes reuse columns. Source identity is checked even on a cache hit.

The browser keeps 64 contour responses, debounces scrubbing, cancels obsolete
requests and verifies response frame/model/illumination/mask identity. It only
draws contours matching the displayed image; a pending model never blocks the
observation. Opacity/zoom do not trigger model computation. No background model
preload of the entire observation interval occurs.

## Validation

- Independent density fixture from EXOSpy revision
  `3cb1e6701aeb41b703f58fb95ecb3167387bc9db`, using its general spherical-harmonic
  evaluator, with coefficients checked against the published tables. The external
  evaluator is not a runtime dependency. Fixture: `tests/fixtures/zoennchen-2015.json`.
- Angular averages reproduce the published radial density profiles. Uniform
  density rays reproduce analytic chord lengths, phase factors, shadow removal
  and cm-to-kR conversion.
- First/middle/last March frames in both cameras check the Earth-center ray,
  Sun direction, orthonormal basis and 64-versus-128-node convergence (<1e-7
  relative on the sampled rays).
- Direct 128-node reintegration of emitted contour vertices on March 1, 15 and
  31, both cameras/models, at 1/6/15 mW/m² found <2% brightness error from spatial
  interpolation. This is a numerical check, not an observational error estimate.
- Backend endpoint, authentication, existing scientific regressions and frontend
  identity checks are covered by the relevant tests. Run `tests/test_zoennchen.py`,
  `tests/test_science.py`, `tests/test_service.py`, `tests/test_auth.py`,
  `tests/model-overlay.test.ts`, plus types/build and browser interactions.

Development-machine measurements were approximately 0.2 s per uncached WFI/NFI
image and under 1 ms for a cache hit, excluding network transfer. Hardware and
the selected masks/geometry affect timings.
