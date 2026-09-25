import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTheory, componentDensity, DEFAULT_THEORY, densityAt, EARTH_GM,
  EARTH_RADIUS_KM, escapeFraction, K_OVER_H_MASS, launchSpeed,
  theoryCSV, theoryJSON, trajectory,
} from '../lib/theory.ts';

const near = (actual: number, expected: number, relative = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= Math.max(1e-20, Math.abs(expected) * relative), `${actual} ≠ ${expected}`);

function integrate(f: (x: number) => number, a: number, b: number, tolerance = 1e-11): number {
  const simpson = (lo: number, hi: number) => (hi - lo) / 6 * (f(lo) + 4 * f((lo + hi) / 2) + f(hi));
  function refine(lo: number, hi: number, whole: number, tol: number, depth: number): number {
    const mid = (lo + hi) / 2, left = simpson(lo, mid), right = simpson(mid, hi);
    if (depth === 0 || Math.abs(left + right - whole) < 15 * tol) return left + right + (left + right - whole) / 15;
    return refine(lo, mid, left, tol / 2, depth - 1) + refine(mid, hi, right, tol / 2, depth - 1);
  }
  return refine(a, b, simpson(a, b), tolerance, 24);
}

// Independent velocity/residence-time integral, using adaptive Simpson instead
// of the production Gaussian moment reduction. Units here are cm throughout.
function referenceDensity(radiusRe: number, temperature: number, radial = false) {
  const r0 = (6370 + 500) * 1e5, r = radiusRe * 6370 * 1e5;
  const gm = 398600.4418 * 1e15, sigma2 = 1.380649e-16 * temperature / 1.6735575e-24;
  const q = (r0 / r) ** 2, delta = 2 * gm * (1 / r0 - 1 / r);
  const d = delta / (2 * sigma2), lambda = gm / (r0 * sigma2);
  // Transform s=d+u² to regularize the radial turning point.
  const f = (u: number) => {
    const s = d + u * u;
    if (radial) return Math.SQRT2 / Math.sqrt(sigma2) * q * s * Math.exp(-s);
    const a = 2 * sigma2 * s - delta, b = 2 * sigma2 * s * (1 - q) - delta;
    return Math.exp(-s) / sigma2 * (Math.sqrt(Math.max(0, a)) - Math.sqrt(Math.max(0, b))) * 2 * u;
  };
  const branch = Math.sqrt(lambda - d);
  const angularCorner = Math.sqrt(Math.max(0, d / (1 - q) - d));
  const cuts = [...new Set([0, branch, angularCorner, Math.sqrt(50)].filter(x => x <= Math.sqrt(50)))].sort((a, b) => a - b);
  let sum = 0;
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1], b = cuts[i];
    sum += integrate(f, a, b, 1e-17) * ((a + b) / 2 < branch ? 2 : 1);
  }
  return sum;
}

void test('density agrees with an independent residence-time integral for both direction laws', () => {
  for (const law of ['cosine', 'radial'] as const) for (const T of [500, 1000, 6000, 25000]) {
    for (const radius of [1.08, 2, 5, 10, 30]) {
      const calculated = componentDensity(radius * EARTH_RADIUS_KM, EARTH_RADIUS_KM + 500, T, law);
      near(calculated.ballistic + calculated.escaping, referenceDensity(radius, T, law === 'radial'), 5e-6);
    }
  }
});

void test('cold thermal escape reproduces the Jeans flux fraction, independent of angle', () => {
  const r0 = 6870, sigma2 = K_OVER_H_MASS * 1000, lambda = EARTH_GM / (r0 * sigma2);
  near(escapeFraction(1000, r0), integrate(s => s * Math.exp(-s), lambda, 50));
  const cosine = calculateTheory({ ...DEFAULT_THEORY, hotFraction: 0 });
  const radial = calculateTheory({ ...cosine.parameters, launchLaw: 'radial' });
  near(cosine.escapeFraction, radial.escapeFraction);
  near(cosine.escapeFraction + cosine.returnFraction, 1);
  assert.ok(cosine.escapeFraction > 0.007 && cosine.escapeFraction < 0.008);
});

