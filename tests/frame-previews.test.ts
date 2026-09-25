import test from 'node:test';
import assert from 'node:assert/strict';
import { framePreviewKey, loadFrameAssets } from '../lib/frame-previews.ts';
import { PreviewCache, previewWindowIndices } from '../lib/preview-images.ts';
import { loadedFrameRanges } from '../lib/loaded-frame-ranges.ts';
import type { Contours, Frame } from '../lib/research.ts';

const frame = (id: string) => ({ id }) as Frame;
const key = (id: string, exclude = true) => framePreviewKey(frame(id), [0, 5.4], 'radiance', exclude);
const image = (id: string) => ({ src: id }) as HTMLImageElement;
const contours = (id: string): Contours => ({ frame_id: id, contours: [] });
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

void test('a frame becomes ready only after both decoded pixels and matching contours are ready', async () => {
  for (const first of ['image', 'contours']) {
    const pixels = deferred<HTMLImageElement>(), lines = deferred<Contours>();
    const cache = new PreviewCache((request: string) => loadFrameAssets(request, () => pixels.promise, () => lines.promise));
    let published = false;
    const request = cache.get(key('a')).then(value => { published = true; return value; });
    if (first === 'image') pixels.resolve(image('a')); else lines.resolve(contours('a'));
    await settle();
    assert.equal(published, false);
    assert.equal(cache.getSnapshot().size, 0);
    assert.deepEqual(loadedFrameRanges([key('a')], cache.getSnapshot()), []);
    if (first === 'image') lines.resolve(contours('a')); else pixels.resolve(image('a'));
    const ready = await request;
    assert.equal(ready.image.src, 'a');
    assert.equal(ready.isolines?.frame_id, 'a');
    assert.equal(cache.getSnapshot().size, 1);
  }
});

void test('failed contours keep the previous complete frame cached and are retried without caching failure', async () => {
  let failures = 1;
  const cache = new PreviewCache((request: string) => loadFrameAssets(request,
    async url => image(url), async path => {
      const id = new URLSearchParams(path.split('?')[1]).get('id')!;
      if (id === 'bad' && failures-- > 0) throw new Error('contours unavailable');
      return contours(id);
    }));
  const previous = await cache.get(key('good'));
  await assert.rejects(cache.get(key('bad')), /contours unavailable/);
  assert.deepEqual([...cache.getSnapshot()], [key('good')]);
  assert.equal(await cache.get(key('good')), previous);
  assert.equal((await cache.get(key('bad'))).isolines?.frame_id, 'bad');
});

void test('contours from another frame cannot be published alongside the selected image', async () => {
  await assert.rejects(loadFrameAssets(key('selected'), async () => image('selected'),
    async () => contours('stale')), /identities do not match/);
});

void test('cache identities separate camera, brightness and contour mask; geometric overlays need no contour request', async () => {
  assert.notEqual(key('WFI/1'), key('NFI/1'));
  assert.notEqual(key('WFI/1'), key('WFI/1', false));
  assert.notEqual(key('WFI/1'), framePreviewKey(frame('WFI/1'), [-1, 5.4], 'radiance', true));
  for (const mode of ['re', 'none'] as const) {
    const ready = await loadFrameAssets(framePreviewKey(frame('a'), [0, 5.4], mode, true),
      async () => image('a'), async () => { throw new Error('Unexpected contour request'); });
    assert.equal(ready.isolines, null);
  }
});

void test('the 201-frame buffer preloads complete image-and-contour bundles for either camera', async () => {
  let images = 0, isolines = 0;
  const cache = new PreviewCache((request: string) => loadFrameAssets(request,
    async url => { images++; return image(url); }, async path => {
      isolines++;
      return contours(new URLSearchParams(path.split('?')[1]).get('id')!);
    }), undefined, 0);
  for (const camera of ['WFI', 'NFI']) {
    const keys = previewWindowIndices(500, 250).map(i => key(`${camera}-${i}`));
    cache.setPreloadWindow(keys, false);
    const current = await cache.get(keys[0]);
    cache.setPreloadWindow(keys);
    await settle();
    assert.equal(cache.getSnapshot().size, 201);
    assert.ok(keys.every(value => cache.getSnapshot().has(value)));
    assert.equal(await cache.get(keys[0]), current);
    assert.equal((await cache.get(keys.at(-1)!)).isolines?.frame_id, `${camera}-150`);
  }
  assert.equal(images, 402);
  assert.equal(isolines, 402);
});
