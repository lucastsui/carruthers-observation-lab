import type { Job } from './research';
import { isPairedROI } from './research.ts';

// Paired analyses use one explicitly labeled row per sector and frame.
export function analysisCSV(result: Job) {
  const paired = isPairedROI(result.recipe.roi);
  const columns = [
    'timestamp_utc',
    'channel',
    ...(paired ? ['region'] : []),
    'mean_kR',
    'median_kR',
    'spatial_std_kR',
    'valid_pixels',
    'selected_pixels',
    'coverage',
    'nonpositive_pixels',
    'source',
    'source_fingerprint',
    'frame_index',
    'data_version',
    'earth_x_pixel',
    'earth_y_pixel',
    'pixels_per_re',
    'exposure_s',
    'exclude_interpolated',
    'roi_json',
    'method_version',
    'flags_json',
    'baseline_mean_kR',
    'baseline_frame_id',
  ];
  const rows = (result.rows || []).flatMap((row) => {
    const r = row as unknown as Record<string, unknown>;
    const xy = r.earth_xy as number[];
    const sectors = paired
      ? Object.entries(row.regions!).map(([region, stats]) => ({
          ...stats,
          region,
        }))
      : [{}];
    return sectors.map((stats) => {
      const mapped: Record<string, unknown> = {
        ...r,
        ...stats,
        timestamp_utc: row.timestamp,
        data_version: row.version,
        earth_x_pixel: xy?.[0],
        earth_y_pixel: xy?.[1],
        exclude_interpolated: result.recipe.exclude_interpolated,
        roi_json: JSON.stringify(result.recipe.roi),
        method_version: result.method?.version ?? row.method_version,
        flags_json: JSON.stringify(row.flags),
        baseline_mean_kR: result.baseline?.mean_kR,
        baseline_frame_id: result.baseline?.frame_id,
      };
      return columns
        .map((key) => {
          const value = mapped[key];
          const text =
            value == null
              ? ''
              : typeof value === 'object'
                ? JSON.stringify(value)
                : `${value as string | number | boolean}`;
          return '"' + text.replaceAll('"', '""') + '"';
        })
        .join(',');
    });
  });
  return [columns.join(','), ...rows].join('\r\n');
}
