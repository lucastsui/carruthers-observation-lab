'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { previewURL } from '@/lib/research';
import type { Frame } from '@/lib/research';
import { sunAligned, RE_KM } from '@/lib/orbit';
import type { Vec3 } from '@/lib/orbit';

type Runtime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  group: THREE.Group;
};
function frameOverview(r: Runtime, mode: string) {
  const solarX = mode === 'overview' ? 175 : 360;
  const bounds = r.renderer.domElement.parentElement?.getBoundingClientRect();
  if (bounds?.width && bounds.height) {
    r.camera.aspect = bounds.width / bounds.height;
    r.camera.updateProjectionMatrix();
  }
  const halfAngle = Math.atan(
    Math.tan(THREE.MathUtils.degToRad(r.camera.fov / 2)) *
      Math.min(1, r.camera.aspect),
  );
  const distance = (solarX / 2 + 35) / Math.sin(halfAngle);
  r.controls.target.set(solarX / 2, 0, 0);
  r.camera.position
    .copy(new THREE.Vector3(0.48, 0.44, 1).normalize().multiplyScalar(distance))
    .add(r.controls.target);
  r.controls.update();
}
function disposeGroup(group: THREE.Group) {
  group.traverse((obj) => {
    const renderable = obj as THREE.Mesh;
    renderable.geometry?.dispose();
    const materials = renderable.material
      ? Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material]
      : [];
    materials.forEach((m) => {
      (m as THREE.MeshBasicMaterial).map?.dispose();
      m.dispose();
    });
  });
  group.clear();
}
function label(
  text: string,
  color: string,
  position: THREE.Vector3,
  width = 35,
) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '500 60px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#050b16';
  ctx.lineWidth = 8;
  ctx.strokeText(text, 384, 48);
  ctx.fillStyle = color;
  ctx.fillText(text, 384, 48);
  const map = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map,
      transparent: true,
      depthTest: false,
      sizeAttenuation: false,
    }),
  );
  sprite.position.copy(position);
  sprite.scale.set(width * 0.008, width * 0.001, 1);
  return sprite;
}
function line(points: THREE.Vector3[], color: number, opacity = 1) {
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }),
  );
}
export function OrbitViewer({
  frame,
  frames,
  scale,
  onReady,
}: {
  frame: Frame;
  frames: Frame[];
  scale: [number, number];
  onReady: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    runtime = useRef<Runtime | null>(null);
  const [mode, setMode] = useState('overview'),
    [cones, setCones] = useState(true),
    [fatalError, setFatalError] = useState(''),
    [mounted, setMounted] = useState(false);
  const [imageState, setImageState] = useState<{
    key: string;
    error: string;
  } | null>(null);
  const frameKey = `${frame.id}:${scale.join(':')}:${mode}:${cones}`;
  const loading = imageState?.key !== frameKey;
  const error =
    fatalError || (imageState?.key === frameKey ? imageState.error : '');
  const initial = useRef(true);
  const distance = Math.hypot(...frame.spacecraft_position_km);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      queueMicrotask(() =>
        setFatalError(
          '3D rendering could not start. Enable WebGL in this browser; the 2D observations remain available.',
        ),
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor('#050a14');
    renderer.domElement.setAttribute(
      'aria-label',
      'Rotatable Earth, Carruthers trajectory, and projected observation. Drag to rotate; scroll to zoom.',
    );
    renderer.domElement.tabIndex = 0;
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(42, 1, 0.05, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 4;
    controls.maxDistance = 1500;
    controls.target.set(55, 0, 0);
    camera.position.set(155, 100, 220);
    controls.update();
    scene.add(new THREE.AmbientLight(0xb2c7ff, 1.5));
    const light = new THREE.DirectionalLight(0xffe4b0, 3);
    light.position.set(300, 0, 0);
    scene.add(light);
    const group = new THREE.Group();
    scene.add(group);
    runtime.current = { scene, camera, renderer, controls, group };
    const resize = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      if (width && height) {
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
    });
    resize.observe(element);
    let animation = 0;
    function render() {
      animation = requestAnimationFrame(render);
      controls.update();
      renderer.render(scene, camera);
    }
    render();
    const readyFrame = requestAnimationFrame(() => setMounted(true));
    return () => {
      cancelAnimationFrame(readyFrame);
      cancelAnimationFrame(animation);
      resize.disconnect();
      controls.dispose();
      disposeGroup(group);
      renderer.dispose();
      renderer.domElement.remove();
      runtime.current = null;
    };
  }, []);
  useEffect(() => {
    const r = runtime.current;
    if (!r || !mounted) return;
    disposeGroup(r.group);
    let active = true;
    const factor = mode === 'overview' ? 0.45 : 1;
    const convert = (v: Vec3, sun = frame.sun_position_km) =>
      new THREE.Vector3(...sunAligned(v, sun));
    const spacecraft = convert(
      frame.spacecraft_position_km.map((v) => v / RE_KM) as Vec3,
    ).multiplyScalar(factor);
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(1, 40, 24),
      new THREE.MeshPhongMaterial({
        color: 0x267dce,
        emissive: 0x07244a,
        shininess: 25,
      }),
    );
    r.group.add(earth);
    const solarX = mode === 'overview' ? 175 : 360;
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(12, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0xffbd55 }),
    );
    sun.position.set(solarX, 0, 0);
    r.group.add(sun);
    r.group.add(
      line(
        [new THREE.Vector3(), new THREE.Vector3(solarX - 14, 0, 0)],
        0x756641,
        0.65,
      ),
    );
    r.group.add(
      label('Sun direction', '#ffd590', new THREE.Vector3(solarX, 19, 0), 48),
    );
    const l1 = new THREE.Vector3((1500000 / RE_KM) * factor, 0, 0);
    const l1dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.75, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xaec6df }),
    );
    l1dot.position.copy(l1);
    r.group.add(l1dot);
    r.group.add(
      label(
        'L1 ≈ 1.5 million km',
        '#b5c6db',
        l1.clone().add(new THREE.Vector3(0, -8, 0)),
        49,
      ),
    );
    const orbit = frames
      .filter((f) => f.channel === 'WFI')
      .map((f) =>
        convert(
          f.spacecraft_position_km.map((v) => v / RE_KM) as Vec3,
          f.sun_position_km,
        ).multiplyScalar(factor),
      );
    if (orbit.length > 1) r.group.add(line(orbit, 0xd8b7ff));
    // A visible spacecraft glyph. Its dimensions do not represent the physical bus.
    const satellite = new THREE.Group();
    satellite.position.copy(spacecraft);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshPhongMaterial({ color: 0xf3cb80 }),
    );
    satellite.add(body);
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(7, 0.15, 1.8),
      new THREE.MeshPhongMaterial({ color: 0x426cba }),
    );
    satellite.add(wing);
    r.group.add(satellite);
    r.group.add(
      label(
        'Carruthers',
        '#f8dfa5',
        spacecraft.clone().add(new THREE.Vector3(0, 9, 0)),
        40,
      ),
    );
    r.group.add(
      label('Earth · 1 Rᴇ', '#91c0ff', new THREE.Vector3(0, -8, 0), 30),
    );
    // Select the opposite camera nearest in time for its true calibrated FOV geometry.
    let other: Frame | undefined;
    for (const f of frames)
      if (
        f.channel !== frame.channel &&
        (!other ||
          Math.abs(f.epoch_ms - frame.epoch_ms) <
            Math.abs(other.epoch_ms - frame.epoch_ms))
      )
        other = f;
    function addCone(f: Frame, main: boolean) {
      const corners = f.image_plane_corners_re.map((p) =>
        convert(p, f.sun_position_km),
      );
      const color = f.channel === 'WFI' ? 0xef7780 : 0x4c9fff;
      if (cones) {
        const positions: number[] = [];
        for (let i = 0; i < 4; i++)
          positions.push(
            ...spacecraft.toArray(),
            ...corners[i].toArray(),
            ...corners[(i + 1) % 4].toArray(),
          );
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(positions, 3),
        );
        g.computeVertexNormals();
        r!.group.add(
          new THREE.Mesh(
            g,
            new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.035,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
          ),
        );
        corners.forEach((c) => r!.group.add(line([spacecraft, c], color, 0.4)));
        r!.group.add(line([...corners, corners[0]], color, 0.65));
      }
      if (!main) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          corners.flatMap((v) => v.toArray()),
          3,
        ),
      );
      geometry.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2),
      );
      geometry.setIndex([0, 1, 2, 0, 2, 3]);
      geometry.computeVertexNormals();
      const texture = new THREE.TextureLoader().load(
        previewURL(frame, scale),
        (tex) => {
          if (!active) {
            tex.dispose();
            return;
          }
          setImageState({ key: frameKey, error: '' });
          onReady(frame.id);
        },
        undefined,
        () => {
          if (active) {
            setImageState({
              key: frameKey,
              error: 'Observation image could not load.',
            });
          }
        },
      );
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      // Additive black transparency preserves the measured image shape without an opaque square.
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const plane = new THREE.Mesh(geometry, material);
      r!.group.add(plane);
      r!.group.add(
        label(
          `${frame.channel} image plane`,
          '#f6c0be',
          corners[2]
            .clone()
            .lerp(corners[3], 0.5)
            .add(new THREE.Vector3(0, -5, 0)),
          43,
        ),
      );
    }
    addCone(frame, true);
    if (other && Math.abs(other.epoch_ms - frame.epoch_ms) < 7200000)
      addCone(other, false);
    if (initial.current) {
      frameOverview(r, mode);
      initial.current = false;
    }
    return () => {
      active = false;
    };
  }, [frame, frames, scale, mode, cones, mounted, onReady, frameKey]);
  function reset(close = false) {
    const r = runtime.current;
    if (!r) return;
    if (close) {
      r.controls.target.set(0, 0, 0);
      const direction = new THREE.Vector3(
        ...sunAligned(frame.spacecraft_position_km, frame.sun_position_km),
      ).normalize();
      r.camera.position.copy(
        direction.multiplyScalar(frame.channel === 'WFI' ? 120 : 30),
      );
    } else {
      frameOverview(r, mode);
    }
    r.controls.update();
  }
  return (
    <div className="orbit-viewer">
      <div className="orbit-toolbar">
        <Select
          value={mode}
          onValueChange={(v) => {
            initial.current = true;
            setMode(v || 'overview');
          }}
        >
          <SelectTrigger aria-label="3D distance scale">
            <SelectValue>
              {mode === 'overview'
                ? 'Overview · compressed'
                : 'True spacecraft distance'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="overview">Overview · compressed</SelectItem>
            <SelectItem value="true">True spacecraft distance</SelectItem>
          </SelectContent>
        </Select>
        <button className="button ghost" onClick={() => reset()}>
          Reset view
        </button>
        <button className="button ghost" onClick={() => reset(true)}>
          Face Earth
        </button>
        <label className="switch-row" htmlFor="fov-cones">
          FOV
          <Switch id="fov-cones" checked={cones} onCheckedChange={setCones} />
        </label>
      </div>
      <div className="orbit-stage" ref={host}>
        <div className="orbit-help">
          Drag to rotate · scroll to zoom · right-drag to pan
        </div>
        {(loading || error) && (
          <output className="orbit-message">
            {error || 'Projecting observation…'}
          </output>
        )}
        <div className="orbit-legend">
          <span className="orbit-track">— March trajectory</span>
          <span className="wfi-fov">— WFI</span>
          <span className="nfi-fov">— NFI</span>
        </div>
      </div>
      <div className="orbit-caption">
        <p>
          <b>{(distance / 1000000).toFixed(3)} million km from Earth</b> ·{' '}
          {(distance / RE_KM).toFixed(1)} Rᴇ
        </p>
        <p>
          {mode === 'overview'
            ? 'Spacecraft distances ×0.45; Earth and image keep their relative scale.'
            : 'Earth, image and spacecraft distances share one scale.'}{' '}
          Sun and spacecraft glyph sizes are schematic.
        </p>
        <p>
          Image is a line-of-sight projection through Earth, not a 3D density
          reconstruction. March track from L1C positions in a Sun-aligned view.{' '}
          <a
            href="https://svs.gsfc.nasa.gov/5419/"
            target="_blank"
            rel="noreferrer"
          >
            NASA reference ↗
          </a>
        </p>
      </div>
    </div>
  );
}
