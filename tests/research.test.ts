import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  snapPointToPixel,
  DEFAULT_ROI,
  activeROI,
  regionSignature,
  roiError,
  pairedOpeningAngle,
  pairedSectors,
} from '../lib/research.ts';

void test('NFI click near a pixel boundary remains in the clicked pixel', () => {
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

void test('saved compact region parameters match the active selection', () => {
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

void test('empty and reversed regions have useful validation', () => {
  assert.equal(roiError(DEFAULT_ROI), null);
  assert.ok(roiError({ ...DEFAULT_ROI, inner: NaN }));
  assert.ok(roiError({ ...DEFAULT_ROI, inner: 6 }));
  assert.ok(roiError({ ...DEFAULT_ROI, kind: 'rectangle', x1: 3, x2: 2 }));
});

void test('paired angle dragging is symmetric and changes the analysis recipe', () => {
  for (const [x, y] of [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ])
    assert.equal(pairedOpeningAngle(x, y), 90);
  assert.equal(pairedOpeningAngle(1, 0), 1);
  assert.equal(pairedOpeningAngle(0, 1), 180);
  const roi = {
    ...DEFAULT_ROI,
    kind: 'paired_sectors' as const,
    angle_width: 60,
  };
  assert.deepEqual(
    pairedSectors(roi).map(({ roi }) => [roi.angle_start, roi.angle_end]),
    [
      [150, 210],
      [-30, 30],
    ],
  );
  assert.equal(roiError(roi), null);
  assert.equal(roiError({ ...roi, inner: NaN, outer: NaN }), null);
  assert.equal(
    regionSignature(roi, true),
    regionSignature({ ...roi, inner: NaN, outer: NaN }, true),
  );
  assert.ok(roiError({ ...roi, angle_width: 181 }));
  assert.deepEqual(activeROI(roi), {
    kind: 'paired_sectors',
    angle_width: 60,
  });
  assert.notEqual(
    regionSignature(roi, true),
    regionSignature({ ...roi, angle_width: 45 }, true),
  );
  assert.equal(
    regionSignature(roi, true),
    regionSignature({ ...roi, angle_start: 99 }, true),
  );
});
