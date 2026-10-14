"""Time decoding for the two published Illinois L1C releases.

V1 uses the previously validated filename-date + milliseconds-of-day convention.
V2 declares TT2000 nanoseconds, which must be converted from TT to UTC. Its
Date_Start/Date_End strings follow the unconverted TT coordinate, not UTC.
"""
from datetime import datetime, timezone
import numpy as np


def observation_times(dataset, day):
    variable = dataset['time']
    values = np.asarray(variable[:])
    units = str(getattr(variable, 'units', '')).strip()
    if units == 'ms' and day.startswith('202603'):
        if not np.all(np.isfinite(values)) or np.any(values < 0) or np.any(values >= 86400000):
            raise ValueError('Invalid legacy milliseconds of day')
        base = datetime.strptime(day, '%Y%m%d').replace(tzinfo=timezone.utc)
        return np.rint(base.timestamp() * 1000 + values).astype(np.int64), 'filename date + milliseconds of day (legacy V1)', 'Illinois Data Bank V1'
    if (units != 'nanoseconds since 2000-01-01T12:00:00'
            or getattr(variable, 'TIME_SCALE', None) != 'TT'
            or values.dtype.kind not in 'iu' or np.any(values < 0)):
        raise ValueError('Unsupported L1C time encoding')
    if 'epoch' not in dataset.variables or not np.array_equal(values, dataset['epoch'][:]):
        raise ValueError('L1C time and epoch disagree')
    from astropy.time import Time, TimeDelta
    whole, fraction = np.divmod(values, 1000000000)
    times = Time('2000-01-01T12:00:00', scale='tt') + TimeDelta(whole, fraction * 1e-9, format='sec')
    if len(times):
        for index, key in [(0, 'Date_Start'), (-1, 'Date_End')]:
            if abs((times[index] - Time(getattr(dataset, key), scale='tt')).sec) > 1:
                raise ValueError('L1C time coordinate disagrees with ' + key)
        if any(t[:10].replace('-', '') != day for t in times.tt.isot):
            raise ValueError('L1C time coordinate disagrees with filename date')
    return np.rint(times.utc.unix * 1000).astype(np.int64), 'TT2000 nanoseconds converted to UTC', 'Illinois Data Bank V2'
