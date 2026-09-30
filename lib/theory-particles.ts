/** A finite-volume, steady-state tracer ensemble for the THEORY model.
 * Orbits are weighted by source flux × residence time inside 30 R_E.
 * Random orbital frames cover the whole source sphere; random time phases
 * give a stationary population, including inbound bound atoms from outside.
 * A display slot is recycled at the source or domain boundary. Time outside
 * the domain is omitted, never replaced by a chord through the domain.
 */
import {
  EARTH_GM as GM, EARTH_RADIUS_KM as RE, K_OVER_H_MASS, THEORY_OUTER_RE,
  validateTheory, type TheoryParameters,
} from './theory.ts';

export const PARTICLE_SAMPLES = 128;
export const PARTICLE_MIN = 1000;
export const PARTICLE_MAX = 500000;
export type ParticleOrbit = {
  a: number; e: number; omega: number; bound: boolean; hot: boolean;
  start: number; end: number; frequency: number; outwardTime: number;
  sourceRadius: number; endRadius: number; fluxWeight: number; weight: number;
};
export type ParticleAtlas = {
  positions: Float32Array; width: number; height: number;
  cumulative: Float64Array; durations: Float32Array; bound: Uint8Array;
  hot: Uint8Array; totalAtoms: number;
};

function quadrature(n: number): [number, number][] {
  const rule: [number, number][] = [];
  for (let i = 1; i <= n; i++) {
    let x = Math.cos(Math.PI * (i - 0.25) / (n + 0.5)), derivative = 0;
    for (let iteration = 0; iteration < 30; iteration++) {
      let p0 = 1, p1 = x;
      for (let j = 2; j <= n; j++) {
        const next = ((2 * j - 1) * x * p1 - (j - 1) * p0) / j;
        p0 = p1; p1 = next;
      }
      derivative = n * (x * p1 - p0) / (x * x - 1);
      const step = p1 / derivative;
      x -= step;
      if (Math.abs(step) < 1e-14) break;
    }
    rule.push([(1 + x) / 2, 1 / ((1 - x * x) * derivative * derivative)]);
  }
  return rule;
}

function meanAnomaly(e: number, anomaly: number, bound: boolean) {
  return bound ? anomaly - e * Math.sin(anomaly) : e * Math.sinh(anomaly) - anomaly;
}

function anomalyAtRadius(a: number, e: number, radius: number, bound: boolean) {
  return bound
    ? Math.acos(Math.max(-1, Math.min(1, (1 - radius / a) / e)))
    : Math.acosh(Math.max(1, (1 + radius / a) / e));
}

export function particleOrbit(p: TheoryParameters, temperature: number, s: number,
  mu: number, hot: boolean, fluxWeight: number): ParticleOrbit {
  const sourceRadius = RE + p.altitudeKm, speed2 = 2 * K_OVER_H_MASS * temperature * s;
  const vr = Math.sqrt(speed2) * mu, vt = Math.sqrt(speed2 * (1 - mu * mu));
  const energy = speed2 / 2 - GM / sourceRadius, bound = energy < 0;
  const a = GM / (2 * Math.abs(energy));
  const ex = sourceRadius * vt * vt / GM - 1, ey = -sourceRadius * vr * vt / GM;
  const e = Math.hypot(ex, ey), omega = Math.atan2(ey, ex);
  const endRadius = Math.min(THEORY_OUTER_RE * RE, bound ? a * (1 + e) : Infinity);
  const start = anomalyAtRadius(a, e, sourceRadius, bound);
  const end = anomalyAtRadius(a, e, endRadius, bound);
  const frequency = Math.sqrt(GM / a ** 3);
  const outwardTime = (meanAnomaly(e, end, bound) - meanAnomaly(e, start, bound)) / frequency;
  return { a, e, omega, bound, hot, start, end, frequency, outwardTime,
    sourceRadius, endRadius, fluxWeight, weight: fluxWeight * outwardTime * (bound ? 2 : 1) };
}

/** Integrate the flux speed law in s, splitting at escape energy. Integrating
 * uniform speed quantiles would undersample the cold population's escape tail.
 * mu² is uniform under the cosine crossing law; radial mode fixes mu=1.
 */
export function particleOrbits(p: TheoryParameters): ParticleOrbit[] {
  validateTheory(p);
  const speedRule = quadrature(p.launchLaw === 'radial' ? 80 : 20), angleRule = p.launchLaw === 'radial' ? [[1, 1]] : quadrature(12);
  const orbits: ParticleOrbit[] = [];
  for (const [temperature, fraction, hot] of [[p.coldK, 1 - p.hotFraction, false], [p.hotK, p.hotFraction, true]] as const) {
    if (!fraction) continue;
    const lambda = GM / ((RE + p.altitudeKm) * K_OVER_H_MASS * temperature);
    const cuts = [...new Set([0, 1, 2, 4, 8, 16, 32, 48, lambda])].sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) for (const [u, weight] of speedRule) {
      const span = cuts[i] - cuts[i - 1], s = cuts[i - 1] + span * u;
      for (const [mu2, angleWeight] of angleRule) {
        orbits.push(particleOrbit(p, temperature, s, Math.sqrt(mu2), hot,
          fraction * span * weight * s * Math.exp(-s) * angleWeight));
      }
    }
  }
  return orbits;
}

