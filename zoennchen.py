"""Zoennchen (2015) density and a bounded, single-scattering image overlay.

Equations 6–9 / Tables 1–2: doi:10.5194/angeo-33-413-2015.
Brightness convention follows EXOSpy (doi:10.3389/fspas.2023.1082150).
This is the 3–8 Re shell contribution, NOT a full radiative-transfer prediction.
See docs/zoennchen-overlay.md for assumptions and validation.
"""
from functools import lru_cache
import threading
import time

import contourpy
import erfa
import numpy as np
from astropy.time import Time
from netCDF4 import Dataset

from science import GEOMETRY_NAMES, NETCDF_LOCK, RE_KM, read_array, rotation

METHOD = 'zoennchen-2015-shell-2'
MODELS = ('Z15MIN', 'Z15MAX')
# a10,a11,a20,a21,a22; b; p11,p21,p22; q (all scaled by 1e-4).
COEFFICIENTS = {
    'Z15MIN': (12264.1, 2.87646,
               [938., 92.20, -385.26, 2042.26, -421.34],
               [135.41, 198.16, -597.06, -916.65, 1196.10],
               [4870.41, -2506.10, 2783.95], [-2632.88, 1578.28, -1331.32]),
    'Z15MAX': (16840.9, 2.74640,
               [-921.29, 6763.12, -494.96, -284.02, -556.96],
               [790.11, -3088.94, -405.36, 44.03, 1303.13],
               [1289.94, -753.84, 2029.43], [-788.54, 256.56, -1084.30]),
}


def density(model, xyz):
    """Hydrogen cm^-3 at GSE positions in Re; callers enforce the fit domain."""
    c, k, a, b, p, q = COEFFICIENTS[model]
    r = np.linalg.norm(xyz, axis=-1)
    u = xyz[..., 2] / r
    s = np.sqrt(np.maximum(0., 1 - u*u))
    phi = np.arctan2(xyz[..., 1], xyz[..., 0])
    logr = np.log(r)[..., None]
    A = (np.array(a) + logr*np.array(b))*1e-4
    B = (np.array(p) + logr*np.array(q))*1e-4
    # sqrt(4pi) times the normalized Y_lm, including Condon–Shortley signs.
    angular = (1 + A[..., 0]*np.sqrt(3)*u
               - (A[..., 1]*np.cos(phi) + B[..., 0]*np.sin(phi))*np.sqrt(1.5)*s
               + A[..., 2]*np.sqrt(5)/2*(3*u*u - 1)
               - (A[..., 3]*np.cos(phi) + B[..., 1]*np.sin(phi))*np.sqrt(7.5)*s*u
               + (A[..., 4]*np.cos(2*phi) + B[..., 2]*np.sin(2*phi))*np.sqrt(15/8)*s*s)
    return c*r**(-k)*angular


def gse_basis(frame):
    """Rows rotate GCRS vectors into a Sun-aligned ecliptic-of-date frame."""
    t = Time(frame['epoch_ms']/1000, format='unix', scale='utc').tt
    north = erfa.ecm06(t.jd1, t.jd2)[2]
    x = np.asarray(frame['sun_position_km'], float)
    x /= np.linalg.norm(x)
    y = np.cross(north, x)
    y /= np.linalg.norm(y)
    return np.array([x, y, np.cross(x, y)])


def pixel_rays(geometry, x, y):
    """Zero-based pixel centers to unit outward GCRS rays (camera -Z)."""
    fx, fy = geometry['cam_focal_length']
    cx, cy = geometry['cam_ctr']
    yn = (y-cy)/fy
    xn = (x-cx-float(geometry['cam_skew'])*yn)/fx
    camera = -np.stack([xn, yn, np.ones_like(xn)], axis=-1)
    attitude = rotation(geometry['spacecraft_attitude']) @ rotation(geometry['cam_attitude'])
    rays = camera @ attitude.T
    return rays/np.linalg.norm(rays, axis=-1, keepdims=True)


