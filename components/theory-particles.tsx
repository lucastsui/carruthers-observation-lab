'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  adaptParticleCount, particleFrame, particleRandom, PARTICLE_MAX, PARTICLE_MIN,
  PARTICLE_SAMPLES, PARTICLE_SLICE_HALF_RE, selectParticleOrbit, type ParticleAtlas,
} from '@/lib/theory-particles';
import { EARTH_RADIUS_KM, type TheoryParameters } from '@/lib/theory';
// Vite supplies the default constructor for this virtual worker module.
// oxlint-disable-next-line import/default
import ParticleWorker from '../lib/theory-particles.worker.ts?worker';

const vertexShader = `
  uniform sampler2D paths;
  uniform vec2 atlasSize;
  uniform float clockSeconds;
  uniform float pointSize;
  uniform float sliceHalfWidth;
  uniform float sourceRadius;
  attribute vec3 normalAxis;
  attribute vec3 tangentAxis;
  // row, signed inverse duration (positive = bound), time phase, hot flag
  attribute vec4 orbit;
  varying vec3 dotColor;
  void main() {
    float phase = fract(orbit.z + clockSeconds * abs(orbit.y));
    bool bound = orbit.y > 0.0;
    bool inbound = bound && phase >= 0.5;
    float t = bound ? fract(phase * 2.0) : phase;
    float u = inbound ? 1.0 - pow(1.0 - t, 1.0 / 3.0) : pow(t, 1.0 / 3.0);
    float sampleIndex = u * ${PARTICLE_SAMPLES - 1}.0;
    float left = min(floor(sampleIndex), ${PARTICLE_SAMPLES - 2}.0);
    float column = (inbound ? ${PARTICLE_SAMPLES}.0 : 0.0) + left;
    vec2 uv = vec2((column + 0.5) / atlasSize.x, (orbit.x + 0.5) / atlasSize.y);
    vec2 a = texture2D(paths, uv).xy;
    vec2 b = texture2D(paths, uv + vec2(1.0 / atlasSize.x, 0.0)).xy;
    vec2 xy = mix(a, b, sampleIndex - left);
    vec3 point = normalAxis * xy.x + tangentAxis * xy.y;
    // A thin slab approximates the mathematical plane. Mask the unmodeled
    // source interior in the plane too, so the Earth disk is always empty.
    if (sliceHalfWidth > 0.0 && (abs(point.z) > sliceHalfWidth || length(point.xy) < sourceRadius)) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0;
      dotColor = vec3(0.0); return;
    }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
    gl_PointSize = pointSize;
    dotColor = mix(vec3(0.412, 0.722, 1.0), vec3(1.0, 0.729, 0.471), orbit.w);
  }
`;
const fragmentShader = `
  uniform float opacity;
  varying vec3 dotColor;
  void main() { gl_FragColor = vec4(dotColor, opacity); }
`;
type Options = { limit: number; automatic: boolean; speed: number; paused: boolean; opacity: number; extent: number; projection: boolean };
type Stats = { count: number; fps: number; atomsPerDot: number; simulatedSeconds: number };

