#!/usr/bin/env python3
"""Create a named app bundle for macOS Full Disk Access; do not grant permission."""
from pathlib import Path
import plistlib
import shutil
import subprocess

ROOT = Path('/Users/lucastsui/Applications/ObservationLab')
SOURCE = ROOT / 'runtime/python/cpython-3.12.14-macos-aarch64-none/bin/python3.12'
BUNDLE = ROOT / 'Observation Lab Runtime.app'


def main():
    if BUNDLE.exists():
        raise SystemExit('Runtime bundle already exists; inspect before replacing its identity')
    executable = BUNDLE / 'Contents/MacOS/python3.12'
    executable.parent.mkdir(parents=True)
    shutil.copy2(SOURCE, executable)
    # This relocatable CPython resolves its standard library from ../lib
    # relative to its real executable. Include that existing library unchanged.
    shutil.copytree(SOURCE.parent.parent / 'lib', BUNDLE / 'Contents/lib', symlinks=True)
    info = dict(CFBundleIdentifier='org.carruthers.observation-runtime',
                CFBundleName='Observation Lab Runtime',
                CFBundleDisplayName='Observation Lab Runtime',
                CFBundleExecutable='python3.12', CFBundlePackageType='APPL',
                CFBundleVersion='1', CFBundleShortVersionString='3.12.14',
                LSBackgroundOnly=True,
                NSRemovableVolumesUsageDescription=
                'Observation Lab reads observation files and stores analysis state on its external drive.')
    (BUNDLE / 'Contents/Info.plist').write_bytes(plistlib.dumps(info))
    subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', '--identifier',
                    info['CFBundleIdentifier'], str(BUNDLE)], check=True)
    subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(BUNDLE)], check=True)
    print('Packaged the existing Python executable for selection in Full Disk Access.')
    print('No privacy permission or live runtime links changed.')


if __name__ == '__main__':
    main()
