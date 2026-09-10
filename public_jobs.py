"""Bounded anonymous job queue. Each running calculation is a killable process."""
import copy
import hashlib
import json
import multiprocessing as mp
import os
import threading
import time
import uuid
from collections import OrderedDict
from pathlib import Path
from science import Catalogue, measure_frame, frame_baseline, validate_roi


class RequestError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def calculate(root, recipe, pipe):
    try:
        catalogue = Catalogue(Path(root))
        baseline = frame_baseline(catalogue, recipe['frame_ids'][0], recipe['exclude_interpolated'])
        pipe.send(('baseline', baseline))
        for fid in recipe['frame_ids']:
            pipe.send(('row', measure_frame(catalogue, fid, recipe['roi'], recipe['exclude_interpolated'], include_circularity=True)))
        pipe.send(('done', None))
    except Exception:
        pipe.send(('error', 'Calculation failed. Please retry or select a smaller interval.'))
    finally:
        pipe.close()


class PublicJobs:
    def __init__(self, catalogue, local_dir, method, timeout=120, worker=calculate):
        self.catalogue, self.local_dir, self.method = catalogue, Path(local_dir), method
        self.timeout, self.worker = timeout, worker
        self.jobs = OrderedDict()
        self.cache = OrderedDict()
        self.cache_bytes = 0
        self.lock = threading.Condition(threading.RLock())
        self.owner = threading.local()
        self.context = mp.get_context('spawn')
        self.stopped = False
        self.thread = threading.Thread(target=self._dispatch, daemon=True)
        self.thread.start()

    def set_owner(self, owner):
        self.owner.value = owner

    def _authorized(self, jid):
        job = self.jobs.get(jid)
        if job is None or job['_owner'] != getattr(self.owner, 'value', None):
            raise RequestError('Analysis not found or session expired. Run it again.', 404)
        return job

    def _cleanup(self):
        now = time.monotonic()
        for jid, job in list(self.jobs.items()):
            if job['status'] in ('complete', 'cancelled', 'error') and (now-job['_touched'] > 3600 or len(self.jobs) >= 100):
                del self.jobs[jid]

    def start(self, body):
        if (self.local_dir.parent / 'browsing-only').exists():
            raise RequestError('Analysis is temporarily paused. You can still browse images.', 503)
        ids = body.get('frame_ids')
        if not isinstance(ids, list) or not 1 <= len(ids) <= 1500 or any(not isinstance(x, str) for x in ids) or len(set(ids)) != len(ids):
            raise RequestError('Select 1–1,500 distinct frames.')
        frames = sorted([self.catalogue.get(fid) for fid in ids], key=lambda f: f['epoch_ms'])
        if len({(f['channel'], f['timestamp'][:7]) for f in frames}) != 1:
            raise RequestError('Select one camera within one calendar month.')
        roi = validate_roi(body.get('roi'))
        exclude = body.get('exclude_interpolated', True)
        if not isinstance(exclude, bool):
            raise RequestError('The interpolation choice must be boolean.')
        recipe = dict(frame_ids=[f['id'] for f in frames], channel=frames[0]['channel'], start=frames[0]['timestamp'], end=frames[-1]['timestamp'], roi=roi, exclude_interpolated=exclude)
        signature = hashlib.sha256(json.dumps([self.method['version'], recipe], sort_keys=True).encode()).hexdigest()
        owner = getattr(self.owner, 'value', None)
        if not owner:
            raise RequestError('Reload the page to establish a browser session.', 403)
        with self.lock:
            self._cleanup()
            live = [j for j in self.jobs.values() if j['status'] in ('queued', 'running', 'cancelling')]
            # Retries from the same visitor reuse its existing work.
            for job in live:
                if job['_owner'] == owner and job['_signature'] == signature:
                    return self.status(job['id'])
            owned = [j for j in live if j['_owner'] == owner]
            if any(j['status'] == 'queued' for j in owned) or len(owned) >= 2:
                raise RequestError('You already have an analysis waiting. Wait or cancel it first.', 429)
            if sum(j['status'] == 'queued' for j in live) >= 10:
                raise RequestError('The analysis queue is full. Please try again shortly.', 429)
            jid = uuid.uuid4().hex
            job = dict(id=jid, status='queued', completed=0, total=len(frames), recipe=recipe, rows=[], method=self.method, created_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), _owner=owner, _signature=signature, _touched=time.monotonic())
            if signature in self.cache:
                cached = json.loads(self.cache[signature])
                self.cache.move_to_end(signature)
                job.update(status='complete', completed=len(frames), rows=cached['rows'], baseline=cached['baseline'], reused=True)
            self.jobs[jid] = job
            self.lock.notify()
            return self.status(jid)

    def status(self, jid, rows=False):
        with self.lock:
            job = self._authorized(jid)
            result = {k: v for k, v in job.items() if not k.startswith('_') and (rows or k != 'rows')}
            if job['status'] == 'queued':
                waiting = [j['id'] for j in self.jobs.values() if j['status'] == 'queued']
                result['queue_position'] = waiting.index(jid)+1
            return copy.deepcopy(result)

    def cancel(self, jid):
        with self.lock:
            job = self._authorized(jid)
            if job['status'] == 'queued': job['status'] = 'cancelled'
            elif job['status'] == 'running': job['status'] = 'cancelling'
            return self.status(jid)

    def health(self):
        with self.lock:
            self._cleanup()
            return dict(running=sum(j['status'] in ('running','cancelling') for j in self.jobs.values()), queued=sum(j['status']=='queued' for j in self.jobs.values()), worker_alive=self.thread.is_alive(), stuck=any(j['status']=='running' and time.monotonic()-j.get('_started',time.monotonic())>self.timeout+15 for j in self.jobs.values()))

    def _dispatch(self):
        while not self.stopped:
            with self.lock:
                job = next((j for j in self.jobs.values() if j['status']=='queued'), None)
                if job is None:
                    self.lock.wait(1)
                    continue
                job.update(status='running', _started=time.monotonic())
            receive, send = self.context.Pipe(duplex=False)
            process = self.context.Process(target=self.worker, args=(str(self.catalogue.root), job['recipe'], send), daemon=True)
            try:
                process.start()
                send.close()
                while True:
                    with self.lock:
                        cancel = job['status']=='cancelling' or self.stopped
                        expired = time.monotonic()-job['_started'] >= self.timeout
                        if cancel or expired:
                            job.update(status='cancelled' if cancel else 'error', error='Analysis exceeded the two-minute limit. Select a smaller interval.' if expired else '')
                            break
                    if receive.poll(.05):
                        kind, value = receive.recv()
                        with self.lock:
                            if kind == 'row':
                                job['rows'].append(value)
                                job['completed'] += 1
                            elif kind == 'baseline': job['baseline'] = value
                            elif kind == 'error':
                                job.update(status='error', error=value)
                                break
                            elif kind == 'done':
                                job.update(status='complete', _touched=time.monotonic())
                                payload = json.dumps(dict(rows=job['rows'], baseline=job['baseline']), allow_nan=False).encode()
                                old = self.cache.pop(job['_signature'], b'')
                                self.cache_bytes -= len(old)
                                self.cache[job['_signature']] = payload
                                self.cache_bytes += len(payload)
                                while self.cache_bytes > 64*1024*1024:
                                    _, old = self.cache.popitem(last=False)
                                    self.cache_bytes -= len(old)
                                break
                    elif not process.is_alive():
                        raise RuntimeError('Worker exited')
            except Exception:
                with self.lock: job.update(status='error', error='Analysis worker stopped. Please retry.')
            finally:
                if process.pid:
                    if process.is_alive(): process.terminate()
                    process.join(2)
                    if process.is_alive(): process.kill(); process.join()
                    process.close()
                receive.close()
                send.close()
                with self.lock: job['_touched'] = time.monotonic()

    def close(self):
        self.stopped = True
        with self.lock: self.lock.notify()
        self.thread.join(4)
