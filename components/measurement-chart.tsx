'use client';
/* eslint-disable jsx-a11y/prefer-tag-over-role -- This keyboard-operable SVG is a data selection control; an input cannot render the plot. */
import { useEffect, useRef, useState, useId } from 'react';
export type Datum = {
  x: number;
  y: number | null;
  id?: string;
  coverage?: number;
};
const valueLabel = (v: number) =>
  Number(v.toPrecision(4)).toLocaleString('en-US', {
    maximumFractionDigits: 4,
  });
export function MeasurementChart({
  data,
  time = false,
  selected,
  onSelect,
  label,
  logarithmic = false,
  baseline,
  units = 'kR',
  color = '#83dfca',
  domain,
  compact = false,
  daily = false,
  maxGap,
}: {
  data: Datum[];
  time?: boolean;
  selected?: number;
  onSelect?: (id: string) => void;
  label: string;
  logarithmic?: boolean;
  baseline?: number | null;
  units?: string;
  color?: string;
  domain?: [number, number];
  compact?: boolean;
  daily?: boolean;
  maxGap?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const valid = (d: Datum) =>
    d.y !== null && Number.isFinite(d.y) && (!logarithmic || d.y > 0);
  const points = data.filter(valid);
  const drawing = useRef<HTMLDivElement>(null);
  const clipId = useId().replaceAll(':', '');
  const [size, setSize] = useState({ width: 360, height: compact ? 95 : 180 });
  const hasPoints = points.length > 0;
  useEffect(() => {
    const element = drawing.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasPoints]);
  if (!points.length)
    return (
      <div className="chart-empty">
        {logarithmic
          ? 'No positive radiance to plot. Nonpositive values remain in exports.'
          : 'No valid data in this interval.'}
      </div>
    );
  const w = Math.max(200, size.width),
    h = Math.max(compact ? 72 : 105, size.height),
    l = 54,
    r = 18,
    t = 18,
    b = compact ? 21 : 36;
  const xmin = domain?.[0] ?? Math.min(...data.map((d) => d.x)),
    xmax = domain?.[1] ?? Math.max(...data.map((d) => d.x));
  const transform = (v: number) => (logarithmic ? Math.log10(v) : v);
  const validBaseline =
    baseline != null &&
    Number.isFinite(baseline) &&
    (!logarithmic || baseline > 0);
  const ys = points.map((d) => transform(d.y!));
  if (validBaseline) ys.push(transform(baseline!));
  const rawMin = Math.min(...ys),
    rawMax = Math.max(...ys);
  const padding = Math.max(
    (rawMax - rawMin) * 0.12,
    logarithmic ? 0.035 : Math.abs(rawMax) * 0.005,
    0.0001,
  );
  const ymin = rawMin - padding,
    ymax = rawMax + padding;
  const x = (v: number) => l + ((v - xmin) / (xmax - xmin || 1)) * (w - l - r);
  const y = (v: number) =>
    h - b - ((transform(v) - ymin) / (ymax - ymin)) * (h - b - t);
  const pathTokens: string[] = [];
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    if (!valid(d)) continue;
    if (daily) {
      pathTokens.push(
        `M ${x(Math.max(xmin, d.x - 43200000))} ${y(d.y!)} H ${x(Math.min(xmax, d.x + 43200000))}`,
      );
      continue;
    }
    const previous = data[i - 1];
    const connected =
      previous && valid(previous) && (!maxGap || d.x - previous.x <= maxGap);
    pathTokens.push(`${connected ? 'L' : 'M'} ${x(d.x)} ${y(d.y!)}`);
  }
  const path = pathTokens.join(' ');
  const nearest = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect(),
      px = ((e.clientX - box.left) / box.width) * w;
    let n = 0;
    data.forEach((d, i) => {
      if (Math.abs(x(d.x) - px) < Math.abs(x(data[n].x) - px)) n = i;
    });
    return n;
  };
  const tick = (v: number) =>
    time
      ? new Date(v)
          .toISOString()
          .slice(
            xmax - xmin > 86400000 ? 5 : 11,
            xmax - xmin > 86400000 ? 10 : 16,
          )
      : v.toFixed(1);
  const hoverIndex = hover === null ? null : Math.min(hover, data.length - 1);
  const d = hoverIndex === null ? null : data[hoverIndex];
  const ticks: number[] = [];
  if (logarithmic) {
    for (let e = Math.floor(ymin); e <= Math.ceil(ymax); e++)
      for (const m of [1, 2, 5]) {
        const v = m * 10 ** e;
        if (transform(v) >= ymin && transform(v) <= ymax) ticks.push(v);
      }
  }
  if (ticks.length < 2)
    for (let i = 0; i < (compact ? 2 : 4); i++) {
      const v = ymin + ((ymax - ymin) * i) / (compact ? 1 : 3);
      ticks.push(logarithmic ? 10 ** v : v);
    }
  const spacedTicks = ticks.reduce<number[]>((kept, v) => {
    if (!kept.length || Math.abs(y(v) - y(kept[kept.length - 1])) >= 20)
      kept.push(v);
    return kept;
  }, []);
  return (
    <div className={`plot-root ${compact ? 'compact-plot' : ''}`}>
      <div className="plot-drawing" ref={drawing}>
        <svg
          className="chart"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={data.length - 1}
          aria-valuenow={hoverIndex ?? 0}
          aria-valuetext={`${tick(data[hoverIndex ?? 0].x)}: ${data[hoverIndex ?? 0].y ?? 'Missing'} ${units}`}
          aria-roledescription="interactive chart"
          tabIndex={0}
          aria-label={label}
          viewBox={`0 0 ${w} ${h}`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              setHover((i) =>
                Math.max(
                  0,
                  Math.min(
                    data.length - 1,
                    (i ?? 0) + (e.key === 'ArrowRight' ? 1 : -1),
                  ),
                ),
              );
            }
            if (e.key === 'Enter' && d?.id) onSelect?.(d.id);
          }}
          onPointerMove={(e) => setHover(nearest(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            const i = nearest(
              e as unknown as React.PointerEvent<SVGSVGElement>,
            );
            if (data[i].id) onSelect?.(data[i].id!);
          }}
          style={{ cursor: onSelect ? 'pointer' : 'default' }}
        >
          <title>{label}</title>
          <defs>
            <clipPath id={clipId}>
              <rect x={l} y={t} width={w - l - r} height={h - b - t} />
            </clipPath>
          </defs>
          {spacedTicks.map((v, i) => (
            <g key={i}>
              <line className="grid" x1={l} x2={w - r} y1={y(v)} y2={y(v)} />
              <line x1={l - 4} x2={l} y1={y(v)} y2={y(v)} stroke="#8495a6" />
              <text x={l - 8} y={y(v) + 4} textAnchor="end">
                {valueLabel(v)}
              </text>
            </g>
          ))}
          {Array.from({ length: w < 400 ? 3 : 5 }, (_, i) => {
            const v = xmin + ((xmax - xmin) * i) / (w < 400 ? 2 : 4);
            return (
              <g key={i}>
                <line
                  x1={x(v)}
                  x2={x(v)}
                  y1={h - b}
                  y2={h - b + 4}
                  stroke="#8495a6"
                />
                <text x={x(v)} y={h - b + 17} textAnchor="middle">
                  {tick(v)}
                </text>
              </g>
            );
          })}
          <text x={l} y={12}>
            {units}
          </text>
          {!compact && (
            <text x={(l + w - r) / 2} y={h - 1} textAnchor="middle">
              {time ? 'Observation time · UTC' : 'Projected radius · Rᴇ'}
            </text>
          )}
          <g clipPath={`url(#${clipId})`}>
            {validBaseline && (
              <line
                x1={l}
                x2={w - r}
                y1={y(baseline!)}
                y2={y(baseline!)}
                stroke="#e8b867"
                strokeWidth="1.6"
                strokeDasharray="6 4"
              >
                <title>
                  First-frame baseline: {valueLabel(baseline!)} {units}
                </title>
              </line>
            )}
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={compact ? 1.3 : 1.8}
            />
            {points.length < 150 &&
              points.map((v, i) => (
                <circle
                  key={i}
                  cx={x(v.x)}
                  cy={y(v.y!)}
                  r={compact ? 2 : 3}
                  fill={(v.coverage ?? 1) < 0.8 ? '#f4bd74' : color}
                >
                  <title>
                    {time
                      ? new Date(v.x).toISOString()
                      : `${v.x.toFixed(2)} Rᴇ`}
                    : {v.y?.toFixed(4)} {units}
                    {v.coverage !== undefined
                      ? `; ${(v.coverage * 100).toFixed(1)}% valid`
                      : ''}
                  </title>
                </circle>
              ))}
            {selected !== undefined && selected >= xmin && selected <= xmax && (
              <line
                x1={x(selected)}
                x2={x(selected)}
                y1={t}
                y2={h - b}
                stroke="#d8e4ed"
                strokeDasharray="4 4"
                opacity=".7"
              />
            )}
            {d && (
              <line
                x1={x(d.x)}
                x2={x(d.x)}
                y1={t}
                y2={h - b}
                stroke={color}
                opacity=".5"
              />
            )}
          </g>
        </svg>
      </div>
      <div className="chart-readout mono">
        {d
          ? `${time ? new Date(d.x).toISOString().slice(5, 16).replace('T', ' ') : `${d.x.toFixed(2)} Rᴇ`} · ${d.y == null ? 'Missing' : valueLabel(d.y)} ${units}${d.coverage !== undefined ? ` · ${(d.coverage * 100).toFixed(1)}% valid` : ''}`
          : compact
            ? daily
              ? 'Daily means · UTC; no subdaily variation inferred'
              : '1-minute observations · UTC'
            : time
              ? 'Hover for values · click to view frame'
              : `Full annuli · logarithmic radiance${data.some((d) => d.y !== null && d.y <= 0) ? ' · nonpositive bins omitted' : ''}`}
      </div>
    </div>
  );
}
