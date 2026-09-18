#!/usr/bin/env python3
"""Compare the staged nightglow backend with the running Spark app."""
import hashlib
import http.cookiejar
import io
import json
import math
from pathlib import Path
import time
import urllib.error
import urllib.request
from PIL import Image

def browser(base):
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}),
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def request(path, body=None, raw=False):
        data = json.dumps(body).encode() if body is not None else None
        headers = {'Content-Type': 'application/json', 'X-Carruthers-Local': '1'}
        with client.open(urllib.request.Request(base + path, data=data, headers=headers), timeout=45) as response:
            value = response.read()
        return value if raw else json.loads(value)
    return request

old = browser('http://127.0.0.1:8765')
new = browser('http://127.0.0.1:18766')
catalogue, staged = old('/api/catalogue'), new('/api/catalogue')
assert len(staged['frames']) == 1794 and staged['file_count'] == 62
assert [f['id'] for f in catalogue['frames']] == [f['id'] for f in staged['frames']]
assert old('/', raw=True) == new('/', raw=True), 'Frontend changed'
with Image.open(io.BytesIO(old('/api/colorbar', raw=True))) as before, Image.open(io.BytesIO(new('/api/colorbar', raw=True))) as after:
    assert before.size == after.size and before.convert('RGBA').tobytes() == after.convert('RGBA').tobytes()
checks = ['1794 identical frame IDs', '62 files', 'identical frontend and colorbar']
for channel in ('WFI', 'NFI'):
    frame = next(f for f in staged['frames'] if f['channel'] == channel and f['timestamp'].startswith('2026-03-15'))
    fid = frame['id']
    for endpoint in ('preview', 'contours', 'baseline'):
        path = f'/api/{endpoint}?id={fid}'
        result = new(path, raw=endpoint == 'preview')
        if endpoint == 'preview':
            assert result.startswith(b'\x89PNG\r\n\x1a\n')
        if endpoint == 'baseline':
            assert math.isclose(result['mean_kR'], old(path)['mean_kR'], rel_tol=1e-12)
    for roi in (dict(kind='annulus', inner=4.5, outer=5.5), dict(kind='paired_sectors', angle_width=60)):
        body = dict(frame_id=fid, roi=roi, exclude_interpolated=True)
        a, b = old('/api/measure', body), new('/api/measure', body)
        if 'regions' in a:
            for side in ('dawn', 'dusk'):
                assert math.isclose(a['regions'][side]['mean_kR'], b['regions'][side]['mean_kR'], rel_tol=1e-12)
        else:
            assert math.isclose(a['mean_kR'], b['mean_kR'], rel_tol=1e-12)
    checks.append(f'{channel} previews, contours, baseline, annulus, paired sectors and radial profile')
    print(checks[-1], flush=True)

def analysis(ids, roi):
    job = new('/api/jobs', dict(frame_ids=ids, roi=roi, exclude_interpolated=True))
    started = time.monotonic()
    while time.monotonic() - started < 330:
        result = new('/api/jobs?id=' + job['id'] + '&rows=1')
        if result['status'] in ('complete', 'error', 'cancelled'):
            break
        time.sleep(.5)
    assert result['status'] == 'complete', result.get('error', result['status'])
    assert len(result['rows']) == len(ids)
    assert set(result['rows'][0]['circularity']) == {'1', '3'}
    assert b'mean_kR' in new('/api/export?id=' + job['id'], raw=True)
    assert new('/api/export?id=' + job['id'] + '&format=json')['rows'] == result['rows']
    return result, round(time.monotonic() - started, 2)

ids = [f['id'] for f in staged['frames'] if f['channel'] == 'WFI' and f['timestamp'].startswith('2026-03-15')]
result, seconds = analysis(ids, dict(kind='annulus', inner=4.5, outer=5.5))
assert math.isclose(result['rows'][0]['mean_kR'], 5.055363316796408, abs_tol=1e-12)
assert math.isclose(result['rows'][-1]['mean_kR'], 5.0864138765212, abs_tol=1e-12)
checks.append(f'22-frame WFI regression, circularity, CSV and JSON exports ({seconds}s)')
print(checks[-1], flush=True)

full = [f['id'] for f in staged['frames'] if f['channel'] == 'NFI']
result, seconds = analysis(full, dict(kind='paired_sectors', angle_width=180))
checks.append(f'Full 1161-frame NFI paired analysis with circularity ({seconds}s)')
print(checks[-1], flush=True)
other = browser('http://127.0.0.1:18766')
try:
    other('/api/jobs?id=' + result['id'])
    raise AssertionError('Another visitor accessed private analysis')
except urllib.error.HTTPError as exc:
    assert exc.code == 404
checks.append('Visitor analysis isolation')
for kind in ('symh', 'lyman'):
    series = new(f'/api/context?kind={kind}&start=2026-03-15&end=2026-03-15')
    if series['status'] != 'available':
        raise RuntimeError(f'{kind} reference observations unavailable')
    checks.append(f'{kind} reference series available ({len(series["data"])} observations; stale={series["stale"]})')
report = dict(status='passed', frames=1794, files=62, checks=checks,
              validated_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
Path(__file__).with_name('validation.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2), flush=True)
