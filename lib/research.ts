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
  image_plane_corners_re: [number, number, number][];
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
  kind: 'annulus' | 'sector' | 'rectangle' | 'point';
  inner: number;
  outer: number;
  angle_start: number;
  angle_end: number;
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
};
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
        : roi.kind === 'sector'
          ? ['inner', 'outer', 'angle_start', 'angle_end']
          : ['inner', 'outer'];
  if (keys.some((k) => !Number.isFinite(roi[k as keyof ROI])))
    return 'Enter valid numbers for the selection.';
  if (
    (roi.kind === 'annulus' || roi.kind === 'sector') &&
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
  return null;
}
export function activeROI(roi: ROI) {
  const keys =
    roi.kind === 'point'
      ? ['x', 'y']
      : roi.kind === 'rectangle'
        ? ['x1', 'x2', 'y1', 'y2']
        : roi.kind === 'sector'
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
  kind: 'symh' | 'lyman';
  name: string;
  units: string;
  cadence: string;
  source: string;
  source_url: string;
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
