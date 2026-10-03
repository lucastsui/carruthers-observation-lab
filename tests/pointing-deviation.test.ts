import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pointingDeviationGeometry,
  sunAligned,
  type Vec3,
} from '../lib/orbit.ts';

function close(actual: number[], expected: number[], tolerance = 1e-12) {
  assert.ok(Math.hypot(...actual.map((v, i) => v - expected[i])) < tolerance);
}

void test('Earth reference points from the spacecraft to Earth, not along the Sun axis', () => {
  const result = pointingDeviationGeometry([-1, 0, 0], [2, 2, 0])!;
  assert.ok(Math.abs(result.angleDeg - 45) < 1e-12);
  close(result.reference, [-Math.SQRT1_2, -Math.SQRT1_2, 0]);
  close(result.boresight, [-1, 0, 0]);
});

void test('true-angle arc has unit radius and ends on both directed rays', () => {
  for (const degrees of [0.001, 0.35, 30, 90, 179.999, 180]) {
    const radians = (degrees * Math.PI) / 180;
    const result = pointingDeviationGeometry(
      [-Math.cos(radians), Math.sin(radians), 0],
      [100, 0, 0],
    )!;
    assert.ok(Math.abs(result.angleDeg - degrees) < 1e-10);
    close(result.arc[0], result.reference);
    close(result.arc.at(-1)!, result.boresight);
    for (const point of result.arc)
      assert.ok(Math.abs(Math.hypot(...point) - 1) < 1e-10);
    assert.ok(Math.abs(result.arc[16][0] + Math.cos(radians / 2)) < 1e-10);
  }
});

void test('pointing away from Earth is 180 degrees, not zero', () => {
  const aligned = pointingDeviationGeometry([-1, 0, 0], [1, 0, 0])!;
  assert.equal(aligned.angleDeg, 0);
  assert.deepEqual(aligned.arc, []);
  const away = pointingDeviationGeometry([1, 0, 0], [1, 0, 0])!;
  assert.equal(away.angleDeg, 180);
  assert.equal(away.arc.length, 33);
});

void test('angle and arc survive display rotation and spacecraft distance compression', () => {
  const b: Vec3 = [-2, -1, 0.01],
    position: Vec3 = [200, 100, 0];
  const original = pointingDeviationGeometry(b, position)!;
  const sun: Vec3 = [100, 20, 30];
  for (const factor of [0.45, 1]) {
    const result = pointingDeviationGeometry(
      sunAligned(b, sun),
      sunAligned(position, sun).map((v) => v * factor) as Vec3,
    )!;
    assert.ok(Math.abs(result.angleDeg - original.angleDeg) < 1e-12);
    result.arc.forEach((v, i) => close(v, sunAligned(original.arc[i], sun)));
  }
});

void test('invalid directions and spacecraft positions are rejected', () => {
  for (const bad of [
    [0, 0, 0],
    [NaN, 0, 0],
    [Infinity, 0, 0],
  ] as Vec3[]) {
    assert.equal(pointingDeviationGeometry(bad, [1, 0, 0]), null);
    assert.equal(pointingDeviationGeometry([1, 0, 0], bad), null);
  }
});
