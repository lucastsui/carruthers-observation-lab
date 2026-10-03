import test from 'node:test';
import assert from 'node:assert/strict';
import {
  modelOverlayKey,
  matchingModelOverlay,
  modelLabelPosition,
  type ModelContours,
} from '../lib/model-overlay.ts';

void test('model labels fit completely inside the supported region and avoid holes', () => {
  const rings: [number, number][][] = [
    [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ],
    [
      [40, 40],
      [60, 40],
      [60, 60],
      [40, 60],
      [40, 40],
    ],
  ];
  assert.deepEqual(modelLabelPosition([[20, 20]], rings, 20, 10, 0), [20, 20]);
  assert.equal(modelLabelPosition([[3, 20]], rings, 20, 10, 0), null);
  assert.equal(modelLabelPosition([[50, 50]], rings, 10, 10, 0), null);
  assert.equal(modelLabelPosition([[35, 50]], rings, 20, 10, 0), null);
  assert.deepEqual(
    modelLabelPosition(
      [
        [50, 50],
        [20, 20],
      ],
      rings,
      20,
      10,
      0,
    ),
    [20, 20],
  );
});

void test('model cache identity changes with every physical or mask input', () => {
  const key = modelOverlayKey('frame-a', 'Z15MAX', 6, true);
  for (const changed of [
    modelOverlayKey('frame-b', 'Z15MAX', 6, true),
    modelOverlayKey('frame-a', 'Z15MIN', 6, true),
    modelOverlayKey('frame-a', 'Z15MAX', 7, true),
    modelOverlayKey('frame-a', 'Z15MAX', 6, false),
  ])
    assert.notEqual(changed, key);
});

void test('late contours from another frame, model, illumination or mask are rejected', () => {
  const value = {
    frame_id: 'a',
    model: 'Z15MAX',
    irradiance_mw: 6,
    exclude_interpolated: true,
  } as ModelContours;
  assert.equal(matchingModelOverlay(value, 'a', 'Z15MAX', 6, true), true);
  assert.equal(matchingModelOverlay(value, 'b', 'Z15MAX', 6, true), false);
  assert.equal(matchingModelOverlay(value, 'a', 'Z15MIN', 6, true), false);
  assert.equal(matchingModelOverlay(value, 'a', 'Z15MAX', 7, true), false);
  assert.equal(matchingModelOverlay(value, 'a', 'Z15MAX', 6, false), false);
});
