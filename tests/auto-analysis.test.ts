import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { AutoAnalysis } from '../lib/auto-analysis.ts';
import type { AnalysisSelection, AnalysisState } from '../lib/auto-analysis.ts';
import { DEFAULT_ROI, activeROI } from '../lib/research.ts';
import type { Job } from '../lib/research.ts';

const selection = (outer = 5.5): AnalysisSelection => ({
  frame_ids: ['wfi-1', 'wfi-2'],
  roi: { ...DEFAULT_ROI, outer },
  exclude_interpolated: true,
});
function job(
  id: string,
  s: AnalysisSelection,
  status: Job['status'] = 'running',
): Job {
  return {
    id,
    status,
    completed: status === 'complete' ? s.frame_ids.length : 0,
    total: s.frame_ids.length,
    recipe: {
      ...s,
      channel: 'WFI',
      start: '2026-03-15T00:00:00Z',
      end: '2026-03-15T23:00:00Z',
    },
    rows: [],
  };
}

function harness(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending: {
    path: string;
    body?: unknown;
    resolve: (j: Job) => void;
    reject: (error: Error) => void;
  }[] = [];
  const states: AnalysisState[] = [],
    results: Job[] = [];
  const worker = new AutoAnalysis({
    transport: <T>(path: string, body?: unknown) =>
      new Promise<T>((resolve, reject) => {
        pending.push({ path, body, resolve: (j) => resolve(j as T), reject });
      }),
    onState: (state) => states.push(state),
    onResult: (result) => results.push(result),
  });
  t.after(() => worker.dispose());
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const tick = async (ms: number) => {
    t.mock.timers.tick(ms);
    await flush();
  };
  const take = (path: string) => {
    const request = pending.shift();
    assert.equal(request?.path, path);
    return request!;
  };
  const reply = async (path: string, value: Job) => {
    take(path).resolve(value);
    await flush();
  };
  return { worker, pending, states, results, flush, tick, take, reply };
}

test('initial selection and rapid dragging calculate only the last region, without a button', async (t) => {
  const h = harness(t);
  h.worker.setSelection(selection(6));
  await h.tick(200);
  h.worker.setSelection(selection(7));
  await h.tick(200);
  h.worker.setSelection(selection(8));
  await h.tick(399);
  assert.equal(h.pending.length, 0);
  await h.tick(1);
  const request = h.take('jobs');
  assert.deepEqual(request.body, {
    ...selection(8),
    roi: activeROI(selection(8).roi),
  });
  request.resolve(job('latest', selection(8), 'complete'));
  await h.flush();
  await h.reply(
    'jobs?id=latest&rows=1',
    job('latest', selection(8), 'complete'),
  );
  assert.deepEqual(
    h.results.map((r) => r.id),
    ['latest'],
  );
  assert.equal(h.states.at(-1)?.phase, 'complete');
});

test('a superseded start response is tracked and cancelled before the newest job starts', async (t) => {
  const h = harness(t);
  h.worker.setSelection(selection(6));
  await h.tick(400);
  const starting = h.take('jobs');
  h.worker.setSelection(selection(7));
  await h.tick(400);
  assert.equal(h.pending.length, 0, 'must wait for the first job ID');
  starting.resolve(job('old', selection(6)));
  await h.flush();
  await h.reply('cancel', job('old', selection(6), 'cancelling'));
  h.worker.setSelection(selection(8));
  await h.tick(400);
  await h.reply('jobs?id=old', job('old', selection(6), 'cancelling'));
  assert.equal(
    h.pending.length,
    0,
    'a cancellation acknowledgement is not completion',
  );
  await h.tick(250);
  await h.reply('jobs?id=old', job('old', selection(6), 'cancelled'));
  const latest = h.take('jobs');
  assert.deepEqual(latest.body, {
    ...selection(8),
    roi: activeROI(selection(8).roi),
  });
  latest.resolve(job('new', selection(8), 'complete'));
  await h.flush();
  await h.reply('jobs?id=new&rows=1', job('new', selection(8), 'complete'));
  assert.deepEqual(
    h.results.map((r) => r.id),
    ['new'],
  );
});

test('late numeric rows from a previous region never replace the latest selection', async (t) => {
  const h = harness(t);
  h.worker.setSelection(selection(6));
  await h.tick(400);
  await h.reply('jobs', job('old', selection(6), 'complete'));
  const lateRows = h.take('jobs?id=old&rows=1');
  h.worker.setSelection(selection(7));
  await h.tick(400);
  lateRows.resolve(job('old', selection(6), 'complete'));
  await h.flush();
  assert.equal(h.results.length, 0);
  await h.reply('jobs', job('new', selection(7), 'complete'));
  await h.reply('jobs?id=new&rows=1', job('new', selection(7), 'complete'));
  assert.deepEqual(
    h.results.map((r) => r.id),
    ['new'],
  );
});