/** Exact time to an outward radius, used for independent shell-count checks. */
export function timeToRadius(orbit: ParticleOrbit, radiusKm: number) {
  if (radiusKm <= orbit.sourceRadius) return 0;
  if (radiusKm >= orbit.endRadius) return orbit.outwardTime;
  const anomaly = anomalyAtRadius(orbit.a, orbit.e, radiusKm, orbit.bound);
  return (meanAnomaly(orbit.e, anomaly, orbit.bound)
    - meanAnomaly(orbit.e, orbit.start, orbit.bound)) / orbit.frequency;
}

/** Position at a fraction of the outward/inward visible passage time.
 * Solve Kepler's equation in a bracket, including highly eccentric orbits.
 */
export function orbitPosition(orbit: ParticleOrbit, fraction: number, inbound = false): [number, number] {
  const { a, e, start, end, bound, omega } = orbit;
  const target = meanAnomaly(e, start, bound)
    + Math.max(0, Math.min(1, inbound ? 1 - fraction : fraction))
    * (meanAnomaly(e, end, bound) - meanAnomaly(e, start, bound));
  let lo = start, hi = end, anomaly = (lo + hi) / 2;
  for (let i = 0; i < 32; i++) {
    const residual = meanAnomaly(e, anomaly, bound) - target;
    if (Math.abs(residual) < 1e-13) break;
    if (residual > 0) hi = anomaly; else lo = anomaly;
    const derivative = bound ? 1 - e * Math.cos(anomaly) : e * Math.cosh(anomaly) - 1;
    const next = anomaly - residual / derivative;
    anomaly = next > lo && next < hi ? next : (lo + hi) / 2;
  }
  if (inbound) anomaly = 2 * Math.PI - anomaly;
  const x = bound ? a * (Math.cos(anomaly) - e) : a * (e - Math.cosh(anomaly));
  const y = bound ? a * Math.sqrt(Math.max(0, 1 - e * e)) * Math.sin(anomaly)
    : a * Math.sqrt(e * e - 1) * Math.sinh(anomaly);
  return [(x * Math.cos(omega) - y * Math.sin(omega)) / RE,
    (x * Math.sin(omega) + y * Math.cos(omega)) / RE];
}

export function buildParticleAtlas(p: TheoryParameters): ParticleAtlas {
  const orbits = particleOrbits(p), width = PARTICLE_SAMPLES * 2, height = orbits.length;
  const positions = new Float32Array(width * height * 4);
  const cumulative = new Float64Array(height), durations = new Float32Array(height);
  const bound = new Uint8Array(height), hot = new Uint8Array(height);
  let total = 0;
  orbits.forEach((orbit, row) => {
    cumulative[row] = total += orbit.weight;
    durations[row] = orbit.outwardTime * (orbit.bound ? 2 : 1);
    bound[row] = Number(orbit.bound); hot[row] = Number(orbit.hot);
    for (let branch = 0; branch < (orbit.bound ? 2 : 1); branch++) {
      for (let j = 0; j < PARTICLE_SAMPLES; j++) {
        // Concentrate samples near the source, where motion is fastest.
        const u = j / (PARTICLE_SAMPLES - 1);
        const fraction = branch ? 1 - (1 - u) ** 3 : u ** 3;
        const [x, y] = orbitPosition(orbit, fraction, branch === 1);
        const index = (row * width + branch * PARTICLE_SAMPLES + j) * 4;
        positions[index] = x; positions[index + 1] = y;
      }
    }
  });
  for (let i = 0; i < height; i++) cumulative[i] /= total;
  return { positions, width, height, cumulative, durations, bound, hot,
    totalAtoms: total * p.flux * 4 * Math.PI * ((RE + p.altitudeKm) * 1e5) ** 2 };
}

export function selectParticleOrbit(cumulative: Float64Array, quantile: number) {
  let lo = 0, hi = cumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cumulative[mid] < quantile) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Stable random slots: changing count retains the existing sample. */
export function particleRandom(index: number, channel: number) {
  let x = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Uniform source normal and uniform tangent azimuth, in 3D. */
export function particleFrame(index: number) {
  const z = 2 * particleRandom(index, 2) - 1, phi = 2 * Math.PI * particleRandom(index, 3);
  const azimuth = 2 * Math.PI * particleRandom(index, 4), r = Math.sqrt(1 - z * z);
  const c = Math.cos(phi), s = Math.sin(phi), ca = Math.cos(azimuth), sa = Math.sin(azimuth);
  return { normal: [r * c, r * s, z], tangent: [-s * ca - z * c * sa, c * ca - z * s * sa, r * sa] };
}

/** Hysteresis prevents rapid quality oscillation. A slow device reduces the
 * sample count; simulated time and the physical distribution are unchanged. */
export function adaptParticleCount(count: number, ceiling: number, fps: number, stableWindows: number) {
  if (fps < 25) return Math.max(PARTICLE_MIN, Math.min(ceiling, Math.floor(count * 0.7 / 1000) * 1000));
  if (fps > 40 && stableWindows >= 3) return Math.min(ceiling, Math.ceil(count * 1.2 / 1000) * 1000);
  return Math.min(count, ceiling);
}
