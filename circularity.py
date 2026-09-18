"""Full-contour circle departure; threshold sensitivity is not statistical uncertainty."""
import numpy as np
from matplotlib.path import Path as PolygonPath
import contourpy

CIRCULARITY_METHOD = {
    'version': 'circularity-1.0',
    'definition': '100 * RMS radial residual / fitted radius; geometric least-squares circle with a free center',
    'contour': 'Unique closed high-brightness contour enclosing projected Earth; full image, independent of ROI',
    'sampling': '512 points at uniform arc-length intervals on the unrounded contour',
    'smoothing': 'None; calibrated linear brightness with the same validity/interpolation mask as the analysis',
    'levels_kR': [1., 3.],
    'sensitivity_factors': [.95, 1., 1.05],
    'band': 'Min/max departure across the three thresholds, only when all three contours are valid; not a confidence interval',
    'missing': 'Open, missing, ambiguous, unresolved or failed-fit contours are not imputed',
}


def resample_closed(line, count=512):
    """Exclude the repeated end point and duplicate zero-length segments."""
    lengths = np.linalg.norm(np.diff(line, axis=0), axis=1)
    keep = np.r_[True, lengths > 1e-12]
    points = line[keep]
    distance = np.r_[0., np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))]
    if len(points) < 4 or distance[-1] <= 0:
        raise ValueError('Degenerate contour')
    targets = np.linspace(0, distance[-1], count, endpoint=False)
    return np.column_stack([np.interp(targets, distance, points[:, axis]) for axis in (0, 1)])


def fit_circle(points):
    """Minimize geometric radial residuals, then normalize; never minimize residual/R."""
    origin = points.mean(axis=0)
    xy = points-origin
    algebraic, _, rank, _ = np.linalg.lstsq(np.column_stack([2*xy, np.ones(len(xy))]), (xy*xy).sum(axis=1), rcond=None)
    if rank < 3:
        raise ValueError('Degenerate circle fit')
    center = algebraic[:2]
    for _ in range(50):
        delta = center-xy
        radii = np.linalg.norm(delta, axis=1)
        if np.any(radii <= 1e-12):
            raise ValueError('Degenerate circle fit')
        residual = radii-radii.mean()
        jac = delta/radii[:, None]
        jac -= jac.mean(axis=0)
        step, _, rank, _ = np.linalg.lstsq(jac, -residual, rcond=None)
        if rank < 2:
            raise ValueError('Unstable circle fit')
        if np.linalg.norm(step) < 1e-10*max(radii.mean(), 1.):
            break
        cost = float(residual @ residual)
        accepted = False
        for factor in (1., .5, .25, .125, .0625, .03125, .015625):
            candidate = center+factor*step
            rr = np.linalg.norm(xy-candidate, axis=1)
            candidate_cost = float(((rr-rr.mean())**2).sum())
            if candidate_cost <= cost:
                center, accepted = candidate, True
                break
        if not accepted:
            if np.linalg.norm(jac.T @ residual) <= 1e-8*max(cost, 1.):
                break
            raise ValueError('Circle fit did not converge')
    else:
        raise ValueError('Circle fit did not converge')
    radii = np.linalg.norm(xy-center, axis=1)
    radius = float(radii.mean())
    rms = float(np.sqrt(np.mean((radii-radius)**2)))
    center = center+origin
    if not np.isfinite([*center, radius, rms]).all() or radius <= 0:
        raise ValueError('Non-finite circle fit')
    return dict(departure_pct=100*rms/radius, radius_re=radius,
                center_x_re=float(center[0]), center_y_re=float(center[1]),
                center_offset_re=float(np.linalg.norm(center)), rms_re=rms)


def contour_fit(generator, level, frame):
    lines = generator.lines(level)
    candidates = []
    for line in lines:
        if len(line) < 4 or not np.array_equal(line[0], line[-1]):
            continue
        area = .5*np.sum(line[:-1, 0]*line[1:, 1]-line[1:, 0]*line[:-1, 1])
        if area > 0 and PolygonPath(line).contains_point(frame['earth_xy']):
            candidates.append(line)
    if not candidates:
        return dict(status='open_or_missing', departure_pct=None)
    if len(candidates) != 1:
        return dict(status='ambiguous', departure_pct=None)
    line = candidates[0]
    height, width = frame['shape']
    if np.any(line[:, 0] <= 0) or np.any(line[:, 0] >= width-1) or np.any(line[:, 1] <= 0) or np.any(line[:, 1] >= height-1):
        return dict(status='open_or_missing', departure_pct=None)
    try:
        points = (resample_closed(line)-frame['earth_xy'])/frame['pixels_per_re']
        points[:, 1] *= -1
        fit = fit_circle(points)
        if fit['radius_re']*frame['pixels_per_re'] < 2:
            return dict(status='unresolved', departure_pct=None)
        return dict(status='ok', **fit)
    except (ValueError, np.linalg.LinAlgError):
        return dict(status='fit_failed', departure_pct=None)


def circularity_arrays(raw, fov, interpolation, frame, exclude_interpolated=True):
    valid = fov & np.isfinite(raw)
    if exclude_interpolated:
        valid &= ~interpolation
    generator = contourpy.contour_generator(z=np.ma.array(raw/1000., mask=~valid), corner_mask=False, line_type='Separate')
    output = {}
    for level in CIRCULARITY_METHOD['levels_kR']:
        variants = [dict(threshold_kR=level*factor, **contour_fit(generator, level*factor, frame))
                    for factor in CIRCULARITY_METHOD['sensitivity_factors']]
        nominal = variants[1]
        complete_band = all(v['status'] == 'ok' for v in variants)
        values = [v['departure_pct'] for v in variants] if complete_band else []
        output[str(int(level))] = dict(**nominal, sensitivity_low_pct=min(values) if values else None,
                                      sensitivity_high_pct=max(values) if values else None,
                                      variants=variants)
    return output
