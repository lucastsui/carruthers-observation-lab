import * as THREE from 'three';
import { sunAligned, type Vec3 } from './orbit.ts';

// Exterior adapted from the user's Carruthers Systems Model:
// https://claude.ai/artifact/XCxFBEFvxrktwbWHW4doxT
// Schematic geometry, not flight CAD. No artifact scripts, iframe, or remote assets.
// Artifact axes: +Z telescope face, -Z solar-cell face, +Y payload-up.
// Body axes: -Y nominal boresight, +Y array normal, +Z payload-up in Fig. 2(a):
// https://arxiv.org/html/2608.13516v1#S2
export const MODEL_TO_BODY = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(1, 0, 0),
  Math.PI / 2,
);

/** Model -> spacecraft body -> GCRS -> CEDA's Sun-aligned display. */
export function spacecraftModelQuaternion(
  attitude: [number, number, number, number],
  sun: Vec3,
): THREE.Quaternion {
  if (
    !attitude.every(Number.isFinite) ||
    Math.abs(Math.hypot(...attitude) - 1) > 1e-5
  )
    throw new Error('Expected a unit spacecraft attitude quaternion');
  if (!sun.every(Number.isFinite) || Math.hypot(...sun) === 0)
    throw new Error('Expected a nonzero Sun vector');
  // Same scalar-last Hamilton matrix as science.rotation: inverse of the
  // stored passive/JPL GCRS-to-body transform. Do not apply camera attitude
  // to the whole spacecraft, and do not replace measured pointing with lookAt.
  const bodyToGcrs = new THREE.Quaternion(...attitude).normalize();
  const axes = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ].map((v) => {
    const axis = new THREE.Vector3(...v).applyQuaternion(bodyToGcrs);
    return new THREE.Vector3(...sunAligned(axis.toArray() as Vec3, sun));
  });
  return new THREE.Quaternion()
    .setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(axes[0], axes[1], axes[2]),
    )
    .multiply(MODEL_TO_BODY)
    .normalize();
}

