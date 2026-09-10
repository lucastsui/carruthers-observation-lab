import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LOG_R,
  radianceTicks,
  DAWN_SECTOR,
  DUSK_SECTOR,
} from '../lib/display.ts';
import { sunAligned } from '../lib/orbit.ts';
void test('radiance ticks span exactly 270 kR and decades have equal spacing', () => {
  const ticks = radianceTicks(1, MAX_LOG_R);
  assert.ok(Math.abs(ticks.at(-1)!.value - 270) < 1e-9);
  const at = (v: number) =>
    ticks.find((t) => Math.abs(t.value - v) < 1e-9)!.fraction;
  assert.ok(Math.abs(at(1) - at(0.1) - (at(10) - at(1))) < 1e-12);
});
void test('dawn and dusk presets are 45-degree sectors centered left/right', () => {
  assert.equal(DAWN_SECTOR.angle_end - DAWN_SECTOR.angle_start, 45);
  assert.equal((DAWN_SECTOR.angle_end + DAWN_SECTOR.angle_start) / 2, 180);
  assert.equal(DUSK_SECTOR.angle_end - DUSK_SECTOR.angle_start, 45);
  assert.equal((DUSK_SECTOR.angle_end + DUSK_SECTOR.angle_start) / 2, 0);
});
void test('Sun-aligned transform preserves lengths and places the Sun on positive x', () => {
  const v = sunAligned([100, 20, 30], [100, 20, 30]);
  assert.ok(Math.abs(v[0] - Math.hypot(100, 20, 30)) < 1e-10);
  assert.ok(Math.abs(v[1]) + Math.abs(v[2]) < 1e-10);
  const w = sunAligned([6, 7, 8], [100, 20, 30]);
  assert.ok(Math.abs(Math.hypot(...w) - Math.hypot(6, 7, 8)) < 1e-10);
});