def shell_column(position, rays, model, samples=64, density_fn=None):
    """Phase-weighted H column cm^-2; mask inner rays and integrate only 3–8 Re.

    Only the forward ray is used. A geometric terrestrial shadow excludes
    direct sunlight; absorption, re-emission and interplanetary light are absent.
    """
    rays = np.asarray(rays, float)
    along = rays @ position
    impact2 = np.maximum(0., np.dot(position, position)-along*along)
    half = np.sqrt(np.maximum(0., 64-impact2))
    lo = np.maximum(0., -along-half)
    hi = -along+half
    valid = (impact2 >= 9) & (impact2 < 64) & (hi > lo)
    result = np.full(len(rays), np.nan)
    nodes, weights = np.polynomial.legendre.leggauss(samples)
    evaluate = density_fn or (lambda xyz: density(model, xyz))
    indices = np.flatnonzero(valid)
    result[indices] = 0.
    # Split exactly at the cylinder/terminator shadow boundary. Sampling a
    # discontinuous on/off shadow with quadrature nodes causes nonconvergence.
    transverse = np.sum(rays[:, 1:]**2, axis=1)
    dot = rays[:, 1:] @ position[1:]
    c = np.dot(position[1:], position[1:])-1
    discriminant = dot*dot-transverse*c
    divisor = np.where(transverse > 1e-14, transverse, 1.)
    root = np.sqrt(np.maximum(0., discriminant))
    crosses = (transverse > 1e-14) & (discriminant > 0)
    shadow_lo = np.where(crosses, (-dot-root)/divisor, np.inf)
    shadow_hi = np.where(crosses, (-dot+root)/divisor, -np.inf)
    parallel_inside = (transverse <= 1e-14) & (c < 0)
    shadow_lo = np.where(parallel_inside, -np.inf, shadow_lo)
    shadow_hi = np.where(parallel_inside, np.inf, shadow_hi)
    dx = rays[:, 0]
    crossing_x = -position[0]/np.where(np.abs(dx) > 1e-14, dx, 1.)
    shadow_lo = np.where(dx < -1e-14, np.maximum(shadow_lo, crossing_x), shadow_lo)
    shadow_hi = np.where(dx > 1e-14, np.minimum(shadow_hi, crossing_x), shadow_hi)
    shadow_lo = np.where((np.abs(dx) <= 1e-14) & (position[0] >= 0), np.inf, shadow_lo)
    shadow_lo, shadow_hi = np.maximum(lo, shadow_lo), np.minimum(hi, shadow_hi)
    has_shadow = shadow_hi > shadow_lo
    shadow_lo = np.where(has_shadow, shadow_lo, lo)
    shadow_hi = np.where(has_shadow, shadow_hi, lo)
    starts = np.concatenate([lo[indices], shadow_hi[indices]])
    stops = np.concatenate([shadow_lo[indices], hi[indices]])
    indices = np.tile(indices, 2)
    nonempty = stops > starts
    indices, starts, stops = indices[nonempty], starts[nonempty], stops[nonempty]
    # Small batches cap temporary memory and allow other request threads to run.
    for offset in range(0, len(indices), 2048):
        idx = indices[offset:offset+2048]
        start, stop = starts[offset:offset+2048], stops[offset:offset+2048]
        length = stop-start
        distance = (start+stop)[:, None]/2 + length[:, None]/2*nodes
        points = position + distance[..., None]*rays[idx, None, :]
        hydrogen = evaluate(points)
        phase = 11/12 + rays[idx, 0]**2/4
        np.add.at(result, idx, np.sum(hydrogen*weights, axis=1)*length/2*(RE_KM*1e5)*phase)
    return result


def scattering_rate(irradiance_mw):
    # EXOSpy/Emerich relation: integrated photons cm^-2 s^-1 -> g s^-1.
    flux = irradiance_mw*1e-3 * 121.6e-9 / (6.62607015e-34*299792458) * 1e-4
    return 3.47e-4*(flux/1e11)**1.21


