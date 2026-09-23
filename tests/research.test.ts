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
  isPairedROI,
  pairedAnnularFromDrag,
  pairedAnnularCorners,
  pairedAnnularDragAnchor,
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

void test('annular drag on either side or in reverse gives the same opposite pair', () => {
  const bounds = pairedAnnularFromDrag([-6, 3], [-3, -1]);
  assert.deepEqual(bounds, {
    inner: 3.16,
    outer: 6.71,
    angle_start: -26.57,
    angle_end: 18.43,
  });
  assert.deepEqual(pairedAnnularFromDrag([-3, -1], [-6, 3]), bounds);
  assert.deepEqual(pairedAnnularFromDrag([6, -3], [3, 1]), bounds);
  const roi = {
    ...DEFAULT_ROI,
    kind: 'paired_annular_sectors' as const,
    ...bounds,
  };
  const [left, right] = pairedSectors(roi);
  assert.equal(left.roi.inner, right.roi.inner);
  assert.equal(left.roi.outer, right.roi.outer);
  assert.equal(left.roi.angle_start, right.roi.angle_start + 180);
  assert.equal(left.roi.angle_end, right.roi.angle_end + 180);
  for (const corner of pairedAnnularCorners(roi)) {
    assert.deepEqual(
      pairedAnnularDragAnchor(roi, corner.point, 0.01),
      corner.anchor,
    );
    assert.deepEqual(
      pairedAnnularFromDrag(corner.point, corner.anchor),
      bounds,
    );
  }
  assert.deepEqual(pairedAnnularDragAnchor(roi, [1, 0], 0.01), [1, 0]);
  assert.equal(pairedAnnularFromDrag([-3, 1], [3, -1]), null);
  assert.equal(pairedAnnularFromDrag([0, 0], [3, -1]), null);
  assert.equal(pairedAnnularFromDrag([3, 1], [3, 1]), null);
});

void test('paired annular validation and saved recipe include both radii and angles', () => {
  const roi = {
    ...DEFAULT_ROI,
    kind: 'paired_annular_sectors' as const,
    angle_start: -30,
    angle_end: 20,
  };
  assert.equal(roiError(roi), null);
  assert.equal(isPairedROI(roi), true);
  assert.deepEqual(activeROI(roi), {
    kind: roi.kind,
    inner: 4.5,
    outer: 5.5,
    angle_start: -30,
    angle_end: 20,
  });
  for (const patch of [
    { inner: NaN },
    { outer: 3 },
    { angle_start: -91 },
    { angle_end: 91 },
    { angle_end: -30 },
  ])
    assert.ok(roiError({ ...roi, ...patch }));
  for (const patch of [
    { inner: 4 },
    { outer: 6 },
    { angle_start: -20 },
    { angle_end: 30 },
  ])
    assert.notEqual(
      regionSignature(roi, true),
      regionSignature({ ...roi, ...patch }, true),
    );
  assert.equal(
    regionSignature(roi, true),
    regionSignature({ ...roi, angle_width: 179 }, true),
  );
});
