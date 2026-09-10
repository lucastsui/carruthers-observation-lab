#!/usr/bin/env python3
"""Verify every deployed observation against the original local SHA-256 manifest."""
import argparse
import hashlib
import json
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('root',type=Path)
p.add_argument('--manifest',type=Path,default=Path(__file__).with_name('dataset-manifest.json'))
a=p.parse_args()
m=json.loads(a.manifest.read_text())
for item in m['files']:
    path=a.root/item['path']
    if path.stat().st_size!=item['bytes']: raise SystemExit('Size mismatch: '+item['path'])
    with path.open('rb') as f: actual=hashlib.file_digest(f,'sha256').hexdigest()
    if actual!=item['sha256']: raise SystemExit('Checksum mismatch: '+item['path'])
print(f"Verified {len(m['files'])} files, {sum(i['bytes'] for i in m['files']):,} bytes")
