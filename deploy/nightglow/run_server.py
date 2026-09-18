#!/usr/bin/python3
"""Fail-closed launchd supervisor. Only stdlib; no writes until storage is verified."""
import hashlib
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import plistlib
import pwd
import selectors
import signal
import stat
import subprocess
import sys
import time
import urllib.request

ROOT = Path('/Users/lucastsui/Applications/ObservationLab')
VOLUME = Path('/Volumes/Observation Data')
UUID = '279D3C74-134E-4772-A3C3-EE64D76B70F7'
MARKER = Path('carruthers/dataset-verified.json')
STOP = False


def volume_info():
    info = plistlib.loads(subprocess.check_output(
        ['/usr/sbin/diskutil', 'info', '-plist', str(VOLUME)],
        timeout=30, stderr=subprocess.DEVNULL))
    if (info.get('VolumeUUID', '').upper() != UUID
            or info.get('MountPoint') != str(VOLUME)
            or info.get('FilesystemType') != 'apfs'
            or info.get('Internal') is not False
            or not info.get('WritableVolume')):
        raise RuntimeError('Expected writable external APFS volume is not mounted')
    if VOLUME.is_symlink() or not os.path.ismount(VOLUME):
        raise RuntimeError('Volume path is not an actual mount point')
    return os.stat(VOLUME).st_dev


def check_path(path, device, directory=False):
    """Reject symlinks and filesystem crossings in every relative component."""
    current = Path('.')
    for part in path.parts:
        current /= part
        metadata = current.lstat()
        if stat.S_ISLNK(metadata.st_mode) or metadata.st_dev != device:
            raise RuntimeError('Unsafe storage path: ' + str(current))
    mode = current.stat().st_mode
    if not (stat.S_ISDIR(mode) if directory else stat.S_ISREG(mode)):
        raise RuntimeError('Unexpected storage path type: ' + str(path))


def make_directory(path, device):
    current = Path('.')
    for part in path.parts:
        current /= part
        if not current.exists():
            current.mkdir(mode=0o700)
        check_path(current, device, directory=True)


def verify_marker(device):
    check_path(MARKER, device)
    report = json.loads(MARKER.read_text())
    manifest_bytes = (ROOT / 'app/deploy/dataset-manifest.json').read_bytes()
    manifest = json.loads(manifest_bytes)
    if (report.get('status') != 'verified' or report.get('volume_uuid') != UUID
            or report.get('files') != len(manifest['files'])
            or report.get('bytes') != sum(item['bytes'] for item in manifest['files'])
            or report.get('manifest_sha256') != hashlib.sha256(manifest_bytes).hexdigest()):
        raise RuntimeError('Dataset verification report does not match this deployment')
    return report


def verify_running_storage(device):
    """Check the filesystem pinned after the full startup UUID verification.

    Disk Arbitration can pause during logout. Do not make a running service
    depend on repeated diskutil IPC when its mounted filesystem is unchanged.
    The pinned cwd, current mount and verification marker must still agree.
    """
    if (VOLUME.is_symlink() or not os.path.ismount(VOLUME)
            or os.stat(VOLUME).st_dev != device
            or os.stat('.').st_dev != device):
        raise RuntimeError('Mounted observation volume changed; stopping service')
    return verify_marker(device)


def stop_signal(signum, frame):
    global STOP
    STOP = True


def terminate(child):
    # Kill the process group as well as any analysis subprocesses.
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        child.wait(timeout=15)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    child.wait()


