"""Pin tempfile storage in the server and all spawned Python workers."""
import os
import tempfile

expected = os.environ.get('CARRUTHERS_VOLUME_DEVICE')
if expected:
    try:
        device = int(expected)
        directory = os.environ['TMPDIR']
        if (not os.path.ismount('/Volumes/Observation Data')
                or os.stat('.').st_dev != device
                or os.stat(directory).st_dev != device):
            raise OSError('External storage unavailable')
        tempfile.tempdir = directory
    except Exception as exc:
        raise SystemExit('Observation Lab external temporary storage unavailable') from exc
