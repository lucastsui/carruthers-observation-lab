'use client';
import { useContextSeries } from '@/hooks/use-reference-data';
import { MeasurementChart } from '@/components/measurement-chart';
export function ContextChart({
  kind,
  start,
  end,
  domain,
  selected,
}: {
  kind: 'dst' | 'lyman';
  start: string;
  end: string;
  domain: [number, number];
  selected?: number;
}) {
  const { state, retry } = useContextSeries(kind, start, end);
  const value = state?.value;
  const color = kind === 'dst' ? '#a9a1ff' : '#f3a962';
  return (
    <div className="context-chart">
      <div className="context-heading">
        <strong style={{ color }}>
          {kind === 'dst' ? 'Dst' : 'Solar Lyman-α'}
        </strong>
        <a
          href={
            kind === 'dst'
              ? 'https://wdc.kugi.kyoto-u.ac.jp/dstdir/index.html'
              : 'https://lasp.colorado.edu/lisird/data/composite_lyman_alpha'
          }
          target="_blank"
          rel="noreferrer"
          title={value ? `${value.source}. ${value.interpretation ?? ''}` : undefined}
        >
          {kind === 'dst' ? 'Kyoto · provisional · nT' : 'LISIRD · mW/m² at 1 AU'}
        </a>
      </div>
      {value?.status === 'available' ? (
        <>
          <MeasurementChart
            data={value.data}
            time
            domain={domain}
            compact
            daily={kind === 'lyman'}
            maxGap={kind === 'dst' ? 90 * 60 * 1000 : undefined}
            cadenceLabel="Hourly means · UTC (hour centers)"
            seriesLabel={value.name}
            units={value.units}
            color={color}
            selected={selected}
            label={`${value.name} ${value.units} versus UTC on the brightness plot time interval`}
          />
          {value.stale && (
            <span className="small status">
              Cached observations · source temporarily unavailable
            </span>
          )}
        </>
      ) : (
        <output className="context-empty">
          {state
            ? state.error || value?.error || 'No source data for this interval.'
            : 'Loading reference observations…'}
          {state && (
            <button className="button ghost" onClick={retry}>
              Retry
            </button>
          )}
        </output>
      )}
    </div>
  );
}
