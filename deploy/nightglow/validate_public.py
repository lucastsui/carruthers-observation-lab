#!/usr/bin/env python3
"""Verify public Funnel access through public DNS, bypassing the caller's tailnet."""
import ipaddress
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request

HOST = 'nightglow.tail2214e5.ts.net'
URL = 'https://' + HOST

def main():
    report_path = Path(sys.argv[1])
    deadline = time.monotonic() + 900
    public_ip = None
    while time.monotonic() < deadline:
        try:
            request = urllib.request.Request(
                'https://cloudflare-dns.com/dns-query?name=' + HOST + '&type=A',
                headers={'Accept': 'application/dns-json'})
            with urllib.request.urlopen(request, timeout=15) as response:
                dns = json.load(response)
            addresses = [a['data'] for a in dns.get('Answer', []) if a['type'] == 1]
            public_ip = next(a for a in addresses if ipaddress.ip_address(a).is_global)
            probe = subprocess.run(['curl', '--silent', '--show-error', '--fail', '--noproxy', '*',
                '--resolve', f'{HOST}:443:{public_ip}', '--max-time', '15', URL + '/health'],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if probe.returncode == 0 and json.loads(probe.stdout)['status'] == 'ok':
                break
        except Exception:
            pass
        time.sleep(5)
    else:
        raise SystemExit('Public Funnel DNS/HTTPS did not become ready; Spark stays online')
    print('Public Funnel HTTPS is reachable through ' + public_ip, flush=True)
    with tempfile.TemporaryDirectory(prefix='observation-public-test-') as directory:
        cookie = str(Path(directory) / 'cookies')
        def request(path, body=None, raw=False, expected=200, origin=URL, visitor=cookie):
            command = ['curl', '--silent', '--show-error', '--noproxy', '*',
                '--resolve', f'{HOST}:443:{public_ip}', '--max-time', '60',
                '--cookie', visitor, '--cookie-jar', visitor,
                '-H', 'Origin: ' + origin, '-H', 'Content-Type: application/json',
                '-H', 'X-Carruthers-Local: 1', '--write-out', '\n%{http_code}', URL + path]
            data = None
            if body is not None:
                data = body if isinstance(body, bytes) else json.dumps(body).encode()
                command += ['--data-binary', '@-']
            response = subprocess.run(command, input=data, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, check=True).stdout
            content, status = response.rsplit(b'\n', 1)
            accepted = {200, 202} if expected == 200 and path == '/api/jobs' and body is not None else {expected}
            if int(status) not in accepted:
                raise RuntimeError(f'{path}: expected HTTP {expected}, got {status.decode()}')
            return content if raw or expected != 200 else json.loads(content)
        catalogue = request('/api/catalogue')
        if len(catalogue['frames']) != 1794 or catalogue['file_count'] != 62:
            raise RuntimeError('Dataset catalogue changed')
        checks = ['public DNS and TLS', '1794 frames across 62 files']
        for camera in ('WFI', 'NFI'):
            ids = [frame['id'] for frame in catalogue['frames']
                   if frame['channel'] == camera and frame['timestamp'].startswith('2026-03-15')][:2]
            if not request('/api/preview?id=' + ids[0], raw=True).startswith(b'\x89PNG'):
                raise RuntimeError('Invalid image preview')
            request('/api/contours?id=' + ids[0])
            request('/api/baseline?id=' + ids[0])
            roi = dict(kind='annulus', inner=4.5, outer=5.5) if camera == 'WFI' else dict(kind='paired_sectors', angle_width=60)
            job = request('/api/jobs', dict(frame_ids=ids, roi=roi, exclude_interpolated=True))
            for _ in range(180):
                result = request('/api/jobs?id=' + job['id'] + '&rows=1')
                if result['status'] in ('complete', 'error', 'cancelled'):
                    break
                time.sleep(1)
            if result['status'] != 'complete' or len(result['rows']) != 2:
                raise RuntimeError('Analysis did not complete: ' + str(result.get('error')))
            if camera == 'WFI' and abs(result['rows'][0]['mean_kR'] - 5.055363316796408) > 1e-12:
                raise RuntimeError('Scientific regression')
            if b'mean_kR' not in request('/api/export?id=' + job['id'], raw=True):
                raise RuntimeError('CSV export failed')
            if request('/api/export?id=' + job['id'] + '&format=json')['rows'] != result['rows']:
                raise RuntimeError('JSON export changed the analysis')
            request('/api/jobs?id=' + job['id'], expected=404, visitor=str(Path(directory) / 'other'))
            checks.append(camera + ' image, contours, analysis, exports and visitor privacy')
        for kind in ('symh', 'lyman'):
            series = request('/api/context?kind=' + kind + '&start=2026-03-15&end=2026-03-15')
            if series['status'] != 'available':
                raise RuntimeError(kind + ' reference data unavailable')
        request('/health', body={}, origin='https://evil.example', expected=403)
        request('/api/jobs', body=b' ' * (1024*1024 + 1), expected=413)
        checks += ['reference charts', 'cross-origin rejection', 'gateway upload limit']
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(dict(status='passed', url=URL, public_ip=public_ip,
        frames=1794, files=62, checks=checks, time=time.time()), indent=2) + '\n')
    print('Public functional and privacy checks passed.', flush=True)

if __name__ == '__main__':
    main()
