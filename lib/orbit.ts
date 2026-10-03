export type Vec3 = [number, number, number];
export const RE_KM = 6370;
export const formatPointingAngle = (angle: number) =>
  `${angle.toFixed(4)}°`;
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
