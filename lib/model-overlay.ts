import type { Contours } from './research.ts';

export type ModelChoice = 'off' | 'Z15MIN' | 'Z15MAX';
export type ModelContours = Contours & {
  model: Exclude<ModelChoice, 'off'>;
  method: string;
  irradiance_mw: number;
  exclude_interpolated: boolean;
  valid_grid_points: number;
  integration_seconds: number;
};

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
    Math.abs(value.irradiance_mw - irradiance) < 0.00051 &&
    value.exclude_interpolated === exclude
  );
}
