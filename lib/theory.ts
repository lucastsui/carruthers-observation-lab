/**
 * Steady, spherical, source-fed H exosphere in a central gravitational field.
 *
 * Inputs describe the OUTWARD FLUX at r0, not an equilibrium gas density.
 * Each component's flux-weighted speed law is p(s) = s exp(-s),
 * s = v² / (2 sigma²), sigma² = kT/m_H. Directions are either cosine-law
 * p(mu)=2mu (mu=cos(angle from radial)) or strictly radial.
 *
 * Density follows residence time: n(r) = F (r0/r)² E[passes / v_r(r)].
 * v_r² = v² - 2GM(1/r0-1/r) - (r0 v_t/r)². Bound trajectories pass
 * twice; unbound trajectories once. Angular and speed integrals reduce to
 * the Gaussian moments below. Angular momentum is retained in cosine mode.
 * No satellite population disconnected from the source shell is added.
 * Units internally: km, seconds, kelvin; inputs F in cm^-2 s^-1, n in cm^-3.
 */
export const THEORY_VERSION = 'spherical-h-flux-1.0';
export const EARTH_RADIUS_KM = 6370;
export const EARTH_GM = 398600.4418; // km³ s^-2
export const K_OVER_H_MASS = 1.380649e-23 / 1.6735575e-27 / 1e6; // km² s^-2 K^-1
export const THEORY_OUTER_RE = 30;

export type LaunchLaw = 'cosine' | 'radial';
export type TheoryParameters = {
  altitudeKm: number;
  flux: number;
  coldK: number;
  hotK: number;
  hotFraction: number;
  launchLaw: LaunchLaw;
};
export const DEFAULT_THEORY: TheoryParameters = {
  altitudeKm: 500, flux: 1e10, coldK: 1000, hotK: 6000,
  hotFraction: 0.1, launchLaw: 'cosine',
};
export type DensityPoint = {
  radiusRe: number;
  cold: number;
  hot: number;
  total: number;
  ballistic: number;
  escaping: number;
};
export type TheoryResult = {
  parameters: TheoryParameters;
  profile: DensityPoint[];
  escapeFraction: number;
  returnFraction: number;
  escapeSpeed: number;
  totalLaunchRate: number;
  densityAt5: number;
  densityAt10: number;
};

