'use client';
import { MAX_LOG_R, radianceLabel, radianceTicks } from '@/lib/display';
import type { ContourMode } from '@/lib/display';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

export function DisplayControls({
  zoom,
  setZoom,
  contours,
  setContours,
  scale,
  onScaleChange,
  onScaleCommit,
  onReset,
}: {
  zoom: string;
  setZoom: (value: string) => void;
  contours: ContourMode;
  setContours: (value: ContourMode) => void;
  scale: [number, number];
  onScaleChange: (value: [number, number]) => void;
  onScaleCommit: (value: [number, number]) => void;
  onReset: () => void;
}) {
  function update(value: number | readonly number[], commit = false) {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      !value.every(Number.isFinite) ||
      value[0] < 1 ||
      value[1] > MAX_LOG_R + 1e-8 ||
      value[0] >= value[1]
    )
      return;
    const next: [number, number] = [value[0], value[1]];
    if (commit) onScaleCommit(next);
    else onScaleChange(next);
  }
  return (
    <section className="display-settings" aria-labelledby="display-heading">
      <div className="control-heading">
        <h2 id="display-heading">Display</h2>
        <Select value={zoom} onValueChange={(v) => setZoom(v || '1')}>
          <SelectTrigger aria-label="Image zoom">
            <SelectValue>
              {zoom === '1' ? 'Full frame' : `${zoom}× zoom`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {['1', '2', '4', '8'].map((v) => (
              <SelectItem key={v} value={v}>
                {v === '1' ? 'Full frame' : `${v}× zoom`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="contour-control">
        <span>Contours</span>
        <Select
          value={contours}
          onValueChange={(v) => setContours((v || 'radiance') as ContourMode)}
        >
          <SelectTrigger aria-label="Contour quantity">
            <SelectValue>
              {contours === 'radiance'
                ? 'Radiance · kR'
                : contours === 're'
                  ? 'Radius · Rᴇ'
                  : 'None'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="radiance">Radiance · kR</SelectItem>
            <SelectItem value="re">Radius · Rᴇ</SelectItem>
            <SelectItem value="none">None</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="scale-heading">
        <span id="brightness-scale-label">Radiance · kR</span>
        <button
          className="button ghost"
          onClick={onReset}
          title="Restore default brightness limits for the selected camera"
        >
          Reset scale
        </button>
      </div>
      <div className="scale-values mono" aria-hidden="true">
        <span>Min {radianceLabel(10 ** scale[0] / 1000)}</span>
        <span>Max {radianceLabel(10 ** scale[1] / 1000)}</span>
      </div>
      <Slider
        className="brightness-slider"
        aria-labelledby="brightness-scale-label"
        min={1}
        max={MAX_LOG_R}
        step={0.01}
        largeStep={1}
        minStepsBetweenValues={2}
        thumbCollisionBehavior="none"
        value={scale}
        onValueChange={(v) => update(v)}
        onValueCommitted={(v) => update(v, true)}
        format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
      />
      <div className="slider-scale-ticks" aria-hidden="true">
        {radianceTicks(1, MAX_LOG_R)
          .filter(
            (t) =>
              [0.01, 0.1, 1, 10].some((v) => Math.abs(v - t.value) < 1e-8) ||
              t.fraction === 1,
          )
          .map((t) => (
            <span key={t.value} style={{ left: `${t.fraction * 100}%` }}>
              {radianceLabel(t.value)}
            </span>
          ))}
      </div>
      <p className="small muted scale-help">
        Image colors only; values unchanged.
      </p>
    </section>
  );
}
