import type { Job } from './research';

export function circularityCSV(result: Job) {
  const columns = [
    'timestamp_utc',
    'channel',
    'frame_id',
    'level_kR',
    'status',
    'departure_pct',
    'sensitivity_low_pct',
    'sensitivity_high_pct',
    'radius_re',
    'rms_re',
    'center_x_re',
    'center_y_re',
    'center_offset_re',
    'lower_threshold_kR',
    'lower_threshold_status',
    'lower_threshold_departure_pct',
    'upper_threshold_kR',
    'upper_threshold_status',
    'upper_threshold_departure_pct',
    'exclude_interpolated',
    'source',
    'source_fingerprint',
    'data_version',
    'method_version',
    'circularity_method_json',
  ];
  const rows = (result.rows || []).flatMap((row) =>
    (['1', '3'] as const).map((level) => {
      const value = row.circularity?.[level];
      const low = value?.variants[0],
        high = value?.variants[2];
      const values = [
        row.timestamp,
        row.channel,
        row.frame_id,
        Number(level),
        value?.status ?? 'not_calculated',
        value?.departure_pct,
        value?.sensitivity_low_pct,
        value?.sensitivity_high_pct,
        value?.radius_re,
        value?.rms_re,
        value?.center_x_re,
        value?.center_y_re,
        value?.center_offset_re,
        low?.threshold_kR,
        low?.status,
        low?.departure_pct,
        high?.threshold_kR,
        high?.status,
        high?.departure_pct,
        result.recipe.exclude_interpolated,
        row.source,
        row.source_fingerprint,
        row.version,
        result.method?.version,
        JSON.stringify(result.method?.circularity),
      ];
      return values
        .map(
          (value) =>
            '"' +
            (value == null
              ? ''
              : `${value as string | number | boolean}`
            ).replaceAll('"', '""') +
            '"',
        )
        .join(',');
    }),
  );
  return [columns.join(','), ...rows].join('\r\n');
}
