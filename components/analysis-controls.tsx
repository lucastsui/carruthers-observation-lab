'use client';
import { exportAnalysis } from '@/lib/saved';
import type { ReactNode } from 'react';
import { Download, Activity, Square, Save, Info } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { MeasurementChart } from '@/components/measurement-chart';
import {
  fmt,
  roiError,
  roiLabel,
  downloadText,
  PAIRED_REGIONS,
} from '@/lib/research';
import type { Frame, ROI, Baseline } from '@/lib/research';
import type { useAnalysis } from '@/hooks/use-analysis';
import { ContextChart } from '@/components/context-chart';
type Analysis = ReturnType<typeof useAnalysis>;
const REGION_SHAPES = [
  { kind: 'annulus', label: 'Annulus' },
  { kind: 'sector', label: 'Annular sector' },
  { kind: 'paired_sectors', label: 'Dawn + Dusk' },
  { kind: 'rectangle', label: 'Rectangle' },
  { kind: 'point', label: 'Single pixel' },
] as const;

function RegionShapeIcon({ kind }: { kind: ROI['kind'] }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {kind === 'annulus' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
        </>
      )}
      {kind === 'sector' && (
        <path d="M6 3 A15 15 0 0 1 21 18 L14 18 A8 8 0 0 0 6 10 Z" />
      )}
      {kind === 'paired_sectors' && (
        <path d="M12 12 L3 6 A11 11 0 0 0 3 18 Z M12 12 L21 6 A11 11 0 0 1 21 18 Z" />
      )}
      {kind === 'rectangle' && (
        <rect x="3" y="5" width="18" height="14" rx="1" />
      )}
      {kind === 'point' && (
        <>
          <rect x="3" y="3" width="18" height="18" rx="1" />
          <path d="M9 3V21 M15 3V21 M3 9H21 M3 15H21" opacity="0.5" />
          <rect
            x="9"
            y="9"
            width="6"
            height="6"
            fill="currentColor"
            stroke="none"
          />
        </>
      )}
    </svg>
  );
}

