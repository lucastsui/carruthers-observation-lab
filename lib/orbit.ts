export type Vec3 = [number, number, number];
export const RE_KM = 6370;
export const formatPointingAngle = (angle: number) =>
  `${angle.toFixed(angle > 0 && angle < 0.1 ? 3 : 2)}°`;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n) as Vec3;
};
/** Directed off-nadir angle and unit-radius arc, centered on the spacecraft. */
export function pointingDeviationGeometry(
  boresight: Vec3,
  spacecraftPosition: Vec3,
) {
  if (
    !boresight.every(Number.isFinite) ||
    !spacecraftPosition.every(Number.isFinite) ||
    Math.hypot(...boresight) === 0 ||
    Math.hypot(...spacecraftPosition) === 0
  )
    return null;
  const b = unit(boresight),
    reference = unit(spacecraftPosition).map((v) => -v) as Vec3,
    cosine = Math.max(-1, Math.min(1, dot(b, reference))),
    sine = Math.hypot(...cross(reference, b)),
    angle = Math.atan2(sine, cosine),
    transverse = b.map((v, i) => v - cosine * reference[i]) as Vec3;
  // Coincident/opposite directions have no unique plane; choose a stable one
  // for the close-up camera and, at 180°, a valid semicircular arc.
  const tangent =
    sine > 1e-12
      ? unit(transverse)
      : unit(
          cross(
            reference,
            Math.abs(reference[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0],
          ),
        );
  const arc: Vec3[] =
    angle > 1e-12
      ? Array.from({ length: 33 }, (_, i) => {
          if (i === 0) return reference;
          if (i === 32) return b;
          const t = (angle * i) / 32;
          return reference.map(
            (v, axis) => v * Math.cos(t) + tangent[axis] * Math.sin(t),
          ) as Vec3;
        })
      : [];
  return {
    angleDeg: (angle * 180) / Math.PI,
    reference,
    boresight: b,
    tangent,
    arc,
  };
}
/** Sun-aligned rotating view, with the J2000 ecliptic normal as the north reference. */
export function sunAligned(v: Vec3, sun: Vec3): Vec3 {
  const x = unit(sun),
    eclipticNorth: Vec3 = [
      0,
      -Math.sin((23.4392911 * Math.PI) / 180),
      Math.cos((23.4392911 * Math.PI) / 180),
    ];
  const y = unit(cross(eclipticNorth, x)),
    z = cross(x, y);
  // Three.js uses y-up: place north on y and dusk on z.
  return [dot(v, x), dot(v, z), -dot(v, y)];
}
