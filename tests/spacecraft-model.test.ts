import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import {
  MODEL_TO_BODY,
  spacecraftModelQuaternion,
} from '../lib/spacecraft-model.ts';

function close(actual: Vector3, expected: number[]) {
  assert.ok(
    actual.distanceTo(new Vector3(...expected)) < 1e-12,
    actual.toArray().join(','),
  );
}

void test('model cells and telescope apertures have opposite, correctly registered faces', () => {
  close(new Vector3(0, 0, -1).applyQuaternion(MODEL_TO_BODY), [0, 1, 0]);
  close(new Vector3(0, 0, 1).applyQuaternion(MODEL_TO_BODY), [0, -1, 0]);
  close(new Vector3(0, 1, 0).applyQuaternion(MODEL_TO_BODY), [0, 0, 1]);
});

void test('recorded attitude turns panel toward Sun without reversing boresight', () => {
  // Body +90 degrees about Z: array normal +Y becomes world -X.
  const h = Math.SQRT1_2;
  for (const sign of [1, -1]) {
    const pose = spacecraftModelQuaternion(
      [0, 0, sign * h, sign * h],
      [-1, 0, 0],
    );
    close(new Vector3(0, 0, -1).applyQuaternion(pose), [1, 0, 0]);
    close(new Vector3(0, 0, 1).applyQuaternion(pose), [-1, 0, 0]);
    assert.ok(Math.abs(pose.length() - 1) < 1e-12);
  }
});

void test('measured panel tilt is retained, not replaced by forced Sun pointing', () => {
  const pose = spacecraftModelQuaternion([0, 0, 0, 1], [1, 1, 0]);
  const normal = new Vector3(0, 0, -1).applyQuaternion(pose);
  assert.ok(
    Math.abs(normal.angleTo(new Vector3(1, 0, 0)) - Math.PI / 4) < 1e-12,
  );
});

void test('invalid attitudes and Sun vectors are rejected', () => {
  assert.throws(() => spacecraftModelQuaternion([0, 0, 0, 0], [1, 0, 0]));
  assert.throws(() => spacecraftModelQuaternion([0, 0, 0, 1], [0, 0, 0]));
});
