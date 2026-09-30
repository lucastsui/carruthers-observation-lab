import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptParticleCount, buildParticleAtlas, orbitPosition, particleFrame, particleOrbit,
  particleOrbits, particleRandom, PARTICLE_MAX, PARTICLE_MIN, PARTICLE_SAMPLES, selectParticleOrbit, timeToRadius,
  type ParticleAtlas,
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

void test('bound atoms cross 30 R_E continuously, spend full time outside, and recycle only at the exobase', () => {
  const orbits = particleOrbits(DEFAULT_THEORY);
  const crossing = orbits.find(orbit => orbit.bound && orbit.endRadius > 60 * RE && orbit.endRadius < 120 * RE)!;
  assert.ok(crossing);
  const exitTime = timeToRadius(crossing, 30 * RE), halfFlight = crossing.outwardTime;
  assert.ok(halfFlight > exitTime * 2, 'outside flight must not be skipped');
  near(halfFlight, (Math.PI - crossing.start + crossing.e * Math.sin(crossing.start)) / crossing.frequency);
  near(Math.hypot(...orbitPosition(crossing, exitTime / halfFlight)), 30);
  near(Math.hypot(...orbitPosition(crossing, 1 - exitTime / halfFlight, true)), 30);
  const apogee = orbitPosition(crossing, 1), inwardStart = orbitPosition(crossing, 0, true);
  near(Math.hypot(...apogee), crossing.a * (1 + crossing.e) / RE);
  apogee.forEach((value, i) => near(value, inwardStart[i]));
  near(Math.hypot(...orbitPosition(crossing, 1, true)), crossing.sourceRadius / RE);
  near(crossing.weight, 2 * crossing.fluxWeight * halfFlight);
  for (const orbit of orbits.filter(orbit => !orbit.bound)) {
    near(orbit.endRadius / RE, 30);
    near(Math.hypot(...orbitPosition(orbit, 1)), 30);
    near(orbit.weight, orbit.fluxWeight * orbit.outwardTime);
  }
});

function atlasPosition(atlas: ParticleAtlas, row: number, fraction: number, inbound = false) {
  const warp = atlas.timeWarps[row];
  const outward = Math.log1p((inbound ? 1 - fraction : fraction) * Math.expm1(warp)) / warp;
  const index = (inbound ? 1 - outward : outward) * (PARTICLE_SAMPLES - 1);
  const lo = Math.min(PARTICLE_SAMPLES - 2, Math.floor(index)), f = index - lo;
  const offset = (row * atlas.width + (inbound ? PARTICLE_SAMPLES : 0) + lo) * 4;
  return [atlas.positions[offset] * (1 - f) + atlas.positions[offset + 4] * f,
    atlas.positions[offset + 1] * (1 - f) + atlas.positions[offset + 5] * f];
}

void test('long bound GPU paths resolve source motion and join continuously at apogee', () => {
  for (const launchLaw of ['cosine', 'radial'] as const) {
    const p = { ...DEFAULT_THEORY, launchLaw }, atlas = buildParticleAtlas(p), orbits = particleOrbits(p);
    const rows = orbits.map((orbit, row) => ({ orbit, row }))
      .filter(({ orbit }) => orbit.bound && orbit.endRadius > 30 * RE);
    assert.ok(rows.length > 0);
    for (const { orbit, row } of rows) {
      near(atlas.durations[row], orbit.outwardTime * 2, 1e-7);
      for (const fraction of [0, 1e-10, 1e-8, 1e-6, 1e-4, 0.01, 0.1, 0.5, 0.9, 1]) {
        for (const inbound of [false, true]) {
          const actual = atlasPosition(atlas, row, fraction, inbound), exact = orbitPosition(orbit, fraction, inbound);
          assert.ok(Math.hypot(actual[0] - exact[0], actual[1] - exact[1]) / Math.hypot(...exact) < 0.006,
            `${launchLaw} row ${row}, fraction ${fraction}, inbound ${inbound}`);
        }
      }
      const outward = atlasPosition(atlas, row, 1), inward = atlasPosition(atlas, row, 0, true);
      outward.forEach((value, i) => near(value, inward[i]));
    }
  }
});

