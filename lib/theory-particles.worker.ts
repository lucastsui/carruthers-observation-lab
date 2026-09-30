import { buildParticleAtlas } from './theory-particles.ts';
import type { TheoryParameters } from './theory.ts';

self.onmessage = (event: MessageEvent<TheoryParameters>) => {
  try {
    const atlas = buildParticleAtlas(event.data);
    self.postMessage({ atlas }, { transfer: [atlas.positions.buffer, atlas.cumulative.buffer,
      atlas.durations.buffer, atlas.bound.buffer, atlas.hot.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Particle preparation failed.' });
  }
};
