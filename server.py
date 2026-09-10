#!/usr/bin/env python3
"""Loopback-only Carruthers app. Serves built UI and reads local NetCDF frames."""
from __future__ import annotations
import argparse
import csv
import io
import json
import mimetypes
import os
import threading
import traceback
import uuid
from functools import lru_cache
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import numpy as np
from matplotlib import colormaps
from PIL import Image
from science import Catalogue, METHOD_VERSION, measure_frame, validate_roi, frame_baseline, radiance_contours
from space_weather import SpaceWeather
from circularity import CIRCULARITY_METHOD

BASE = Path(__file__).resolve().parent
DEFAULT_DATA = BASE.parent / 'code and data' / 'L1C'
METHOD = {
    'circularity': CIRCULARITY_METHOD,
    'version': METHOD_VERSION, 'input': 'L1C calibrated numeric arrays',
    'units': 'kR = stored Rayleighs / 1000; no additional 4π conversion',
    'geometry': 'Registered camera quaternion projection; no image translation; near-nadir focal length / spacecraft distance',
    'coordinates': 'Projected Earth radii, 6370 km; x right, y up; source row 0 at top; half-open selection bounds',
    'time': 'Filename UTC date plus time in milliseconds of day; reported time is not relabelled as exposure midpoint',
    'mask': 'Finite image values inside mask_fov; optional exclusion of mask_interpolation; finite negative values retained',
    'uncertainty': 'Image uncertainty definition is unvalidated; spatial_std_kR is pixel dispersion, not an uncertainty on the mean',
    'interpretation': 'Line-of-sight brightness, not local hydrogen density; exploratory measurements',
    'coverage': 'Valid / selected pixel centers within the raster; does not count region portions outside the raster',
    'paired_sectors': 'Dawn centered at 180 degrees (image left), dusk at 0 degrees (image right); filled pies from Earth center to the raster edges, equal opening angles. regions contains separate statistics; top-level statistics describe their union.',
    'fingerprint': 'Source path, size and mtime identifier, not a cryptographic checksum of file contents',
}


def json_bytes(obj):
    return json.dumps(obj, allow_nan=False, ensure_ascii=False).encode()


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


class JobManager:
    def __init__(self, catalogue, local_dir):
        self.catalogue, self.local_dir = catalogue, local_dir
        self.jobs = {}
        self.lock = threading.RLock()

    def start(self, body):
        ids = body.get('frame_ids', [])
        if not isinstance(ids, list) or not ids or len(ids) > 5000 or len(set(ids)) != len(ids):
            raise ValueError('Select 1–5000 distinct frames')
        frames = [self.catalogue.get(fid) for fid in ids]
        if len({f['channel'] for f in frames}) != 1:
            raise ValueError('Measure one camera at a time')
        frames.sort(key=lambda f: f['epoch_ms'])
        roi = validate_roi(body.get('roi', {}))
        exclude = body.get('exclude_interpolated', True)
        if not isinstance(exclude, bool):
            raise ValueError('exclude_interpolated must be a boolean')
        with self.lock:
            if any(j['status'] in ('queued', 'running', 'cancelling') for j in self.jobs.values()):
                raise ValueError('An extraction is already running. Wait or cancel it first.')
            while len(self.jobs) >= 12:
                del self.jobs[next(iter(self.jobs))]
            jid = uuid.uuid4().hex
            recipe = dict(roi=roi, exclude_interpolated=exclude, channel=frames[0]['channel'],
                          frame_ids=[f['id'] for f in frames], start=frames[0]['timestamp'], end=frames[-1]['timestamp'])
            self.jobs[jid] = dict(id=jid, status='queued', completed=0, total=len(frames), recipe=recipe,
                                  created_at=utc_now(), rows=[], method=METHOD, cancel=False,
                                  baseline=frame_baseline(self.catalogue, frames[0]['id'], exclude))
        threading.Thread(target=self._run, args=(jid,), daemon=True).start()
        return self.status(jid)

    def _run(self, jid):
        try:
            with self.lock:
                job = self.jobs[jid]
                job['status'] = 'running'
                recipe = job['recipe']
            for fid in recipe['frame_ids']:
                with self.lock:
                    if job['cancel']:
                        job['status'] = 'cancelled'
                        return
                row = measure_frame(self.catalogue, fid, recipe['roi'], recipe['exclude_interpolated'], include_circularity=True)
                with self.lock:
                    job['rows'].append(row)
                    job['completed'] += 1
            with self.lock:
                job['status'] = 'cancelled' if job['cancel'] else 'complete'
        except Exception as exc:
            traceback.print_exc()
            with self.lock:
                self.jobs[jid].update(status='error', error=str(exc))

    def status(self, jid, rows=False):
        with self.lock:
            if jid not in self.jobs:
                raise ValueError('This extraction is no longer in memory. Load a saved analysis or extract again.')
            return json.loads(json_bytes({k: v for k, v in self.jobs[jid].items() if k != 'cancel' and (rows or k != 'rows')}))

    def cancel(self, jid):
        with self.lock:
            if jid not in self.jobs:
                raise ValueError('Unknown extraction')
            job = self.jobs[jid]
            if job['status'] in ('queued', 'running'):
                job.update(cancel=True, status='cancelling')
        return self.status(jid)

    def save(self, jid, title):
        result = self.status(jid, rows=True)
        if result['status'] != 'complete':
            raise ValueError('Only completed extractions can be saved')
        result.update(title=str(title or f"{result['recipe']['channel']} · {result['recipe']['start'][:10]} · {result['recipe']['roi']['kind']}")[:160], saved_at=utc_now())
        self.local_dir.mkdir(parents=True, exist_ok=True)
        destination = self.local_dir / f'{jid}.json'
        temp = self.local_dir / f'.{jid}.{uuid.uuid4().hex}.tmp'
        temp.write_bytes(json_bytes(result))
        os.chmod(temp, 0o600)
        temp.replace(destination)
        return dict(id=jid, title=result['title'], saved_at=result['saved_at'])

    def saved(self):
        out = []
        for path in sorted(self.local_dir.glob('*.json'), reverse=True):
            try:
                v = json.loads(path.read_text())
                out.append({k: v[k] for k in ('id', 'title', 'saved_at', 'recipe')})
            except (ValueError, KeyError):
                continue
        return sorted(out, key=lambda v: v['saved_at'], reverse=True)

    def load(self, jid):
        if not isinstance(jid, str) or len(jid) != 32 or any(c not in '0123456789abcdef' for c in jid):
            raise ValueError('Invalid saved analysis ID')
        path = self.local_dir / f'{jid}.json'
        if not path.is_file():
            raise ValueError('Saved analysis not found')
        return json.loads(path.read_text())


