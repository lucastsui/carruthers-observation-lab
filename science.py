"""Array measurements for the local Carruthers March 2026 v1.3 demo.

No recentering, smoothing, log transform or display clipping enters measurements.
Coordinates are projected offsets in Earth radii; +x is right, +y is up.
"""
from __future__ import annotations
import hashlib
import io
import math
import re
import threading
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from pathlib import Path
import numpy as np
from matplotlib import colormaps
from netCDF4 import Dataset
from PIL import Image

RE_KM = 6370.0
METHOD_VERSION = 'carruthers-local-1.2'
SCALES = {'WFI': [1.0, math.log10(270000)], 'NFI': [3.0, math.log10(270000)]}  # log10(R); 270 kR display ceiling.
NETCDF_LOCK = threading.RLock()  # netCDF/HDF5 libraries are not thread-safe.
GEOMETRY_NAMES = ['spacecraft_position', 'spacecraft_attitude', 'cam_attitude',
                  'cam_focal_length', 'cam_ctr', 'cam_skew']


def rotation(q):
    q = np.asarray(q, dtype=float)
    if q.shape != (4,) or not np.all(np.isfinite(q)) or not np.isclose(np.linalg.norm(q), 1):
        raise ValueError('Expected a finite unit quaternion')
    x, y, z, w = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                     [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                     [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])


def earth_geometry(g):
    pos = g['spacecraft_position']
    focal, ctr, skew = g['cam_focal_length'], g['cam_ctr'], float(g['cam_skew'])
    direction = rotation(g['cam_attitude']).T @ rotation(g['spacecraft_attitude']).T @ -pos
    distance = np.linalg.norm(pos)
    if not np.all(np.isfinite(np.r_[direction, focal, ctr, skew, distance])) or distance <= 0 or direction[2] == 0:
        raise ValueError('Invalid camera geometry')
    if not np.allclose(np.abs(focal), abs(focal[0])) or focal[0] == 0 or not np.isclose(skew, 0):
        raise ValueError('This demo requires equal focal scales and zero skew')
    xn, yn = direction[:2] / direction[2]
    xy = ctr + [focal[0]*xn + skew*yn, focal[1]*yn]
    return [float(x) for x in xy], float(abs(focal[0])*RE_KM/distance)


def image_plane_geometry(g, shape):
    """Intersect calibrated pixel rays with the plane through Earth normal to its sightline.

    Corners follow top-left, top-right, bottom-right, bottom-left raster edges.
    Coordinates are GCRS Earth radii, without a second image translation.
    """
    position = np.asarray(g['spacecraft_position'], dtype=float)
    normal = position / np.linalg.norm(position)
    attitude = rotation(g['spacecraft_attitude']) @ rotation(g['cam_attitude'])
    fx, fy = g['cam_focal_length']
    cx, cy = g['cam_ctr']
    height, width = shape
    corners = []
    for col, row in [(-.5, -.5), (width-.5, -.5), (width-.5, height-.5), (-.5, height-.5)]:
        yn = (row-cy)/fy
        ray = attitude @ np.array([(col-cx-float(g['cam_skew'])*yn)/fx, yn, 1.])
        denominator = np.dot(ray, normal)
        if abs(denominator) < 1e-9:
            raise ValueError('Image ray is parallel to the Earth plane')
        point = position - np.dot(position, normal)/denominator * ray
        corners.append((point / RE_KM).tolist())
    return dict(spacecraft_position_km=position.tolist(), image_plane_corners_re=corners)


def read_array(var, index=slice(None)):
    a = np.array(var[index])
    if a.dtype.kind == 'f':
        for key in ('_FillValue', 'missing_value'):
            value = getattr(var, key, None)
            if value is not None:
                for sentinel in np.asarray(value).flat:
                    if np.isfinite(sentinel):
                        a[a == sentinel] = np.nan
    return a


