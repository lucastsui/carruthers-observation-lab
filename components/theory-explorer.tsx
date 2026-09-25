'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Download, RotateCcw, Pin, X, FlaskConical } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  calculateTheory, DEFAULT_THEORY, EARTH_RADIUS_KM, launchSpeed,
  THEORY_ASSUMPTIONS, THEORY_VERSION, theoryCSV, theoryJSON, trajectory,
} from '@/lib/theory';
import type { TheoryParameters, TheoryResult, Trajectory } from '@/lib/theory';

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

const PALETTE = [[7, 15, 25], [21, 57, 74], [40, 128, 139], [115, 214, 186], [241, 225, 158]];
function densityColor(t: number) {
  const v = Math.max(0, Math.min(1, t)) * (PALETTE.length - 1);
  const i = Math.min(PALETTE.length - 2, Math.floor(v)), f = v - i;
  return PALETTE[i].map((c, j) => Math.round(c + f * (PALETTE[i + 1][j] - c)));
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

function SpaceGrid({ extent, altitude, children }: { extent: number; altitude: number; children?: React.ReactNode }) {
  const scale = 210 / extent, r0 = 1 + altitude / EARTH_RADIUS_KM;
  return <svg viewBox="0 0 420 420" className="theory-space-overlay" aria-hidden="true">
    <defs><radialGradient id="theory-earth"><stop offset="0" stopColor="#4d85a5" /><stop offset="1" stopColor="#163c59" /></radialGradient></defs>
    <path d="M210 0V420M0 210H420" stroke="#abbccd" opacity="0.17" />
    {[2, 5, 10, 20].filter(r => r < extent).map(r => <g key={r}>
      <circle cx="210" cy="210" r={r * scale} fill="none" stroke="#c7d8df" strokeDasharray="2 6" opacity="0.25" />
      <text x={215 + r * scale} y="205" fill="#c7d8df" fontSize="11">{r}</text>
    </g>)}
    {children}
    <circle cx="210" cy="210" r={r0 * scale} fill="none" stroke="#b9ddfb" strokeWidth="1" strokeDasharray="3 3" />
    <circle cx="210" cy="210" r={scale} fill="url(#theory-earth)" stroke="#8bc7f1" strokeWidth="0.7" />
    <text x="10" y="20" fill="#cad6df" fontSize="11">+{extent} R_E</text>
    <text x="410" y="405" fill="#cad6df" textAnchor="end" fontSize="11">±{extent} R_E from center</text>
  </svg>;
}

function TrajectoryView({ result, extent }: { result: TheoryResult; extent: number }) {
  const paths = useMemo(() => {
    const p = result.parameters;
    const sets: { temperature: number; label: string; color: string }[] = [];
    if (p.hotFraction < 1) sets.push({ temperature: p.coldK, label: 'Cold', color: COLORS.cold });
    if (p.hotFraction > 0) sets.push({ temperature: p.hotK, label: 'Hot', color: COLORS.hot });
    return sets.flatMap(set => [0.2, 0.5, 0.85].flatMap(q => {
      const speed = launchSpeed(set.temperature, q);
      const angles = p.launchLaw === 'radial' ? [0] : [25, 55, 75];
      return angles.map(angle => ({ ...set, ...trajectory(p.altitudeKm, speed, angle, extent * 1.5) }));
    }));
  }, [result, extent]);
  const draw = (t: Trajectory) => {
    let open = false;
    return t.points.map(([x, y]) => {
      if (!Number.isFinite(x + y)) { open = false; return ''; }
      const code = open ? 'L' : 'M'; open = true;
      return `${code}${(210 + x / extent * 210).toFixed(2)},${(210 - y / extent * 210).toFixed(2)}`;
    }).join(' ');
  };
  return <div className="theory-space-image theory-trajectories">
    <SpaceGrid extent={extent} altitude={result.parameters.altitudeKm}>
      {paths.map((t, i) => <path key={i} d={draw(t)} stroke={t.color} fill="none" strokeWidth="1.4"
        strokeDasharray={t.escapes ? '5 3' : undefined} opacity="0.75">
        <title>{t.label}: {t.speed.toFixed(2)} km/s, {t.angle}° from radial; {t.escapes ? 'escapes' : `returns, apogee ${t.apexRe?.toFixed(2)} R_E`}</title>
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
  const titles = { assumptions: 'Assumptions and limits', equations: 'Equations and scientific context', values: 'Model density values' };
  const rows = result.profile.filter((_, i) => i % 15 === 0);
  const pages = kind === 'values' ? Math.ceil(rows.length / 7) : 2;
  return <>
    <DialogTitle>{titles[kind]}</DialogTitle>
    <DialogDescription>Steady spherical hydrogen model · {THEORY_VERSION}</DialogDescription>
    <div className="theory-detail-body">
      {kind === 'assumptions' && <>
        <ul>{THEORY_ASSUMPTIONS.slice(page * 5, page * 5 + 5).map(note => <li key={note}>{note}</li>)}</ul>
        <p>Hotter does not necessarily mean denser: atoms can travel farther, pass faster, or escape. The return and escape fractions describe launch flux.</p>
      </>}
      {kind === 'equations' && (page === 0 ? <>
        <p>Conserved specific energy ε = v²/2 − GM/r₀ and angular momentum h = r₀v sin θ give radial speed² = 2ε + 2GM/r − h²/r².</p>
        <p>Local density: n(r) = F(r₀/r)² ⟨passes / vᵣ(r)⟩. Bound orbits contribute two passages and escaping orbits one. The average includes only trajectories that reach the shell.</p>
        <p>The launch speed law is p(s) = s exp(−s), s = m_Hv²/(2k_BT). Cosine directions have p(μ) = 2μ, μ = cos θ. Radial mode uses μ = 1.</p>
        <p>Escaping outward flux fraction = (1 + λ)exp(−λ), λ = GMm_H/(r₀k_BT). This differs from the fraction of atoms above escape speed in a bulk Maxwell distribution.</p>
      </> : <>
        <p>Residence-time integrals use deterministic quadrature of Gaussian moments. Example trajectories are exact Kepler conics. They do not use a stepwise vertical-only approximation.</p>
        <p>The source components are exploratory assumptions. This does not implement the density inversion or energization mechanisms of <a href="https://www.nature.com/articles/ncomms13655" target="_blank" rel="noreferrer">Qin &amp; Waldrop (2016)</a>. Crossing-speed and angular weights follow <a href="https://molflow.docs.cern.ch/guide/molflow/general/attachments/molflow_algorithm.pdf" target="_blank" rel="noreferrer">kinetic flux sampling</a>.</p>
        <p>Earth radius: 6,370 km. GM: 398,600.4418 km³/s². Source altitude is measured from the surface; plotted radius is measured from Earth’s center.</p>
        <p>Density is in atoms/cm³, not Lyman-alpha brightness. The model has no time-dependent storm evolution or radiative transfer.</p>
      </>)}
      {kind === 'values' && <div className="theory-data-table"><table><caption>Sampled densities · atoms/cm³. CSV and JSON include all 181 radii.</caption><thead><tr><th>R_E</th><th>Cold</th><th>Hot</th><th>Total</th></tr></thead>
        <tbody>{rows.slice(page * 7, page * 7 + 7).map(row => <tr key={row.radiusRe}><td>{row.radiusRe.toFixed(2)}</td><td>{number(row.cold)}</td><td>{number(row.hot)}</td><td>{number(row.total)}</td></tr>)}</tbody></table></div>}
    </div>
    <nav className="theory-detail-pagination" aria-label="Theory detail pages">
      <button className="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
      <span aria-live="polite">Page {page + 1} of {pages}</span>
      <button className="button" disabled={page + 1 === pages} onClick={() => setPage(page + 1)}>Next</button>
    </nav>
  </>;
}

export function TheoryExplorer() {
  const [parameters, setParameters] = useState<TheoryParameters>({ ...DEFAULT_THEORY });
  const [comparison, setComparison] = useState<TheoryResult | null>(null);
  const [view, setView] = useState<'density' | 'trajectories'>('density');
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
                {[5, 10, 20].map(v => <option key={v} value={v}>±{v} R_E</option>)}</select></label></div>
            <fieldset className="theory-view-buttons" aria-label="Theory spatial view">
              <button className={`button ${view === 'density' ? 'primary' : ''}`} aria-pressed={view === 'density'} onClick={() => setView('density')}>Density slice</button>
              <button className={`button ${view === 'trajectories' ? 'primary' : ''}`} aria-pressed={view === 'trajectories'} onClick={() => setView('trajectories')}>Example trajectories</button>
            </fieldset>
            <div className="theory-space-stage">{view === 'density' ? <DensitySlice result={result} extent={extent} logRange={logRange} /> : <TrajectoryView result={result} extent={extent} />}</div>
            {view === 'density' ? <>
              <div className="theory-colorbar" /><div className="theory-scale-labels"><span>{expTick(10 ** logMin)}</span><span>H atoms/cm³ · log color scale</span><span>{expTick(10 ** logMax)}</span></div>
              <div className="theory-color-controls"><label>Min <select aria-label="Density color scale minimum" value={logMin} onChange={e => setLogMin(Number(e.target.value))}>
                {[-4, -2, 0, 2].filter(v => v < logMax).map(v => <option key={v} value={v}>{expTick(10 ** v)}</option>)}</select></label>
                <label>Max <select aria-label="Density color scale maximum" value={logMax} onChange={e => setLogMax(Number(e.target.value))}>
                  {[3, 5, 7, 9].filter(v => v > logMin).map(v => <option key={v} value={v}>{expTick(10 ** v)}</option>)}</select></label><span>Display only</span></div>
              <p className="theory-explainer">Local density slice, not brightness. Dashed ring: source shell; its interior is not modeled. Colors saturate beyond the displayed limits.</p>
            </> : <p className="theory-explainer">Example paths, not a weighted cloud. Blue: cold; orange: hot. Dashed paths escape; solid paths return, possibly outside this view. Radial paths overlap.</p>}
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
      <DialogContent className="theory-detail-dialog">
        {details && <TheoryDetails key={details} kind={details} result={result} />}
      </DialogContent>
    </Dialog>
  </main>;
}
