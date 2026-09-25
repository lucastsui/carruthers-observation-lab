'use client';
import { useId, useMemo, useSyncExternalStore } from 'react';
import { Slider } from '@/components/ui/slider';
import { previewImages } from '@/lib/preview-images';
import { loadedFrameRanges } from '@/lib/loaded-frame-ranges';
import { previewURL, type Frame } from '@/lib/research';

const empty: ReadonlySet<string> = new Set();
const serverSnapshot = () => empty;

export function FrameSlider({ frames, scale, index, onChange }: {
  frames: Frame[];
  scale: [number, number];
  index: number;
  onChange: (index: number) => void;
}) {
  const descriptionId = useId();
  const loaded = useSyncExternalStore(
    previewImages.subscribe, previewImages.getSnapshot, serverSnapshot,
  );
  const urls = useMemo(() => frames.map((frame) => previewURL(frame, scale)), [frames, scale]);
  const ranges = useMemo(() => loadedFrameRanges(urls, loaded), [urls, loaded]);
  const count = ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0);
  return (
    <div className="frame-timeline">
      <Slider
        className="frame-slider"
        aria-label="Selected frame"
        aria-describedby={descriptionId}
        min={0}
        max={Math.max(1, frames.length - 1)}
        step={1}
        thumbAlignment="center"
        value={[index]}
        disabled={frames.length < 2}
        onValueChange={(value) => {
          if (frames.length) onChange(Math.max(0, Math.min(
            frames.length - 1, Array.isArray(value) ? value[0] : value,
          )));
        }}
        trackContent={ranges.map((range) => (
          <span
            key={range.start}
            className="frame-loaded-range"
            data-start={range.start}
            data-end={range.end}
            aria-hidden="true"
            style={{ left: `${range.left}%`, width: `${range.width}%` }}
          />
        ))}
      />
      <span
        id={descriptionId}
        className="frame-loaded-label"
        title="Light sections show frames ready to view at the current brightness scale."
      >
        <span className="frame-loaded-swatch" aria-hidden="true" />
        {count}/{frames.length} loaded
        <span className="sr-only"> at the current brightness scale. Light sections are ready to view.</span>
      </span>
    </div>
  );
}
