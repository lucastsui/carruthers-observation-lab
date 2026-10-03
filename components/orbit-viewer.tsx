'use client';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Info } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { Frame } from '@/lib/research';
import { pointingDeviationGeometry, sunAligned, RE_KM } from '@/lib/orbit';
import type { Vec3 } from '@/lib/orbit';
import {
  createSpacecraftModel,
  spacecraftModelQuaternion,
} from '@/lib/spacecraft-model';

type Runtime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  group: THREE.Group;
  satellite: THREE.Group;
  deviationLabel?: THREE.Sprite;
};
function frameOverview(r: Runtime, mode: string) {
  const factor = mode === 'overview' ? 0.45 : 1;
  const extent =
    Math.max((1500000 / RE_KM) * factor, r.satellite.position.x) + 20;
  const bounds = r.renderer.domElement.parentElement?.getBoundingClientRect();
  if (bounds?.width && bounds.height) {
    r.camera.aspect = bounds.width / bounds.height;
    r.camera.updateProjectionMatrix();
  }
  const halfAngle = Math.atan(
    Math.tan(THREE.MathUtils.degToRad(r.camera.fov / 2)) *
      Math.min(1, r.camera.aspect),
  );
  const distance = (extent / 2 + 35) / Math.sin(halfAngle);
  r.controls.target.set(extent / 2, 0, 0);
  r.camera.position
    .copy(new THREE.Vector3(0.48, 0.44, 1).normalize().multiplyScalar(distance))
    .add(r.controls.target);
  r.controls.update();
}
function disposeGroup(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materialsToDispose = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  group.traverse((obj) => {
    const renderable = obj as THREE.Mesh;
    if (renderable.geometry) geometries.add(renderable.geometry);
    const materials = renderable.material
      ? Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material]
      : [];
    materials.forEach((m) => {
      const texture = (m as THREE.MeshBasicMaterial).map;
      if (texture) textures.add(texture);
      materialsToDispose.add(m);
    });
  });
  textures.forEach((texture) => texture.dispose());
  materialsToDispose.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
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
  actions,
  frame,
  frames,
  image,
  onReady,
}: {
  actions?: ReactNode;
  frame: Frame;
  frames: Frame[];
  image: HTMLImageElement | null;
  onReady: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    runtime = useRef<Runtime | null>(null),
    pointingExplanation = useRef<HTMLDivElement>(null),
    orientationExplanation = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState('overview'),
    [cones, setCones] = useState(true),
    [fatalError, setFatalError] = useState(''),
    [mounted, setMounted] = useState(false);
  const initial = useRef(true);
  const spacecraftFocused = useRef(false);
  const distance = Math.hypot(...frame.spacecraft_position_km);
  const deviation = frame.earth_sun_pointing_deviation_deg;
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
      'Rotatable Earth, Earth-to-Sun direction arrow, Carruthers trajectory, and projected observation. Drag to rotate; scroll to zoom.',
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
    const satellite = createSpacecraftModel();
    satellite.scale.setScalar(1); // Eight times smaller than the original schematic glyph.
    satellite.visible = false;
    scene.add(satellite);
    runtime.current = { scene, camera, renderer, controls, group, satellite };
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
      const deviationLabel = runtime.current?.deviationLabel;
      if (deviationLabel && renderer.domElement.clientHeight) {
        const pixelsPerUnit =
          renderer.domElement.clientHeight /
          (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
        deviationLabel.scale.set(190 / pixelsPerUnit, 23.75 / pixelsPerUnit, 1);
      }
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
      disposeGroup(satellite);
      renderer.dispose();
      renderer.domElement.remove();
      runtime.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    const r = runtime.current;
    if (!r || !mounted || !image) return;
    r.deviationLabel = undefined;
    disposeGroup(r.group);
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
    // Sun-aligned coordinates put Earth → Sun along +X in both distance modes.
    r.group.add(
      new THREE.ArrowHelper(
        convert(frame.sun_position_km).normalize(),
        new THREE.Vector3(1.2, 0, 0),
        18,
        0xffbd55,
        4,
        2,
      ),
    );
    r.group.add(
      label('Sun direction', '#ffd590', new THREE.Vector3(18, 9, 0), 30),
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
    // Reuse the detailed model while frames change; only its pose changes.
    if (spacecraftFocused.current) {
      const delta = spacecraft.clone().sub(r.satellite.position);
      r.camera.position.add(delta);
      r.controls.target.add(delta);
    }
    r.satellite.position.copy(spacecraft);
    r.satellite.visible = !!frame.spacecraft_attitude;
    if (frame.spacecraft_attitude)
      r.satellite.quaternion.copy(
        spacecraftModelQuaternion(
          frame.spacecraft_attitude,
          frame.sun_position_km,
        ),
      );
    if (cones && frame.camera_boresight_gcrs) {
      const boresight = convert(frame.camera_boresight_gcrs).normalize();
      r.group.add(
        new THREE.ArrowHelper(
          boresight,
          spacecraft,
          20,
          frame.channel === 'WFI' ? 0xef7780 : 0x4c9fff,
          2,
          0.8,
        ),
      );
    }
    if (frame.camera_boresight_gcrs) {
      const pointing = pointingDeviationGeometry(
        frame.camera_boresight_gcrs,
        frame.sun_position_km,
      );
      if (pointing) {
        const reference = convert(pointing.reference).normalize();
        const origin = spacecraft.clone().addScaledVector(reference, 9);
        // A translated Earth-Sun reference makes the tilt direction clear at
        // the spacecraft. Arrow length is schematic, independent of angle.
        r.group.add(line([spacecraft, origin], 0xffd590, 0.8));
        if (pointing.direction) {
          const direction = convert(pointing.direction).normalize();
          const arrow = new THREE.ArrowHelper(
            direction,
            origin,
            12,
            0x75eadb,
            2.5,
            1.3,
          );
          // Like the text labels, keep this schematic annotation visible when
          // the enlarged spacecraft crosses its position in the close-up view.
          for (const part of [arrow.line, arrow.cone]) {
            part.renderOrder = 3;
            const materials = Array.isArray(part.material)
              ? part.material
              : [part.material];
            for (const material of materials) {
              material.depthTest = false;
              material.depthWrite = false;
            }
          }
          r.group.add(arrow);
          const caption = label(
            `${frame.channel} deviation · ${pointing.angleDeg.toFixed(2)}°`,
            '#9af8e9',
            origin.clone().addScaledVector(direction, 15),
            40,
          );
          caption.center.set(0.5, 1.1);
          r.deviationLabel = caption;
          r.group.add(caption);
        } else {
          r.deviationLabel = label(
            `${frame.channel} deviation · 0.00°`,
            '#9af8e9',
            origin,
            40,
          );
          r.group.add(r.deviationLabel);
        }
      }
    }
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
      const texture = new THREE.Texture(image);
      texture.needsUpdate = true;
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
    onReady(frame.id);
  }, [frame, frames, image, mode, cones, mounted, onReady]);
  function reset(close = false) {
    const r = runtime.current;
    if (!r) return;
    spacecraftFocused.current = false;
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
  function viewSpacecraft() {
    const r = runtime.current;
    if (!r || !r.satellite.visible) return;
    spacecraftFocused.current = true;
    const center = new THREE.Vector3(0, 0.18, 0)
      .multiply(r.satellite.scale)
      .applyQuaternion(r.satellite.quaternion)
      .add(r.satellite.position);
    const offset = new THREE.Vector3(2.3, 1.6, -2.8)
      .normalize()
      .multiplyScalar(
        Math.max(r.controls.minDistance, (27 * r.satellite.scale.x) / 8),
      )
      .applyQuaternion(r.satellite.quaternion);
    r.controls.target.copy(center);
    r.camera.position.copy(center).add(offset);
    r.controls.update();
  }
  return (
    <div className="orbit-viewer">
      <div className="orbit-toolbar">
        <Select
          value={mode}
          onValueChange={(v) => {
            initial.current = true;
            spacecraftFocused.current = false;
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
        <button
          className="button ghost"
          onClick={viewSpacecraft}
          disabled={!frame.spacecraft_attitude}
        >
          View spacecraft
        </button>
        <label className="switch-row" htmlFor="fov-cones">
          FOV
          <Switch id="fov-cones" checked={cones} onCheckedChange={setCones} />
        </label>
      </div>
      <div className="orbit-stage" ref={host}>
        {actions && <div className="orbit-actions">{actions}</div>}
        <div className="orbit-help">
          <div>Drag to rotate · scroll to zoom · right-drag to pan</div>
          <div className="orbit-pointing">
            <span>
              Earth–Sun pointing deviation ({frame.channel}):{' '}
              {typeof deviation === 'number' && Number.isFinite(deviation)
                ? `${deviation.toFixed(2)}°`
                : 'Unavailable'}
            </span>
            <Popover>
              <PopoverTrigger
                className="orbit-pointing-info"
                aria-label="How is the Earth–Sun pointing deviation calculated?"
              >
                <Info aria-hidden="true" />
              </PopoverTrigger>
              <PopoverContent
                ref={pointingExplanation}
                initialFocus={pointingExplanation}
                className="orbit-pointing-explanation"
                align="start"
              >
                <PopoverTitle>Earth–Sun pointing deviation</PopoverTitle>
                <PopoverDescription>
                  The smaller angle between the selected {frame.channel}{' '}
                  camera’s optical axis and the Earth–Sun line at this
                  observation’s UTC timestamp. 0° means parallel to the line;
                  90° means perpendicular. The value is independent of how you
                  rotate or scale the 3D view.
                </PopoverDescription>
                <p>
                  The NetCDF spacecraft_attitude and cam_attitude fields use
                  scalar-last quaternions (x, y, z, w). We interpret them using
                  the JPL passive convention: sky (GCRS/J2000) → spacecraft →
                  camera. Reversing these transformations puts the outward
                  camera −Z axis into the sky frame. It lies close to spacecraft
                  −Y, the documented nominal boresight.
                </p>
                <p>
                  Astropy/ERFA calculates the Earth → Sun direction in GCRS from
                  the observation time. After normalizing both vectors, the
                  angle is θ = arccos(|b · s|), where b is the camera direction
                  and s is the Sun direction. The absolute value treats the
                  Earth–Sun reference as a line, giving a result from 0° to 90°.
                </p>
                <p>
                  The spacecraft model follows the recorded body attitude. Its
                  solar-cell face is spacecraft +Y; the telescope side is −Y.
                  The colored arrow shows the selected camera’s calibrated
                  boresight when FOV is enabled. Model details and size are
                  schematic.
                </p>
                <p>
                  The mint arrow shows which way the boresight tilts away from
                  the Earth–Sun line. It points along the boresight component
                  perpendicular to that line: d = b − (b · s)s. A short gold
                  segment places a parallel Earth–Sun reference at the
                  spacecraft. The arrow has a fixed schematic length; its label
                  gives the angle in degrees. Its direction and label update
                  with the selected camera and observation. At exact alignment,
                  no tilt direction exists, so the arrow is omitted.
                </p>
                <p>
                  This uses camera pointing, which can differ slightly from the
                  direction to Earth’s center. Checks of all 1,794 March 2026
                  frames reproduce the registered Earth centers and confirm the
                  boresight sign. This is consistency with the supplied
                  geometry, not independent star-based validation of pointing
                  accuracy.
                </p>
                <div className="orbit-pointing-sources">
                  <a
                    href="https://claude.ai/artifact/XCxFBEFvxrktwbWHW4doxT"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Spacecraft model supplied for CEDA
                  </a>
                  <a
                    href="https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/q2m_c.html"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    JPL: quaternion conventions
                  </a>
                  <a
                    href="https://arxiv.org/html/2608.13516v1#S2"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Carruthers: viewing geometry and spacecraft −Y boresight
                  </a>
                  <a
                    href="https://docs.astropy.org/en/stable/api/astropy.coordinates.get_sun.html"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Astropy: Sun position in GCRS
                  </a>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="orbit-pointing">
            <span>Assumption on orientation</span>
            <Popover>
              <PopoverTrigger
                className="orbit-pointing-info"
                aria-label="What is the assumption on spacecraft orientation?"
              >
                <Info aria-hidden="true" />
              </PopoverTrigger>
              <PopoverContent
                ref={orientationExplanation}
                initialFocus={orientationExplanation}
                className="orbit-pointing-explanation"
                align="start"
              >
                <PopoverTitle>Assumption on orientation</PopoverTitle>
                <PopoverDescription>
                  CEDA assumes the outward normal of the GCI instrument deck is
                  spacecraft +Z. The solar-cell face points along +Y, and the
                  nominal telescope viewing direction is −Y.
                </PopoverDescription>
                <p>
                  The instrument-deck mapping follows Figure 2(a) of the viewing
                  geometry paper and Sections 3.2 and 4.4 of the mission paper.
                  The L1C metadata describes +Z as “positive outward through the
                  launch vehicle adapter.” We interpret this as the same +Z
                  direction as the instrument deck; that interpretation still
                  needs confirmation from the mission team.
                </p>
                <p>
                  The recorded quaternion includes the full attitude, including
                  roll. With this model alignment, the instrument deck faces
                  toward ecliptic south in the March observations. If the deck
                  instead corresponds to −Z, the model would need a 180° roll
                  adjustment about its nominal viewing axis.
                </p>
                <p>
                  This uncertainty concerns how the model fits the spacecraft
                  axes. The Earth–Sun pointing deviation is calculated from the
                  camera geometry and does not depend on this model assumption.
                </p>
                <div className="orbit-pointing-sources">
                  <a
                    href="https://arxiv.org/html/2608.13516v1#S2"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Viewing geometry: spacecraft axes, Figure 2(a)
                  </a>
                  <a
                    href="https://arxiv.org/html/2608.10130v1#S3.SS2"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Mission paper: GCI mounting side, Section 3.2
                  </a>
                  <a
                    href="https://arxiv.org/html/2608.10130v1#S4.SS4"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Mission paper: +Z face and GCI, Section 4.4
                  </a>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
        {fatalError && <output className="orbit-message">{fatalError}</output>}
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
          The small arrow points from Earth toward the Sun; its length and the
          spacecraft model size are schematic.
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
