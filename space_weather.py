"""Public comparison series. Native timestamps/cadences and missing data are retained."""
from __future__ import annotations
import json
import math
import threading
from calendar import monthrange
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SOURCES = {
    'dst': dict(name='Dst', units='nT', cadence='hourly mean',
                source='WDC for Geomagnetism, Kyoto · provisional Dst',
                source_url='https://wdc.kugi.kyoto-u.ac.jp/dstdir/index.html',
                data_version='provisional',
                interpretation='Hourly means plotted at UTC hour centers (00:30–23:30). Missing values remain gaps.'),
    'symh': dict(name='SYM-H', units='nT', cadence='1 minute',
                 source='WDC Kyoto via NASA CDAWeb · OMNI_HRO_1MIN',
                 source_url='https://cdaweb.gsfc.nasa.gov/misc/NotesO.html#OMNI_HRO_1MIN'),
    'lyman': dict(name='Solar Lyman-alpha', units='mW/m²', cadence='daily mean',
                  source='LASP LISIRD · Composite Solar Lyman-alpha',
                  source_url='https://lasp.colorado.edu/lisird/data/composite_lyman_alpha',
                  interpretation='Solar irradiance at 1 AU; timestamps are daily record centers. W/m² multiplied by 1000 to show mW/m².'),
}


def parse_dst(payload, month):
    """Kyoto WDC-like records: base in 100 nT plus 24 hourly values in nT.

    Format: https://wdc.kugi.kyoto-u.ac.jp/dstae/format/dstformat.html
    The first value covers 00:00–01:00 UTC; plot each mean at its hour center.
    Provisional monthly files must contain one complete record per calendar day.
    """
    rows, days = [], set()
    for line in payload.splitlines():
        if not line.strip():
            continue
        if line.startswith('[Created at ') and line.endswith(']'):
            continue  # Kyoto appends a generation-time footer after the records.
        if (len(line) != 120 or line[:3] != 'DST' or line[7] != '*'
                or line[12:14] != 'X1'):
            raise ValueError('Invalid provisional Kyoto Dst record')
        year = int(line[14:16].strip() or '19') * 100 + int(line[3:5])
        date = datetime(year, int(line[5:7]), int(line[8:10]), tzinfo=timezone.utc)
        if (date.year, date.month) != (month.year, month.month) or date.day in days:
            raise ValueError('Unexpected or duplicate Kyoto Dst date')
        days.add(date.day)
        base = int(line[16:20]) * 100
        for hour in range(24):
            value = int(line[20 + hour*4:24 + hour*4])
            timestamp = date + timedelta(hours=hour, minutes=30)
            rows.append(dict(x=int(timestamp.timestamp()*1000),
                             y=None if value == 9999 else base + value))
        int(line[116:120])  # Validate, but do not plot the daily-mean field.
    if days != set(range(1, monthrange(month.year, month.month)[1] + 1)):
        raise ValueError('Incomplete Kyoto Dst month')
    return sorted(rows, key=lambda row: row['x'])


def parse_symh(payload):
    if payload.get('status', {}).get('code') not in (1200, 1201):
        raise ValueError('CDAWeb did not return a valid data response')
    parameters = payload.get('parameters', [])
    i = next(i for i, p in enumerate(parameters) if p['name'] == 'SYM_H')
    fill = float(parameters[i].get('fill') or 99999)
    rows = []
    for row in payload.get('data', []):
        value = float(row[i])
        timestamp = datetime.fromisoformat(row[0].replace('Z', '+00:00'))
        rows.append(dict(x=int(timestamp.timestamp()*1000), y=value if math.isfinite(value) and value != fill else None))
    return rows


def parse_lyman(payload):
    dataset = payload['composite_lyman_alpha']
    names = dataset['parameters']
    ti, vi = names.index('time'), names.index('irradiance')
    fill = float(dataset['metadata']['irradiance']['missing_value'])
    if dataset['metadata']['irradiance']['units'] != 'W/m^2':
        raise ValueError('Unrecognized LISIRD irradiance units')
    if dataset['metadata']['time']['units'] != 'milliseconds since 1970-01-01':
        raise ValueError('Unrecognized LISIRD timestamp units')
    return [dict(x=int(row[ti]), y=float(row[vi])*1000 if math.isfinite(float(row[vi])) and float(row[vi]) > 0 and float(row[vi]) != fill else None)
            for row in dataset.get('data', [])]


