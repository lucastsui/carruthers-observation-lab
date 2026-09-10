import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBandRuns } from '../lib/plot-bands.ts';

void test('sensitivity bands stop at missing curves, missing bounds and observation gaps', () => {
  const p = (x: number) => ({ x, y: 3, low: 2, high: 4 });
  const data = [
    p(0),
    p(1),
    { ...p(2), y: null },
    p(3),
    { ...p(4), low: null },
    p(5),
    p(20),
  ];
  assert.deepEqual(
    splitBandRuns(data, 5).map((r) => r.map((p) => p.x)),
    [[0, 1], [3], [5], [20]],
  );
  assert.deepEqual(splitBandRuns([{ ...p(0), low: 5 }]), []);
  assert.deepEqual(splitBandRuns([{ ...p(0), high: NaN }]), []);
});