export function AnalysisControls({
  a,
  frame,
  count,
  roi,
  setROI,
  exclude,
  setExclude,
  playing,
  displayControls,
}: {
  a: Analysis;
  frame: Frame | undefined;
  count: number;
  roi: ROI;
  setROI: (r: ROI) => void;
  exclude: boolean;
  setExclude: (v: boolean) => void;
  playing: boolean;
  displayControls: ReactNode;
}) {
  const invalid = roiError(roi),
    sample = a.sample;
  const numberField = (
    key: Exclude<keyof ROI, 'kind'>,
    label: string,
    step = 0.1,
  ) => (
    <label className="field" key={key}>
      {label}
      <input
        type="number"
        step={step}
        value={Number.isFinite(roi[key]) ? roi[key] : ''}
        onChange={(e) => setROI({ ...roi, [key]: e.target.valueAsNumber })}
      />
    </label>
  );
  return (
    <section
      className="panel extraction controls-card"
      aria-label="Region and display controls"
    >
      <div className="region-controls">
        <div className="control-heading">
          <h2>Region</h2>
          <TooltipProvider delay={200}>
            <ToggleGroup
              className="region-shapes"
              aria-label="Selection shape"
              multiple={false}
              value={[roi.kind]}
              onValueChange={(values) => {
                const kind = REGION_SHAPES.find(
                  (shape) => shape.kind === values[0],
                )?.kind;
                if (kind && kind !== roi.kind) setROI({ ...roi, kind });
              }}
            >
              {REGION_SHAPES.map(({ kind, label }) => (
                <Tooltip key={kind}>
                  <TooltipTrigger
                    render={
                      <ToggleGroupItem
                        value={kind}
                        aria-label={label}
                        className="region-shape-button"
                      />
                    }
                  >
                    <RegionShapeIcon kind={kind} />
                  </TooltipTrigger>
                  <TooltipContent>{label}</TooltipContent>
                </Tooltip>
              ))}
            </ToggleGroup>
          </TooltipProvider>
        </div>
        <p className="selection-help">
          {roi.kind === 'rectangle'
            ? 'Drag a box; x right, y up.'
            : roi.kind === 'point'
              ? 'Click to select a pixel.'
              : roi.kind === 'paired_sectors'
                ? 'Drag an edge handle to set both angles. Pies extend to the image edges.'
                : 'Drag to set the radii.'}
        </p>
        {(roi.kind === 'annulus' || roi.kind === 'sector') && (
          <div className="pair">
            {numberField('inner', 'Inner · Rᴇ')}
            {numberField('outer', 'Outer · Rᴇ')}
          </div>
        )}
        {roi.kind === 'paired_sectors' && (
          <>
            <label className="field shared-angle">
              Shared opening angle · °
              <input
                type="number"
                min={1}
                max={180}
                step={1}
                value={Number.isFinite(roi.angle_width) ? roi.angle_width : ''}
                onChange={(e) =>
                  setROI({ ...roi, angle_width: e.target.valueAsNumber })
                }
              />
            </label>
          </>
        )}
        {roi.kind === 'sector' && (
          <>
            <div className="pair">
              {numberField('angle_start', 'Start · °', 1)}
              {numberField('angle_end', 'End · °', 1)}
            </div>
            <p className="small muted">0° right; 90° up.</p>
          </>
        )}
        {roi.kind === 'rectangle' && (
          <>
            <div className="pair">
              {numberField('x1', 'Min x · Rᴇ')}
              {numberField('x2', 'Max x · Rᴇ')}
            </div>
            <div className="pair">
              {numberField('y1', 'Min y · Rᴇ')}
              {numberField('y2', 'Max y · Rᴇ')}
            </div>
          </>
        )}
        {roi.kind === 'point' && (
          <div className="pair">
            {numberField('x', 'x · Rᴇ')}
            {numberField('y', 'y · Rᴇ')}
          </div>
        )}
        <label className="switch-row" htmlFor="exclude-interpolation">
          Skip interpolated pixels
          <Switch
            id="exclude-interpolation"
            checked={exclude}
            onCheckedChange={setExclude}
          />
        </label>
        {invalid && (
          <p className="status error" role="alert">
            {invalid}
          </p>
        )}
      </div>
      {displayControls}
      <div className="measurement-controls">
        <div className="measurement-summary">
          <div className="metric">
            {sample?.regions ? (
              <div
                className="paired-means"
                aria-label="Dawn and Dusk frame means"
              >
                {PAIRED_REGIONS.map(({ id, label, color }) => (
                  <div key={id}>
                    <span style={{ color }}>{label}</span>
                    <strong>{fmt(sample.regions![id].mean_kR)} kR</strong>
                    <small>
                      {(sample.regions![id].coverage * 100).toFixed(1)}%
                      coverage
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <div className="metric-value">
                <span className="metric-label">Frame mean</span>
                <strong>
                  {sample ? fmt(sample.mean_kR) : '—'}
                  <span>kR</span>
                </strong>
              </div>
            )}
            {!sample?.regions && (
              <div className="metric-caption">
                <span>
                  {playing
                    ? 'Pause to inspect'
                    : sample
                      ? `${sample.valid_pixels.toLocaleString()} valid pixels`
                      : a.sampleError
                        ? 'Measurement unavailable'
                        : invalid
                          ? 'Adjust the selection'
                          : frame
                            ? 'Reading the array…'
                            : 'No frame selected'}
                </span>
                <span>
                  {sample
                    ? `${(sample.coverage * 100).toFixed(1)}% coverage`
                    : ''}
                </span>
              </div>
            )}
          </div>
          {sample && sample.coverage < 0.8 && (
            <p className="status">This selection has limited valid coverage.</p>
          )}
          {a.sampleError && (
            <p className="status error" role="alert">
              {a.sampleError}
            </p>
          )}
        </div>
        {a.busy ? (
          <div role="status" className="extraction-progress">
            <Progress
              value={a.job ? (100 * a.job.completed) / a.job.total : 0}
            />
            <div className="progress-actions">
              <span className="small muted">
                {a.phase === 'waiting'
                  ? 'Submitting analysis…'
                  : a.job?.status === 'queued'
                    ? `Queued · ${a.job.queue_position ?? 1} in line`
                    : `${a.job?.completed ?? 0} / ${a.job?.total ?? count} frames`}
              </span>
              <button className="button" onClick={() => a.cancel()}>
                <Square />
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="automatic-status" role="status">
            <Activity aria-hidden="true" />
            <span>
              {a.phase === 'cancelled'
                ? 'Time plot paused'
                : a.phase === 'error'
                  ? 'Update failed'
                  : !count
                    ? 'Choose an interval'
                    : invalid
                      ? 'Adjust the selection'
                      : a.phase === 'complete'
                        ? 'Analysis complete'
                        : 'Ready to analyze'}
            </span>
          </div>
        )}
      </div>
      <Dialog>
        <DialogTrigger className="button ghost full notes-button">
          <Info />
          Notes & geometry
        </DialogTrigger>
        <DialogContent className="reference-dialog">
          <DialogTitle>Measurement reference</DialogTitle>
          <Tabs defaultValue="science">
            <TabsList>
              <TabsTrigger value="science">Units & masks</TabsTrigger>
              <TabsTrigger value="geometry" disabled={!frame}>
                Frame & geometry
              </TabsTrigger>
            </TabsList>{' '}
            <TabsContent value="science" className="reference-text">
              {' '}
              <p className="hint">
                Selection stays at the same projected distances in every frame.
                Measurements use the original numeric arrays.
              </p>
              <p>
                1 kR = 1,000 Rayleighs. Finite negative values are retained for
                measurement; only positive values appear on the logarithmic
                image.
              </p>
              <p>
                Coverage counts valid pixels within the part of the selection
                inside the raster. It does not include portions extending beyond
                the raster.
              </p>
              <p>
                Brightness integrates emission along the line of sight. It is
                not a direct measurement of local hydrogen density. Error bars
                have not been validated.
              </p>
              {sample && !sample.regions && (
                <dl>
                  <dt>Median</dt>
                  <dd>{fmt(sample.median_kR)} kR</dd>
                  <dt>Pixel dispersion (σ)</dt>
                  <dd>{fmt(sample.spatial_std_kR)} kR</dd>
                  <dt>Nonpositive pixels</dt>
                  <dd>{sample.nonpositive_pixels}</dd>
                </dl>
              )}
              <p>
                Pixel dispersion describes spatial variation, not uncertainty on
                the mean. Image coordinates: x right, y up; distances use the
                near-nadir approximation.
              </p>
            </TabsContent>
            {frame && (
              <TabsContent value="geometry" className="reference-text">
                <p className="filename mono">{frame.source}</p>
                <dl>
                  <dt>Array frame index</dt>
                  <dd>{frame.frame_index} (zero based)</dd>
                  <dt>Exposure</dt>
                  <dd>{frame.exposure_s.toFixed(1)} s</dd>
                  <dt>Earth x, y</dt>
                  <dd>{frame.earth_xy.map((n) => n.toFixed(3)).join(', ')}</dd>
                  <dt>Pixels / Rᴇ</dt>
                  <dd>{frame.pixels_per_re.toFixed(4)}</dd>
                  <dt>Header earth_loc</dt>
                  <dd>
                    {frame.header_earth_xy.map((n) => n.toFixed(3)).join(', ')}
                  </dd>
                </dl>
                <p>
                  Earth is projected with the registered camera parameters. No
                  second translation is applied to the image. The March v1.3
                  earth_loc and plate_scale fields are inconsistent with this
                  geometry.
                </p>
                <p>
                  Reported timestamp: {frame.timestamp}. It is not assumed to be
                  the exposure midpoint.
                </p>
                <p>
                  Quality flags:{' '}
                  {Object.entries(frame.flags)
                    .filter(([, v]) => v !== 0)
                    .map(
                      ([k, v]) =>
                        `${k.replace('flag_', '')}: ${v ?? 'unknown'}`,
                    )
                    .join('; ') || 'all stored flags are 0'}
                  .
                </p>
              </TabsContent>
            )}
          </Tabs>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function AnalysisResults({
  a,
  frame,
  onSelect,
  baseline,
  baselineError,
}: {
  baseline?: Baseline;
  baselineError?: string;
  a: Analysis;
  frame: Frame | undefined;
  onSelect: (id: string) => void;
}) {
  // Never present or export a curve for a previous region as the current one.
  const result = a.resultMatches ? a.result : null;
  function exportProfile() {
    if (!frame || !a.sample?.profile) return;
    const s = a.sample;
    const columns = [
      'inner_re',
      'outer_re',
      'radius_re',
      'mean_kR',
      'valid_pixels',
      'selected_pixels',
      'coverage',
    ] as const;
    const content = [
      'timestamp_utc,channel,frame_id,source,source_fingerprint,data_version,method_version,exclude_interpolated,' +
        columns.join(','),
      ...s.profile!.map((p) =>
        [
          s.timestamp,
          frame.channel,
          frame.id,
          s.source,
          s.source_fingerprint,
          s.version,
          s.method_version,
          s.exclude_interpolated,
          ...columns.map((k) => p[k] ?? ''),
        ]
          .map((value) => '"' + String(value).replaceAll('"', '""') + '"')
          .join(','),
      ),
    ].join('\n');
    downloadText(
      `carruthers-${frame.channel}-radial-profile.csv`,
      content,
      'text/csv',
    );
  }
  return (
    <div
      className="panel results-layout"
      role="region"
      aria-label="Observation plots"
      tabIndex={0}
    >
      <section
        className="chart-panel time-chart"
        aria-label="Brightness through time"
        aria-busy={a.busy}
      >
        <div className="chart-header">
          <h3>Radiance & solar / geomagnetic activity</h3>
          {result && <span className="small muted">{result.total} frames</span>}
        </div>
        {result ? (
          <>
            <p className="result-meta">
              {result.recipe.channel} · {roiLabel(result.recipe.roi)}
              <br />
              <span
                className="result-interval"
                title={`${result.recipe.start} – ${result.recipe.end}`}
              >
                {result.recipe.start.slice(5, 16).replace('T', ' ')} –{' '}
                {result.recipe.end.slice(5, 16).replace('T', ' ')} UTC
              </span>
            </p>
            <MeasurementChart
              data={(result.rows || []).map((r) => ({
                x: r.epoch_ms,
                y: r.mean_kR,
                id: r.frame_id,
                coverage: r.coverage,
              }))}
              series={
                result.recipe.roi.kind === 'paired_sectors'
                  ? PAIRED_REGIONS.map(({ id, label, color }) => ({
                      label,
                      color,
                      data: (result.rows || []).map((r) => ({
                        x: r.epoch_ms,
                        y: r.regions?.[id].mean_kR ?? null,
                        id: r.frame_id,
                        coverage: r.regions?.[id].coverage,
                      })),
                    }))
                  : undefined
              }
              time
              baseline={baseline?.mean_kR}
              selected={frame?.epoch_ms}
              onSelect={onSelect}
              label={
                result.recipe.roi.kind === 'paired_sectors'
                  ? 'Dawn and Dusk radiance in kilo-Rayleighs versus reported observation time'
                  : 'Mean selected-region brightness in kilo-Rayleighs versus reported observation time'
              }
            />
            <div className="baseline-label" title={baseline?.definition}>
              <i />
              {baseline?.mean_kR != null
                ? `Baseline ${fmt(baseline.mean_kR)} kR · first-frame FOV mean`
                : baselineError
                  ? 'Baseline unavailable'
                  : 'Loading first-frame baseline…'}
            </div>
            <ContextChart
              kind="symh"
              start={result.recipe.start}
              end={result.recipe.end}
              domain={[
                result.rows?.[0]?.epoch_ms ?? Date.parse(result.recipe.start),
                result.rows?.at(-1)?.epoch_ms ?? Date.parse(result.recipe.end),
              ]}
              selected={frame?.epoch_ms}
            />
            <ContextChart
              kind="lyman"
              start={result.recipe.start}
              end={result.recipe.end}
              domain={[
                result.rows?.[0]?.epoch_ms ?? Date.parse(result.recipe.start),
                result.rows?.at(-1)?.epoch_ms ?? Date.parse(result.recipe.end),
              ]}
              selected={frame?.epoch_ms}
            />
            <p className="small muted plot-legend">
              {result.recipe.exclude_interpolated
                ? 'Interpolated pixels excluded'
                : 'Interpolated pixels included'}{' '}
              · orange &lt;80% coverage · no error bars
            </p>
            <div className="action-row">
              <button
                className="button"
                onClick={() => exportAnalysis(result, 'csv')}
              >
                <Download />
                CSV
              </button>
              <button
                className="button"
                onClick={() => exportAnalysis(result, 'json')}
                aria-label="Download data and recipe as JSON"
                title="Download data and recipe as JSON"
              >
                <Download />
                JSON
              </button>
              <button
                className="button"
                onClick={() => void a.save()}
                disabled={a.resultSaved}
                aria-label={
                  a.resultSaved
                    ? 'Analysis saved locally'
                    : 'Save analysis locally'
                }
                title={
                  a.resultSaved
                    ? 'Analysis saved locally'
                    : 'Save analysis locally'
                }
              >
                <Save />
                {a.resultSaved ? 'Saved' : 'Save'}
              </button>
            </div>
          </>
        ) : (
          <div className="chart-empty">
            {a.busy
              ? 'Updating brightness for your selection…'
              : a.phase === 'cancelled'
                ? 'Time plot paused. Run analysis when ready.'
                : a.phase === 'error'
                  ? 'Unable to update. Choose Analyze to retry.'
                  : 'Choose a valid region and observation interval.'}
            <br />
            {a.busy
              ? 'The time plot will appear automatically.'
              : 'Choose Analyze at the top right of the image.'}
          </div>
        )}
      </section>
      <section
        className="chart-panel profile-chart"
        aria-label="Radial brightness profile"
      >
        <div className="chart-header">
          <h3>Radiance / Rᴇ</h3>
          <button
            className="button ghost"
            disabled={!a.sample?.profile}
            onClick={exportProfile}
          >
            <Download />
            CSV
          </button>
        </div>
        {a.sample?.profile ? (
          <>
            <MeasurementChart
              data={a.sample.profile.map((p) => ({
                x: p.radius_re,
                y: p.mean_kR,
                coverage: p.coverage,
              }))}
              logarithmic
              baseline={baseline?.mean_kR}
              label="Current-frame brightness averaged in full annuli versus projected distance from Earth"
            />
            <p className="small muted plot-legend">
              Current frame · full annuli. Dashed gold: first-frame FOV mean.
              {baseline?.mean_kR != null && baseline.mean_kR <= 0
                ? ' Nonpositive baseline cannot appear on a log axis.'
                : ''}
            </p>
          </>
        ) : (
          <div className="chart-empty">
            Pause on a frame to inspect brightness versus distance.
          </div>
        )}
      </section>
    </div>
  );
}
