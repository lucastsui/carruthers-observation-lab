import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analysisCSV } from '../lib/analysis-export.ts';
import { DEFAULT_ROI } from '../lib/research.ts';
import type { Job, Measurement } from '../lib/research.ts';

for (const kind of ['paired_sectors', 'paired_annular_sectors'] as const)
  void test(`${kind} CSV labels separate values and preserves a missing sector`, () => {
    const result = {
      recipe: {
        roi: { ...DEFAULT_ROI, kind },
        exclude_interpolated: true,
      },
      rows: [
        {
          timestamp: '2026-03-15T00:00:00Z',
          channel: 'WFI',
          mean_kR: 100,
          regions: {
            dawn: { mean_kR: -1, valid_pixels: 4, coverage: 1 },
            dusk: { mean_kR: null, valid_pixels: 0, coverage: 0 },
          },
        } as Measurement,
      ],
    } as Job;
    const lines = analysisCSV(result).split('\r\n');
    assert.equal(lines.length, 3);
    assert.ok(lines[0].startsWith('timestamp_utc,channel,region,mean_kR'));
    assert.ok(lines[1].startsWith('"2026-03-15T00:00:00Z","WFI","dawn","-1"'));
    assert.ok(lines[2].startsWith('"2026-03-15T00:00:00Z","WFI","dusk",""'));
    assert.ok(lines[1].includes(kind));
    assert.ok(lines[2].includes(kind));
    const single = {
      ...result,
      recipe: { ...result.recipe, roi: DEFAULT_ROI },
    };
    assert.equal(analysisCSV(single).split('\r\n').length, 2);
    assert.ok(analysisCSV(single).startsWith('timestamp_utc,channel,mean_kR'));
  });
