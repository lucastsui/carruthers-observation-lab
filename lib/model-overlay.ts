import type { ContextSeries, Contours } from './research.ts';

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

export function dailyModelIrradiance(
  series: ContextSeries | undefined,
  utcDay: string | undefined,
): number | null {
  if (!utcDay || series?.kind !== 'lyman' || series.units !== 'mW/m²') return null;
  const value = series.data.find(
    (point) => Number.isFinite(point.x) && new Date(point.x).toISOString().slice(0, 10) === utcDay,
  )?.y;
  // Match the UTC day of the daily mean, not the nearest noon timestamp.
  // Keep missing/out-of-range observations explicit; never clamp to the slider.
  if (value == null || !Number.isFinite(value) || value < 1 || value > 30) return null;
  return Math.round(value * 1000) / 1000; // Existing contour API precision.
}

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
    value.brightness_scale === 1 &&
    Math.abs(value.irradiance_mw - irradiance) < 0.00051 &&
    value.exclude_interpolated === exclude
  );
}
