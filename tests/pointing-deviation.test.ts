import test from 'node:test';
import assert from 'node:assert/strict';
import { pointingDeviationGeometry, type Vec3 } from '../lib/orbit.ts';

function close(actual: number[], expected: number[]) {
  assert.ok(Math.hypot(...actual.map((v, i) => v - expected[i])) < 1e-12);
}

void test('anti-sunward boresight uses the near end of the line and the correct tilt side', () => {
  const result = pointingDeviationGeometry([-Math.sqrt(3), 1, 0], [2, 0, 0])!;
  assert.ok(Math.abs(result.angleDeg - 30) < 1e-12);
  close(result.reference, [-1, 0, 0]);
  close(result.direction!, [0, 1, 0]);
});

void test('tilt direction stays unit length across angles and follows the transverse azimuth', () => {
  for (const degrees of [5, 30, 70]) {
    const radians = (degrees * Math.PI) / 180;
    const result = pointingDeviationGeometry(
      [-Math.cos(radians), 0, -Math.sin(radians)],
      [1, 0, 0],
    )!;
    close(result.direction!, [0, 0, -1]);
    assert.ok(Math.abs(result.angleDeg - degrees) < 1e-10);
  }
});

void test('reversing the reference line does not reverse the tilt arrow', () => {
  const b: Vec3 = [-2, 1, 1];
  const a = pointingDeviationGeometry(b, [1, 0, 0])!;
  const c = pointingDeviationGeometry(b, [-1, 0, 0])!;
  close(a.direction!, c.direction!);
  close(a.reference, c.reference);
  assert.equal(a.angleDeg, c.angleDeg);
});

void test('aligned directions have no tilt arrow and invalid vectors are rejected', () => {
  for (const b of [[1, 0, 0], [-1, 0, 0]] as Vec3[]) {
    const result = pointingDeviationGeometry(b, [1, 0, 0])!;
    assert.equal(result.direction, null);
    assert.equal(result.angleDeg, 0);
  }
  assert.equal(pointingDeviationGeometry([0, 0, 0], [1, 0, 0]), null);
  assert.equal(pointingDeviationGeometry([1, 0, 0], [0, 0, 0]), null);
  assert.equal(pointingDeviationGeometry([NaN, 0, 0], [1, 0, 0]), null);
});
