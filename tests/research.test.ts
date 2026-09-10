import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  snapPointToPixel,
  DEFAULT_ROI,
  activeROI,
  regionSignature,
  roiError,
} from '../lib/research.ts';

test('NFI click near a pixel boundary remains in the clicked pixel', () => {
  const frame = {
    earth_xy: [512, 512] as [number, number],
    pixels_per_re: 62.439,
  };
  assert.deepEqual(
    snapPointToPixel(
      frame,
      0.49 / frame.pixels_per_re,
      -0.49 / frame.pixels_per_re,
    ),
    { x: 0, y: 0 },
  );
  const p = snapPointToPixel(
    frame,
    1.1 / frame.pixels_per_re,
    2.1 / frame.pixels_per_re,
  );
  assert.equal(Math.round(p.x * frame.pixels_per_re), 1);
  assert.equal(Math.round(p.y * frame.pixels_per_re), 2);
});

test('saved compact region parameters match the active selection', () => {
  const compact = activeROI(DEFAULT_ROI);
  assert.deepEqual(compact, { kind: 'annulus', inner: 4.5, outer: 5.5 });
  assert.equal(
    regionSignature({ ...DEFAULT_ROI, x: 22 }, true),
    regionSignature(DEFAULT_ROI, true),
  );
  assert.notEqual(
    regionSignature(DEFAULT_ROI, false),
    regionSignature(DEFAULT_ROI, true),
  );
});

test('empty and reversed regions have useful validation', () => {
  assert.equal(roiError(DEFAULT_ROI), null);
  assert.ok(roiError({ ...DEFAULT_ROI, inner: NaN }));
  assert.ok(roiError({ ...DEFAULT_ROI, inner: 6 }));
  assert.ok(roiError({ ...DEFAULT_ROI, kind: 'rectangle', x1: 3, x2: 2 }));
});
