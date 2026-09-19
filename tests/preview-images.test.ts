import test from 'node:test';
import assert from 'node:assert/strict';
import { PreviewImageCache } from '../lib/preview-images.ts';

const image = (src: string) => ({ src }) as HTMLImageElement;

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