class Catalogue:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.frames, self.by_id, self.paths, self.skipped = [], {}, {}, []
        total_bytes = 0
        for path in sorted(self.root.rglob('CARRUTHERS_GCI-*_L1C_*_v*.nc')):
            match = re.fullmatch(r'CARRUTHERS_GCI-(WFI|NFI)_L1C_(\d{8})_(v[^.]+\.[^.]+)\.nc', path.name)
            if not match:
                continue
            channel, day, version = match.groups()
            if version != 'v1.3' or not day.startswith('202603'):
                self.skipped.append({'file': path.name, 'reason': 'Geometry validated for March 2026 v1.3 only'})
                continue
            stat = path.stat()
            source = str(path.relative_to(self.root))
            fingerprint = hashlib.sha256(f'{source}:{stat.st_size}:{stat.st_mtime_ns}'.encode()).hexdigest()[:16]
            with NETCDF_LOCK, Dataset(path) as ds:
                ds.set_auto_mask(False)
                times = read_array(ds['time'])
                geometry = {n: read_array(ds[n]) for n in GEOMETRY_NAMES}
                headers = read_array(ds['earth_loc'])
                flags = {n: read_array(v) for n, v in ds.variables.items() if n.startswith('flag_')}
                exposure = read_array(ds['t_int'])
                shape = list(ds['images'].shape[1:])
                data_version = str(getattr(ds, 'Data_version', version))
            base = datetime.strptime(day, '%Y%m%d').replace(tzinfo=timezone.utc)
            for i, ms in enumerate(times):
                xy, ppre = earth_geometry({n: v[i] for n, v in geometry.items()})
                timestamp = (base + timedelta(milliseconds=float(ms))).isoformat(timespec='seconds').replace('+00:00', 'Z')
                fid = f'{fingerprint}-{i}'
                frame = dict(id=fid, channel=channel, timestamp=timestamp, epoch_ms=int(base.timestamp()*1000+float(ms)),
                             source=source, source_size=stat.st_size, source_mtime_ns=stat.st_mtime_ns,
                             source_fingerprint=fingerprint, version=version, producer_data_version=data_version,
                             frame_index=i, shape=shape, earth_xy=xy, pixels_per_re=ppre,
                             header_earth_xy=[float(x) for x in headers[i]], exposure_s=float(exposure[i]),
                             **image_plane_geometry({n: v[i] for n, v in geometry.items()}, shape),
                             flags={n: int(v[i]) if np.isfinite(v[i]) else None for n, v in flags.items()})
                self.frames.append(frame)
                self.by_id[fid] = frame
                self.paths[fid] = path
            total_bytes += stat.st_size
        self.frames.sort(key=lambda x: (x['epoch_ms'], x['channel']))
        # Analytic ERFA solar ephemeris in GCRS; no external downloads are needed.
        from astropy.coordinates import get_sun
        from astropy.time import Time
        if self.frames:
            times = Time([f['epoch_ms']/1000 for f in self.frames], format='unix', scale='utc')
            positions = get_sun(times).cartesian.xyz.to_value('km').T
            for frame, sun in zip(self.frames, positions):
                frame['sun_position_km'] = sun.tolist()
        self.total_bytes = total_bytes
        self.file_count = len(set(self.paths.values()))
        self.preview_cache = OrderedDict()
        self.cache_bytes = 0
        self.cache_lock = threading.Lock()

    def public(self):
        return dict(frames=self.frames, file_count=self.file_count, bytes=self.total_bytes,
                    scales=SCALES, method_version=METHOD_VERSION, skipped=self.skipped)

    def get(self, fid):
        if fid not in self.by_id:
            raise ValueError('Unknown frame')
        return self.by_id[fid]

    def read(self, fid, interpolation=True):
        frame = self.get(fid)
        path = self.paths[fid]
        stat = path.stat()
        if stat.st_size != frame['source_size'] or stat.st_mtime_ns != frame['source_mtime_ns']:
            raise ValueError('Source file changed. Restart the app to refresh the catalogue.')
        with NETCDF_LOCK, Dataset(path) as ds:
            ds.set_auto_mask(False)
            raw = read_array(ds['images'], frame['frame_index']).astype(float, copy=False)
            fov = read_array(ds['mask_fov']) == 1
            interp = read_array(ds['mask_interpolation'], frame['frame_index']) != 0 if interpolation else None
        return raw, fov, interp

    def preview(self, fid, low, high):
        if not np.isfinite([low, high]).all() or not (-3 <= low < high <= 9):
            raise ValueError('Display limits must satisfy -3 ≤ minimum < maximum ≤ 9 log10(R)')
        key = (fid, low, high)
        with self.cache_lock:
            if key in self.preview_cache:
                self.preview_cache.move_to_end(key)
                return self.preview_cache[key]
        raw, fov, _ = self.read(fid, interpolation=False)
        valid = fov & np.isfinite(raw) & (raw > 0)
        scaled = np.zeros(raw.shape)
        scaled[valid] = np.clip((np.log10(raw[valid])-low)/(high-low), 0, 1)
        rgba = colormaps['gist_heat'](scaled, bytes=True)
        rgba[~valid] = [8, 14, 21, 255]
        out = io.BytesIO()
        Image.fromarray(rgba).save(out, format='PNG', compress_level=1)
        result = out.getvalue()
        with self.cache_lock:
            if key not in self.preview_cache:
                self.preview_cache[key] = result
                self.cache_bytes += len(result)
                while self.cache_bytes > 64*1024*1024:
                    _, old = self.preview_cache.popitem(last=False)
                    self.cache_bytes -= len(old)
        return result