function solarCells() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#1a0f22';
  g.fillRect(0, 0, 512, 512);
  const size = 32;
  for (let row = 0; row < 16; row++)
    for (let col = 0; col < 16; col++) {
      const shade = 0.82 + ((row * 7 + col * 3) % 5) * 0.03;
      g.fillStyle = `rgb(${Math.round(46 * shade)},${Math.round(20 * shade)},${Math.round(58 * shade)})`;
      g.fillRect(col * size + 1.4, row * size + 1.4, size - 2.8, size - 2.8);
      g.strokeStyle = 'rgba(150,120,180,0.25)';
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(col * size + size / 2, row * size + 1.4);
      g.lineTo(col * size + size / 2, (row + 1) * size - 1.4);
      g.stroke();
    }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createSpacecraftModel(): THREE.Group {
  const sat = new THREE.Group();
  sat.name = 'Carruthers schematic spacecraft';
  const materials = {
    // Slightly lifted black levels keep the silhouette readable in CEDA's dark scene.
    foil: { color: 0x30343d, metalness: 0.62, roughness: 0.34 },
    dark: { color: 0x181b23, metalness: 0.45, roughness: 0.5 },
    frame: { color: 0x6e7080, metalness: 0.65, roughness: 0.5 },
    silver: { color: 0xb9bcc9, metalness: 0.8, roughness: 0.35 },
    white: { color: 0xd8d9e2, metalness: 0.12, roughness: 0.8 },
    gold: { color: 0xd8b14f, metalness: 0.7, roughness: 0.3 },
    tan: { color: 0xc7b084, metalness: 0.28, roughness: 0.62 },
    aperture: { color: 0x121118, metalness: 0.2, roughness: 0.9 },
  };
  const mats = Object.fromEntries(
    Object.entries(materials).map(([key, value]) => [
      key,
      new THREE.MeshStandardMaterial(value),
    ]),
  ) as Record<keyof typeof materials, THREE.MeshStandardMaterial>;
  function add(
    parent: THREE.Group,
    name: string,
    geometry: THREE.BufferGeometry,
    material: keyof typeof materials,
    x = 0,
    y = 0,
    z = 0,
  ) {
    const mesh = new THREE.Mesh(geometry, mats[material]);
    mesh.name = name;
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  const box = (x: number, y: number, z: number) =>
    new THREE.BoxGeometry(x, y, z);
  const cylinder = (r: number, h: number, r2 = r) =>
    new THREE.CylinderGeometry(r, r2, h, 16);
  const bus = new THREE.Group();
  sat.add(bus);
  const bx = 0.52,
    by = 0.42,
    bz = 0.46,
    az = -(bz + 0.12);
  add(bus, 'Bus · black MLI', box(bx * 2, by * 2, bz * 2), 'foil');
  for (const sign of [-1, 1])
    add(
      bus,
      'Bus rim',
      box(bx * 2 + 0.03, 0.05, bz * 2 + 0.03),
      'dark',
      0,
      sign * by,
    );
  add(
    bus,
    'Equipment deck',
    box(0.34, 0.02, 0.3),
    'white',
    0.06,
    -by - 0.012,
    0.1,
  );
  for (let i = 0; i < 6; i++)
    add(
      bus,
      'Deck fixture',
      cylinder(0.028, 0.03),
      'silver',
      -0.03 + (i % 2) * 0.18,
      -by - 0.028,
      Math.floor(i / 2) * 0.1 - 0.1,
    );
  add(
    bus,
    'Deck bracket',
    box(0.15, 0.02, 0.11),
    'tan',
    -0.3,
    -by - 0.012,
    0.02,
  );
  add(bus, 'Radiator', box(0.02, 0.62, 0.66), 'silver', bx + 0.011);
  add(bus, 'Radiator edge', box(0.015, 0.6, 0.1), 'dark', bx + 0.02);

  const hx = 0.67,
    hy = 0.58,
    ch = 0.19;
  const outline = new THREE.Shape();
  outline.moveTo(-hx + ch, hy);
  outline.lineTo(hx - ch, hy);
  outline.lineTo(hx, hy - ch);
  outline.lineTo(hx, -hy + ch);
  outline.lineTo(hx - ch, -hy);
  outline.lineTo(-hx + ch * 1.7, -hy);
  outline.lineTo(-hx, -hy + ch * 1.7);
  outline.lineTo(-hx, hy - ch);
  outline.closePath();
  const backing = new THREE.ExtrudeGeometry(outline, {
    depth: 0.03,
    bevelEnabled: false,
  });
  add(bus, 'Solar array backing', backing, 'frame', 0, 0, az - 0.03);
  // Only the outward -Z face carries cells. Normalize UVs instead of clamping
  // the artifact's negative shape coordinates to half of the texture.
  const face = new THREE.ShapeGeometry(outline);
  const positions = face.getAttribute('position');
  const uv = face.getAttribute('uv');
  for (let i = 0; i < uv.count; i++)
    uv.setXY(
      i,
      (positions.getX(i) + hx) / (2 * hx),
      (positions.getY(i) + hy) / (2 * hy),
    );
  const index = face.getIndex()!;
  for (let i = 0; i < index.count; i += 3) {
    const first = index.getX(i);
    index.setX(i, index.getX(i + 2));
    index.setX(i + 2, first);
  }
  face.computeVertexNormals(); // outward surface normal is artifact -Z
  const cells = new THREE.Mesh(
    face,
    new THREE.MeshStandardMaterial({
      map: solarCells(),
      color: 0xffffff,
      metalness: 0.3,
      roughness: 0.5,
    }),
  );
  cells.name = 'Solar cells · outward model -Z / spacecraft +Y';
  cells.position.z = az - 0.031;
  bus.add(cells);
  const rim = add(
    bus,
    'Solar array frame',
    backing.clone(),
    'frame',
    0,
    0,
    az + 0.02,
  );
  rim.scale.set(1.03, 1.03, 0.4);
  for (const [x, y] of [
    [-0.42, 0.34],
    [0.42, 0.34],
    [-0.42, -0.34],
    [0.42, -0.34],
  ])
    add(
      bus,
      'Array standoff',
      cylinder(0.012, 0.12),
      'frame',
      x,
      y,
      -(bz + 0.06),
    ).rotation.x = Math.PI / 2;
  for (const [x, y, r] of [
    [-0.3, 0.16, 0.062],
    [0.31, 0.17, 0.062],
    [-0.31, -0.24, 0.055],
  ]) {
    add(
      bus,
      'Array fixture',
      cylinder(r, 0.03),
      'tan',
      x,
      y,
      az - 0.05,
    ).rotation.x = Math.PI / 2;
    add(
      bus,
      'Array fixture inset',
      cylinder(0.018, 0.04),
      'dark',
      x,
      y,
      az - 0.07,
    ).rotation.x = Math.PI / 2;
  }
  add(
    bus,
    'Array bracket',
    box(0.11, 0.1, 0.05),
    'tan',
    0.12,
    -0.24,
    az - 0.05,
  );
  for (const y of [0.12, -0.05, -0.22]) {
    add(
      bus,
      'Thruster cluster',
      box(0.1, 0.11, 0.05),
      'gold',
      0.3,
      y,
      bz + 0.03,
    );
    for (const [x, dy] of [
      [-0.026, -0.026],
      [0.026, -0.026],
      [-0.026, 0.026],
      [0.026, 0.026],
    ])
      add(
        bus,
        'Thruster nozzle',
        new THREE.ConeGeometry(0.016, 0.05, 14),
        'silver',
        0.3 + x,
        y + dy,
        bz + 0.085,
      ).rotation.x = Math.PI / 2;
  }
  const dish = add(
    bus,
    'Communication antenna',
    new THREE.SphereGeometry(0.075, 24, 12, 0, Math.PI * 2, 0, 0.6),
    'silver',
    -0.34,
    0.02,
    bz + 0.06,
  );
  dish.rotation.x = -Math.PI / 2 - 0.2;
  add(
    bus,
    'Antenna mount',
    cylinder(0.007, 0.1),
    'frame',
    -0.34,
    0.02,
    bz + 0.02,
  ).rotation.x = Math.PI / 2;

  const payload = new THREE.Group();
  payload.position.y = 0.13;
  sat.add(payload);
  for (const [x, z] of [
    [-0.3, 0.28],
    [0.3, 0.28],
    [0, -0.3],
  ])
    for (const dx of [-0.05, 0.05])
      add(
        payload,
        'Payload bipod',
        cylinder(0.012, 0.13),
        'frame',
        x + dx,
        0.235,
        z,
      ).rotation.x = (z > 0 ? -1 : 1) * 0.15;
  for (const [w, h, d, x, y, z] of [
    [0.81, 0.3, 0.03, 0, 0.45, 0.355],
    [0.81, 0.3, 0.03, 0, 0.45, -0.355],
    [0.03, 0.3, 0.68, 0.39, 0.45, 0],
    [0.03, 0.3, 0.68, -0.39, 0.45, 0],
    [0.81, 0.025, 0.74, 0, 0.5875, 0],
    [0.81, 0.025, 0.74, 0, 0.3125, 0],
  ])
    add(payload, 'Optical bench enclosure', box(w, h, d), 'foil', x, y, z);
  function baffle(name: string, x: number, half: number, length: number) {
    const y = 0.5,
      z = 0.355 + length / 2;
    add(
      payload,
      name + ' hood',
      box(half * 2, half * 2, length),
      'dark',
      x,
      y,
      z,
    );
    add(
      payload,
      name + ' trim',
      box(half * 2 + 0.012, half * 2 + 0.012, 0.02),
      'gold',
      x,
      y,
      z + length / 2,
    );
    add(
      payload,
      name + ' aperture · model +Z',
      box(half * 1.5, half * 1.5, 0.015),
      'aperture',
      x,
      y,
      z + length / 2 + 0.006,
    );
    const hinge = new THREE.Group();
    hinge.position.set(x, y + half, z + length / 2);
    payload.add(hinge);
    add(
      hinge,
      name + ' open door',
      box(half * 2 + 0.02, 0.012, half * 2 + 0.02),
      'foil',
      0,
      0.02 + half,
      0.02,
    ).rotation.x = -2.1;
  }
  baffle('NFI', 0.205, 0.085, 0.17);
  baffle('WFI', -0.205, 0.1, 0.13);
  for (const [x, y, rz] of [
    [-0.03, 0.545, 0.35],
    [0.05, 0.55, -0.35],
  ]) {
    const tracker = add(
      payload,
      'Star tracker',
      cylinder(0.032, 0.12, 0.044),
      'gold',
      x,
      y,
      0.4,
    );
    tracker.rotation.set(Math.PI / 2 - 0.35, 0, rz);
  }
  add(
    payload,
    'Sun sensor housing',
    box(0.09, 0.04, 0.05),
    'gold',
    0,
    0.605,
    0.33,
  );
  for (const x of [-0.022, 0.022])
    add(
      payload,
      'Sun sensor',
      cylinder(0.011, 0.018, 0.014),
      'dark',
      x,
      0.63,
      0.33,
    );
  for (const [x, z] of [
    [-0.055, -0.1],
    [0.025, -0.1],
    [-0.015, -0.235],
  ]) {
    const leg = add(
      payload,
      'COSSMo support',
      cylinder(0.008, 0.13),
      'frame',
      x,
      0.655,
      z,
    );
    leg.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(-0.015 - x, 0.6 - 0.655, -0.16 - z).normalize(),
    );
  }
  add(
    payload,
    'COSSMo solar monitor',
    box(0.15, 0.135, 0.1),
    'tan',
    -0.015,
    0.735,
    -0.155,
  );
  add(
    payload,
    'COSSMo window',
    cylinder(0.02, 0.05),
    'dark',
    -0.05,
    0.735,
    -0.215,
  ).rotation.x = Math.PI / 2;
  add(
    payload,
    'COSSMo window',
    cylinder(0.013, 0.05),
    'dark',
    0.02,
    0.735,
    -0.215,
  ).rotation.x = Math.PI / 2;
  add(
    payload,
    'Instrument control package',
    box(0.32, 0.19, 0.07),
    'dark',
    0,
    0.45,
    -0.39,
  );
  add(
    payload,
    'ICP connector',
    box(0.05, 0.03, 0.05),
    'silver',
    -0.12,
    0.53,
    -0.42,
  );
  add(
    payload,
    'ICP connector',
    box(0.05, 0.03, 0.05),
    'silver',
    0.12,
    0.37,
    -0.42,
  );
  return sat;
}
