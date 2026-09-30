import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptParticleCount, buildParticleAtlas, orbitPosition, particleFrame, particleOrbit,
  particleOrbits, particleRandom, PARTICLE_MAX, PARTICLE_MIN, PARTICLE_SLICE_HALF_RE, selectParticleOrbit, timeToRadius,
} from '../lib/theory-particles.ts';
import { DEFAULT_THEORY, densityAt, EARTH_GM as GM, EARTH_RADIUS_KM as RE, K_OVER_H_MASS } from '../lib/theory.ts';

function near(actual: number, expected: number, relative = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= Math.max(1e-10, Math.abs(expected) * relative), `${actual} != ${expected}`);
}

void test('source frames cover the whole sphere with uniform tangent azimuth', () => {
  const mean = [0, 0, 0], squares = [0, 0, 0];
  const octants = Array(8).fill(0);
  for (let i = 0; i < 20000; i++) {
    const { normal, tangent } = particleFrame(i);
    near(Math.hypot(...normal), 1); near(Math.hypot(...tangent), 1);
    near(normal.reduce((sum, n, j) => sum + n * tangent[j], 0), 0);
    normal.forEach((n, j) => { mean[j] += n / 20000; squares[j] += n * n / 20000; });
    octants[(normal[0] > 0 ? 1 : 0) + (normal[1] > 0 ? 2 : 0) + (normal[2] > 0 ? 4 : 0)]++;
  }
  mean.forEach(value => assert.ok(Math.abs(value) < 0.015));
  squares.forEach(value => near(value, 1 / 3, 0.025));
  octants.forEach(value => assert.ok(value > 2300 && value < 2700));
});

void test('time-parametrized paths conserve energy and angular momentum and obey source boundaries', () => {
  const r0 = RE + 500;
  for (const speed of [2, 8, 10.7, 11, 25]) for (const mu of [0.15, 0.7, 1]) {
    const s = speed * speed / (2 * K_OVER_H_MASS * 1000);
    const orbit = particleOrbit(DEFAULT_THEORY, 1000, s, mu, false, 1);
    near(Math.hypot(...orbitPosition(orbit, 0)), r0 / RE);
    near(Math.hypot(...orbitPosition(orbit, 1)), orbit.endRadius / RE);
    if (orbit.bound) near(Math.hypot(...orbitPosition(orbit, 1, true)), r0 / RE);
    for (const inbound of orbit.bound ? [false, true] : [false]) {
      const dt = Math.min(0.01, orbit.outwardTime * 1e-5), f = 0.37;
      const point = orbitPosition(orbit, f, inbound).map(value => value * RE);
      const before = orbitPosition(orbit, f - dt / orbit.outwardTime, inbound);
      const after = orbitPosition(orbit, f + dt / orbit.outwardTime, inbound);
      const velocity = after.map((v, i) => (v - before[i]) * RE / (2 * dt));
      near(velocity.reduce((sum, v) => sum + v * v, 0) / 2 - GM / Math.hypot(...point), speed * speed / 2 - GM / r0, 2e-5);
      near(point[0] * velocity[1] - point[1] * velocity[0], r0 * speed * Math.sqrt(1 - mu * mu), 2e-5);
      assert.ok((point[0] * velocity[0] + point[1] * velocity[1]) * (inbound ? -1 : 1) > 0);
    }
  }
});

void test('residence-weighted shell populations agree with the independent analytic density field', () => {
  for (const launchLaw of ['cosine', 'radial'] as const) {
    for (const source of [{ coldK: 1000, hotK: 6000, hotFraction: 0.1 },
      { coldK: 200, hotK: 30000, hotFraction: 0 }, { coldK: 3000, hotK: 30000, hotFraction: 1 }]) {
      const p = { ...DEFAULT_THEORY, ...source, launchLaw }, orbits = particleOrbits(p);
      near(orbits.reduce((sum, orbit) => sum + orbit.fluxWeight, 0), 1, 1e-9);
      near(orbits.filter(orbit => orbit.hot).reduce((sum, orbit) => sum + orbit.fluxWeight, 0), p.hotFraction, 1e-9);
      const bins = [1 + p.altitudeKm / RE, 1.2, 1.5, 2, 3, 5, 10, 20, 30];
      for (let i = 1; i < bins.length; i++) {
        const a = bins[i - 1], b = bins[i], steps = 2000, dr = (b - a) / steps;
        const sampled = orbits.reduce((sum, orbit) => sum + orbit.fluxWeight
          * (timeToRadius(orbit, b * RE) - timeToRadius(orbit, a * RE)) * (orbit.bound ? 2 : 1), 0)
          * p.flux * 4 * Math.PI * ((RE + p.altitudeKm) * 1e5) ** 2;
        let integral = 0;
        for (let j = 0; j <= steps; j++) {
          const r = a + j * dr;
          integral += (j === 0 || j === steps ? 1 : j % 2 ? 4 : 2) * densityAt(r, p).total * r * r;
        }
        integral *= dr / 3 * 4 * Math.PI * (RE * 1e5) ** 3;
        near(sampled, integral, 0.03);
      }
    }
  }
});