def conservative_mask(valid, x, y):
    """A grid point is valid only if its entire sampling footprint is valid."""
    rx = max(.5, float(x[1]-x[0])/2)
    ry = max(.5, float(y[1]-y[0])/2)
    x0 = np.clip(np.floor(x-rx).astype(int), 0, valid.shape[1])
    x1 = np.clip(np.ceil(x+rx).astype(int)+1, 0, valid.shape[1])
    y0 = np.clip(np.floor(y-ry).astype(int), 0, valid.shape[0])
    y1 = np.clip(np.ceil(y+ry).astype(int)+1, 0, valid.shape[0])
    sums = np.pad((~valid).astype(np.int64), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    count = (sums[y1[:, None], x1] - sums[y0[:, None], x1]
             - sums[y1[:, None], x0] + sums[y0[:, None], x0])
    return count == 0


class ModelOverlays:
    """Per-service bounded caches; one calculation at a time avoids duplicates."""
    def __init__(self, catalogue):
        self.catalogue = catalogue
        self.lock = threading.Lock()
        self.columns = lru_cache(maxsize=24)(self._column)
        self.contours = lru_cache(maxsize=64)(self._contours)

    def get(self, fid, model='Z15MAX', irradiance_mw=6., exclude=True):
        self.catalogue.get(fid)
        if model not in MODELS:
            raise ValueError('Choose Z15MIN or Z15MAX')
        if not np.isfinite(irradiance_mw) or not 1 <= irradiance_mw <= 15:
            raise ValueError('Solar Lyman-alpha irradiance must be 1–15 mW/m²')
        # Check file identity on cache hits too.
        frame = self.catalogue.get(fid)
        stat = self.catalogue.paths[fid].stat()
        if stat.st_size != frame['source_size'] or stat.st_mtime_ns != frame['source_mtime_ns']:
            raise ValueError('Source file changed. Restart the app to refresh the catalogue.')
        with self.lock:
            return self.contours(fid, model, round(irradiance_mw, 3), exclude)

    def _column(self, fid, model):
        frame = self.catalogue.get(fid)
        with NETCDF_LOCK, Dataset(self.catalogue.paths[fid]) as ds:
            ds.set_auto_mask(False)
            geometry = {n: read_array(ds[n], frame['frame_index']) for n in GEOMETRY_NAMES}
        # Crop computation to the shell; use <=0.5-pixel sampling where affordable.
        # Exact ray/sphere intersection, not this generous bounding box, sets validity.
        cx, cy = frame['earth_xy']
        radius = frame['pixels_per_re']*8.5
        h, w = frame['shape']
        def axis(center, size):
            low, high = max(0., center-radius), min(size-1., center+radius)
            return np.linspace(low, high, min(257, max(2, int(np.ceil((high-low)*2))+1)))
        x, y = axis(cx, w), axis(cy, h)
        xx, yy = np.meshgrid(x, y)
        basis = gse_basis(frame)
        rays = pixel_rays(geometry, xx, yy).reshape(-1, 3) @ basis.T
        position = basis @ np.asarray(frame['spacecraft_position_km']) / RE_KM
        started = time.perf_counter()
        column = shell_column(position, rays, model).reshape(xx.shape)
        return x, y, column, time.perf_counter()-started

    def _contours(self, fid, model, irradiance_mw, exclude):
        x, y, column, seconds = self.columns(fid, model)
        raw, fov, interpolation = self.catalogue.read(fid)
        valid = fov & np.isfinite(raw)
        if exclude:
            valid &= ~interpolation
        mask = ~conservative_mask(valid, x, y) | ~np.isfinite(column)
        g = scattering_rate(irradiance_mw)
        brightness = column*g/1e9  # Rayleigh -> kR, phase already included.
        # B approaches zero as sqrt(8-b) near a tangent to the truncated shell.
        # Interpolate B² there: identical level sets, much smaller edge error.
        generator = contourpy.contour_generator(x=x+.5, y=y+.5,
                    z=np.ma.array(brightness**2, mask=mask), corner_mask=False)
        # Clip the whole SVG overlay, including label glyphs and stroke widths,
        # to the same supported cells as the scientific contours. Filled rings
        # preserve inner/outer boundaries and observation-mask holes exactly.
        domain = contourpy.contour_generator(x=x+.5, y=y+.5,
                    z=np.ma.array(np.ones(column.shape), mask=mask),
                    corner_mask=False, fill_type='OuterOffset')
        polygons, offsets = domain.filled(.5, 1.5)
        clip_paths = [np.round(points[start:stop], 4).tolist()
                      for points, rings in zip(polygons, offsets)
                      for start, stop in zip(rings[:-1], rings[1:])]
        contours = []
        for level in [.1, .3, 1., 3., 10., 30.]:
            paths = [np.round(line, 4).tolist() for line in generator.lines(level**2) if len(line) >= 2]
            if paths:
                contours.append(dict(level_kR=level, paths=paths))
        values = brightness[~mask]
        return dict(frame_id=fid, model=model, method=METHOD, units='kR',
                    contours=contours, clip_paths=clip_paths, exclude_interpolated=exclude,
                    irradiance_mw=irradiance_mw, g_factor_s=g,
                    domain_re=[3, 8], outer_treatment='truncated',
                    quantity='Single-scattering brightness contributed by the 3–8 Re shell',
                    valid_grid_points=int(values.size), grid_shape=list(column.shape),
                    brightness_range_kR=[float(values.min()), float(values.max())] if values.size else None,
                    integration_seconds=round(seconds, 4),
                    assumptions=['Fixed reference solar irradiance, not date-matched',
                                 'Inner sightlines below 3 Re omitted; density above 8 Re omitted',
                                 'Geometric Earth shadow; no absorption, multiple scattering or albedo',
                                 'No interplanetary background or instrument point-spread function'])