void test('source normalization and population mixtures are linear; equal temperatures are identical', () => {
  const c = calculateTheory({ ...DEFAULT_THEORY, hotFraction: 0 });
  const h = calculateTheory({ ...DEFAULT_THEORY, hotFraction: 1 });
  const mix = calculateTheory(DEFAULT_THEORY);
  const doubled = calculateTheory({ ...DEFAULT_THEORY, flux: DEFAULT_THEORY.flux * 2 });
  for (let i = 0; i < mix.profile.length; i++) {
    near(mix.profile[i].total, 0.9 * c.profile[i].total + 0.1 * h.profile[i].total);
    near(doubled.profile[i].total, mix.profile[i].total * 2);
    near(mix.profile[i].total, mix.profile[i].ballistic + mix.profile[i].escaping);
  }
  const equal = { ...DEFAULT_THEORY, coldK: 3000, hotK: 3000 };
  near(calculateTheory(equal).densityAt10, calculateTheory({ ...equal, hotFraction: 0.95 }).densityAt10);
});

void test('source density has the thermal half-space limit and excludes the unmodeled interior', () => {
  const p = { ...DEFAULT_THEORY, hotFraction: 0 }, r0 = EARTH_RADIUS_KM + p.altitudeKm;
  const sigma = Math.sqrt(K_OVER_H_MASS * p.coldK) * 1e5;
  const vmax = Math.sqrt(2 * EARTH_GM / r0) * 1e5;
  const bulkBound = integrate(x => Math.sqrt(2 / Math.PI) * x * x * Math.exp(-x * x / 2), 0, vmax / sigma);
  const reservoirDensity = p.flux * Math.sqrt(2 * Math.PI) / sigma;
  near(densityAt(r0 / EARTH_RADIUS_KM, p).total, reservoirDensity * (1 + bulkBound) / 2);
  assert.equal(densityAt(1, p).total, 0);
});

void test('full trajectories include angular momentum, return to the source, and use total energy for escape', () => {
  const r0 = 6870, speed = 8, angle = 60;
  const t = trajectory(500, speed, angle);
  near(Math.hypot(...t.points[0]), r0 / EARTH_RADIUS_KM);
  near(Math.hypot(...t.points.at(-1)!), r0 / EARTH_RADIUS_KM);
  const energy = speed * speed / 2 - EARTH_GM / r0;
  const angularMomentum = r0 * speed * Math.sin(angle * Math.PI / 180);
  near(angularMomentum ** 2 / (2 * (t.apexRe! * EARTH_RADIUS_KM) ** 2) - EARTH_GM / (t.apexRe! * EARTH_RADIUS_KM), energy);
  assert.ok(t.points.some(([_, y]) => Math.abs(y) > 1));
  assert.ok(trajectory(500, 12, 75).escapes); // small vertical speed but total energy > 0
  const vertical = trajectory(500, 5, 0);
  near(vertical.apexRe!, (1 / (1 / r0 - 25 / (2 * EARTH_GM))) / EARTH_RADIUS_KM);
});

void test('crossing speeds use flux weighting and exported recipes preserve units and assumptions', () => {
  const v = launchSpeed(1000, 0.5), s = v * v / (2 * K_OVER_H_MASS * 1000);
  near(1 - (1 + s) * Math.exp(-s), 0.5);
  const r = calculateTheory(DEFAULT_THEORY), csv = theoryCSV(r), exported = JSON.parse(theoryJSON(r));
  assert.equal(csv.trim().split('\n').length, r.profile.length + 1);
  assert.match(csv, /hot_launch_flux_fraction/);
  assert.deepEqual(exported.parameters, DEFAULT_THEORY);
  assert.equal(exported.units.profile_density, 'atoms/cm³');
  assert.ok(exported.assumptions.some((s: string) => s.includes('No collisions')));
});

void test('parameter extremes remain finite and invalid input is rejected', () => {
  for (const altitudeKm of [200, 725, 1500]) for (const coldK of [200, 3000]) {
    const r = calculateTheory({ ...DEFAULT_THEORY, altitudeKm, coldK, hotK: 30000 });
    assert.ok(r.profile.every(p => Number.isFinite(p.total) && p.total > 0));
  }
  assert.throws(() => calculateTheory({ ...DEFAULT_THEORY, flux: NaN }));
  assert.throws(() => calculateTheory({ ...DEFAULT_THEORY, hotFraction: 1.1 }));
});