def export_csv(result):
    rows = result['rows']
    out = io.StringIO(newline='')
    names = ['timestamp_utc', 'channel', 'mean_kR', 'median_kR', 'spatial_std_kR', 'valid_pixels', 'selected_pixels',
             'coverage', 'nonpositive_pixels', 'source', 'source_fingerprint', 'frame_index', 'data_version',
             'earth_x_pixel', 'earth_y_pixel', 'pixels_per_re', 'exposure_s', 'exclude_interpolated', 'roi_json', 'method_version', 'flags_json', 'baseline_mean_kR', 'baseline_frame_id']
    paired = result['recipe']['roi']['kind'] == 'paired_sectors'
    if paired:
        names.insert(2, 'region')
    writer = csv.DictWriter(out, fieldnames=names)
    writer.writeheader()
    export_rows = [dict(row, region=name, **stats) for row in rows for name, stats in row['regions'].items()] if paired else rows
    for row in export_rows:
        mapped = {n: row.get(n) for n in names if n in row}
        mapped.update(timestamp_utc=row['timestamp'], data_version=row['version'],
                      earth_x_pixel=row['earth_xy'][0], earth_y_pixel=row['earth_xy'][1],
                      exclude_interpolated=result['recipe']['exclude_interpolated'],
                      roi_json=json.dumps(result['recipe']['roi'], sort_keys=True),
                      method_version=result['method']['version'], flags_json=json.dumps(row['flags'], sort_keys=True),
                      baseline_mean_kR=result.get('baseline', {}).get('mean_kR'),
                      baseline_frame_id=result.get('baseline', {}).get('frame_id'))
        writer.writerow(mapped)
    return out.getvalue().encode()


