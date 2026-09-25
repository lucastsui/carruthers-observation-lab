'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FrameSlider } from '@/components/frame-slider';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { CollectionDialog } from '@/components/collection-dialog';
import { ObservationViewer } from '@/components/observation-viewer';
import { DisplayControls } from '@/components/display-controls';
import {
  AnalysisControls,
  AnalysisResults,
} from '@/components/analysis-controls';
import { OrbitViewer } from '@/components/orbit-viewer';
import { DEFAULT_WFI_LOG_R, MAX_LOG_R } from '@/lib/display';
import type { ContourMode } from '@/lib/display';
import { useBaseline } from '@/hooks/use-reference-data';
import { useAnalysis } from '@/hooks/use-analysis';
import { useWorkspaceTools } from '@/hooks/use-workspace-tools';
import { useFramePreview } from '@/hooks/use-frame-preview';
import { previewImages, previewWindowIndices } from '@/lib/preview-images';
import { api, DEFAULT_ROI, previewURL, roiError } from '@/lib/research';
import type { Catalogue, Channel, ROI, Recipe } from '@/lib/research';

export default function Home() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null),
    [error, setError] = useState('');
  const [channel, setChannel] = useState<Channel>('WFI'),
    [start, setStart] = useState('2026-03-15T00:00'),
    [end, setEnd] = useState('2026-03-15T23:59');
  const [index, setIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [ready, setReady] = useState(''),
    [fps, setFPS] = useState('2');
  const [roi, setROI] = useState<ROI>(DEFAULT_ROI),
    [contours, setContours] = useState<ContourMode>('radiance'),
    [viewerMode, setViewerMode] = useState('image'),
    [zoom, setZoom] = useState('1');
  const [scale, setScale] = useState<[number, number]>([DEFAULT_WFI_LOG_R, MAX_LOG_R]),
    [draftScale, setDraftScale] = useState<[number, number]>([DEFAULT_WFI_LOG_R, MAX_LOG_R]);
  const [exclude, setExclude] = useState(true);
  const [compactPanel, setCompactPanel] = useState('viewer');
  const preferredTime = useRef<number | null>(null);
  // Group rapid slider movements; releasing a handle applies its final value immediately.
  useEffect(() => {
    const timer = setTimeout(() => setScale(draftScale), 120);
    return () => clearTimeout(timer);
  }, [draftScale]);
  useEffect(() => {
    api<Catalogue>('catalogue')
      .then(setCatalogue)
      .catch((e) => setError(e.message));
  }, []);
  const frames = useMemo(
    () =>
      catalogue?.frames.filter(
        (f) =>
          f.channel === channel &&
          f.epoch_ms >= Date.parse(start + 'Z') &&
          f.epoch_ms <= Date.parse(end + 'Z') + 59999,
      ) || [],
    [catalogue, channel, start, end],
  );
  const frame = frames[Math.min(index, Math.max(0, frames.length - 1))];
  const { preview, pending: previewPending, message: previewMessage } =
    useFramePreview(frame, scale);
  const displayedFrame = preview?.frame || frame;
  const measurementFrame = frame ? displayedFrame : undefined;
  useEffect(() => {
    setPlaying(false);
    let closest = 0;
    if (preferredTime.current !== null)
      frames.forEach((f, i) => {
        if (
          Math.abs(f.epoch_ms - preferredTime.current!) <
          Math.abs(frames[closest].epoch_ms - preferredTime.current!)
        )
          closest = i;
      });
    setIndex(closest);
  }, [frames]);
  useEffect(() => {
    if (frame) preferredTime.current = frame.epoch_ms;
  }, [frame]);
  useEffect(() => {
    if (playing && frame && ready === frame.id && !previewPending) {
      const t = setTimeout(
        () => setIndex((i) => (i + 1) % frames.length),
        1000 / Number(fps),
      );
      return () => clearTimeout(t);
    }
  }, [playing, frame, ready, frames.length, fps, previewPending]);
  const previewWindow = useMemo(
    () => previewWindowIndices(frames.length, index).map((i) => previewURL(frames[i], scale)),
    [frames, index, scale],
  );
  useEffect(() => {
    previewImages.setPreloadWindow(previewWindow, false);
    // Let the selected frame decode first and debounce rapid scrubbing.
    const timer = previewPending ? undefined : setTimeout(() => {
      previewImages.setPreloadWindow(previewWindow);
    }, 75);
    return () => {
      clearTimeout(timer);
      previewImages.setPreloadWindow([]);
    };
  }, [previewWindow, previewPending]);
  const step = useCallback(
    (n: number) => {
      setPlaying(false);
      setIndex((i) => Math.max(0, Math.min(frames.length - 1, i + n)));
    },
    [frames.length],
  );
  const toggle = useCallback(() => setPlaying((p) => !p), []);
  const changeCamera = (value: Channel) => {
    setChannel(value);
    const next =
      catalogue?.scales[value] || ([DEFAULT_WFI_LOG_R, MAX_LOG_R] as [number, number]);
    setScale(next);
    setDraftScale(next);
  };
  const baseline = useBaseline(frames[0], exclude);
  const analysis = useAnalysis(measurementFrame, frames, roi, exclude, playing);
  const changeROI = useCallback((r: ROI) => {
    setPlaying(false);
    setROI(r);
  }, []);
  const restoreRecipe = (recipe: Recipe) => {
    setPlaying(false);
    if (channel !== recipe.channel) changeCamera(recipe.channel);
    setStart(recipe.start.slice(0, 16));
    setEnd(recipe.end.slice(0, 16));
    setROI({ ...DEFAULT_ROI, ...recipe.roi });
    setExclude(recipe.exclude_interpolated);
  };
  const selectFrame = (id: string) => {
    const f = catalogue?.frames.find((item) => item.id === id);
    if (!f) return;
    setCompactPanel('viewer');
    preferredTime.current = f.epoch_ms;
    setPlaying(false);
    const i = frames.findIndex((item) => item.id === id);
    if (i >= 0) setIndex(i);
    else if (analysis.result) restoreRecipe(analysis.result.recipe);
  };
  const invalidDates =
    !start || !end || Date.parse(start + 'Z') > Date.parse(end + 'Z');
  useWorkspaceTools({
    channel,
    interval: { start_utc: start, end_utc: end },
    frame_count: frames.length,
    frame: measurementFrame
      ? { id: measurementFrame.id, timestamp: measurementFrame.timestamp }
      : null,
    selection: roi,
    exclude_interpolated: exclude,
    measurement: analysis.sample
      ? { mean_kR: analysis.sample.mean_kR, coverage: analysis.sample.coverage }
      : null,
    extraction: analysis.job
      ? {
          status: analysis.job.status,
          completed: analysis.job.completed,
          total: analysis.job.total,
        }
      : null,
  });
  const analyzeButton = (
    <button
      className="button primary image-analyze-button"
      onClick={analysis.retry}
      disabled={
        !frames.length ||
        previewPending ||
        !!roiError(roi) ||
        analysis.busy ||
        analysis.phase === 'complete'
      }
      title={
        analysis.phase === 'complete'
          ? 'This selection has been analyzed.'
          : 'Analyze the selected region through time'
      }
    >
      <Activity aria-hidden="true" />
      {analysis.busy ? 'Analyzing…' : 'Analyze'}
    </button>
  );
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <h1>Carruthers Exploratory Data Analysis (CEDA)</h1>
        </div>
        <div className="header-actions">
          {catalogue && (
            <CollectionDialog
              catalogue={catalogue}
              a={analysis}
              onRestore={restoreRecipe}
            />
          )}
        </div>
      </header>
      {!catalogue ? (
        <main className="empty-page">
          <h2>
            {error
              ? 'Unable to open observations'
              : 'Reading observation catalogue…'}
          </h2>
          <p className="muted">
            {error || 'Preparing the local March 2026 collection.'}
          </p>
        </main>
      ) : (
        <>
          <section
            className="observation-bar"
            aria-label="Observation interval"
          >
            <Tabs
              value={channel}
              onValueChange={(v) => changeCamera(v as Channel)}
              className="selection-tabs"
            >
              <TabsList aria-label="Camera">
                <TabsTrigger value="WFI">WFI</TabsTrigger>
                <TabsTrigger value="NFI">NFI</TabsTrigger>
              </TabsList>
            </Tabs>
            <label className="field">
              From · UTC
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="field">
              Through · UTC
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
            <p className="small muted">{frames.length} frames selected</p>
            {invalidDates && (
              <p className="status error">
                Enter a valid interval, with the end after the start.
              </p>
            )}
            <button
              className="button ghost"
              onClick={() => {
                setStart('2026-03-01T00:00');
                setEnd('2026-03-31T23:59');
              }}
            >
              All of March
            </button>
          </section>

          <Tabs
            className="compact-nav"
            value={compactPanel}
            onValueChange={(v) => setCompactPanel(String(v))}
          >
            <TabsList aria-label="Workspace panel">
              <TabsTrigger value="viewer">Viewer</TabsTrigger>
              <TabsTrigger value="controls">Controls</TabsTrigger>
              <TabsTrigger value="results">Results</TabsTrigger>
            </TabsList>
          </Tabs>
          <main className="workspace" data-panel={compactPanel}>
            <aside
              className="left-column"
              aria-label="Measurement and display controls"
            >
              <AnalysisControls
                a={analysis}
                frame={measurementFrame}
                count={frames.length}
                roi={roi}
                setROI={changeROI}
                exclude={exclude}
                setExclude={setExclude}
                playing={playing}
                displayControls={
                  <DisplayControls
                    zoom={zoom}
                    setZoom={setZoom}
                    contours={contours}
                    setContours={setContours}
                    scale={draftScale}
                    onScaleChange={(value) => {
                      setPlaying(false);
                      setDraftScale(value);
                    }}
                    onScaleCommit={(value) => {
                      setPlaying(false);
                      setDraftScale(value);
                      setScale(value);
                    }}
                    onReset={() => {
                      const value = catalogue.scales[channel];
                      setPlaying(false);
                      setScale(value);
                      setDraftScale(value);
                    }}
                  />
                }
              />
            </aside>
            <section className="center-column">
              {analysis.error && (
                <p className="status error workspace-error" role="alert">
                  {analysis.error}{' '}
                  <button
                    className="button ghost"
                    onClick={analysis.clearError}
                  >
                    Dismiss
                  </button>
                </p>
              )}
              {frame ? (
                <>
                  <div className="panel viewer-panel">
                    <div className="viewer-head">
                      <div>
                        <div className="eyebrow">{displayedFrame.channel} observation</div>
                        <div className="time mono">
                          {displayedFrame.timestamp
                            .replace('T', ' · ')
                            .replace('Z', ' UTC')}
                        </div>
                      </div>
                      <Tabs
                        value={viewerMode}
                        onValueChange={(v) => setViewerMode(String(v))}
                      >
                        <TabsList aria-label="Observation view">
                          <TabsTrigger value="image">2D image</TabsTrigger>
                          <TabsTrigger value="orbit">3D orbit</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>
                    <div className="viewer-body" aria-busy={previewPending}>
                      {viewerMode === 'orbit' ? (
                        <OrbitViewer
                          actions={analyzeButton}
                          frame={displayedFrame}
                          frames={catalogue.frames}
                          image={preview?.image || null}
                          onReady={setReady}
                        />
                      ) : (
                        <ObservationViewer
                          actions={analyzeButton}
                          frame={displayedFrame}
                          image={preview?.image || null}
                          interactive={!previewPending}
                          scale={preview?.scale || scale}
                          roi={roi}
                          contours={contours}
                          exclude={exclude}
                          zoom={Number(zoom)}
                          onROI={changeROI}
                          onStep={step}
                          onTogglePlay={toggle}
                          onReady={setReady}
                        />
                      )}
                      {previewMessage && (
                        <output className="preview-status">
                          {previewMessage}
                          {preview && ' Current image retained.'}
                        </output>
                      )}
                    </div>
                  </div>
                  <div className="transport panel">
                    <div className="transport-row">
                      <button
                        className="button icon primary"
                        aria-label={playing ? 'Pause' : 'Play frames'}
                        onClick={toggle}
                        disabled={frames.length < 2}
                      >
                        {playing ? <Pause /> : <Play />}
                      </button>
                      <button
                        className="button icon"
                        aria-label="Previous frame"
                        onClick={() => step(-1)}
                        disabled={index === 0}
                      >
                        <ChevronLeft />
                      </button>
                      <div className="transport-slider">
                        <FrameSlider
                          frames={frames}
                          scale={scale}
                          index={index}
                          onChange={(next) => {
                            setPlaying(false);
                            setIndex(next);
                          }}
                        />
                      </div>
                      <button
                        className="button icon"
                        aria-label="Next frame"
                        onClick={() => step(1)}
                        disabled={index === frames.length - 1}
                      >
                        <ChevronRight />
                      </button>
                      <span className="small mono">
                        {index + 1}/{frames.length}
                      </span>
                      <Select
                        value={fps}
                        onValueChange={(v) => setFPS(v || '2')}
                      >
                        <SelectTrigger aria-label="Playback speed">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {['1', '2', '4', '8'].map((v) => (
                            <SelectItem key={v} value={v}>
                              {v} fps
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="transport-note">
                      <span>Click image, then scroll or use ← →</span>
                      <span>Playback rate ≠ observation cadence</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="panel chart-empty">
                  No observations in this interval. Choose dates in March 2026.
                </div>
              )}
            </section>
            <aside className="right-column" aria-label="Brightness results">
              <AnalysisResults
                a={analysis}
                frame={measurementFrame}
                onSelect={selectFrame}
                baseline={baseline?.value}
                baselineError={baseline?.error}
              />
            </aside>
          </main>
        </>
      )}
      {analysis.notice && (
        <div className="status toast" role="status">
          {analysis.notice}
        </div>
      )}
    </div>
  );
}
