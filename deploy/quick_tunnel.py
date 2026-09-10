#!/usr/bin/env python3
"""Run a Quick Tunnel and atomically publish its current, exact HTTPS origin."""
import os
import re
import signal
import subprocess
from pathlib import Path

directory=Path('/run/carruthers-tunnel')
directory.mkdir(parents=True,exist_ok=True)
url_file=directory/'public-url'
url_file.unlink(missing_ok=True)
process=subprocess.Popen(['/usr/local/bin/cloudflared','tunnel','--no-autoupdate','--url','http://127.0.0.1:8765'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
def stop(signum, frame):
    process.terminate()
signal.signal(signal.SIGTERM,stop)
signal.signal(signal.SIGINT,stop)
try:
    for line in process.stdout:
        print(line.rstrip(),flush=True)
        match=re.search(r'https://[a-z0-9-]+\.trycloudflare\.com',line)
        if match:
            temp=directory/'public-url.tmp'
            temp.write_text(match.group()+'\n')
            temp.chmod(0o644)
            temp.replace(url_file)
    raise SystemExit(process.wait() or 1)
finally:
    if process.poll() is None: process.terminate(); process.wait(timeout=10)