def make_handler(catalogue, jobs, static_root):
    weather = SpaceWeather(Path(os.environ.get('CARRUTHERS_WEATHER_CACHE', jobs.local_dir.parent / 'space-weather')))
    baseline_cached = lru_cache(maxsize=128)(lambda fid, exclude: frame_baseline(catalogue, fid, exclude))
    contours_cached = lru_cache(maxsize=24)(lambda fid, exclude: radiance_contours(catalogue, fid, exclude))
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            if args and str(args[1] if len(args) > 1 else '').startswith('5'):
                super().log_message(fmt, *args)

        def allowed(self):
            host = self.headers.get('Host', '').split(':')[0]
            if host not in ('127.0.0.1', 'localhost'):
                self.send_data(403, b'Localhost access only', 'text/plain')
                return False
            origin = self.headers.get('Origin')
            # Dev preview is also loopback. Production uses same origin at 8765.
            allowed_origins = {f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}', 'http://127.0.0.1:5173'}
            if origin and origin not in allowed_origins:
                self.send_data(403, b'Cross-origin access is disabled', 'text/plain')
                return False
            return True

        def send_data(self, status, body, content_type='application/json', download=None, cache=False):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'private, max-age=3600' if cache else 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'")
            if download:
                self.send_header('Content-Disposition', f'attachment; filename="{download}"')
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def send_json(self, obj, status=200):
            self.send_data(status, json_bytes(obj))

        def do_GET(self):
            if not self.allowed():
                return
            try:
                parsed = urlparse(self.path)
                path = parsed.path
                query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
                if path == '/api/health':
                    return self.send_json(dict(app='carruthers-local', frames=len(catalogue.frames), method=METHOD_VERSION))
                if path == '/api/catalogue':
                    return self.send_json(catalogue.public())
                if path == '/api/preview':
                    return self.send_data(200, catalogue.preview(query.get('id'), float(query.get('low', 1)), float(query.get('high', 5.4))), 'image/png', cache=True)
                if path == '/api/baseline':
                    return self.send_json(baseline_cached(query.get('id'), query.get('exclude', '1') == '1'))
                if path == '/api/contours':
                    return self.send_json(contours_cached(query.get('id'), query.get('exclude', '1') == '1'))
                if path == '/api/context':
                    return self.send_json(weather.series(query.get('kind'), query.get('start', ''), query.get('end', '')))
                if path == '/api/colorbar':
                    rgba = colormaps['gist_heat'](np.linspace(0, 1, 256), bytes=True)[None, :, :]
                    out = io.BytesIO()
                    Image.fromarray(rgba).save(out, format='PNG')
                    return self.send_data(200, out.getvalue(), 'image/png', cache=True)
                if path == '/api/jobs':
                    return self.send_json(jobs.status(query.get('id'), rows=query.get('rows') == '1'))
                if path == '/api/saved':
                    return self.send_json(jobs.load(query['id']) if 'id' in query else jobs.saved())
                if path == '/api/export':
                    result = jobs.load(query['id']) if query.get('saved') == '1' else jobs.status(query.get('id'), rows=True)
                    if result['status'] != 'complete':
                        raise ValueError('Extraction is not complete')
                    if query.get('format') == 'json':
                        return self.send_data(200, json_bytes(result), download=f"carruthers-{result['id'][:8]}.json")
                    return self.send_data(200, export_csv(result), 'text/csv; charset=utf-8', download=f"carruthers-{result['recipe']['channel']}-{result['recipe']['start'][:10]}.csv")
                if path.startswith('/api/'):
                    return self.send_json({'error': 'Unknown endpoint'}, 404)
                relative = unquote(path).lstrip('/') or 'index.html'
                file = (static_root / relative).resolve()
                if not file.is_relative_to(static_root.resolve()) or not file.is_file():
                    return self.send_data(404, b'Not found. Build the interface with npm run build.', 'text/plain')
                mime = mimetypes.guess_type(file)[0] or 'application/octet-stream'
                return self.send_data(200, file.read_bytes(), mime)
            except (ValueError, TypeError, KeyError) as exc:
                self.send_json({'error': str(exc)}, getattr(exc, 'status', 400))
            except Exception:
                traceback.print_exc()
                self.send_json({'error': 'The local data service encountered an error. See the terminal log.'}, 500)

        def do_POST(self):
            if not self.allowed():
                return
            if self.headers.get('X-Carruthers-Local') != '1' or self.headers.get_content_type() != 'application/json':
                return self.send_json({'error': 'A local JSON request is required'}, 403)
            try:
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 1024*1024:
                    raise ValueError('Invalid request size')
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError('Expected a JSON object')
                path = urlparse(self.path).path
                if path == '/api/measure':
                    exclude = body.get('exclude_interpolated', True)
                    if not isinstance(exclude, bool):
                        raise ValueError('exclude_interpolated must be a boolean')
                    return self.send_json(measure_frame(catalogue, body.get('frame_id'), validate_roi(body.get('roi', {})), exclude, profile=True))
                if path == '/api/jobs':
                    return self.send_json(jobs.start(body), 202)
                if path == '/api/cancel':
                    return self.send_json(jobs.cancel(body.get('id')))
                if path == '/api/save':
                    return self.send_json(jobs.save(body.get('id'), body.get('title')))
                self.send_json({'error': 'Unknown endpoint'}, 404)
            except (ValueError, TypeError, KeyError) as exc:
                self.send_json({'error': str(exc)}, getattr(exc, 'status', 400))
            except Exception:
                traceback.print_exc()
                self.send_json({'error': 'The local data service encountered an error. See the terminal log.'}, 500)
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=Path(os.environ.get('CARRUTHERS_DATA_DIR', DEFAULT_DATA)))
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    if not args.data.is_dir():
        parser.error(f'Data folder not found: {args.data}')
    print('Indexing local observation metadata…', flush=True)
    catalogue = Catalogue(args.data)
    jobs = JobManager(catalogue, BASE / '.local' / 'analyses')
    static_root = BASE / 'dist' / 'client'
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(catalogue, jobs, static_root))
    server.daemon_threads = True
    print(f'{len(catalogue.frames)} frames in {catalogue.file_count} files. Local app: http://127.0.0.1:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped. Your source observations are unchanged.')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