export function validateTheory(p: TheoryParameters) {
  const limits: [keyof TheoryParameters, number, number][] = [
    ['altitudeKm', 200, 1500], ['flux', 1e7, 1e12], ['coldK', 200, 3000],
    ['hotK', 3000, 30000], ['hotFraction', 0, 1],
  ];
  for (const [key, min, max] of limits) {
    const value = p[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      throw new Error(`Invalid ${key}: expected ${min}–${max}.`);
  }
  if (p.launchLaw !== 'cosine' && p.launchLaw !== 'radial')
    throw new Error('Unknown launch direction law.');
}

// Gauss–Legendre integration avoids subtractive cancellation in small Gaussian
// moments, important for the cold population at large radii.
function gaussLegendre(n: number): [number, number][] {
  const rule: [number, number][] = [];
  for (let i = 1; i <= n; i++) {
    let x = Math.cos(Math.PI * (i - 0.25) / (n + 0.5)), derivative = 0;
    for (let iteration = 0; iteration < 20; iteration++) {
      let p0 = 1, p1 = x;
      for (let j = 2; j <= n; j++) {
        const next = ((2 * j - 1) * x * p1 - (j - 1) * p0) / j;
        p0 = p1; p1 = next;
      }
      derivative = n * (x * p1 - p0) / (x * x - 1);
      const step = p1 / derivative;
      x -= step;
      if (Math.abs(step) < 1e-15) break;
    }
    rule.push([(x + 1) / 2, 1 / ((1 - x * x) * derivative * derivative)]);
  }
  return rule;
}
const GAUSS = gaussLegendre(32);
const HALF_SQRT_PI = Math.sqrt(Math.PI) / 2;

/** Integrals of exp(-t²) and t² exp(-t²), from 0 to sqrt(x). */
function moments(x: number) {
  if (x <= 0) return [0, 0];
  if (x > 40) return [HALF_SQRT_PI, HALF_SQRT_PI / 2];
  const end = Math.sqrt(x);
  let zero = 0, second = 0;
  for (const [u, w] of GAUSS) {
    const t = end * u, weighted = end * w * Math.exp(-t * t);
    zero += weighted; second += weighted * t * t;
  }
  return [zero, second];
}

export function escapeFraction(temperature: number, radiusKm: number) {
  const lambda = EARTH_GM / (radiusKm * K_OVER_H_MASS * temperature);
  // Integral of flux speed law s exp(-s) from lambda to infinity.
  return (1 + lambda) * Math.exp(-lambda);
}

/** Local density per unit outward surface flux. No fitted density profile. */
export function componentDensity(radiusKm: number, launchRadiusKm: number,
  temperature: number, law: LaunchLaw): { ballistic: number; escaping: number } {
  if (radiusKm < launchRadiusKm - 1e-9) return { ballistic: 0, escaping: 0 };
  radiusKm = Math.max(radiusKm, launchRadiusKm);
  const sigma = Math.sqrt(K_OVER_H_MASS * temperature);
  const lambda = EARTH_GM / (launchRadiusKm * sigma * sigma);
  const ratio = launchRadiusKm / radiusKm, q = ratio * ratio;
  const d = lambda * (1 - ratio), w = lambda * ratio;
  const [i0, i2] = moments(w);
  let outward: number, returning: number;
  if (law === 'radial') {
    const factor = Math.SQRT2 / sigma * q * Math.exp(-d);
    outward = factor * HALF_SQRT_PI * (d + 0.5);
    returning = factor * (d * i0 + i2);
  } else {
    const root = Math.sqrt(Math.max(0, 1 - q));
    const threshold = root > 0 ? d / (1 - q) : Infinity;
    const secondWeight = root * Math.exp(-threshold);
    const gamma = 2 * moments(lambda - threshold)[1];
    outward = Math.SQRT2 / sigma * HALF_SQRT_PI * (Math.exp(-d) - secondWeight);
    returning = Math.SQRT2 / sigma * (Math.exp(-d) * 2 * i2 - secondWeight * gamma);
  }
  // Conversion: F[cm^-2 s^-1] / v[km s^-1] -> n[cm^-3].
  return { ballistic: Math.max(0, 2 * returning) / 1e5,
    escaping: Math.max(0, outward - returning) / 1e5 };
}

export function densityAt(radiusRe: number, p: TheoryParameters): DensityPoint {
  const r0 = EARTH_RADIUS_KM + p.altitudeKm, r = radiusRe * EARTH_RADIUS_KM;
  const c = componentDensity(r, r0, p.coldK, p.launchLaw);
  const h = componentDensity(r, r0, p.hotK, p.launchLaw);
  const fc = p.flux * (1 - p.hotFraction), fh = p.flux * p.hotFraction;
  const cold = fc * (c.ballistic + c.escaping), hot = fh * (h.ballistic + h.escaping);
  return { radiusRe, cold, hot, total: cold + hot,
    ballistic: fc * c.ballistic + fh * h.ballistic,
    escaping: fc * c.escaping + fh * h.escaping };
}

export function calculateTheory(p: TheoryParameters): TheoryResult {
  validateTheory(p);
  const r0 = EARTH_RADIUS_KM + p.altitudeKm, first = r0 / EARTH_RADIUS_KM;
  const profile = Array.from({ length: 181 }, (_, i) =>
    densityAt(first * (THEORY_OUTER_RE / first) ** (i / 180), p));
  const escape = (1 - p.hotFraction) * escapeFraction(p.coldK, r0)
    + p.hotFraction * escapeFraction(p.hotK, r0);
  return { parameters: { ...p }, profile, escapeFraction: escape, returnFraction: 1 - escape,
    escapeSpeed: Math.sqrt(2 * EARTH_GM / r0),
    totalLaunchRate: 4 * Math.PI * (r0 * 1e5) ** 2 * p.flux,
    densityAt5: densityAt(5, p).total, densityAt10: densityAt(10, p).total };
}

export type Trajectory = {
  points: [number, number][];
  speed: number;
  angle: number;
  escapes: boolean;
  apexRe: number | null;
};

/** Exact Kepler conic in the orbital plane, launched from (r0,0), outward. */
export function trajectory(altitudeKm: number, speed: number, angle: number,
  outerRe = THEORY_OUTER_RE): Trajectory {
  const r0 = EARTH_RADIUS_KM + altitudeKm;
  const rad = angle * Math.PI / 180, vr = speed * Math.cos(rad), vt = speed * Math.sin(rad);
  const energy = speed * speed / 2 - EARTH_GM / r0;
  const h = r0 * vt, ex = r0 * vt * vt / EARTH_GM - 1, ey = -r0 * vr * vt / EARTH_GM;
  const e = Math.hypot(ex, ey), escapes = energy >= 0;
  const apex = escapes ? null : -EARTH_GM / (2 * energy) * (1 + e);
  const cap = outerRe * EARTH_RADIUS_KM;
  if (Math.abs(vt) < 1e-8) {
    const end = Math.min(apex ?? cap, cap) / EARTH_RADIUS_KM;
    return { points: [[r0 / EARTH_RADIUS_KM, 0], [end, 0]], speed, angle,
      escapes, apexRe: apex === null ? null : apex / EARTH_RADIUS_KM };
  }
  const omega = Math.atan2(ey, ex), start = -omega;
  const p = h * h / EARTH_GM;
  // Bound orbits return to the launch shell. For off-screen apogees draw both
  // visible branches separately (NaN breaks the SVG path), not a chord.
  const end = escapes ? Math.acos(Math.max(-1, Math.min(1, (p / cap - 1) / e))) : 2 * Math.PI - start;
  const points: [number, number][] = [];
  for (let i = 0; i <= 400; i++) {
    const nu = start + (end - start) * i / 400;
    const r = p / (1 + e * Math.cos(nu));
    points.push(r > 0 && r <= cap * 1.01
      ? [r * Math.cos(nu + omega) / EARTH_RADIUS_KM, r * Math.sin(nu + omega) / EARTH_RADIUS_KM]
      : [NaN, NaN]);
  }
  return { points, speed, angle, escapes, apexRe: apex === null ? null : apex / EARTH_RADIUS_KM };
}

/** Quantile of the surface-crossing speed law, not the bulk Maxwell speed law. */
export function launchSpeed(temperature: number, quantile: number) {
  let lo = 0, hi = 50;
  for (let i = 0; i < 55; i++) {
    const mid = (lo + hi) / 2;
    if (1 - (1 + mid) * Math.exp(-mid) < quantile) lo = mid; else hi = mid;
  }
  return Math.sqrt(2 * K_OVER_H_MASS * temperature * (lo + hi) / 2);
}

export function theoryCSV(result: TheoryResult) {
  const p = result.parameters;
  const header = ['model_version', 'launch_altitude_km', 'outward_flux_cm-2_s-1', 'cold_K',
    'hot_K', 'hot_launch_flux_fraction', 'launch_law', 'radius_from_center_Re',
    'cold_H_cm-3', 'hot_H_cm-3', 'total_H_cm-3', 'ballistic_H_cm-3', 'escaping_H_cm-3'];
  return [header.join(','), ...result.profile.map(row => [THEORY_VERSION, p.altitudeKm,
    p.flux, p.coldK, p.hotK, p.hotFraction, p.launchLaw, row.radiusRe,
    row.cold, row.hot, row.total, row.ballistic, row.escaping].join(','))].join('\n') + '\n';
}

export const THEORY_ASSUMPTIONS = [
  'Stationary, uniform outward source on a spherical shell; spherical Earth gravity.',
  'Cold and hot labels denote two assumed source components, not inferred populations.',
  'Flux-weighted Maxwell speed law for each component: p(s)=s exp(-s), s=m_H v²/(2 k_B T).',
  'Cosine directions: p(mu)=2mu, mu=cos(angle from outward radial); radial mode uses mu=1.',
  'Hot fraction is the fraction of outgoing number flux, not gas density or mass currently aloft.',
  'Bound particles return and are absorbed at the source shell; unbound particles escape.',
  'Steady-state density includes returning bound orbits even when their apogee is beyond the plotted domain.',
  'No collisions, charge exchange, ionization, solar radiation pressure, or independently trapped satellite population.',
  'No finite source age or particle lifetime. Far-reaching bound orbits can take very long to return.',
  'Density in atoms/cm³, not line-of-sight brightness. No fit to Carruthers data or reproduction of Qin–Waldrop.',
];

export function theoryJSON(result: TheoryResult) {
  return JSON.stringify({ model: THEORY_VERSION, assumptions: THEORY_ASSUMPTIONS,
    constants: { earth_radius_km: EARTH_RADIUS_KM, earth_GM_km3_s2: EARTH_GM,
      kB_over_hydrogen_mass_km2_s2_K: K_OVER_H_MASS },
    units: { profile_density: 'atoms/cm³', radius: 'Earth radii from center',
      flux: 'atoms/cm²/s', fractions: 'outgoing number flux' }, ...result }, null, 2);
}
