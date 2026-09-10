'use client';
import { Download } from 'lucide-react';
import { MeasurementChart } from '@/components/measurement-chart';
import { downloadText } from '@/lib/research';
import type { Job, ContourFit } from '@/lib/research';
import { circularityCSV } from '@/lib/circularity-export';

const levels = [
  { key: '1', label: '1 kR', color: '#e8b867' },
  { key: '3', label: '3 kR', color: '#80baff' },
] as const;
const statusText: Record<ContourFit['status'], string> = {
  ok: '',
  open_or_missing: 'Incomplete contour',
  ambiguous: 'Ambiguous contour',
  unresolved: 'Contour too small',
  fit_failed: 'Circle fit unavailable',
};

export function CircularityChart({
  result,
  busy,
  selected,
  onSelect,
  onAnalyze,
}: {
  result: Job | null;
  busy: boolean;
  selected?: number;
  onSelect: (id: string) => void;
  onAnalyze: () => void;
}) {
  const rows = result?.rows || [];
  const calculated = rows.some((row) => !!row.circularity);
  const series = levels.map((level) => ({
    label: level.label,
    color: level.color,
    data: rows.map((row) => {
      const value = row.circularity?.[level.key];
      return {
        x: row.epoch_ms,
        id: row.frame_id,
        y: value?.departure_pct ?? null,
        low: value?.sensitivity_low_pct,
        high: value?.sensitivity_high_pct,
        note:
          value?.status === 'ok'
            ? value.sensitivity_low_pct == null
              ? 'Sensitivity unavailable'
              : undefined
            : value
              ? statusText[value.status]
              : 'Not calculated',
      };
    }),
  }));
  const counts = series.map((s) => s.data.filter((p) => p.y !== null).length);
  return (
    <section
      className="chart-panel circularity-chart"
      aria-label="Contour circularity through time"
      aria-busy={busy}
    >
      <div className="chart-header">
        <h3>Contour circularity</h3>
        <button
          className="button ghost"
          disabled={!calculated}
          aria-label="Download circularity as CSV"
          onClick={() =>
            result &&
            downloadText(
              `carruthers-${result.recipe.channel}-${result.recipe.start.slice(0, 10)}-circularity.csv`,
              circularityCSV(result),
              'text/csv;charset=utf-8',
            )
          }
        >
          <Download />
          CSV
        </button>
      </div>
      <p className="small muted plot-legend">
        Departure from circularity · 0% is a circle · lower is rounder
      </p>
      {calculated ? (
        <>
          {counts.some((n) => n > 0) ? (
            <MeasurementChart
              data={series[0].data}
              series={series}
              time
              units="%"
              zeroBased
              seriesLabel="Contour levels"
              selected={selected}
              onSelect={onSelect}
              label="Departure from circularity for 1 and 3 kilo-Rayleigh contours, with threshold-sensitivity bands, versus observation time"
            />
          ) : (
            <div className="chart-empty">
              No complete 1 kR or 3 kR contours surround Earth in this interval.
              Clipped or masked contours have no circularity score.
            </div>
          )}
          <p className="small muted plot-legend">
            Valid contours: 1 kR {counts[0]}/{rows.length} · 3 kR {counts[1]}/
            {rows.length}
          </p>
          <p className="small muted plot-legend">
            Shading: ±5% threshold sensitivity, not a confidence interval. Gaps:
            unavailable contours.
          </p>
        </>
      ) : (
        <div className="chart-empty">
          {busy ? (
            'Calculating contour circularity…'
          ) : result ? (
            <span>
              This saved analysis has no circularity measurements.{' '}
              <button className="button" onClick={onAnalyze}>
                Calculate circularity
              </button>
            </span>
          ) : (
            'Choose Analyze at the top right of the image to calculate circularity through time.'
          )}
        </div>
      )}
      <details className="circularity-definition">
        <summary>Definition & sensitivity</summary>
        <p>
          100 × RMS distance from the fitted circle ÷ fitted radius. The center
          is free to move. Each full contour is sampled at 512 equal arc-length
          intervals; the selected region does not restrict it. Radiance is
          unsmoothed.
        </p>
        <p>
          Bands span the results at 0.95, 1.00 and 1.05 kR, or 2.85, 3.00 and
          3.15 kR. All three contours must be valid to show a band. These ranges
          test threshold sensitivity and do not estimate measurement-noise
          uncertainty.
        </p>
      </details>
    </section>
  );
}
