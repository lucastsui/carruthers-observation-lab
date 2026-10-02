export type Channel = 'WFI' | 'NFI';
export type Frame = {
  id: string;
  channel: Channel;
  timestamp: string;
  epoch_ms: number;
  source: string;
  version: string;
  frame_index: number;
  shape: [number, number];
  earth_xy: [number, number];
  header_earth_xy: [number, number];
  pixels_per_re: number;
  exposure_s: number;
  sun_position_km: [number, number, number];
  spacecraft_position_km: [number, number, number];
  spacecraft_attitude?: [number, number, number, number];
  image_plane_corners_re: [number, number, number][];
  camera_boresight_gcrs?: [number, number, number];
  earth_sun_pointing_deviation_deg?: number;
  flags: Record<string, number | null>;
};
export type Catalogue = {
  frames: Frame[];
  file_count: number;
  bytes: number;
  scales: Record<Channel, [number, number]>;
  method_version: string;
  skipped: { file: string; reason: string }[];
};
export function snapPointToPixel(
  frame: Pick<Frame, 'earth_xy' | 'pixels_per_re'>,
  x: number,
  y: number,
) {
  const p = frame.pixels_per_re,
    [cx, cy] = frame.earth_xy;
  const col = Math.floor(cx + x * p + 0.5),
    row = Math.floor(cy - y * p + 0.5);
  return {
    x: Number(((col - cx) / p).toFixed(6)),
    y: Number(((cy - row) / p).toFixed(6)),
  };
}
export type ROI = {
  kind:
    | 'annulus'
    | 'sector'
    | 'paired_sectors'
    | 'paired_annular_sectors'
    | 'rectangle'
    | 'point';
  inner: number;
  outer: number;
  angle_start: number;
  angle_end: number;
  angle_width: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  x: number;
  y: number;
};
export const DEFAULT_ROI: ROI = {
  kind: 'annulus',
  inner: 4.5,
  outer: 5.5,
  angle_start: 0,
  angle_end: 90,
  angle_width: 45,
  x1: 3,
  x2: 6,
  y1: -1,
  y2: 1,
  x: 5,
  y: 0,
};
export type Profile = {
  radius_re: number;
  inner_re: number;
  outer_re: number;
  mean_kR: number | null;
  valid_pixels: number;
  selected_pixels: number;
  coverage: number;
};
export type ContourFit = {
  threshold_kR: number;
  status: 'ok' | 'open_or_missing' | 'ambiguous' | 'unresolved' | 'fit_failed';
  departure_pct: number | null;
  radius_re?: number;
  center_x_re?: number;
  center_y_re?: number;
  center_offset_re?: number;
  rms_re?: number;
};
export type CircularityMeasurement = ContourFit & {
  sensitivity_low_pct: number | null;
  sensitivity_high_pct: number | null;
  variants: ContourFit[];
};
export type Measurement = {
  frame_id: string;
  source: string;
  source_fingerprint: string;
  version: string;
  method_version: string;
  exclude_interpolated: boolean;
  timestamp: string;
  epoch_ms: number;
  channel: Channel;
  mean_kR: number | null;
  median_kR: number | null;
  spatial_std_kR: number | null;
  valid_pixels: number;
  selected_pixels: number;
  coverage: number;
  nonpositive_pixels: number;
  profile?: Profile[];
  flags: Record<string, number | null>;
  regions?: Record<'dawn' | 'dusk', RegionMeasurement>;
  circularity?: Record<'1' | '3', CircularityMeasurement>;
};
export type RegionMeasurement = Pick<
  Measurement,
  | 'mean_kR'
  | 'median_kR'
  | 'spatial_std_kR'
  | 'valid_pixels'
  | 'selected_pixels'
  | 'coverage'
  | 'nonpositive_pixels'
