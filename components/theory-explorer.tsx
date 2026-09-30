'use client';
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Download, RotateCcw, Pin, X, FlaskConical } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  calculateTheory, DEFAULT_THEORY, EARTH_RADIUS_KM, launchSpeed,
  THEORY_ASSUMPTIONS, THEORY_VERSION, theoryCSV, theoryJSON, trajectory,
} from '@/lib/theory';
import type { TheoryParameters, TheoryResult, Trajectory } from '@/lib/theory';
import { THEORY_CONTEXT } from '@/lib/theory-context';
import { particleFrame, particleRandom } from '@/lib/theory-particles';

const TheoryEquationPage = lazy(() => import('@/components/theory-equation-page'));
const TheoryParticles = lazy(() => import('@/components/theory-particles'));

const COLORS = { total: '#a9efda', cold: '#69b8ff', hot: '#ffba78', reference: '#c4b2fc' };
const number = (v: number) => v === 0 ? '0' : v >= 1e5 || v < 0.01
  ? v.toExponential(2) : v.toLocaleString('en-US', { maximumSignificantDigits: 4 });
const percent = (v: number) => v > 0 && v < 0.0001 ? `${(v * 100).toExponential(2)}%` : `${(v * 100).toFixed(2)}%`;
const expTick = (v: number) => v >= 1e4 || v < 0.01 ? v.toExponential(0).replace('+', '') : String(v);
const knobText = (value: number, logarithmic: boolean) => logarithmic
  ? Number(value.toPrecision(4)).toExponential().replace('+', '') : String(value);

function Knob({ label, value, onChange, min, max, step, unit, hint, logarithmic = false }: {
  label: string; value: number; onChange: (value: number) => void;
  min: number; max: number; step: number; unit: string; hint?: string; logarithmic?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? knobText(value, logarithmic);
  const commit = () => {
    const parsed = Number(text);
    if (draft !== null && text.trim() && Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(parsed);
    setDraft(null);
  };
  return <div className="theory-knob">
    <label htmlFor={id}>{label} <span>{unit}</span></label>
    <div className="theory-knob-inputs">
      <input type="range" aria-label={`${label} slider`}
        min={logarithmic ? Math.log10(min) : min} max={logarithmic ? Math.log10(max) : max}
        step={step} value={logarithmic ? Math.log10(value) : value}
        onChange={e => onChange(logarithmic ? 10 ** Number(e.target.value) : Number(e.target.value))} />
      <input id={id} type="number" min={min} max={max} step="any" value={text}
        onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { commit(); e.currentTarget.blur(); } }} />
    </div>
    {hint && <p>{hint}</p>}
  </div>;
}

