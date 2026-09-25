import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewImageCache, previewWindowIndices } from '../lib/preview-images.ts';
import { loadedFrameRanges } from '../lib/loaded-frame-ranges.ts';

const image = (src: string) => ({ src }) as HTMLImageElement;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function controlledCache(capacity = 12) {
  const calls: string[] = [];
  const pending = new Map<string, {
    resolve: (value: HTMLImageElement) => void;
    reject: (error: Error) => void;
  }>();
  const cache = new PreviewImageCache((url) => {
    calls.push(url);
    return new Promise((resolve, reject) => { pending.set(url, { resolve, reject }); });
  }, capacity);
  return {
    cache, calls,
    finish: (url: string) => pending.get(url)!.resolve(image(url)),
    fail: (url: string) => pending.get(url)!.reject(new Error('network')),
  };
}

void test('the preload window includes five frames on each side, nearest first, without wrapping', () => {
  assert.deepEqual(previewWindowIndices(20, 10), [10, 11, 9, 12, 8, 13, 7, 14, 6, 15, 5]);
  assert.deepEqual(previewWindowIndices(20, 0), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(previewWindowIndices(20, 19), [19, 18, 17, 16, 15, 14]);
  assert.deepEqual(previewWindowIndices(3, 1), [1, 2, 0]);
  assert.deepEqual(previewWindowIndices(3, 20), [2, 1, 0]);
  assert.deepEqual(previewWindowIndices(3, -1), [0, 1, 2]);
  assert.deepEqual(previewWindowIndices(1, 0), [0]);
  assert.deepEqual(previewWindowIndices(0, 0), []);
});

void test('jumping replaces queued work, keeps at most two background requests, and prioritizes selection', async () => {
  const { cache, calls, finish } = controlledCache();
  cache.setPreloadWindow(['a0', 'a1', 'a2', 'a3']);
  assert.deepEqual(calls, ['a1', 'a2']);
  cache.setPreloadWindow(['b0', 'b1', 'b2']);
  cache.setPreloadWindow(['c0', 'c1', 'c2', 'c3'], false);
  const selected = cache.get('c0');
  assert.deepEqual(calls, ['a1', 'a2', 'c0']);
  finish('a1');
  await settle();
  assert.deepEqual(calls, ['a1', 'a2', 'c0']); // Still waiting for the selected image.
  finish('c0');
  await selected;
  cache.setPreloadWindow(['c0', 'c1', 'c2', 'c3']);
  assert.deepEqual(calls, ['a1', 'a2', 'c0', 'c1']); // Old a2 still occupies one slot.
  cache.setPreloadWindow(['c0', 'c1', 'c2', 'c3']);
  finish('a2');
  await settle();
  assert.deepEqual(calls, ['a1', 'a2', 'c0', 'c1', 'c2']);
  finish('c1');
  await settle();
  assert.deepEqual(calls, ['a1', 'a2', 'c0', 'c1', 'c2', 'c3']);
  cache.setPreloadWindow([]); // Unmount/cleanup drops the queue.
  finish('c2');
  finish('c3');
  await settle();
});

void test('the decoded buffer moves forward and backward and rebuilds for a different camera or scale', async () => {
  const calls: string[] = [];
  const cache = new PreviewImageCache(async (url) => {
    calls.push(url);
    return image(url);
  });
  const move = async (index: number, camera = 'WFI', low = 1) => {
    const urls = previewWindowIndices(40, index).map((i) => `${camera}/${i}?low=${low}`);
    cache.setPreloadWindow(urls, false);
    await cache.get(urls[0]);
    cache.setPreloadWindow(urls);
    await settle();
    assert.ok(urls.every((url) => cache.getSnapshot().has(url)));
    assert.ok(cache.getSnapshot().size <= 12);
    return urls;
  };
  await move(10);
  assert.equal(calls.length, 11);
  await move(11);
  assert.equal(calls.length, 12); // Only the newly exposed forward edge is requested.
  await move(10);
  assert.equal(calls.length, 12); // Recent past is already ready.
  await move(25);
  await move(25, 'NFI');
  await move(25, 'NFI', 2);
  const urls = await move(0, 'NFI', 2);
  assert.equal(urls.length, 6);
});

void test('late loads from an old window cannot evict decoded frames in the current window', async () => {
  const { cache, finish } = controlledCache(3);
  cache.setPreloadWindow(['old-current', 'old-next', 'old-previous']);
  const urls = ['new-current', 'new-next', 'new-previous'];
  cache.setPreloadWindow(urls, false);
  for (const url of urls) {
    const request = cache.get(url);
    finish(url);
    await request;
  }
  const snapshot = cache.getSnapshot();
  finish('old-next');
  finish('old-previous');
  await settle();
  assert.equal(cache.getSnapshot(), snapshot);
  assert.deepEqual([...snapshot], urls);
});

void test('a failed background frame leaves a gap, continues loading, and retries on a later window', async () => {
  const { cache, calls, finish, fail } = controlledCache();
  cache.setPreloadWindow(['current', 'bad', 'good', 'later']);
  fail('bad');
  await settle();
  assert.deepEqual(calls, ['bad', 'good', 'later']);
  finish('good');
  finish('later');
  await settle();
  assert.deepEqual([...cache.getSnapshot()], ['good', 'later']);
  cache.setPreloadWindow(['current', 'bad', 'good', 'later']);
  assert.deepEqual(calls, ['bad', 'good', 'later', 'bad']);
  finish('bad');
  await settle();
  assert.ok(cache.getSnapshot().has('bad'));
});

void test('clearing a window prevents completed background work from starting more requests', async () => {
  const { cache, calls, finish } = controlledCache();
  cache.setPreloadWindow(['current', 'next', 'previous', 'queued']);
  cache.setPreloadWindow([]);
  finish('next');
  finish('previous');
  await settle();
  assert.deepEqual(calls, ['next', 'previous']);
});

void test('loaded markers follow decode completion, eviction and exact brightness URLs', async () => {
  const finishes = new Map<string, (value: HTMLImageElement) => void>();
  const cache = new PreviewImageCache((url) => new Promise((resolve) => {
    finishes.set(url, resolve);
  }), 2);
  let updates = 0;
  const unsubscribe = cache.subscribe(() => { updates++; });
  const initial = cache.getSnapshot();
  const first = cache.get('a?low=1');
  assert.equal(cache.getSnapshot(), initial);
  assert.equal(updates, 0);
  finishes.get('a?low=1')!(image('a'));
  await first;
  assert.deepEqual([...cache.getSnapshot()], ['a?low=1']);
  const ready = cache.getSnapshot();
  await cache.get('a?low=1');
  assert.equal(cache.getSnapshot(), ready);
  assert.equal(updates, 1);
  for (const url of ['b?low=1', 'a?low=2']) {
    const request = cache.get(url);
    finishes.get(url)!(image(url));
    await request;
  }
  assert.deepEqual([...cache.getSnapshot()], ['b?low=1', 'a?low=2']);
  assert.deepEqual(loadedFrameRanges(['a?low=1', 'b?low=1'], cache.getSnapshot()).map(r => [r.start, r.end]), [[1, 1]]);
  assert.deepEqual(loadedFrameRanges(['a?low=2', 'b?low=2'], cache.getSnapshot()).map(r => [r.start, r.end]), [[0, 0]]);
  assert.equal(updates, 3);
  unsubscribe();
  const next = cache.get('c');
  finishes.get('c')!(image('c'));
  await next;
  assert.equal(updates, 3);
});

void test('failed image decoding never marks a frame as loaded', async () => {
  const cache = new PreviewImageCache(async () => { throw new Error('decode failed'); });
  const initial = cache.getSnapshot();
  await assert.rejects(cache.get('broken'), /decode failed/);
  assert.equal(cache.getSnapshot(), initial);
  assert.equal(cache.getSnapshot().size, 0);
});

void test('buffer ranges preserve gaps and match frame slider endpoints', () => {
  const urls = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(loadedFrameRanges(urls, new Set(['a', 'b', 'e'])), [
    { start: 0, end: 1, left: 0, width: 37.5 },
    { start: 4, end: 4, left: 87.5, width: 12.5 },
  ]);
  assert.deepEqual(loadedFrameRanges(urls, new Set(urls)), [
    { start: 0, end: 4, left: 0, width: 100 },
  ]);
  assert.deepEqual(loadedFrameRanges(['e', 'a'], new Set(['a'])), [
    { start: 1, end: 1, left: 50, width: 50 },
  ]);
  assert.deepEqual(loadedFrameRanges(['a'], new Set(['a'])), [
    { start: 0, end: 0, left: 0, width: 100 },
  ]);
  assert.deepEqual(loadedFrameRanges([], new Set(['a'])), []);
  assert.deepEqual(loadedFrameRanges(urls, new Set(['other-camera'])), []);
});

void test('preloading and selecting a frame share one request until it is decoded', async () => {
  let finish!: (value: HTMLImageElement) => void;
  let calls = 0;
  const cache = new PreviewImageCache(() => {
    calls++;
    return new Promise((resolve) => { finish = resolve; });
  });
  const preload = cache.get('frame-a');
  const selected = cache.get('frame-a');
  assert.equal(preload, selected);
  assert.equal(calls, 1);
  const decoded = image('frame-a');
  finish(decoded);
  assert.equal(await selected, decoded);
  assert.equal(await cache.get('frame-a'), decoded);
  assert.equal(calls, 1);
});

void test('a failed load can be retried and does not replace a cached frame', async () => {
  let attempts = 0;
  const cache = new PreviewImageCache(async (url) => {
    if (url === 'bad' && attempts++ === 0) throw new Error('network');
    return image(url);
  });
  const previous = await cache.get('good');
  await assert.rejects(cache.get('bad'), /network/);
  assert.equal(await cache.get('good'), previous);
  assert.equal((await cache.get('bad')).src, 'bad');
});

void test('decoded frames use a bounded least-recently-used working set', async () => {
  const loads: string[] = [];
  const cache = new PreviewImageCache(async (url) => {
    loads.push(url);
    return image(url);
  }, 2);
  const a = await cache.get('a?low=1');
  await cache.get('b');
  assert.equal(await cache.get('a?low=1'), a);
  await cache.get('a?low=2');
  assert.equal(await cache.get('a?low=1'), a);
  await cache.get('b');
  assert.deepEqual(loads, ['a?low=1', 'b', 'a?low=2', 'b']);
});

void test('the browser loader waits for decoding, not just assigning the image URL', async () => {
  const original = globalThis.Image;
  let finish!: () => void;
  class FakeImage {
    src = '';
    decoding = '';
    decode() { return new Promise<void>((resolve) => { finish = resolve; }); }
  }
  globalThis.Image = FakeImage as unknown as typeof Image;
  try {
    let ready = false;
    const pending = new PreviewImageCache().get('/preview').then((value) => {
      ready = true;
      return value;
    });
    await Promise.resolve();
    assert.equal(ready, false);
    finish();
    assert.equal((await pending).src, '/preview');
    assert.equal(ready, true);
  } finally {
    globalThis.Image = original;
  }
});