>;
export const PAIRED_REGIONS = [
  { id: 'dawn', label: 'Dawn', center: 180, color: '#83dfca' },
  { id: 'dusk', label: 'Dusk', center: 0, color: '#eea5dd' },
] as const;
export function isPairedROI(roi: Pick<ROI, 'kind'>) {
  return roi.kind === 'paired_sectors' || roi.kind === 'paired_annular_sectors';
}
export function pairedSectors(roi: ROI) {
  return PAIRED_REGIONS.map((region) => ({
    ...region,
    roi: {
      ...roi,
      kind: 'sector' as const,
      inner: roi.kind === 'paired_annular_sectors' ? roi.inner : 0,
      angle_start:
        region.center +
        (roi.kind === 'paired_annular_sectors'
          ? roi.angle_start
          : -roi.angle_width / 2),
      angle_end:
        region.center +
        (roi.kind === 'paired_annular_sectors'
          ? roi.angle_end
          : roi.angle_width / 2),
    },
  }));
}
type RegionPoint = [number, number];
function polarPoint(radius: number, angle: number): RegionPoint {
  return [
    radius * Math.cos((angle * Math.PI) / 180),
    radius * Math.sin((angle * Math.PI) / 180),
  ];
}
// Store angles on the right side; a drag on the left is rotated by 180°.
export function pairedAnnularFromDrag(a: RegionPoint, b: RegionPoint) {
  if (![...a, ...b].every(Number.isFinite) || a[0] * b[0] < 0) return null;
  const side = a[0] < 0 || b[0] < 0 ? -1 : 1;
  const angles = [a, b].map(
    ([x, y]) => (Math.atan2(side * y, side * x) * 180) / Math.PI,
  );
  const radii = [Math.hypot(...a), Math.hypot(...b)];
  const round = (n: number) => Math.round(n * 100) / 100;
  const bounds = {
    inner: round(Math.min(...radii)),
    outer: round(Math.max(...radii)),
    angle_start: round(Math.min(...angles)),
    angle_end: round(Math.max(...angles)),
  };
  if (
    Math.min(...radii) === 0 ||
    roiError({ ...DEFAULT_ROI, kind: 'paired_annular_sectors', ...bounds })
  )
    return null;
  return bounds;
}
export function pairedAnnularCorners(roi: ROI) {
  return pairedSectors(roi).flatMap(({ id, roi: sector }) =>
    [sector.inner, sector.outer].flatMap((radius, ri) =>
      [sector.angle_start, sector.angle_end].map((angle, ai) => ({
        id,
        point: polarPoint(radius, angle),
        anchor: polarPoint(
          [sector.outer, sector.inner][ri],
          [sector.angle_end, sector.angle_start][ai],
        ),
      })),
    ),
  );
}
export function pairedAnnularDragAnchor(
  roi: ROI,
  point: RegionPoint,
  tolerance: number,
): RegionPoint {
  const nearest = pairedAnnularCorners(roi)
    .map((corner) => ({
      ...corner,
      distance: Math.hypot(
        corner.point[0] - point[0],
        corner.point[1] - point[1],
      ),
    }))
    .sort((a, b) => a.distance - b.distance)[0];
  return nearest.distance <= tolerance ? nearest.anchor : point;
}
// Both wedges stay centered on the image's dawn/dusk axes.
export function pairedOpeningAngle(x: number, y: number) {
  return Math.max(
    1,
    Math.min(
      180,
      Math.round((2 * Math.atan2(Math.abs(y), Math.abs(x)) * 180) / Math.PI),
    ),
  );
}
export type Recipe = {
  roi: ROI;
  exclude_interpolated: boolean;
  channel: Channel;
  frame_ids: string[];
  start: string;
  end: string;
};
export type Job = {
  queue_position?: number;
  method?: Record<string, unknown>;
  baseline?: Baseline;
  id: string;
  status:
    | 'queued'
    | 'running'
    | 'cancelling'
    | 'cancelled'
    | 'complete'
    | 'error';
  completed: number;
  total: number;
  recipe: Recipe;
  rows?: Measurement[];
  error?: string;
  title?: string;
  saved_at?: string;
};
export type Saved = {
  id: string;
  title: string;
  saved_at: string;
  recipe: Recipe;
};
export async function api<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    signal,
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Carruthers-Local': '1',
          },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok) {
    if (response.status === 401) window.location.reload();
    let message = `Service returned ${response.status}`;
    try {
      message =
        ((await response.json()) as { error?: string }).error || message;
    } catch {}
    throw Object.assign(new Error(message), { status: response.status });
  }
  return response.json();
}
export function previewURL(frame: Frame, scale: [number, number]) {
  return `/api/preview?id=${frame.id}&low=${scale[0]}&high=${scale[1]}`;
}
export function fmt(n: number | null | undefined, digits = 3) {
  return n == null
    ? '—'
    : n.toLocaleString('en-US', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
}
export function roiLabel(roi: ROI) {
  if (roi.kind === 'annulus') return `${roi.inner}–${roi.outer} Rᴇ annulus`;
  if (roi.kind === 'paired_sectors')
    return `Dawn + Dusk · full image · ${roi.angle_width}° each`;
  if (roi.kind === 'paired_annular_sectors')
    return `Dawn + Dusk · ${roi.inner}–${roi.outer} Rᴇ · ${roi.angle_start}–${roi.angle_end}° on right`;
  if (roi.kind === 'sector')
    return `${roi.inner}–${roi.outer} Rᴇ, ${roi.angle_start}–${roi.angle_end}° sector`;
  if (roi.kind === 'point') return `Point (${roi.x}, ${roi.y}) Rᴇ`;
  return `Box x ${roi.x1}…${roi.x2}, y ${roi.y1}…${roi.y2} Rᴇ`;
}
export function roiError(roi: ROI): string | null {
  const keys =
    roi.kind === 'point'
      ? ['x', 'y']
      : roi.kind === 'rectangle'
        ? ['x1', 'x2', 'y1', 'y2']
        : roi.kind === 'paired_sectors'
          ? ['angle_width']
          : roi.kind === 'sector' || roi.kind === 'paired_annular_sectors'
            ? ['inner', 'outer', 'angle_start', 'angle_end']
            : ['inner', 'outer'];
  if (keys.some((k) => !Number.isFinite(roi[k as keyof ROI])))
    return 'Enter valid numbers for the selection.';
  if (
    (roi.kind === 'annulus' ||
      roi.kind === 'sector' ||
      roi.kind === 'paired_annular_sectors') &&
    !(roi.inner >= 0 && roi.outer > roi.inner && roi.outer <= 100)
  )
    return 'Outer radius must exceed inner radius (0–100 Rᴇ).';
  if (roi.kind === 'rectangle' && !(roi.x1 < roi.x2 && roi.y1 < roi.y2))
    return 'Box minimums must be below maximums.';
  if (
    roi.kind === 'sector' &&
    !(roi.angle_end > roi.angle_start && roi.angle_end - roi.angle_start <= 360)
  )
    return 'Sector must span more than 0° and at most 360°.';
  if (
    roi.kind === 'paired_annular_sectors' &&
    !(
      roi.angle_start >= -90 &&
      roi.angle_end <= 90 &&
      roi.angle_start < roi.angle_end
    )
  )
    return 'Right-side angles must satisfy −90° ≤ start < end ≤ 90°.';
  if (
    roi.kind === 'paired_sectors' &&
    !(roi.angle_width >= 1 && roi.angle_width <= 180)
  )
    return 'Shared opening angle must be between 1° and 180°.';
  return null;
}
export function activeROI(roi: ROI) {
  const keys =
    roi.kind === 'point'
      ? ['x', 'y']
      : roi.kind === 'rectangle'
        ? ['x1', 'x2', 'y1', 'y2']
        : roi.kind === 'paired_sectors'
          ? ['angle_width']
          : roi.kind === 'sector' || roi.kind === 'paired_annular_sectors'
            ? ['inner', 'outer', 'angle_start', 'angle_end']
            : ['inner', 'outer'];
  return Object.fromEntries(
    ['kind', ...keys].map((k) => [k, roi[k as keyof ROI]]),
  );
}
export function regionSignature(roi: ROI, exclude: boolean) {
  return JSON.stringify({ roi: activeROI(roi), exclude });
}
export function analysisSignature(
  recipe: Pick<Recipe, 'roi' | 'exclude_interpolated' | 'frame_ids'>,
) {
  return JSON.stringify({
    region: regionSignature(recipe.roi, recipe.exclude_interpolated),
    frames: recipe.frame_ids,
  });
}
export function downloadText(
  name: string,
  content: string,
  type = 'application/json',
) {
  const u = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}

export type Baseline = {
  frame_id: string;
  timestamp: string;
  channel: Channel;
  mean_kR: number | null;
  valid_pixels: number;
  definition: string;
  exclude_interpolated: boolean;
};
export type ContextSeries = {
  kind: 'dst' | 'lyman';
  name: string;
  units: string;
  cadence: string;
  source: string;
  source_url: string;
  interpretation?: string;
  data: { x: number; y: number | null }[];
  status: string;
  error: string | null;
  stale: boolean;
  fetched_at: string | null;
};
export type Contours = {
  frame_id: string;
  contours: { level_kR: number; paths: [number, number][][] }[];
};
