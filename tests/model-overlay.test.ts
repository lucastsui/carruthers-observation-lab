import test from 'node:test';
import assert from 'node:assert/strict';
import {
  modelOverlayKey,
  matchingModelOverlay,
  type ModelContours,
} from '../lib/model-overlay.ts';

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
