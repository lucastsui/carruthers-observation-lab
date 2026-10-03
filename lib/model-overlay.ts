import type { Contours } from './research.ts';

export type ModelChoice = 'off' | 'Z15MIN' | 'Z15MAX';
export type ModelContours = Contours & {
  model: Exclude<ModelChoice, 'off'>;
  method: string;
  irradiance_mw: number;
  brightness_scale: number;
  exclude_interpolated: boolean;
  valid_grid_points: number;
  integration_seconds: number;
  clip_paths: [number, number][][];
};

// Fit whole labels inside the supported domain, including holes. Rejecting
// intersecting segment bounding boxes is conservative for any polygon and exact
// for the axis-aligned cell boundaries returned by the overlay service.
export function modelLabelPosition(
  path: [number, number][],
  rings: [number, number][][],
  width: number,
  height: number,
  start: number,
): [number, number] | null {
  for (let sample = 0; sample < 16; sample++) {
    const [x, y] = path[Math.floor(path.length * ((start + sample / 16) % 1))];
    const left = x - width / 2,
      right = x + width / 2;
    const top = y - height / 2,
      bottom = y + height / 2;
    let inside = false,
      touchesBoundary = false;
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1],
          [bx, by] = ring[i];
        if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay))
          inside = !inside;
        if (
          Math.max(ax, bx) >= left &&
          Math.min(ax, bx) <= right &&
          Math.max(ay, by) >= top &&
          Math.min(ay, by) <= bottom
        )
          touchesBoundary = true;
      }
    }
    if (inside && !touchesBoundary) return [x, y];
  }
  return null;
}

export function modelOverlayKey(
  fid: string,
  model: ModelChoice,
  irradiance: number,
  exclude: boolean,
) {
  return `model-contours?id=${encodeURIComponent(fid)}&model=${model}&irradiance=${irradiance}&exclude=${exclude ? 1 : 0}`;
}

export function matchingModelOverlay(
  value: ModelContours,
  fid: string,
  model: ModelChoice,
  irradiance: number,
  exclude: boolean,
) {
  return (
    value.frame_id === fid &&
    value.model === model &&
    Math.abs(value.brightness_scale - 4 * Math.PI) < 1e-12 &&
    Math.abs(value.irradiance_mw - irradiance) < 0.00051 &&
    value.exclude_interpolated === exclude
  );
}