def validate_roi(value):
    if not isinstance(value, dict):
        raise ValueError('Selection must be a JSON object')
    kind = value.get('kind')
    fields = {'annulus': ('inner', 'outer'), 'sector': ('inner', 'outer', 'angle_start', 'angle_end'),
              'paired_sectors': ('angle_width',),
              'rectangle': ('x1', 'x2', 'y1', 'y2'), 'point': ('x', 'y')}
    if kind not in fields:
        raise ValueError('Choose annulus, sector, paired sectors, rectangle or point')
    roi = {'kind': kind}
    for name in fields[kind]:
        v = float(value.get(name, float('nan')))
        if not math.isfinite(v) or abs(v) > 1000:
            raise ValueError(f'Invalid selection value: {name}')
        roi[name] = v
    if kind in ('annulus', 'sector') and not 0 <= roi['inner'] < roi['outer'] <= 100:
        raise ValueError('Radii must satisfy 0 ≤ inner < outer ≤ 100 Earth radii')
    if kind == 'sector' and not 0 < roi['angle_end']-roi['angle_start'] <= 360:
        raise ValueError('Sector end must be greater than start, spanning at most 360°')
    if kind == 'paired_sectors' and not 1 <= roi['angle_width'] <= 180:
        raise ValueError('Shared opening angle must be between 1° and 180°')
    if kind == 'rectangle' and not (roi['x1'] < roi['x2'] and roi['y1'] < roi['y2']):
        raise ValueError('Rectangle minimum coordinates must be below maximum coordinates')
    return roi


def coordinates(frame):
    rows, cols = np.ogrid[:frame['shape'][0], :frame['shape'][1]]
    cx, cy = frame['earth_xy']
    scale = frame['pixels_per_re']
    return (cols-cx)/scale, (cy-rows)/scale


def paired_sectors(roi, frame):
    # Extend beyond every pixel center; only the angular bounds select the pies.
    cx, cy = frame['earth_xy']
    height, width = frame['shape']
    radius = (math.hypot(max(abs(cx), abs(width-1-cx)), max(abs(cy), abs(height-1-cy))) + 1) / frame['pixels_per_re']
    return {name: dict(kind='sector', inner=0, outer=radius,
                       angle_start=center-roi['angle_width']/2, angle_end=center+roi['angle_width']/2)
            for name, center in [('dawn', 180), ('dusk', 0)]}


def selection_mask(frame, roi):
    if roi['kind'] == 'paired_sectors':
        dawn, dusk = paired_masks(frame, roi).values()
        return dawn | dusk
    x, y = coordinates(frame)
    if roi['kind'] in ('annulus', 'sector'):
        r = np.hypot(x, y)
        mask = (r >= roi['inner']) & (r < roi['outer'])
        if roi['kind'] == 'sector':
            angle = np.degrees(np.arctan2(y, x))
            mask &= ((angle-roi['angle_start']) % 360) < roi['angle_end']-roi['angle_start']
        return mask
    if roi['kind'] == 'rectangle':
        return (x >= roi['x1']) & (x < roi['x2']) & (y >= roi['y1']) & (y < roi['y2'])
    mask = np.zeros(frame['shape'], dtype=bool)
    col = int(np.floor(roi['x']*frame['pixels_per_re']+frame['earth_xy'][0]+0.5))
    row = int(np.floor(frame['earth_xy'][1]-roi['y']*frame['pixels_per_re']+0.5))
    if 0 <= row < mask.shape[0] and 0 <= col < mask.shape[1]:
        mask[row, col] = True
    return mask


def paired_masks(frame, roi):
    # The raster supplies the extent. Compute each pixel's angle just once.
    x, y = coordinates(frame)
    angle = np.degrees(np.arctan2(y, x))
    half = roi['angle_width']/2
    # Direct bounds avoid modulo rounding tiny negative offsets up to 360°.
    return {'dawn': (angle >= 180-half) | (angle < -180+half),
            'dusk': (angle >= -half) & (angle < half)}


