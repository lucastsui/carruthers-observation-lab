import test from 'node:test';
import assert from 'node:assert/strict';
import { FramePreviewCache, framePreviewKey, loadFrameAssets } from '../lib/frame-previews.ts';
import { PreviewCache, previewWindowIndices } from '../lib/preview-images.ts';
import { loadedFrameRanges } from '../lib/loaded-frame-ranges.ts';
import type { FrameSource } from '../lib/frame-previews.ts';
import type { Contours, Frame } from '../lib/research.ts';

const frame = (id: string) => ({ id }) as Frame;
const key = (id: string, exclude = true) => framePreviewKey(frame(id), [0, 5.4], 'radiance', exclude);
const image = (id: string) => new Blob([id], { type: 'image/png' });
const decode = async (source: FrameSource) => ({ image: { src: await source.image.text() } as HTMLImageElement, isolines: source.isolines });
const contours = (id: string): Contours => ({ frame_id: id, contours: [] });
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

void test('a frame is loaded only after both its compressed image and matching contours arrive', async () => {
  for (const first of ['image', 'contours']) {
    const pixels = deferred<Blob>(), lines = deferred<Contours>();
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
    assert.equal(await ready.image.text(), 'a');
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

void test('both cameras retain full image-and-contour sequences while bounding decoded memory', async () => {
  const calls: string[] = [];
  const cache = new FramePreviewCache((request: string) => {
    calls.push(request);
    return loadFrameAssets(request, async url => image(url), async path =>
      contours(new URLSearchParams(path.split('?')[1]).get('id')!));
  }, decode, 0, 33);
  for (const [camera, count] of [['WFI', 633], ['NFI', 1161]] as const) {
    const keys = previewWindowIndices(count, 300).map(i => key(`${camera}-${i}`));
    cache.setPreloadWindow(keys, false);
    await cache.get(keys[0]);
    cache.setPreloadWindow(keys);
    await settle();
    assert.equal(cache.getSnapshot().size, count);
    assert.ok(keys.every(value => cache.getSnapshot().has(value)));
    assert.ok(cache.getDecodedSnapshot().size <= 33);
    assert.ok(keys.slice(0, 33).every(value => cache.getDecodedSnapshot().has(value)));
    const requests = calls.length;
    // A distant jump decodes local compressed bytes without another network load.
    const jumped = previewWindowIndices(count, count - 1).map(i => key(`${camera}-${i}`));
    cache.setPreloadWindow(jumped, false);
    assert.equal((await cache.get(jumped[0])).isolines?.frame_id, `${camera}-${count - 1}`);
    cache.setPreloadWindow(jumped);
    await settle();
    assert.equal(calls.length, requests);
    assert.equal(cache.getSnapshot().size, count);
    assert.ok(cache.getDecodedSnapshot().size <= 33);
    assert.ok(jumped.slice(0, 33).every(value => cache.getDecodedSnapshot().has(value)));
  }
  assert.equal(calls.length, 633 + 1161);
});

void test('a decode failure removes the loaded marker and a foreground retry downloads again', async () => {
  let downloads = 0, attempts = 0;
  const cache = new FramePreviewCache(async () => {
    downloads++;
    return { image: image('frame'), isolines: contours('frame') };
  }, async source => {
    if (attempts++ === 0) throw new Error('decode failed');
    return decode(source);
  }, 0);
  cache.setPreloadWindow(['frame'], false);
  await assert.rejects(cache.get('frame'), /decode failed/);
  assert.equal(cache.getSnapshot().size, 0);
  assert.equal((await cache.get('frame')).isolines?.frame_id, 'frame');
  assert.equal(downloads, 2);
});
