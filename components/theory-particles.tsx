'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  adaptParticleCount, particleFrame, particleRandom, PARTICLE_MAX, PARTICLE_MIN,
  PARTICLE_SAMPLES, PARTICLE_TRAIL_COUNT, PARTICLE_TRAIL_FRACTION, PARTICLE_TRAIL_SECONDS, selectParticleOrbit, type ParticleAtlas,
} from '@/lib/theory-particles';
import type { TheoryParameters } from '@/lib/theory';
// Vite supplies the default constructor for this virtual worker module.
// oxlint-disable-next-line import/default
import ParticleWorker from '../lib/theory-particles.worker.ts?worker';

const TRAIL_SEGMENTS = 192;
const vertexShader = `
  uniform sampler2D paths;
  uniform vec2 atlasSize;
  uniform float clockSeconds;
  uniform float pointSize;
  attribute vec3 normalAxis;
  attribute vec3 tangentAxis;
  // row, signed inverse duration (positive = bound), time phase, hot flag
  attribute vec4 orbit;
  attribute float timeWarp;
  varying vec3 earthViewOffset;
  varying vec3 dotColor;
  varying float fade;
  #ifdef PARTICLE_TRAIL
    attribute float trailAge;
  #endif
  void main() {
    // Center phase on exobase return: its last seconds are small negative
    // numbers, preserving precision even for years-long flights. CPU rebasing
    // uses double precision; shader arithmetic only advances at most one day.
    float phase = orbit.z + clockSeconds * abs(orbit.y);
    phase -= floor(phase + 0.5);
    fade = 1.0;
    #ifdef PARTICLE_TRAIL
      float age = trailAge * min(${PARTICLE_TRAIL_FRACTION}, ${PARTICLE_TRAIL_SECONDS}.0 * abs(orbit.y));
      if (phase >= 0.0) phase = max(0.0, phase - age);
      else { phase -= age; if (phase < -0.5) phase += 1.0; }
      fade = pow(1.0 - trailAge, 0.7);
    #endif
    bool bound = orbit.y > 0.0;
    bool inbound = bound && phase < 0.0;
    float elapsed = bound ? abs(phase) * 2.0 : (phase < 0.0 ? 1.0 + phase : phase);
    float outwardGrid = log(1.0 + elapsed * (exp(timeWarp) - 1.0)) / timeWarp;
    float u = inbound ? 1.0 - outwardGrid : outwardGrid;
    float sampleIndex = u * ${PARTICLE_SAMPLES - 1}.0;
    float left = min(floor(sampleIndex), ${PARTICLE_SAMPLES - 2}.0);
    float column = (inbound ? ${PARTICLE_SAMPLES}.0 : 0.0) + left;
    vec2 uv = vec2((column + 0.5) / atlasSize.x, (orbit.x + 0.5) / atlasSize.y);
    vec2 a = texture2D(paths, uv).xy;
    vec2 b = texture2D(paths, uv + vec2(1.0 / atlasSize.x, 0.0)).xy;
    vec2 xy = mix(a, b, sampleIndex - left);
    vec3 point = normalAxis * xy.x + tangentAxis * xy.y;
    // An orthographic view has no physical depth boundary. Project every bound
    // atom, including those beyond the old camera planes; Earth's analytic
    // silhouette supplies occlusion in the fragment shader for dots AND trails.
    earthViewOffset = mat3(viewMatrix) * point;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
    gl_Position.z = 0.0;
    gl_PointSize = pointSize;
    dotColor = mix(vec3(0.412, 0.722, 1.0), vec3(1.0, 0.729, 0.471), orbit.w);
    #ifdef PARTICLE_TRAIL
      dotColor = mix(dotColor, vec3(1.0), 0.55);
    #endif
  }
`;
const fragmentShader = `
  uniform float opacity;
  varying vec3 dotColor;
  varying float fade;
  varying vec3 earthViewOffset;
  void main() {
    float disk = dot(earthViewOffset.xy, earthViewOffset.xy);
    if (disk < 1.0 && earthViewOffset.z < sqrt(1.0 - disk)) discard;
    gl_FragColor = vec4(dotColor, opacity * fade);
  }
`;
type Options = { limit: number; automatic: boolean; speed: number; paused: boolean; opacity: number; extent: number; trails: boolean };
type Stats = { count: number; fps: number; simulatedSeconds: number };

