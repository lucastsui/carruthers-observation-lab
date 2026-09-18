#!/usr/bin/env python3
"""Independent watchdog. No secrets or scientific arrays are sent to monitoring."""
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from urllib.request import Request, urlopen

STATE=Path('/var/lib/carruthers-monitor')
STATE.mkdir(parents=True,exist_ok=True)

def request(url, body=None, method=None, token=None):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    data=json.dumps(body).encode() if body is not None else None
    with urlopen(Request(url,data=data,headers=headers,method=method),timeout=15) as r:
        content=r.read()
        return json.loads(content) if content else {}

def main():
    problems=[]
    remote = os.environ.get('CARRUTHERS_REMOTE_BACKEND') == 'nightglow'
    backend_unit = 'carruthers-nightglow-relay.service' if remote else 'carruthers.service'
    try:
        health=request('http://127.0.0.1:8765/health')
        if health.get('status')!='ok': problems.append('Application health check failed')
    except Exception: problems.append('Application unavailable')
    if remote:
        try:
            output=subprocess.check_output(['/usr/bin/ssh','-o','BatchMode=yes','-o','IdentitiesOnly=yes',
                '-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10',
                '-o','UserKnownHostsFile=/etc/carruthers/nightglow-known-hosts',
                '-i','/etc/carruthers/nightglow-monitor-key',
                'lucastsui@100.118.4.122','storage-status'],text=True,timeout=20)
            disk=json.loads(output)
            if disk['free']/disk['total'] < .2: problems.append('Nightglow data volume below 20% free')
        except Exception: problems.append('Nightglow data volume unavailable')
    else:
        disk=shutil.disk_usage('/srv/carruthers')
        if disk.free/disk.total < .2: problems.append('Disk below 20% free')
    counts={}
    for unit in (backend_unit,'carruthers-gateway.service','carruthers-tunnel.service'):
        try:
            count=int(subprocess.check_output(['systemctl','show',unit,'-p','NRestarts','--value'],text=True).strip())
            counts[unit]=count
            if subprocess.run(['systemctl','is-active','--quiet',unit]).returncode: problems.append('Service inactive: '+unit)
        except Exception: pass
    previous={}
    try: previous=json.loads((STATE/'health.json').read_text())
    except (OSError,ValueError): pass
    crash_events=[e for e in previous.get('crash_events',[]) if time.time()-e['time']<600]
    for unit,n in counts.items():
        delta=max(0,n-previous.get('restarts',{}).get(unit,n))
        if delta: crash_events.append(dict(time=time.time(),unit=unit,count=delta))
        if sum(e['count'] for e in crash_events if e['unit']==unit)>=3: problems.append('Repeated crashes: '+unit)
    failures=previous.get('failures',0)+1 if 'Application unavailable' in problems else 0
    # Restart an unresponsive HTTP service after 3 watchdog failures, at most once / 15 min.
    last_restart=previous.get('last_restart',0)
    if failures>=3 and time.time()-last_restart>900:
        subprocess.run(['systemctl','restart',backend_unit],check=False,timeout=30)
        last_restart=time.time()
    url=''
    try: url=Path('/run/carruthers-tunnel/public-url').read_text().strip()
    except OSError: problems.append('Tunnel URL unavailable')
    token=os.environ.get('BETTERSTACK_API_TOKEN')
    monitor=os.environ.get('BETTERSTACK_MONITOR_ID')
    synced=previous.get('synced_url','')
    if token and monitor and url and url!=synced:
        try:
            request(f'https://uptime.betterstack.com/api/v2/monitors/{monitor}',{'url':url+'/health'},'PATCH',token)
            synced=url
            print('Updated public health monitor URL',flush=True)
        except Exception: problems.append('Could not update external monitor URL')
    heartbeat=os.environ.get('BETTERSTACK_HEARTBEAT_URL')
    if heartbeat:
        try:
            # Heartbeats return plain text; use urlopen directly.
            target=heartbeat.rstrip('/')+('/fail' if problems else '')
            data='; '.join(problems).encode() if problems else None
            with urlopen(Request(target,data=data),timeout=15) as r: r.read(1024)
        except Exception: problems.append('Could not contact external heartbeat service')
    report=dict(time=time.time(),problems=problems,restarts=counts,crash_events=crash_events,failures=failures,last_restart=last_restart,public_url=url,synced_url=synced,external_monitor_configured=bool(token and monitor and heartbeat))
    (STATE/'health.json').write_text(json.dumps(report,indent=2))
    print('Healthy' if not problems else '; '.join(problems),flush=True)

if __name__=='__main__': main()
