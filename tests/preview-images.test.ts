import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewImageCache } from '../lib/preview-images.ts';
import { loadedFrameRanges } from '../lib/loaded-frame-ranges.ts';

const image = (src: string) => ({ src }) as HTMLImageElement;

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