function DensityChart({ result, comparison }: { result: TheoryResult; comparison: TheoryResult | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const chart = useRef<SVGSVGElement>(null);
  const [bounds, setBounds] = useState({ width: 640, height: 240 });
  useEffect(() => {
    const element = chart.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width && entry.contentRect.height)
        setBounds({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const clip = useId().replaceAll(':', '');
  const all = [...result.profile, ...(comparison?.profile || [])];
  const positive = all.flatMap(p => [p.total, p.cold, p.hot]).filter(v => v > 0);
  const ymin = Math.floor(Math.log10(Math.min(...positive))), ymax = Math.ceil(Math.log10(Math.max(...positive)));
  const tickStep = Math.max(1, Math.ceil((ymax - ymin) / 7));
  const left = 62, right = Math.max(200, bounds.width) - 18, top = 16, bottom = Math.max(140, bounds.height) - 40;
  const x = (r: number) => left + Math.log(r) / Math.log(30) * (right - left);
  const y = (n: number) => bottom - (Math.log10(n) - ymin) / (ymax - ymin) * (bottom - top);
  const path = (r: TheoryResult, key: 'total' | 'cold' | 'hot') => r.profile.filter(p => p[key] > 0)
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.radiusRe).toFixed(2)},${y(p[key]).toFixed(2)}`).join(' ');
  const sample = result.profile[hover ?? 65];
  const select = (clientX: number, box: DOMRect) => {
    const local = (clientX - box.left) / box.width * bounds.width;
    const radius = Math.exp((local - left) / (right - left) * Math.log(30));
    let nearest = 0;
    result.profile.forEach((p, i) => { if (Math.abs(p.radiusRe - radius) < Math.abs(result.profile[nearest].radiusRe - radius)) nearest = i; });
    setHover(nearest);
  };
  return <>
    {/* SVG needs an explicit image role for its accessible name; it is not an HTML img. */}
    {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
    <div className="theory-chart-area"><svg ref={chart} className="theory-density-chart" viewBox={`0 0 ${bounds.width} ${bounds.height}`} role="img"
      aria-label="Hydrogen number density versus distance from Earth's center, with logarithmic axes"
      onPointerMove={e => select(e.clientX, e.currentTarget.getBoundingClientRect())}
      onPointerLeave={() => setHover(null)}>
      <defs><clipPath id={clip}><rect x={left} y={top} width={right - left} height={bottom - top} /></clipPath></defs>
      {Array.from({ length: Math.floor((ymax - ymin) / tickStep) + 1 }, (_, i) => ymin + i * tickStep).map(power => <g key={power}>
        <line x1={left} x2={right} y1={y(10 ** power)} y2={y(10 ** power)} stroke="#243440" />
        <text x={left - 10} y={y(10 ** power) + 4} textAnchor="end">{expTick(10 ** power)}</text>
      </g>)}
      {[1, 2, 5, 10, 20, 30].map(r => <g key={r}>
        <line x1={x(r)} x2={x(r)} y1={top} y2={bottom} stroke="#243440" strokeDasharray="3 5" />
        <text x={x(r)} y={bottom + 20} textAnchor="middle">{r}</text>
      </g>)}
      <text x="13" y={(top + bottom) / 2} textAnchor="middle" transform={`rotate(-90 13 ${(top + bottom) / 2})`}>H density · atoms/cm³</text>
      <text x={(left + right) / 2} y={bounds.height - 4} textAnchor="middle">Distance from Earth’s center · R_E (log scale)</text>
      <g clipPath={`url(#${clip})`} fill="none">
        {comparison && <path d={path(comparison, 'total')} stroke={COLORS.reference} strokeWidth="2" strokeDasharray="7 5" />}
        <path d={path(result, 'cold')} stroke={COLORS.cold} strokeWidth="1.8" />
        <path d={path(result, 'hot')} stroke={COLORS.hot} strokeWidth="1.8" />
        <path d={path(result, 'total')} stroke={COLORS.total} strokeWidth="2.8" />
        {hover !== null && <line x1={x(sample.radiusRe)} x2={x(sample.radiusRe)} y1={top} y2={bottom} stroke="#c4d7df" strokeDasharray="3 4" />}
      </g>
      {hover !== null && <circle cx={x(sample.radiusRe)} cy={y(sample.total)} r="4" fill={COLORS.total} />}
    </svg></div>
    <div className="theory-readout mono">
      <span>{sample.radiusRe.toFixed(2)} R_E</span>
      <span style={{ color: COLORS.total }}>Total {number(sample.total)}</span>
      <span style={{ color: COLORS.cold }}>Cold {number(sample.cold)}</span>
      <span style={{ color: COLORS.hot }}>Hot {number(sample.hot)}</span>
      <span className="muted">atoms/cm³</span>
    </div>
  </>;
}

// Match Matplotlib's 256-entry gist_heat lookup used by WFI/NFI previews
// and /api/colorbar, without requiring observation data to render THEORY.
const DENSITY_PALETTE = Array.from({ length: 256 }, (_, i) => {
  const x = i * (1 / 255);
  return [1.5 * x, 2 * x - 1, 4 * x - 3]
    .map(c => Math.floor(Math.max(0, Math.min(1, c)) * 255));
});
const DENSITY_GRADIENT = `linear-gradient(to right, ${DENSITY_PALETTE
  .map((rgb, i) => `rgb(${rgb.join(',')}) ${i / 255 * 100}%`).join(',')})`;
function densityColor(t: number) {
  return DENSITY_PALETTE[Math.min(255, Math.floor(Math.max(0, Math.min(1, t)) * 256))];
}

function DensitySlice({ result, extent, logRange }: { result: TheoryResult; extent: number; logRange: [number, number] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const size = 420, pixels = ctx.createImageData(size, size);
    const profile = result.profile, inner = profile[0].radiusRe;
    const lookup = Array.from({ length: 1200 }, (_, i) => {
      const r = inner * (30 / inner) ** (i / 1199), pos = Math.log(r / inner) / Math.log(30 / inner) * 180;
      const j = Math.min(179, Math.floor(pos)), frac = pos - j;
      const log = Math.log10(profile[j].total) * (1 - frac) + Math.log10(profile[j + 1].total) * frac;
      return densityColor((log - logRange[0]) / (logRange[1] - logRange[0]));
    });
    for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
      const r = Math.hypot(col + 0.5 - size / 2, row + 0.5 - size / 2) / (size / 2) * extent;
      let color = [10, 19, 29];
      if (r >= inner && r <= 30) {
        const index = Math.min(1199, Math.max(0, Math.round(Math.log(r / inner) / Math.log(30 / inner) * 1199)));
        color = lookup[index];
      }
      const offset = (row * size + col) * 4;
      pixels.data.set([...color, 255], offset);
    }
    ctx.putImageData(pixels, 0, 0);
  }, [result, extent, logRange]);
  return <div className="theory-space-image">
    <canvas ref={ref} width="420" height="420" aria-label="Cross-section of the spherical hydrogen density model. Colors use the density scale shown below." />
    <SpaceGrid extent={extent} altitude={result.parameters.altitudeKm} />
  </div>;
}

function SpaceGrid({ extent, altitude, children, earth = true }: { extent: number; altitude: number; children?: React.ReactNode; earth?: boolean }) {
  const scale = 210 / extent, r0 = 1 + altitude / EARTH_RADIUS_KM;
  return <svg viewBox="0 0 420 420" className="theory-space-overlay" aria-hidden="true">
    <defs><radialGradient id="theory-earth"><stop offset="0" stopColor="#4d85a5" /><stop offset="1" stopColor="#163c59" /></radialGradient></defs>
    <path d="M210 0V420M0 210H420" stroke="#abbccd" opacity="0.17" />
    {[2, 5, 10, 20].filter(r => r < extent).map(r => <g key={r}>
      <circle cx="210" cy="210" r={r * scale} fill="none" stroke="#c7d8df" strokeDasharray="2 6" opacity="0.25" />
      <text x={215 + r * scale} y="205" fill="#c7d8df" fontSize="11">{r}</text>
    </g>)}
    <circle cx="210" cy="210" r={r0 * scale} fill="none" stroke="#b9ddfb" strokeWidth="1" strokeDasharray="3 3" />
    <circle cx="210" cy="210" r={scale} fill={earth ? 'url(#theory-earth)' : 'none'} stroke="#8bc7f1" strokeWidth="0.7" />
    {children}
    {!earth && <text x="210" y="214" textAnchor="middle" fill="#e3edf4" stroke="#0a131d" strokeWidth="2" paintOrder="stroke" fontSize="10">Earth</text>}
    <text x="10" y="20" fill="#cad6df" fontSize="11">+{extent} R_E</text>
    <text x="410" y="405" fill="#cad6df" textAnchor="end" fontSize="11">±{extent} R_E from center</text>
  </svg>;
}

function TrajectoryView({ result, extent, count, projection }: { result: TheoryResult; extent: number; count: number; projection: boolean }) {
  const paths = useMemo(() => {
    const p = result.parameters;
    const sets: { temperature: number; label: string; color: string }[] = [];
    if (p.hotFraction < 1) sets.push({ temperature: p.coldK, label: 'Cold', color: COLORS.cold });
    if (p.hotFraction > 0) sets.push({ temperature: p.hotK, label: 'Hot', color: COLORS.hot });
    const angles = p.launchLaw === 'radial' ? [0] : [25, 55, 75];
    const original = [0.2, 0.5, 0.85].flatMap(q => angles.map(angle => ({ q, angle })));
    return Array.from({ length: count }, (_, i) => {
      // Interleave components so small counts show both, retaining the original
      // examples at the default count. Extra examples form a stable sequence:
      // moving the slider adds/removes paths without changing the existing ones.
      const set = sets[i % sets.length], index = Math.floor(i / sets.length);
      const extra = index - original.length + 1;
      const sample = original[index] ?? {
        q: (extra * 0.6180339887498949) % 1,
        angle: p.launchLaw === 'radial' ? 0 : Math.acos(Math.sqrt((extra * Math.SQRT2) % 1)) * 180 / Math.PI,
      };
      const speed = launchSpeed(set.temperature, sample.q);
      const phi = particleRandom(i, 3) * 2 * Math.PI, sign = particleRandom(i, 4) < 0.5 ? 1 : -1;
      const frame = projection ? particleFrame(i) : {
        normal: [Math.cos(phi), Math.sin(phi), 0], tangent: [-Math.sin(phi) * sign, Math.cos(phi) * sign, 0],
      };
      return { ...set, frame, ...trajectory(p.altitudeKm, speed, sample.angle, extent * 1.5) };
    });
  }, [result, extent, count, projection]);
  const draw = (t: Trajectory & { frame: ReturnType<typeof particleFrame> }) => {
    let open = false;
    return t.points.map(([x, y]) => {
      if (!Number.isFinite(x + y)) { open = false; return ''; }
      const [px, py, pz] = t.frame.normal.map((n, j) => n * x + t.frame.tangent[j] * y);
      // Orthographic 3D projection: Earth hides paths on its far side;
      // foreground paths can cross the disk while remaining above the surface.
      const disk = px * px + py * py;
      if (disk < 1 && pz < Math.sqrt(1 - disk)) { open = false; return ''; }
      const code = open ? 'L' : 'M'; open = true;
      return `${code}${(210 + px / extent * 210).toFixed(2)},${(210 - py / extent * 210).toFixed(2)}`;
    }).join(' ');
  };
  return <div className="theory-space-image theory-trajectories">
    <SpaceGrid extent={extent} altitude={result.parameters.altitudeKm}>
      {paths.map((t, i) => <path key={i} d={draw(t)} stroke={t.color} fill="none" strokeWidth="1.4"
        strokeDasharray={t.escapes ? '5 3' : undefined} opacity="0.75">
        <title>{t.label}: {t.speed.toFixed(2)} km/s, {number(t.angle)}° from radial; {t.escapes ? 'escapes' : `returns, apogee ${t.apexRe?.toFixed(2)} R_E`}</title>
      </path>)}
    </SpaceGrid>
  </div>;
}

function download(text: string, type: string, extension: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = `ceda-theory-${THEORY_VERSION}.${extension}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type TheoryDetail = 'assumptions' | 'equations' | 'values';
function TheoryDetails({ kind, result }: { kind: TheoryDetail; result: TheoryResult }) {
  const [page, setPage] = useState(0);
  const body = useRef<HTMLElement>(null);
  useEffect(() => { if (body.current) body.current.scrollTop = 0; }, [page]);
  const titles = { assumptions: 'Assumptions and limits', equations: 'Equations and scientific context', values: 'Model density values' };
  const rows = result.profile.filter((_, i) => i % 15 === 0);
  const pages = kind === 'values' ? Math.ceil(rows.length / 7) : 2;
  return <>
    <DialogTitle>{titles[kind]}</DialogTitle>
    <DialogDescription>Steady spherical hydrogen model · {THEORY_VERSION}</DialogDescription>
    {/* The scroll region needs keyboard focus so its prose can be scrolled without a pointer. */}
    {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
    <section ref={body} className="theory-detail-body" tabIndex={0} aria-label={titles[kind]}>
      {kind === 'assumptions' && <>
        <ul>{THEORY_ASSUMPTIONS.slice(page * 5, page * 5 + 5).map(note => <li key={note}>{note}</li>)}</ul>
        <p>Hotter does not necessarily mean denser: atoms can travel farther, pass faster, or escape. The return and escape fractions describe launch flux.</p>
      </>}
      {kind === 'equations' &&
        <Suspense fallback={<output>Loading equations…</output>}>
          <TheoryEquationPage markdown={THEORY_CONTEXT} />
        </Suspense>
      }
      {kind === 'values' && <div className="theory-data-table"><table><caption>Sampled densities · atoms/cm³. CSV and JSON include all 181 radii.</caption><thead><tr><th>R_E</th><th>Cold</th><th>Hot</th><th>Total</th></tr></thead>
        <tbody>{rows.slice(page * 7, page * 7 + 7).map(row => <tr key={row.radiusRe}><td>{row.radiusRe.toFixed(2)}</td><td>{number(row.cold)}</td><td>{number(row.hot)}</td><td>{number(row.total)}</td></tr>)}</tbody></table></div>}
    </section>
    {kind !== 'equations' && <nav className="theory-detail-pagination" aria-label="Theory detail pages">
      <button className="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
      <span aria-live="polite">Page {page + 1} of {pages}</span>
      <button className="button" disabled={page + 1 === pages} onClick={() => setPage(page + 1)}>Next</button>
    </nav>}
  </>;
}

export function TheoryExplorer() {
  const [parameters, setParameters] = useState<TheoryParameters>({ ...DEFAULT_THEORY });
  const [comparison, setComparison] = useState<TheoryResult | null>(null);
  const [view, setView] = useState<'density' | 'trajectories' | 'particles'>('particles');
  const [projection, setProjection] = useState(true);
  const [trajectoryCount, setTrajectoryCount] = useState<number | null>(null);
  const trajectoryCountId = useId();
  const defaultTrajectoryCount = (parameters.hotFraction > 0 && parameters.hotFraction < 1 ? 2 : 1)
    * (parameters.launchLaw === 'radial' ? 3 : 9);
  const shownTrajectoryCount = trajectoryCount ?? defaultTrajectoryCount;
  const [extent, setExtent] = useState(10);
  const [logMin, setLogMin] = useState(0), [logMax, setLogMax] = useState(5);
  const [details, setDetails] = useState<TheoryDetail | null>(null);
  const [compactPanel, setCompactPanel] = useState('profile');
  const result = useMemo(() => calculateTheory(parameters), [parameters]);
  const logRange = useMemo<[number, number]>(() => [logMin, logMax], [logMin, logMax]);
  const change = <K extends keyof TheoryParameters>(key: K, value: TheoryParameters[K]) =>
    setParameters(p => ({ ...p, [key]: value }));
  return <main className="theory-page" data-compact-panel={compactPanel} aria-label="Theoretical hydrogen model explorer">
    <div className="theory-intro">
      <div><div className="eyebrow"><FlaskConical size={13} /> MODEL EXPLORER</div>
        <h2>Hydrogen exosphere model</h2>
        <p>Change the source population. See where hydrogen spends its time.</p></div>
      <div className="theory-intro-actions"><div className="theory-model-badge">Spherical · steady state · gravity only</div>
        <div className="theory-actions">
          <button className="button" onClick={() => setComparison(result)}><Pin size={14} />{comparison ? 'Replace comparison' : 'Pin comparison'}</button>
          <button className="button" onClick={() => download(theoryCSV(result), 'text/csv', 'csv')}><Download size={14} />CSV</button>
          <button className="button" onClick={() => download(theoryJSON(result), 'application/json', 'json')}>JSON</button>
        </div></div>
    </div>
    <nav className="theory-panel-nav" aria-label="Theory panels">
      {[['profile', 'Overview'], ['source', 'Source'], ['spatial', 'Spatial view'], ['method', 'Method']].map(([id, label]) =>
        <button key={id} className={`button ${compactPanel === id ? 'primary' : ''}`} aria-pressed={compactPanel === id} onClick={() => setCompactPanel(id)}>{label}</button>)}
    </nav>
    <div className="theory-layout">
      <aside className="panel theory-controls" aria-label="Theory parameters">
        <div className="theory-card-heading"><h3>Source population</h3>
          <button className="button icon ghost" title="Reset model parameters" aria-label="Reset model parameters"
            onClick={() => setParameters({ ...DEFAULT_THEORY })}><RotateCcw size={15} /></button></div>
        <p className="theory-explainer">Uniform spherical source; returning atoms are absorbed at the shell.</p>
        <Knob label="Launch altitude" unit="km" min={200} max={1500} step={25}
          value={parameters.altitudeKm} onChange={v => change('altitudeKm', v)} hint="Height above Earth’s surface." />
        <Knob label="Upward hydrogen flux" unit="atoms/cm²/s" min={1e7} max={1e12} step={0.05} logarithmic
          value={parameters.flux} onChange={v => change('flux', v)} hint="Atoms crossing each cm² per second; logarithmic slider." />
        <div className="theory-divider" />
        <Knob label="Cold temperature" unit="K" min={200} max={3000} step={25}
          value={parameters.coldK} onChange={v => change('coldK', v)} />
        <Knob label="Hot temperature" unit="K" min={3000} max={30000} step={100}
          value={parameters.hotK} onChange={v => change('hotK', v)} hint="Energy scale of the assumed hot component." />
        <Knob label="Hot launch fraction" unit="%" min={0} max={100} step={1}
          value={parameters.hotFraction * 100} onChange={v => change('hotFraction', v / 100)}
          hint="Share of upward flux, not of atoms already aloft." />
        <label className="field theory-law">Launch directions
          <select value={parameters.launchLaw} onChange={e => change('launchLaw', e.target.value as TheoryParameters['launchLaw'])}>
            <option value="cosine">Thermal crossing · cosine law</option>
            <option value="radial">Straight outward · radial only</option>
          </select>
        </label>
        <p className="theory-explainer">Maxwell crossing speeds in both modes. Cosine directions retain angular momentum.</p>
        <div className="theory-source-note">Assumed populations; no fit to observations or nonthermal production mechanism.</div>
      </aside>
      <section className="theory-output" aria-label="Predicted hydrogen distribution">
        <div className="theory-metrics" aria-live="polite" aria-atomic="true">
          <div><span>Returns to source</span><strong>{percent(result.returnFraction)}</strong><small>of launched atoms, eventually</small></div>
          <div><span>Escapes Earth</span><strong>{percent(result.escapeFraction)}</strong><small>positive orbital energy</small></div>
          <div><span>Density at 5 R_E</span><strong>{number(result.densityAt5)}</strong><small>hydrogen atoms/cm³</small></div>
          <div><span>Density at 10 R_E</span><strong>{number(result.densityAt10)}</strong><small>hydrogen atoms/cm³</small></div>
        </div>
        <div className="panel theory-profile-panel">
          <div className="theory-card-heading"><div><h3>Hydrogen density profile</h3><p>Local density · radius measured from Earth’s center</p></div></div>
          <div className="theory-legend">
            {(['total', 'cold', 'hot'] as const).map(key => <span key={key}><i style={{ background: COLORS[key] }} />{key === 'total' ? 'Total H' : `${key[0].toUpperCase()}${key.slice(1)} component`}</span>)}
            {comparison && <span><i style={{ background: COLORS.reference }} />Pinned total
              <button className="theory-clear" onClick={() => setComparison(null)} aria-label="Clear comparison"><X size={13} /></button></span>}
          </div>
          <DensityChart result={result} comparison={comparison} />
          {comparison && <p className="theory-comparison-note">Pinned: {comparison.parameters.coldK} / {comparison.parameters.hotK} K · {number(comparison.parameters.hotFraction * 100)}% hot flux · {number(comparison.parameters.flux)} atoms/cm²/s · {comparison.parameters.altitudeKm} km · {comparison.parameters.launchLaw} directions</p>}
        </div>
        <div className="theory-bottom-grid">
          <section className="panel theory-spatial-panel">
            <div className="theory-card-heading"><h3>Spatial view</h3>
              <label className="theory-extent">Extent <select aria-label="Spatial view extent" value={extent} onChange={e => setExtent(Number(e.target.value))}>
                {[2, 5, 10, 20, 30].map(v => <option key={v} value={v}>±{v} R_E</option>)}</select></label></div>
            <fieldset className="theory-view-buttons" aria-label="Theory spatial view">
              <button className={`button ${view === 'particles' ? 'primary' : ''}`} aria-pressed={view === 'particles'} onClick={() => setView('particles')}>Atoms</button>
              <button className={`button ${view === 'density' ? 'primary' : ''}`} aria-pressed={view === 'density'} onClick={() => setView('density')}>Density slice</button>
              <button className={`button ${view === 'trajectories' ? 'primary' : ''}`} aria-pressed={view === 'trajectories'} onClick={() => setView('trajectories')}>Example trajectories</button>
            </fieldset>
            {view !== 'density' && <label className="theory-geometry">Geometry
              <select aria-label="Particle and trajectory geometry" value={projection ? 'projection' : 'slice'} onChange={event => setProjection(event.target.value === 'projection')}>
                <option value="slice">2D cross-section</option><option value="projection">3D projection</option>
              </select></label>}
            {view === 'trajectories' && <div className="theory-trajectory-controls">
              <label htmlFor={trajectoryCountId}>Number of trajectories <output htmlFor={trajectoryCountId}>{shownTrajectoryCount}</output></label>
              <input id={trajectoryCountId} type="range" min={1} max={100} step={1} value={shownTrajectoryCount}
                onChange={e => setTrajectoryCount(Number(e.target.value))} />
            </div>}
            {view === 'particles' ? <Suspense fallback={<p className="theory-explainer">Loading particle view…</p>}>
              <TheoryParticles parameters={parameters} extent={extent} projection={projection} overlay={<SpaceGrid extent={extent} altitude={parameters.altitudeKm} earth={false} />} />
            </Suspense> : <div className="theory-space-stage">{view === 'density' ? <DensitySlice result={result} extent={extent} logRange={logRange} /> : <TrajectoryView result={result} extent={extent} count={shownTrajectoryCount} projection={projection} />}</div>}
            {view === 'density' ? <>
              <div className="theory-colorbar" style={{ backgroundImage: DENSITY_GRADIENT }} /><div className="theory-scale-labels"><span>{expTick(10 ** logMin)}</span><span>H atoms/cm³ · log color scale</span><span>{expTick(10 ** logMax)}</span></div>
              <div className="theory-color-controls"><label>Min <select aria-label="Density color scale minimum" value={logMin} onChange={e => setLogMin(Number(e.target.value))}>
                {[-4, -2, 0, 2].filter(v => v < logMax).map(v => <option key={v} value={v}>{expTick(10 ** v)}</option>)}</select></label>
                <label>Max <select aria-label="Density color scale maximum" value={logMax} onChange={e => setLogMax(Number(e.target.value))}>
                  {[3, 5, 7, 9].filter(v => v > logMin).map(v => <option key={v} value={v}>{expTick(10 ** v)}</option>)}</select></label><span>Display only</span></div>
              <p className="theory-explainer">Local density slice, not brightness. Dashed ring: source shell; its interior is not modeled. Colors saturate beyond the displayed limits.</p>
            </> : view === 'trajectories' ? <p className="theory-explainer">{projection ? 'Random launch sites across the whole source shell, projected in 3D. Paths over Earth’s disk are foreground paths.' : 'Random launch sites around the source circle, with trajectories in the slice plane.'} Blue: cold; orange: hot. Dashed paths escape; solid paths return. These examples are not a density sample.</p> : null}
          </section>
          <section className="panel theory-method-panel">
            <h3>How density is calculated</h3>
            <p>Integrate each component’s allowed motion in Earth’s gravity. Slow passages contribute more density; bound atoms pass outward and back, escaping atoms once.</p>
            <div className="theory-equation">density = arrival rate × residence time / volume</div>
            <dl className="theory-facts"><div><dt>Escape speed at source</dt><dd>{result.escapeSpeed.toFixed(3)} km/s</dd></div>
              <div><dt>Total outward supply</dt><dd>{number(result.totalLaunchRate)} atoms/s</dd></div>
              <div><dt>Geometry</dt><dd>Spherically symmetric</dd></div></dl>
            <div className="theory-detail-actions">
              <button className="button" onClick={() => setDetails('assumptions')}>Assumptions &amp; limits</button>
              <button className="button" onClick={() => setDetails('equations')}>Equations &amp; context</button>
              <button className="button" onClick={() => setDetails('values')}>Density values</button>
            </div>
          </section>
        </div>
      </section>
    </div>
    <Dialog open={details !== null} onOpenChange={open => { if (!open) setDetails(null); }}>
      <DialogContent className={`theory-detail-dialog${details === 'equations' ? ' theory-equations-dialog' : ''}`}>
        {details && <TheoryDetails key={details} kind={details} result={result} />}
      </DialogContent>
    </Dialog>
  </main>;
}