export default function TheoryParticles({ parameters, extent, overlay, projection }: {
  parameters: TheoryParameters; extent: number; overlay: ReactNode; projection: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(100000), [automatic, setAutomatic] = useState(true);
  const [speed, setSpeed] = useState(60), [paused, setPaused] = useState(false), [opacity, setOpacity] = useState(0.65);
  const [stats, setStats] = useState<Stats | null>(null), [status, setStatus] = useState('Preparing steady-state cloud…');
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const options = useRef<Options>({ limit, automatic, speed, paused, opacity, extent, projection });
  useEffect(() => { options.current = { limit, automatic, speed, paused, opacity, extent, projection }; },
    [limit, automatic, speed, paused, opacity, extent, projection]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false }); }
    catch {
      queueMicrotask(() => { if (!disposed) setError('Particle rendering needs WebGL 2. The density slice and example trajectories are still available.'); });
      return () => { disposed = true; };
    }
    queueMicrotask(() => { if (!disposed) { setError(''); setStats(null); setStatus('Preparing steady-state cloud…'); } });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor('#0a131d');
    renderer.domElement.setAttribute('aria-label', 'Animated hydrogen atoms outside the source shell');
    renderer.domElement.tabIndex = 0;
    element.insertBefore(renderer.domElement, element.firstChild);
    const scene = new THREE.Scene();
    const initial = options.current;
    const camera = new THREE.OrthographicCamera(-initial.extent, initial.extent, initial.extent, -initial.extent, 0.1, 200);
    camera.position.set(0, 0, 80);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false; controls.enableZoom = false; controls.enableDamping = true;
    const earthGeometry = new THREE.SphereGeometry(1, 48, 32);
    const earthMaterial = new THREE.MeshBasicMaterial({ color: '#294b62' });
    scene.add(new THREE.Mesh(earthGeometry, earthMaterial));
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, transparent: true, depthWrite: false,
      uniforms: { paths: { value: null }, atlasSize: { value: new THREE.Vector2() },
        clockSeconds: { value: 0 }, pointSize: { value: renderer.getPixelRatio() }, opacity: { value: initial.opacity },
        sliceHalfWidth: { value: initial.projection ? 0 : PARTICLE_SLICE_HALF_RE }, sourceRadius: { value: 1 + parameters.altitudeKm / EARTH_RADIUS_KM } },
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    let atlas: ParticleAtlas | null = null, texture: THREE.DataTexture | null = null;
    let capacity = 0, count = Math.min(25000, options.current.limit), phaseTime = 0, elapsed = 0;
    let visible = true, width = 0, animation = 0, last = 0, frames = 0, windowTime = 0, stableWindows = 0;
    let lastExtent = initial.extent, lastProjection = initial.projection, lost = false;
    controls.enabled = initial.projection;
    renderer.domElement.style.touchAction = initial.projection ? 'none' : 'auto';
    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      if (width > 0) renderer.setSize(width, entry.contentRect.height, false);
    });
    resize.observe(element);
    const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; last = 0; });
    visibility.observe(element);
    const onVisibility = () => { last = 0; frames = 0; windowTime = 0; };
    document.addEventListener('visibilitychange', onVisibility);
    const onContextLost = (event: Event) => {
      event.preventDefault(); lost = true;
      setError('Graphics rendering was interrupted. Retry with a lower dot limit.');
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    function populate(required: number) {
      if (!atlas || required <= capacity) return;
      const nextCapacity = Math.min(PARTICLE_MAX, Math.max(required, Math.ceil(capacity * 1.5)));
      const normals = new Float32Array(nextCapacity * 3), tangents = new Float32Array(nextCapacity * 3);
      const slots = new Float32Array(nextCapacity * 4);
      if (capacity) {
        normals.set(geometry.getAttribute('normalAxis').array);
        tangents.set(geometry.getAttribute('tangentAxis').array);
        slots.set(geometry.getAttribute('orbit').array);
      }
      for (let i = capacity; i < nextCapacity; i++) {
        const row = selectParticleOrbit(atlas.cumulative, particleRandom(i, 0));
        const { normal, tangent } = particleFrame(i);
        normals.set(normal, i * 3); tangents.set(tangent, i * 3);
        // Newly exposed slots also start at an independent steady-state phase.
        slots.set([row, (atlas.bound[row] ? 1 : -1) / atlas.durations[row], particleRandom(i, 1), atlas.hot[row]], i * 4);
      }
      // Free replaced GPU buffers, while retaining the single Points object.
      geometry.dispose();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nextCapacity * 3), 3));
      geometry.setAttribute('normalAxis', new THREE.BufferAttribute(normals, 3));
      geometry.setAttribute('tangentAxis', new THREE.BufferAttribute(tangents, 3));
      geometry.setAttribute('orbit', new THREE.BufferAttribute(slots, 4));
      capacity = nextCapacity;
    }

    let worker: Worker | null = null;
    try {
      worker = new ParticleWorker();
      worker.onmessage = (event: MessageEvent<{ atlas?: ParticleAtlas; error?: string }>) => {
        if (disposed) return;
        if (!event.data.atlas) { setError(event.data.error || 'Particle preparation failed.'); return; }
        atlas = event.data.atlas;
        if (atlas.height > renderer.capabilities.maxTextureSize) {
          setError('This graphics device cannot hold the particle paths. Use the density slice on this device.'); return;
        }
        texture = new THREE.DataTexture(atlas.positions, atlas.width, atlas.height, THREE.RGBAFormat, THREE.FloatType);
        texture.minFilter = THREE.NearestFilter; texture.magFilter = THREE.NearestFilter;
        texture.generateMipmaps = false; texture.needsUpdate = true;
        material.uniforms.paths.value = texture;
        material.uniforms.atlasSize.value.set(atlas.width, atlas.height);
        populate(count); geometry.setDrawRange(0, count);
        setStatus('');
        setStats({ count, fps: 0, atomsPerDot: atlas.totalAtoms / count, simulatedSeconds: 0 });
        worker?.terminate(); worker = null;
      };
      worker.onerror = () => { if (!disposed) setError('Particle preparation failed. Retry to rebuild the cloud.'); };
      worker.postMessage(parameters);
    } catch (error) {
      console.error('Particle worker startup failed', error);
      queueMicrotask(() => { if (!disposed) setError('This browser could not start particle preparation. Retry or use the density slice.'); });
    }

    function render(timestamp: number) {
      animation = requestAnimationFrame(render);
      if (disposed || lost || !visible || document.hidden || width <= 0 || !atlas || !texture) {
        last = 0; frames = 0; windowTime = 0; return;
      }
      const dt = last ? (timestamp - last) / 1000 : 0;
      last = timestamp;
      const current = options.current;
      count = current.automatic ? Math.min(count, current.limit) : current.limit;
      populate(count); geometry.setDrawRange(0, count);
      if (!current.paused) { phaseTime += dt * current.speed; elapsed += dt * current.speed; }
      // Rebase phases before float shader time loses sub-second precision.
      if (phaseTime > 86400) {
        const attribute = geometry.getAttribute('orbit') as THREE.BufferAttribute;
        for (let i = 0; i < capacity; i++) attribute.setZ(i,
          (attribute.getZ(i) + phaseTime * Math.abs(attribute.getY(i))) % 1);
        attribute.needsUpdate = true; phaseTime = 0;
      }
      material.uniforms.clockSeconds.value = phaseTime;
      material.uniforms.opacity.value = current.opacity;
      material.uniforms.sliceHalfWidth.value = current.projection ? 0 : PARTICLE_SLICE_HALF_RE;
      if (lastProjection !== current.projection) {
        lastProjection = current.projection; controls.enabled = current.projection;
        renderer.domElement.style.touchAction = current.projection ? 'none' : 'auto';
        controls.reset(); camera.position.set(0, 0, 80); camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, 0);
      }
      if (current.extent !== lastExtent) {
        lastExtent = current.extent;
        camera.left = -lastExtent; camera.right = lastExtent;
        camera.top = lastExtent; camera.bottom = -lastExtent; camera.updateProjectionMatrix();
      }
      if (current.projection) controls.update();
      renderer.render(scene, camera);
      frames++; windowTime += dt;
      if (windowTime >= 1) {
        const fps = frames / windowTime;
        setStats({ count, fps, atomsPerDot: atlas.totalAtoms / count, simulatedSeconds: elapsed });
        if (current.automatic && !current.paused) {
          stableWindows = fps > 40 ? stableWindows + 1 : 0;
          const next = adaptParticleCount(count, current.limit, fps, stableWindows);
          if (next !== count) { count = next; stableWindows = 0; }
        }
        frames = 0; windowTime = 0;
      }
    }
    animation = requestAnimationFrame(render);
    return () => {
      disposed = true; cancelAnimationFrame(animation); worker?.terminate();
      resize.disconnect(); visibility.disconnect(); document.removeEventListener('visibilitychange', onVisibility);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      controls.dispose(); geometry.dispose(); material.dispose(); texture?.dispose();
      earthGeometry.dispose(); earthMaterial.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
    // Display controls use refs so they never rebuild or restart the cloud.
  }, [parameters, retry]);

  return <div className="theory-particle-view">
    <div className="theory-particle-controls">
      <label className="theory-dot-limit">{automatic ? 'Particle budget' : 'Particles'} <output>{limit.toLocaleString()}</output>
        <input type="range" aria-label="Particle dot limit" min={Math.log10(PARTICLE_MIN)} max={Math.log10(PARTICLE_MAX)}
          step="any" value={Math.log10(limit)} onChange={event => setLimit(Math.max(PARTICLE_MIN,
            Math.min(PARTICLE_MAX, Math.round(10 ** Number(event.target.value) / 1000) * 1000)))} />
      </label>
      <div className="theory-particle-toolbar">
        <label><input type="checkbox" checked={automatic} onChange={event => setAutomatic(event.target.checked)} />Auto · 30 FPS target</label>
        <button className="button" onClick={() => setPaused(value => !value)}>{paused ? 'Resume' : 'Pause'}</button>
      </div>
      <div className="theory-particle-toolbar">
        <label>Speed <select aria-label="Particle playback speed" value={speed} onChange={event => setSpeed(Number(event.target.value))}>
          {[1, 10, 60, 300, 1800].map(value => <option key={value} value={value}>{value < 60 ? `${value} s/s` : `${value / 60} min/s`}</option>)}</select></label>
        <label>Opacity <input type="range" aria-label="Particle opacity" min="0.05" max="1" step="0.05" value={opacity}
          onChange={event => setOpacity(Number(event.target.value))} /></label>
      </div>
    </div>
    <div className="theory-space-stage"><div ref={host} className="theory-space-image theory-particle-image" data-projection={projection}>
      {overlay}
      {(status || error) && <output className="theory-particle-status">{error || status}
        {error && <button className="button" onClick={() => setRetry(value => value + 1)}>Retry particles</button>}</output>}
    </div></div>
    <div className="theory-particle-stats" aria-label="Particle performance">
      <span>{stats ? `${stats.count.toLocaleString()} particles` : 'Preparing…'}</span>
      <span>{paused ? 'Paused' : stats?.fps ? `${Math.round(stats.fps)} FPS` : 'Measuring FPS…'}</span>
      <span>{stats ? `${(stats.simulatedSeconds / 3600).toFixed(2)} simulated hours` : ''}</span>
    </div>
    <p className="theory-explainer">Blue: cold · orange: hot. {projection
      ? '3D projection: dots over Earth’s disk are in front of the planet. Drag to rotate.'
      : 'Thin cross-section: only atoms within ±0.05 R_E of the plane are visible. Earth and the source interior are empty; atoms enter and leave the slice.'}</p>
    <p className="theory-explainer theory-particle-weight">{stats ? `Each dot ≈ ${stats.atomsPerDot.toExponential(2)} atoms within 30 R_E. ` : ''}
      Steady-state launches across the full sphere; slots recycle at the source or 30 R_E. Returning bound atoms are included.</p>
  </div>;
}
