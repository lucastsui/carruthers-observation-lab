#!/usr/bin/python3
"""Read-only validation: mocked failure gates; never launch backend or installer."""
import ast
from pathlib import Path
import plistlib
import types
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
source = (HERE / 'run_server.py').read_text()
ast.parse(source)
module = types.ModuleType('nightglow_wrapper')
exec(compile(source, str(HERE / 'run_server.py'), 'exec'), module.__dict__)
valid = dict(VolumeUUID=module.UUID, MountPoint=str(module.VOLUME),
             FilesystemType='apfs', Internal=False, WritableVolume=True)
for change in ({'VolumeUUID': 'wrong'}, {'MountPoint': '/Volumes/wrong'},
               {'Internal': True}, {'WritableVolume': False}, {'FilesystemType': 'hfs'}):
    info = dict(valid, **change)
    with patch.object(module.subprocess, 'check_output', return_value=plistlib.dumps(info)):
        try:
            module.volume_info()
        except RuntimeError:
            pass
        else:
            raise AssertionError('Accepted incorrect storage: ' + repr(change))
# Every failing startup gate must happen before directory creation or spawning.
for failure in ('volume', 'marker'):
    with patch.object(module.os, 'getuid', return_value=504), \
         patch.object(module.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=504)), \
         patch.object(module.os, 'umask'), patch.object(module.os, 'chdir'), \
         patch.object(module.os, 'stat', side_effect=lambda p: types.SimpleNamespace(st_dev=1 if str(p)=='/' else 2)), \
         patch.object(module, 'volume_info', side_effect=RuntimeError('unmounted') if failure=='volume' else None, return_value=2), \
         patch.object(module, 'check_path', side_effect=FileNotFoundError('no marker')), \
         patch.object(module, 'make_directory') as mkdir, \
         patch.object(module.subprocess, 'Popen') as spawn:
        try:
            module.main()
        except (RuntimeError, FileNotFoundError):
            pass
        else:
            raise AssertionError('Failed open at ' + failure)
        mkdir.assert_not_called()
        spawn.assert_not_called()
plist=plistlib.loads((HERE/'org.carruthers.observation-lab.plist').read_bytes())
assert plist['UserName']=='lucastsui' and plist['ThrottleInterval']>=60
assert plist['KeepAlive'] and plist['RunAtLoad']
assert plist['ProgramArguments']==['/Users/lucastsui/Applications/ObservationLab/runtime/venv/bin/python','-B',str(HERE/'run_server.py')]
print('PASS: syntax, plist invariants, five wrong-volume gates, missing volume/marker fail closed')