void test('off-domain bound particles retain both passages without a connecting chord', () => {
  const orbits = particleOrbits(DEFAULT_THEORY);
  const crossing = orbits.find(orbit => orbit.bound && orbit.a * (1 + orbit.e) > 31 * RE)!;
  assert.ok(crossing);
  near(Math.hypot(...orbitPosition(crossing, 1)), 30);
  near(Math.hypot(...orbitPosition(crossing, 0, true)), 30);
  near(crossing.weight, 2 * crossing.fluxWeight * crossing.outwardTime);
});

void test('GPU atlas and randomly phased display slots preserve shell populations', () => {
  const atlas = buildParticleAtlas(DEFAULT_THEORY), bins = [1.5, 3, 10, 30];
  assert.ok(atlas.height <= 4096);
  assert.ok(atlas.positions.every(Number.isFinite));
  const orbits = particleOrbits(DEFAULT_THEORY), totalWeight = orbits.reduce((sum, orbit) => sum + orbit.weight, 0);
  const expected = bins.map(radius => orbits.reduce((sum, orbit) => sum
    + orbit.fluxWeight * timeToRadius(orbit, radius * RE) * (orbit.bound ? 2 : 1), 0) / totalWeight);
  // Read the actual GPU path table at independently sampled times.
  const counts = bins.map(() => 0), sliceCounts = bins.map(() => 0), sampleCount = 200000;
  let sliceTotal = 0;
  for (let i = 0; i < sampleCount; i++) {
    const row = selectParticleOrbit(atlas.cumulative, particleRandom(i, 0)), phase = particleRandom(i, 1);
    const returning = atlas.bound[row] && phase >= 0.5;
    const time = atlas.bound[row] ? (phase * 2) % 1 : phase;
    const u = returning ? 1 - Math.cbrt(1 - time) : Math.cbrt(time);
    const index = u * 127, lo = Math.min(126, Math.floor(index)), f = index - lo;
    const offset = (row * atlas.width + (returning ? 128 : 0) + lo) * 4;
    const x = atlas.positions[offset] * (1 - f) + atlas.positions[offset + 4] * f;
    const y = atlas.positions[offset + 1] * (1 - f) + atlas.positions[offset + 5] * f;
    const radius = Math.hypot(x, y);
    assert.ok(radius >= (RE + DEFAULT_THEORY.altitudeKm) / RE - 1e-4 && radius <= 30.001);
    bins.forEach((edge, j) => { if (radius <= edge + 1e-4) counts[j]++; });
    const frame = particleFrame(i), xyz = frame.normal.map((n, j) => n * x + frame.tangent[j] * y);
    const rho = Math.hypot(xyz[0], xyz[1]);
    if (Math.abs(xyz[2]) <= PARTICLE_SLICE_HALF_RE && rho >= (RE + DEFAULT_THEORY.altitudeKm) / RE) {
      sliceTotal++;
      sliceCounts.forEach((_, j) => { if (rho <= bins[j]) sliceCounts[j]++; });
    }
  }
  counts.forEach((count, i) => near(count / sampleCount, expected[i], 0.02));
  // A thin cross-section samples area × local density (2π r n(r) dr),
  // unlike the sphere's 4π r² n(r) dr. Its finite thickness is explicit in UI.
  const integrated = bins.map(edge => {
    const start = 1 + DEFAULT_THEORY.altitudeKm / RE, steps = 4000, dr = (edge - start) / steps;
    let sum = 0;
    for (let i = 0; i <= steps; i++) {
      const r = start + i * dr;
      sum += (i === 0 || i === steps ? 1 : i % 2 ? 4 : 2) * r * densityAt(r, DEFAULT_THEORY).total;
    }
    return sum * dr / 3;
  });
  assert.ok(sliceTotal > 1000);
  sliceCounts.forEach((count, i) => assert.ok(Math.abs(count / sliceTotal - integrated[i] / integrated.at(-1)!) < 0.025));
});

void test('boundary source settings produce finite positive residence times and atlas data', () => {
  for (const altitudeKm of [200, 1500]) for (const launchLaw of ['cosine', 'radial'] as const) {
    const atlas = buildParticleAtlas({ ...DEFAULT_THEORY, altitudeKm, launchLaw, coldK: 200, hotK: 30000 });
    assert.ok(atlas.positions.every(Number.isFinite));
    assert.ok(atlas.durations.every(value => value > 0 && Number.isFinite(value)));
    near(atlas.cumulative.at(-1)!, 1);
    assert.ok(atlas.totalAtoms > 0 && Number.isFinite(atlas.totalAtoms));
  }
});

void test('automatic quality respects limits and only raises detail after sustained headroom', () => {
  assert.equal(adaptParticleCount(100000, 100000, 20, 0), 70000);
  assert.equal(adaptParticleCount(10000, 100000, 60, 2), 10000);
  assert.equal(adaptParticleCount(10000, 100000, 60, 3), 12000);
  assert.equal(adaptParticleCount(PARTICLE_MIN, 100000, 2, 0), PARTICLE_MIN);
  assert.equal(adaptParticleCount(PARTICLE_MAX, PARTICLE_MAX, 60, 10), PARTICLE_MAX);
});