def measure_selected(raw, fov, interpolation, selected, exclude_interpolated):
    valid = selected & fov & np.isfinite(raw)
    if exclude_interpolated:
        valid &= ~interpolation
    values = raw[valid] / 1000.0
    count, total = int(valid.sum()), int(selected.sum())
    return dict(mean_kR=float(values.mean()) if count else None,
                median_kR=float(np.median(values)) if count else None,
                spatial_std_kR=float(values.std()) if count else None,
                valid_pixels=count, selected_pixels=total,
                coverage=count/total if total else 0.0,
                nonpositive_pixels=int((values <= 0).sum()))


def measure_arrays(raw, fov, interpolation, frame, roi, exclude_interpolated=True):
    if roi['kind'] == 'paired_sectors':
        masks = paired_masks(frame, roi)
        result = measure_selected(raw, fov, interpolation, masks['dawn'] | masks['dusk'], exclude_interpolated)
        result['regions'] = {name: measure_selected(raw, fov, interpolation, mask, exclude_interpolated)
                             for name, mask in masks.items()}
        return result
    return measure_selected(raw, fov, interpolation, selection_mask(frame, roi), exclude_interpolated)


def radial_profile(raw, fov, interpolation, frame, exclude_interpolated):
    x, y = coordinates(frame)
    radius = np.hypot(x, y)
    maximum = 40.0 if frame['channel'] == 'WFI' else 8.0
    edges = np.linspace(0, maximum, 81)
    valid = fov & np.isfinite(raw) & (radius < maximum)
    if exclude_interpolated:
        valid &= ~interpolation
    bins = np.clip(np.searchsorted(edges, radius, side='right')-1, 0, 79)
    count = np.bincount(bins[valid], minlength=80)
    sums = np.bincount(bins[valid], weights=raw[valid]/1000.0, minlength=80)
    totals = np.bincount(bins[radius < maximum], minlength=80)
    return [dict(radius_re=float((edges[i]+edges[i+1])/2), inner_re=float(edges[i]), outer_re=float(edges[i+1]),
                 mean_kR=float(sums[i]/count[i]) if count[i] else None,
                 valid_pixels=int(count[i]), selected_pixels=int(totals[i]), coverage=float(count[i]/totals[i]) if totals[i] else 0.)
            for i in range(80)]


def frame_baseline(catalogue, fid, exclude_interpolated=True):
    frame = catalogue.get(fid)
    raw, fov, interpolation = catalogue.read(fid)
    valid = fov & np.isfinite(raw)
    if exclude_interpolated:
        valid &= ~interpolation
    values = raw[valid] / 1000.
    return dict(frame_id=fid, timestamp=frame['timestamp'], channel=frame['channel'],
                mean_kR=float(values.mean()) if values.size else None, valid_pixels=int(values.size),
                exclude_interpolated=exclude_interpolated,
                definition='Mean of all valid FOV pixels in the first frame of the selected camera and interval; independent of ROI')


def radiance_contours(catalogue, fid, exclude_interpolated=True):
    import contourpy
    raw, fov, interpolation = catalogue.read(fid)
    valid = fov & np.isfinite(raw)
    if exclude_interpolated:
        valid &= ~interpolation
    generator = contourpy.contour_generator(z=np.ma.array(raw/1000., mask=~valid), corner_mask=False)
    levels = [1., 3., 10., 30., 60., 100., 200., 270.]
    contours = []
    for level in levels:
        paths = [np.round(line + .5, 3).tolist() for line in generator.lines(level) if len(line) >= 2]
        if paths:
            contours.append(dict(level_kR=level, paths=paths))
    return dict(frame_id=fid, contours=contours, units='kR', exclude_interpolated=exclude_interpolated)


def measure_frame(catalogue, fid, roi, exclude_interpolated=True, profile=False, include_circularity=False):
    frame = catalogue.get(fid)
    raw, fov, interp = catalogue.read(fid)
    result = dict(frame_id=fid, timestamp=frame['timestamp'], epoch_ms=frame['epoch_ms'],
                  source=frame['source'], source_fingerprint=frame['source_fingerprint'],
                  frame_index=frame['frame_index'], channel=frame['channel'], version=frame['version'],
                  earth_xy=frame['earth_xy'], pixels_per_re=frame['pixels_per_re'],
                  exposure_s=frame['exposure_s'], flags=frame['flags'],
                  method_version=METHOD_VERSION, exclude_interpolated=exclude_interpolated,
                  **measure_arrays(raw, fov, interp, frame, roi, exclude_interpolated))
    if include_circularity:
        from circularity import circularity_arrays
        result['circularity'] = circularity_arrays(raw, fov, interp, frame, exclude_interpolated)
    if profile:
        result['profile'] = radial_profile(raw, fov, interp, frame, exclude_interpolated)
    return result
