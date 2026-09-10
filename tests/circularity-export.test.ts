import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circularityCSV } from '../lib/circularity-export.ts';
import type { Job } from '../lib/research.ts';

void test('circularity CSV distinguishes missing contours from zero and labels sensitivity', () => {
  const result = {
    recipe: { exclude_interpolated: true },
    method: { version: 'test', circularity: { band: 'threshold sensitivity' } },
    rows: [
      {
        timestamp: '2026-03-15T00:00:00Z',
        channel: 'WFI',
        frame_id: 'a',
        circularity: {
          '1': {
            status: 'ok',
            departure_pct: 0,
            sensitivity_low_pct: 0,
            sensitivity_high_pct: 1,
            variants: [
              { threshold_kR: 0.95, status: 'ok', departure_pct: 1 },
              {},
              { threshold_kR: 1.05, status: 'ok', departure_pct: 0.5 },
            ],
          },
          '3': { status: 'open_or_missing', departure_pct: null, variants: [] },
        },
      },
    ],
  } as unknown as Job;
  const lines = circularityCSV(result).split('\r\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes('sensitivity_low_pct,sensitivity_high_pct'));
  assert.ok(
    lines[1].startsWith(
      '"2026-03-15T00:00:00Z","WFI","a","1","ok","0","0","1"',
    ),
  );
  assert.ok(
    lines[2].startsWith(
      '"2026-03-15T00:00:00Z","WFI","a","3","open_or_missing",""',
    ),
  );
  assert.ok(lines[1].includes('threshold sensitivity'));
});