def main():
    if os.getuid() != pwd.getpwnam('lucastsui').pw_uid:
        raise RuntimeError('Must run as lucastsui, never root')
    os.umask(0o077)
    device = volume_info()
    os.chdir(VOLUME)
    # Pin cwd to this filesystem. All external writes and backend paths remain
    # relative to it, so an unmount cannot redirect writes to an internal stub.
    if os.stat('.').st_dev != device or device == os.stat('/').st_dev:
        raise RuntimeError('Storage changed while entering mount')
    verify_marker(device)
    check_path(Path('carruthers/L1C'), device, directory=True)
    python = ROOT / 'runtime/venv/bin/python'
    if not os.access(python, os.X_OK):
        raise RuntimeError('Application virtualenv is not ready')
    origin = ROOT / 'public-url'
    if not origin.is_file() or not origin.read_text().strip().startswith('https://'):
        raise RuntimeError('HTTPS public-url file is missing or invalid')
    # Recheck immediately before the first external write.
    if volume_info() != device:
        raise RuntimeError('Storage identity changed')
    for name in ('state', 'state/config', 'cache', 'cache/tmp', 'cache/matplotlib',
                 'cache/space-weather', 'state/logs'):
        make_directory(Path('carruthers') / name, device)
    log_path = Path('carruthers/state/logs/server.log')
    for candidate in [log_path] + [Path(str(log_path) + '.' + str(i)) for i in range(1, 6)]:
        if candidate.exists() or candidate.is_symlink():
            check_path(candidate, device)
    logger = logging.getLogger('nightglow')
    logger.setLevel(logging.INFO)
    handler = RotatingFileHandler(log_path, maxBytes=10 * 1024 * 1024,
                                  backupCount=5, encoding='utf-8')
    handler.setFormatter(logging.Formatter('%(asctime)s %(message)s'))
    logger.addHandler(handler)
    env = {
        'HOME': '/Users/lucastsui', 'USER': 'lucastsui', 'LOGNAME': 'lucastsui',
        'PATH': str(ROOT / 'runtime/venv/bin') + ':/usr/bin:/bin:/usr/sbin:/sbin',
        'LANG': 'en_US.UTF-8', 'LC_ALL': 'en_US.UTF-8',
        'PYTHONUNBUFFERED': '1', 'PYTHONDONTWRITEBYTECODE': '1',
        'PYTHONNOUSERSITE': '1', 'VIRTUAL_ENV': str(ROOT / 'runtime/venv'),
        'PYTHONPATH': str(ROOT / 'app/deploy/nightglow/python_startup'),
        'CARRUTHERS_VOLUME_DEVICE': str(device),
        'TMPDIR': 'carruthers/cache/tmp', 'TMP': 'carruthers/cache/tmp',
        'TEMP': 'carruthers/cache/tmp',
        'XDG_CACHE_HOME': str(VOLUME / 'carruthers/cache'),
        'XDG_CONFIG_HOME': str(VOLUME / 'carruthers/state/config'),
        'MPLCONFIGDIR': str(VOLUME / 'carruthers/cache/matplotlib'),
        'CARRUTHERS_WEATHER_CACHE': 'carruthers/cache/space-weather',
    }
    for name in ('OMP_NUM_THREADS', 'OPENBLAS_NUM_THREADS', 'MKL_NUM_THREADS',
                 'VECLIB_MAXIMUM_THREADS', 'NUMEXPR_NUM_THREADS', 'BLIS_NUM_THREADS'):
        env[name] = '1'
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, stop_signal)
    if STOP:
        return 0
    child = subprocess.Popen([
        str(python), '-u', '-c',
        'import os,runpy,sys,tempfile; '
        'tempfile.tempdir=os.environ["TMPDIR"]; '
        'sys.argv=sys.argv[1:]; '
        'sys.path.insert(0,os.path.dirname(sys.argv[0])); '
        'runpy.run_path(sys.argv[0],run_name="__main__")',
        str(ROOT / 'app/public_server.py'),
        '--data', 'carruthers/L1C', '--port', '8766',
        '--job-timeout', '300',
        '--state', 'carruthers/state', '--origin-file', str(origin),
        '--extra-origin', 'https://nightglow.tail2214e5.ts.net',
    ], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
       start_new_session=True)
    logger.info('Backend started pid=%s', child.pid)
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    next_check = time.monotonic() + 10
    next_health = time.monotonic() + 60
    failed_health = 0
    try:
        while not STOP:
            if time.monotonic() >= next_check:
                verify_running_storage(device)
                next_check = time.monotonic() + 10
            if time.monotonic() >= next_health:
                try:
                    with urllib.request.urlopen('http://127.0.0.1:8766/health', timeout=5) as response:
                        health = json.load(response)
                    if health.get('status') != 'ok':
                        raise RuntimeError('Backend reported unhealthy')
                    failed_health = 0
                except Exception:
                    failed_health += 1
                    logger.warning('Backend health check failed (%s/3)', failed_health)
                    if failed_health >= 3:
                        raise RuntimeError('Backend unresponsive; restarting through launchd')
                next_health = time.monotonic() + 30
            for key, _ in selector.select(timeout=1):
                chunk = os.read(key.fd, 8192)
                if chunk:
                    logger.info('%s', chunk.decode('utf-8', errors='replace').rstrip())
                else:
                    selector.unregister(key.fileobj)
            if child.poll() is not None:
                logger.info('Backend exited with status %s', child.returncode)
                return child.returncode or 1
        return 0
    finally:
        terminate(child)
        selector.close()
        child.stdout.close()
        handler.close()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        # Bounded OS log entry, never a fallback log file on internal storage.
        import syslog
        syslog.openlog('observationlab-nightglow')
        syslog.syslog(syslog.LOG_ERR, str(exc)[:1500])
        sys.exit(1)