void test('GPU atlas and randomly phased display slots preserve shell populations', () => {
  const atlas = buildParticleAtlas(DEFAULT_THEORY), bins = [1.5, 3, 10, 30];
  assert.ok(atlas.height <= 4096);
  assert.ok(atlas.positions.every(Number.isFinite));
  const orbits = particleOrbits(DEFAULT_THEORY), totalWeight = orbits.reduce((sum, orbit) => sum + orbit.weight, 0);
  const expected = bins.map(radius => orbits.reduce((sum, orbit) => sum
    + orbit.fluxWeight * timeToRadius(orbit, radius * RE) * (orbit.bound ? 2 : 1), 0) / totalWeight);
  // Read the actual GPU path table at independently sampled times.
  const counts = bins.map(() => 0), sampleCount = 1000000;
  for (let i = 0; i < sampleCount; i++) {
    const row = selectParticleOrbit(atlas.cumulative, particleRandom(i, 0)), phase = particleRandom(i, 1);
    const returning = atlas.bound[row] && phase >= 0.5;
    const time = atlas.bound[row] ? (phase * 2) % 1 : phase;
    const [x, y] = atlasPosition(atlas, row, time, !!returning);
    const radius = Math.hypot(x, y);
    assert.ok(radius >= (RE + DEFAULT_THEORY.altitudeKm) / RE - 1e-4);
    assert.ok(radius <= orbits[row].endRadius / RE + 0.01);
    bins.forEach((edge, j) => { if (radius <= edge + 1e-4) counts[j]++; });
  }
  counts.forEach((count, i) => near(count / sampleCount, expected[i], 0.02));
});

void test('boundary source settings produce finite positive residence times and atlas data', () => {
  for (const altitudeKm of [200, 1500]) for (const launchLaw of ['cosine', 'radial'] as const) {
    const atlas = buildParticleAtlas({ ...DEFAULT_THEORY, altitudeKm, launchLaw, coldK: 200, hotK: 30000 });
    assert.ok(atlas.positions.every(Number.isFinite));
    assert.ok(atlas.durations.every(value => value > 0 && Number.isFinite(value)));
    near(atlas.cumulative.at(-1)!, 1);
    assert.ok(atlas.timeWarps.every(value => value > 0 && Number.isFinite(value)));
  }
});

void test('escape energies near catalogue knots do not create singular bound flights', () => {
  const factor = GM / ((RE + DEFAULT_THEORY.altitudeKm) * K_OVER_H_MASS);
  for (const lambda of [1, 2, 4, 8, 16, 32]) for (const shift of [-1e-9, 0, 1e-9]) {
    const temperature = factor / (lambda + shift);
    const p = lambda <= 2 ? { ...DEFAULT_THEORY, hotK: temperature, hotFraction: 1 }
      : { ...DEFAULT_THEORY, coldK: temperature, hotFraction: 0 };
    const orbits = particleOrbits(p);
    near(orbits.reduce((sum, orbit) => sum + orbit.fluxWeight, 0), 1, 1e-9);
    for (const orbit of orbits) {
      assert.ok(orbit.outwardTime > 0 && Number.isFinite(orbit.outwardTime));
      assert.ok(orbit.endRadius / RE < 100000);
      assert.ok(Number.isFinite(orbit.weight + orbit.timeWarp));
    }
  }
});

void test('automatic quality respects limits and only raises detail after sustained headroom', () => {
  assert.equal(adaptParticleCount(100000, 100000, 20, 0), 70000);
  assert.equal(adaptParticleCount(10000, 100000, 60, 2), 10000);
  assert.equal(adaptParticleCount(10000, 100000, 60, 3), 12000);
  assert.equal(adaptParticleCount(PARTICLE_MIN, 100000, 2, 0), PARTICLE_MIN);
  assert.equal(adaptParticleCount(PARTICLE_MAX, PARTICLE_MAX, 60, 10), PARTICLE_MAX);
});