export default function TheoryParticles({ parameters, extent, overlay, extentControl, onExtentChange }: {
  parameters: TheoryParameters; extent: number; overlay: ReactNode; extentControl: ReactNode;
  onExtentChange: (extent: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(100000), [automatic, setAutomatic] = useState(true);
  const [speed, setSpeed] = useState(60), [paused, setPaused] = useState(false), [opacity, setOpacity] = useState(0.65);
  const [trails, setTrails] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null), [status, setStatus] = useState('Preparing steady-state cloud…');
  const [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const options = useRef<Options>({ limit, automatic, speed, paused, opacity, extent, trails });
  useEffect(() => { options.current = { limit, automatic, speed, paused, opacity, extent, trails }; },
    [limit, automatic, speed, paused, opacity, extent, trails]);

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
    renderer.domElement.setAttribute('aria-label', `3D hydrogen projection with trails following ${PARTICLE_TRAIL_COUNT} moving atoms`);
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
      vertexShader, fragmentShader, transparent: true, depthWrite: false, depthTest: false,
      uniforms: { paths: { value: null }, atlasSize: { value: new THREE.Vector2() },
        clockSeconds: { value: 0 }, pointSize: { value: renderer.getPixelRatio() }, opacity: { value: initial.opacity } },
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    const trailGeometry = new THREE.BufferGeometry();
    const trailMaterial = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, defines: { PARTICLE_TRAIL: 1 },
      uniforms: { ...material.uniforms, opacity: { value: 0.95 } }, transparent: true, depthWrite: false, depthTest: false,
    });
    const trailLines = new THREE.LineSegments(trailGeometry, trailMaterial);
    trailLines.frustumCulled = false;
    scene.add(trailLines);
    let atlas: ParticleAtlas | null = null, texture: THREE.DataTexture | null = null;
    let precisePhases = new Float64Array(0);
    let capacity = 0, count = Math.min(25000, options.current.limit), phaseTime = 0, elapsed = 0;
    let visible = true, width = 0, animation = 0, last = 0, frames = 0, windowTime = 0, stableWindows = 0;
    let lastExtent = initial.extent, lastLimit = initial.limit, lost = false;
    let wheelExtent = initial.extent;
    renderer.domElement.style.touchAction = 'none';
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      wheelExtent = Math.max(2, Math.min(30, wheelExtent * Math.exp(pixels * 0.002)));
      onExtentChange(Math.round(wheelExtent * 10) / 10);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
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
      const slots = new Float32Array(nextCapacity * 4), warps = new Float32Array(nextCapacity);
      const phases = new Float64Array(nextCapacity);
      phases.set(precisePhases);
      if (capacity) {
        normals.set(geometry.getAttribute('normalAxis').array);
        tangents.set(geometry.getAttribute('tangentAxis').array);
        slots.set(geometry.getAttribute('orbit').array);
        warps.set(geometry.getAttribute('timeWarp').array);
      }
      for (let i = capacity; i < nextCapacity; i++) {
        const row = selectParticleOrbit(atlas.cumulative, particleRandom(i, 0));
        const { normal, tangent } = particleFrame(i);
        normals.set(normal, i * 3); tangents.set(tangent, i * 3);
        warps[i] = atlas.timeWarps[row];
        // Newly exposed slots also start at an independent steady-state phase.
        phases[i] = particleRandom(i, 1);
        const centered = phases[i] < 0.5 ? phases[i] : phases[i] - 1;
        slots.set([row, (atlas.bound[row] ? 1 : -1) / atlas.durations[row], centered, atlas.hot[row]], i * 4);
      }
      // Free replaced GPU buffers, while retaining the single Points object.
      geometry.dispose();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nextCapacity * 3), 3));
      geometry.setAttribute('normalAxis', new THREE.BufferAttribute(normals, 3));
      geometry.setAttribute('tangentAxis', new THREE.BufferAttribute(tangents, 3));
      geometry.setAttribute('orbit', new THREE.BufferAttribute(slots, 4));
      geometry.setAttribute('timeWarp', new THREE.BufferAttribute(warps, 1));
      precisePhases = phases; capacity = nextCapacity;
    }

    function populateTrails() {
      if (!atlas) return;
      const vertices = PARTICLE_TRAIL_COUNT * TRAIL_SEGMENTS * 2;
      const normals = new Float32Array(vertices * 3), tangents = new Float32Array(vertices * 3);
      const slots = new Float32Array(vertices * 4), ages = new Float32Array(vertices), warps = new Float32Array(vertices);
      for (let i = 0; i < PARTICLE_TRAIL_COUNT; i++) {
        for (let j = 0; j < TRAIL_SEGMENTS * 2; j++) {
          const vertex = i * TRAIL_SEGMENTS * 2 + j;
          normals.set(geometry.getAttribute('normalAxis').array.slice(i * 3, i * 3 + 3), vertex * 3);
          tangents.set(geometry.getAttribute('tangentAxis').array.slice(i * 3, i * 3 + 3), vertex * 3);
          slots.set(geometry.getAttribute('orbit').array.slice(i * 4, i * 4 + 4), vertex * 4);
          ages[vertex] = (Math.floor(j / 2) + j % 2) / TRAIL_SEGMENTS;
          warps[vertex] = geometry.getAttribute('timeWarp').getX(i);
        }
      }
      trailGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
      trailGeometry.setAttribute('normalAxis', new THREE.BufferAttribute(normals, 3));
      trailGeometry.setAttribute('tangentAxis', new THREE.BufferAttribute(tangents, 3));
      trailGeometry.setAttribute('orbit', new THREE.BufferAttribute(slots, 4));
      trailGeometry.setAttribute('trailAge', new THREE.BufferAttribute(ages, 1));
      trailGeometry.setAttribute('timeWarp', new THREE.BufferAttribute(warps, 1));
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
        populate(count); geometry.setDrawRange(0, count); populateTrails();
        setStatus('');
        setStats({ count, fps: 0, simulatedSeconds: 0 });
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
      const limitChanged = current.limit !== lastLimit;
      if (limitChanged) {
        // A direct slider edit takes effect even while paused. Auto can tune
        // down again after measuring actual frame rate during playback.
        lastLimit = current.limit; count = current.limit;
        stableWindows = 0; frames = 0; windowTime = 0;
      } else count = current.automatic ? Math.min(count, current.limit) : current.limit;
      populate(count); geometry.setDrawRange(0, count);
      if (limitChanged) setStats({ count, fps: 0, simulatedSeconds: elapsed });
      if (!current.paused) { phaseTime += dt * current.speed; elapsed += dt * current.speed; }
      // Rebase phases before float shader time loses sub-second precision.
      if (phaseTime > 86400) {
        const attribute = geometry.getAttribute('orbit') as THREE.BufferAttribute;
        for (let i = 0; i < capacity; i++) {
          precisePhases[i] = (precisePhases[i] + phaseTime * Math.abs(attribute.getY(i))) % 1;
          attribute.setZ(i, precisePhases[i] < 0.5 ? precisePhases[i] : precisePhases[i] - 1);
        }
        attribute.needsUpdate = true;
        const trailOrbits = trailGeometry.getAttribute('orbit') as THREE.BufferAttribute;
        for (let i = 0; i < trailOrbits.count; i++) {
          const slot = Math.floor(i / (TRAIL_SEGMENTS * 2));
          trailOrbits.setZ(i, attribute.getZ(slot));
        }
        trailOrbits.needsUpdate = true; phaseTime = 0;
      }
      material.uniforms.clockSeconds.value = phaseTime;
      material.uniforms.opacity.value = current.opacity;
      trailLines.visible = current.trails;
      if (current.extent !== lastExtent) {
        lastExtent = current.extent;
        if (Math.abs(lastExtent - Math.round(wheelExtent * 10) / 10) > 1e-6) wheelExtent = lastExtent;
        camera.left = -lastExtent; camera.right = lastExtent;
        camera.top = lastExtent; camera.bottom = -lastExtent; camera.updateProjectionMatrix();
      }
      controls.update();
      renderer.render(scene, camera);
      frames++; windowTime += dt;
      if (windowTime >= 1) {
        const fps = frames / windowTime;
        setStats({ count, fps, simulatedSeconds: elapsed });
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
      element.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      controls.dispose(); geometry.dispose(); material.dispose(); texture?.dispose();
      trailGeometry.dispose(); trailMaterial.dispose();
      earthGeometry.dispose(); earthMaterial.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
    // Display controls use refs so they never rebuild or restart the cloud.
  }, [parameters, retry, onExtentChange]);

  return <div className="theory-particle-view">
    <div className="theory-particle-controls">
      <div className="theory-particle-sliders">
      <label className="theory-dot-limit">{automatic ? 'Particle limit' : 'Particles'} <output>{limit.toLocaleString()}</output>
        <input type="range" aria-label="Particle dot limit" min={Math.log10(PARTICLE_MIN)} max={Math.log10(PARTICLE_MAX)}
          aria-valuetext={`${limit.toLocaleString()} particles`}
          step="any" value={Math.log10(limit)} onChange={event => setLimit(Math.max(PARTICLE_MIN,
            Math.min(PARTICLE_MAX, Math.round(10 ** Number(event.target.value) / 1000) * 1000)))} />
      </label>
      {extentControl}
      <label className="theory-speed-control">Speed
        <output>{speed < 60 ? `${speed} s/s` : `${(speed / 60).toLocaleString('en-US', { maximumFractionDigits: 1 })} min/s`}</output>
        <input type="range" aria-label="Particle playback speed" min="0" max={Math.log10(1800)} step="any"
          value={Math.log10(speed)} aria-valuetext={`${speed} simulated seconds per real second`}
          onChange={event => setSpeed(Math.max(1, Math.min(1800, Math.round(10 ** Number(event.target.value)))))} />
      </label>
      <label className="theory-opacity-control">Opacity <output>{Math.round(opacity * 100)}%</output>
        <input type="range" aria-label="Particle opacity" min="0.05" max="1" step="0.05" value={opacity}
          onChange={event => setOpacity(Number(event.target.value))} /></label>
      </div>
      <div className="theory-particle-toolbar">
        <label><input type="checkbox" checked={automatic} onChange={event => setAutomatic(event.target.checked)} />Auto · 30 FPS target</label>
        <label><input type="checkbox" checked={trails} onChange={event => setTrails(event.target.checked)} />{PARTICLE_TRAIL_COUNT} trails</label>
        <button className="button" onClick={() => setPaused(value => !value)}>{paused ? 'Resume' : 'Pause'}</button>
      </div>
    </div>
    <div className="theory-space-stage"><div ref={host} className="theory-space-image theory-particle-image">
      {overlay}
      {(status || error) && <output className="theory-particle-status">{error || status}
        {error && <button className="button" onClick={() => setRetry(value => value + 1)}>Retry particles</button>}</output>}
    </div></div>
    <div className="theory-particle-stats" aria-label="Particle performance">
      <span>{stats ? `${stats.count.toLocaleString()} particles` : 'Preparing…'}</span>
      <span>{paused ? 'Paused' : stats?.fps ? `${Math.round(stats.fps)} FPS` : 'Measuring FPS…'}</span>
      <span>{stats ? `${(stats.simulatedSeconds / 3600).toFixed(2)} simulated hours` : ''}</span>
    </div>
    <p className="theory-explainer">3D projection · Blue: cold; orange: hot. Fading trails follow {PARTICLE_TRAIL_COUNT} moving dots.
      Dots over Earth’s disk are in front of the planet. Drag to rotate; scroll to zoom.</p>
    <p className="theory-explainer theory-particle-weight">Bound atoms stay tracked beyond 30 R_E until they return to the exobase.
      Only escaping atoms recycle at 30 R_E. Counts include atoms outside the visible frame.</p>
  </div>;
}
