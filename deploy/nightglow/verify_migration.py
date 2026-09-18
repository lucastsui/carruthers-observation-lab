#!/Users/lucastsui/Applications/ObservationLab/runtime/venv/bin/python
"""Hash copied observations and preserve the live catalogue's frame identities."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import time
from run_server import VOLUME, UUID, volume_info, check_path

HERE = Path(__file__).resolve().parent
manifest_bytes = (HERE.parent / 'dataset-manifest.json').read_bytes()
manifest = json.loads(manifest_bytes)
metadata = json.loads((HERE / 'source-metadata.json').read_text())
device = volume_info()
os.chdir(VOLUME)
if os.stat('.').st_dev != device:
    raise RuntimeError('Volume changed')
root = Path('carruthers/L1C')
check_path(root, device, directory=True)
rootfd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
total = 0
try:
    for index, item in enumerate(manifest['files'], 1):
        relative = Path(item['path'])
        if relative.is_absolute() or '..' in relative.parts:
            raise RuntimeError('Invalid manifest path')
        check_path(root / relative, device)
        fd = os.open(relative, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=rootfd)
        with os.fdopen(fd, 'rb') as stream:
            before = os.fstat(stream.fileno())
            if before.st_dev != device or before.st_size != item['bytes']:
                raise RuntimeError('Size/device mismatch: ' + item['path'])
            actual = hashlib.file_digest(stream, 'sha256').hexdigest()
            after = os.fstat(stream.fileno())
            if actual != item['sha256'] or (before.st_size,before.st_mtime_ns) != (after.st_size,after.st_mtime_ns):
                raise RuntimeError('Checksum or concurrent change: ' + item['path'])
            expected = metadata[item['path']]
            if expected['bytes'] != before.st_size:
                raise RuntimeError('Source metadata mismatch')
            if before.st_mtime_ns != expected['mtime_ns']:
                if volume_info() != device:
                    raise RuntimeError('Volume changed before timestamp restoration')
                os.utime(stream.fileno(), ns=(before.st_atime_ns, expected['mtime_ns']))
            fingerprint = hashlib.sha256(f"{item['path']}:{before.st_size}:{os.fstat(stream.fileno()).st_mtime_ns}".encode()).hexdigest()[:16]
            if fingerprint != expected['fingerprint']:
                raise RuntimeError('Frame identity mismatch: ' + item['path'])
            total += before.st_size
        print(f'Verified {index}/{len(manifest["files"])}: {relative.name}', flush=True)
finally:
    os.close(rootfd)
if volume_info() != device:
    raise RuntimeError('Volume changed before verification report')
report = dict(status='verified', files=len(manifest['files']), bytes=total,
              volume_uuid=UUID, verified_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              manifest_sha256=hashlib.sha256(manifest_bytes).hexdigest())
check_path(Path('carruthers'), device, directory=True)
parentfd = os.open('carruthers', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
temporary = '.dataset-verified-' + secrets.token_hex(8) + '.tmp'
try:
    if os.fstat(parentfd).st_dev != device:
        raise RuntimeError('Report directory changed')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parentfd)
    with os.fdopen(fd, 'w') as stream:
        stream.write(json.dumps(report, indent=2) + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, 'dataset-verified.json', src_dir_fd=parentfd, dst_dir_fd=parentfd)
finally:
    os.close(parentfd)
print(json.dumps(report), flush=True)