class SpaceWeather:
    def __init__(self, cache: Path):
        self.cache = cache
        self.locks = {kind: threading.Lock() for kind in SOURCES}

    def series(self, kind, start, end):
        if kind not in SOURCES:
            raise ValueError('Choose dst, symh or lyman')
        start_date = datetime.strptime(start, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        end_date = datetime.strptime(end, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        if not 0 <= (end_date-start_date).days <= 62:
            raise ValueError('Select a comparison interval of at most 63 days')
        months = []
        current = start_date.replace(day=1)
        while current <= end_date:
            months.append(current)
            current = (current.replace(day=28)+timedelta(days=4)).replace(day=1)
        combined, errors, timestamps, urls = [], [], [], []
        stale = False
        for month in months:
            with self.locks[kind]:
                data = self._month(kind, month)
            combined.extend(data['data'])
            if data.get('error'): errors.append(data['error'])
            if data.get('fetched_at'): timestamps.append(data['fetched_at'])
            if data.get('request_url'): urls.append(data['request_url'])
            stale |= data.get('stale', False)
        lo, hi = start_date.timestamp()*1000, (end_date+timedelta(days=1)).timestamp()*1000
        rows = sorted((r for r in combined if lo <= r['x'] < hi), key=lambda r:r['x'])
        return dict(**SOURCES[kind], kind=kind, data=rows, stale=stale,
                    status='available' if any(r['y'] is not None for r in rows) else 'unavailable',
                    error='; '.join(errors) or None, fetched_at=min(timestamps) if timestamps else None,
                    request_urls=urls, start=start, end=end)

    def _month(self, kind, month):
        next_month = (month.replace(day=28)+timedelta(days=4)).replace(day=1)
        path = self.cache / f'{kind}-{month:%Y-%m}.json'
        old = None
        if path.is_file():
            try:
                old = json.loads(path.read_text())
                if datetime.now(timezone.utc).timestamp()-path.stat().st_mtime < 86400:
                    return old
            except (ValueError, OSError):
                pass
        if kind == 'dst':
            url = (f'https://wdc.kugi.kyoto-u.ac.jp/dst_provisional/{month:%Y%m}/'
                   f'dst{month:%y%m}.for.request')
        elif kind == 'symh':
            url = 'https://cdaweb.gsfc.nasa.gov/hapi/data?' + urlencode(dict(
                id='OMNI_HRO_1MIN', parameters='SYM_H', **{'time.min':month.strftime('%Y-%m-%dT00:00:00Z'),
                'time.max':next_month.strftime('%Y-%m-%dT00:00:00Z')}, format='json'))
        else:
            url = 'https://lasp.colorado.edu/lisird/latis/dap/composite_lyman_alpha.jsond?' + urlencode({
                'time>':month.strftime('%Y-%m-%d'), 'time<':next_month.strftime('%Y-%m-%d')})
        try:
            with urlopen(Request(url, headers={'User-Agent':'Carruthers-CEDA/1.0'}), timeout=30) as response:
                if kind == 'dst':
                    rows = parse_dst(response.read().decode('ascii'), month)
                else:
                    payload = json.load(response)
                    rows = parse_symh(payload) if kind == 'symh' else parse_lyman(payload)
            result = dict(data=rows, request_url=url, fetched_at=datetime.now(timezone.utc).isoformat())
            self.cache.mkdir(parents=True, exist_ok=True)
            temp = path.with_suffix('.tmp')
            temp.write_text(json.dumps(result, allow_nan=False))
            temp.replace(path)
            return result
        except Exception as exc:
            message = f'{SOURCES[kind]["name"]} source unavailable ({type(exc).__name__}); ' + ('showing cached observations.' if old else 'no values substituted.')
            return dict(**(old or {'data':[]}), stale=bool(old), error=message)
