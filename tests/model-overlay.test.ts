import test from 'node:test';
import assert from 'node:assert/strict';
import {
  modelOverlayKey,
  matchingModelOverlay,
  modelLabelPosition,
  dailyModelIrradiance,
  type ModelContours,
} from '../lib/model-overlay.ts';
import type { ContextSeries } from '../lib/research.ts';

void test('solar irradiance uses the displayed UTC day, including frames before the daily noon timestamp', () => {
  const series = {
    kind: 'lyman', units: 'mW/m²',
    data: [
      { x: Date.parse('2026-03-01T12:00:00Z'), y: 8.325571194291115 },
      { x: Date.parse('2026-03-02T12:00:00Z'), y: 7.380708586424589 },
    ],
  } as ContextSeries;
  for (const time of ['2026-03-01T00:00:00Z', '2026-03-01T23:59:59Z']) {
    assert.equal(dailyModelIrradiance(series, time.slice(0, 10)), 8.326);
  }
  assert.equal(dailyModelIrradiance(series, '2026-03-02'), 7.381);
  assert.equal(dailyModelIrradiance(series, '2026-03-03'), null);
  assert.equal(dailyModelIrradiance(undefined, '2026-03-01'), null);
});

void test('missing, wrong-unit and out-of-range solar observations are not substituted or clamped', () => {
  const series = {
    kind: 'lyman', units: 'mW/m²',
    data: [{ x: Date.parse('2026-03-01T12:00:00Z'), y: 8 }],
  } as ContextSeries;
  for (const y of [null, NaN, Infinity, -9999, 0, 0.9, 30.1]) {
    assert.equal(dailyModelIrradiance({ ...series, data: [{ ...series.data[0], y }] }, '2026-03-01'), null);
  }
  assert.equal(dailyModelIrradiance({ ...series, units: 'W/m^2' }, '2026-03-01'), null);
  assert.equal(dailyModelIrradiance({ ...series, kind: 'dst' }, '2026-03-01'), null);
});

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
    brightness_scale: 1,
    exclude_interpolated: true,
  } as ModelContours;
  assert.equal(matchingModelOverlay(value, 'a', 'Z15MAX', 6, true), true);
  assert.equal(matchingModelOverlay(value, 'b', 'Z15MAX', 6, true), false);
  assert.equal(matchingModelOverlay(value, 'a', 'Z15MIN', 6, true), false);
  assert.equal(matchingModelOverlay(value, 'a', 'Z15MAX', 7, true), false);
  assert.equal(matchingModelOverlay(value, 'a', 'Z15MAX', 6, false), false);
  assert.equal(matchingModelOverlay({ ...value, brightness_scale: 4 * Math.PI }, 'a', 'Z15MAX', 6, true), false);
});