test('camera/frame ranges and masks trigger updates; equivalent selections do not', async (t) => {
  const h = harness(t);
  let current = selection();
  h.worker.adopt(job('saved', current, 'complete'));
  h.worker.setSelection({ ...current, roi: { ...current.roi, x: 50 } });
  await h.tick(1000);
  assert.equal(
    h.pending.length,
    0,
    'inactive shape fields must not restart extraction',
  );
  const changes = [
    { ...current, frame_ids: ['wfi-1'] },
    { ...current, frame_ids: ['nfi-1', 'nfi-2'] },
    { ...current, frame_ids: ['nfi-1', 'nfi-2'], exclude_interpolated: false },
  ];
  for (const [i, next] of changes.entries()) {
    current = next;
    h.worker.setSelection(current);
    await h.tick(400);
    await h.reply('jobs', job(String(i), current, 'complete'));
    await h.reply(`jobs?id=${i}&rows=1`, job(String(i), current, 'complete'));
    h.worker.setSelection({ ...current, frame_ids: [...current.frame_ids] });
    await h.tick(1000);
    assert.equal(h.pending.length, 0);
  }
  assert.equal(h.results.length, 3);
});

test('invalid or empty selections stop pending and running calculations', async (t) => {
  const h = harness(t);
  h.worker.setSelection(selection());
  h.worker.setSelection(null);
  await h.tick(1000);
  assert.equal(h.pending.length, 0);
  h.worker.setSelection(selection());
  await h.tick(400);
  await h.reply('jobs', job('old', selection()));
  h.worker.setSelection(null);
  await h.tick(250);
  await h.reply('jobs?id=old', job('old', selection()));
  await h.reply('cancel', job('old', selection(), 'cancelled'));
  await h.tick(1000);
  assert.equal(h.pending.length, 0);
  assert.equal(h.states.at(-1)?.phase, 'idle');
  assert.equal(h.results.length, 0);
});

test('Cancel stays paused for the same selection; Resume and selection changes run automatically', async (t) => {
  const h = harness(t);
  h.worker.setSelection(selection());
  h.worker.cancel();
  h.worker.setSelection(selection());
  await h.tick(1000);
  assert.equal(h.pending.length, 0);
  assert.equal(h.states.at(-1)?.phase, 'cancelled');
  h.worker.retry();
  await h.tick(400);
  await h.reply('jobs', job('resumed', selection()));
  h.worker.cancel();
  await h.tick(250);
  await h.reply('jobs?id=resumed', job('resumed', selection()));
  await h.reply('cancel', job('resumed', selection(), 'cancelled'));
  await h.tick(1000);
  assert.equal(h.pending.length, 0);
  h.worker.setSelection(selection(8));
  await h.tick(400);
  assert.equal(h.take('jobs').path, 'jobs');
});

test('loading saved results cancels old work and avoids recalculating the saved recipe', async (t) => {
  const h = harness(t);
  h.worker.setSelection(selection());
  await h.tick(400);
  await h.reply('jobs', job('old', selection()));
  h.worker.adopt(job('saved', selection(8), 'complete'));
  h.worker.setSelection(selection(8));
  await h.tick(250);
  await h.reply('jobs?id=old', job('old', selection()));
  await h.reply('cancel', job('old', selection(), 'cancelled'));
  await h.tick(1000);
  assert.equal(h.pending.length, 0);
  assert.equal(h.states.at(-1)?.job?.id, 'saved');
  assert.equal(h.states.at(-1)?.phase, 'complete');
  assert.equal(h.results.length, 0);
});

test('transient polling failure keeps ownership and retries before starting a newer selection', async (t) => {
  const h = harness(t);
  h.worker.setSelection(selection());
  await h.tick(400);
  await h.reply('jobs', job('old', selection()));
  await h.tick(250);
  h.take('jobs?id=old').reject(new Error('Temporary disconnect'));
  await h.flush();
  h.worker.setSelection(selection(8));
  await h.tick(400);
  assert.equal(h.pending.length, 0);
  await h.tick(1100);
  await h.reply('jobs?id=old', job('old', selection()));
  await h.reply('cancel', job('old', selection(), 'cancelled'));
  assert.equal(h.take('jobs').path, 'jobs');
});

test('failed starts do not repeatedly hammer the service and a new region retries', async (t) => {
  const h = harness(t);
  h.worker.setSelection(selection());
  await h.tick(400);
  h.take('jobs').reject(new Error('Service unavailable'));
  await h.flush();
  await h.tick(5000);
  assert.equal(h.pending.length, 0);
  assert.equal(h.states.at(-1)?.phase, 'error');
  h.worker.setSelection(selection(8));
  await h.tick(400);
  assert.equal(h.take('jobs').path, 'jobs');
});

test('unmount cancels even a delayed job-start response and publishes no further state', async (t) => {
  const h = harness(t);
  h.worker.setSelection(selection());
  await h.tick(400);
  const start = h.take('jobs');
  h.worker.dispose();
  const count = h.states.length;
  start.resolve(job('old', selection()));
  await h.flush();
  await h.reply('cancel', job('old', selection(), 'cancelled'));
  await h.tick(5000);
  assert.equal(h.pending.length, 0);
  assert.equal(h.results.length, 0);
  assert.equal(h.states.length, count);
});
