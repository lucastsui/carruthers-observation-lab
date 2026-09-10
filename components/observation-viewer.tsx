'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Frame, ROI, Contours } from '@/lib/research';
import {
  api,
  previewURL,
  roiError,
  snapPointToPixel,
  pairedSectors,
  pairedOpeningAngle,
} from '@/lib/research';

import { radianceTicks, radianceLabel } from '@/lib/display';
import type { ContourMode } from '@/lib/display';

export function ObservationViewer({
  actions,
  frame,
  scale,
  roi,
  contours,
  exclude,
  zoom,
  onROI,
  onStep,
  onTogglePlay,
  onReady,
}: {
  actions?: ReactNode;
  frame: Frame;
  scale: [number, number];
  roi: ROI;
  contours: ContourMode;
  exclude: boolean;
  zoom: number;
  onROI: (r: ROI) => void;
  onStep: (n: number) => void;
  onTogglePlay: () => void;
  onReady: (id: string) => void;
}) {
  const [isolines, setIsolines] = useState<{
    key: string;
    value: Contours;
  } | null>(null);
  const [contourFailure, setContourFailure] = useState<string | null>(null);
  const contourKey = `${frame.id}:${exclude}`;
  const contourError =
    contourFailure === contourKey ? 'Radiance contours unavailable' : '';
  useEffect(() => {
    if (contours !== 'radiance') return;
    const controller = new AbortController();
    api<Contours>(
      `contours?id=${frame.id}&exclude=${exclude ? 1 : 0}`,
      undefined,
      controller.signal,
    )
      .then((value) => {
        setIsolines({ key: contourKey, value });
        setContourFailure(null);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setContourFailure(contourKey);
      });
    return () => controller.abort();
  }, [contourKey, contours, frame.id, exclude]);
  const canvas = useRef<HTMLCanvasElement>(null),
    stage = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<{
      id: string;
      url: string;
      image: HTMLImageElement;
    } | null>(null),
    [error, setError] = useState('');
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const drag = useRef<{ origin: [number, number]; angle: boolean } | null>(
      null,
    ),
    lastWheel = useRef(0);
  const url = previewURL(frame, scale),
    loaded = image?.url === url;
  const size = frame.shape[1],
    span = size / zoom,
    cx = frame.earth_xy[0],
    cy = frame.earth_xy[1],
    left = (size - span) / 2,
    top = (frame.shape[0] - span) / 2;
  const p = frame.pixels_per_re;
  useEffect(() => {
    let active = true;
    setError('');
    const im = new Image();
    im.onload = () => {
      if (active) {
        setImage({ id: frame.id, url, image: im });
        onReady(frame.id);
      }
    };
    im.onerror = () => {
      if (active)
        setError(
          'Frame could not load. Check the local service and display limits.',
        );
    };
    im.src = url;
    return () => {
      active = false;
      im.onload = null;
      im.onerror = null;
    };
  }, [url, frame.id, onReady]);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#080e15';
    ctx.fillRect(0, 0, size, size);
    if (loaded && image) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image.image, left, top, span, span, 0, 0, size, size);
    }
  }, [image, loaded, size, left, top, span]);
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const wheel = (e: WheelEvent) => {
      if (document.activeElement !== node) return;
      e.preventDefault();
      if (Date.now() - lastWheel.current > 110) {
        onStep(e.deltaY > 0 ? 1 : -1);
        lastWheel.current = Date.now();
      }
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [onStep]);
  function position(e: React.PointerEvent<HTMLDivElement>): [number, number] {
    const b = e.currentTarget.getBoundingClientRect();
    return [
      (left + ((e.clientX - b.left) / b.width) * span - 0.5 - cx) / p,
      (cy - (top + ((e.clientY - b.top) / b.height) * span - 0.5)) / p,
    ];
  }
  function update(a: [number, number], b: [number, number]) {
    if (roi.kind === 'paired_sectors') {
      onROI({ ...roi, angle_width: pairedOpeningAngle(...b) });
      return;
    }
    if (
      roi.kind !== 'point' &&
      Math.hypot(a[0] - b[0], a[1] - b[1]) * p * zoom < 2
    )
      return;
    const round = (x: number) => Math.round(x * 100) / 100;
    if (roi.kind === 'rectangle')
      onROI({
        ...roi,
        x1: round(Math.min(a[0], b[0])),
        x2: round(Math.max(a[0], b[0])),
        y1: round(Math.min(a[1], b[1])),
        y2: round(Math.max(a[1], b[1])),
      });
    else if (roi.kind === 'point')
      onROI({ ...roi, ...snapPointToPixel(frame, b[0], b[1]) });
    else {
      const r1 = Math.hypot(...a),
        r2 = Math.hypot(...b);
      onROI({
        ...roi,
        inner: round(Math.min(r1, r2)),
        outer: round(Math.max(r1, r2)),
      });
    }
  }
  const validROI = !roiError(roi);
  const vx = (x: number) => cx + x * p + 0.5,
    vy = (y: number) => cy - y * p + 0.5;
  let selection = null;
  if (validROI && roi.kind === 'rectangle')
    selection = (
      <rect
        x={vx(roi.x1)}
        y={vy(roi.y2)}
        width={(roi.x2 - roi.x1) * p}
        height={(roi.y2 - roi.y1) * p}
      />
    );
  if (validROI && roi.kind === 'point') {
    const x = Math.floor(cx + roi.x * p + 0.5) + 0.5,
      y = Math.floor(cy - roi.y * p + 0.5) + 0.5;
    selection = (
      <>
        <rect x={x - 0.5} y={y - 0.5} width={1} height={1} />
        <path
          d={`M ${x - 6 / zoom} ${y} h ${12 / zoom} M ${x} ${y - 6 / zoom} v ${12 / zoom}`}
          fill="none"
        />
      </>
    );
  }
  function sectorPath(
    start: number,
    end: number,
    innerRadius = roi.inner,
    outerRadius = roi.outer,
  ) {
    const segments = Math.max(3, Math.ceil((end - start) / 3));
    const angles = Array.from(
      { length: segments + 1 },
      (_, i) => start + ((end - start) * i) / segments,
    );
    const ring = (radius: number, a: number) => [
      vx(radius * Math.cos((a * Math.PI) / 180)),
      vy(radius * Math.sin((a * Math.PI) / 180)),
    ];
    return `M ${[...angles.map((a) => ring(outerRadius, a)), ...angles.reverse().map((a) => ring(innerRadius, a))].map((xy) => xy.join(' ')).join(' L ')} Z`;
  }
  const fullRadius =
    (2 *
      Math.hypot(
        Math.max(Math.abs(cx + 0.5), Math.abs(frame.shape[1] - cx - 0.5)),
        Math.max(Math.abs(cy + 0.5), Math.abs(frame.shape[0] - cy - 0.5)),
      )) /
    p;
  const paired =
    validROI && roi.kind === 'paired_sectors'
      ? pairedSectors({ ...roi, outer: fullRadius })
      : [];
  function edgePoint(degrees: number, inset = 0) {
    const dx = Math.cos((degrees * Math.PI) / 180),
      dy = -Math.sin((degrees * Math.PI) / 180);
    const pad = inset / zoom;
    const tx =
      Math.abs(dx) < 1e-10
        ? Infinity
        : ((dx > 0 ? left + span - pad : left + pad) - cx - 0.5) / dx;
    const ty =
      Math.abs(dy) < 1e-10
        ? Infinity
        : ((dy > 0 ? top + span - pad : top + pad) - cy - 0.5) / dy;
    const distance = Math.max(0, Math.min(tx, ty));
    return [cx + 0.5 + dx * distance, cy + 0.5 + dy * distance];
  }
  if (validROI && (roi.kind === 'annulus' || roi.kind === 'sector')) {
    selection = (
      <path
        d={sectorPath(
          roi.kind === 'annulus' ? 0 : roi.angle_start,
          roi.kind === 'annulus' ? 360 : roi.angle_end,
        )}
      />
    );
  }
  return (
    <>
      <div className="image-viewport">
        <div
          ref={stage}
          className="image-stage"
          role="group"
          tabIndex={0}
          aria-label="Observation image. Left and right arrows or scroll select frames. Space plays. Drag to select a region."
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              onStep(e.key === 'ArrowRight' ? 1 : -1);
            }
            if (e.code === 'Space') {
              e.preventDefault();
              onTogglePlay();
            }
          }}
          onPointerDown={(e) => {
            if (!loaded) return;
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            const origin = position(e);
            drag.current = {
              origin,
              angle: roi.kind === 'paired_sectors',
            };
            if (roi.kind === 'point') update(origin, origin);
          }}
          onPointerMove={(e) => {
            const xy = position(e);
            setCursor(xy);
            if (drag.current) update(drag.current.origin, xy);
          }}
          onPointerUp={(e) => {
            if (drag.current) {
              update(drag.current.origin, position(e));
              drag.current = null;
            }
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onPointerLeave={() => setCursor(null)}
        >
          <canvas
            ref={canvas}
            width={size}
            height={size}
            aria-label={`${frame.channel} brightness at ${frame.timestamp}`}
          />
          {loaded && (
            <svg viewBox={`${left} ${top} ${span} ${span}`} aria-hidden="true">
              <g
                stroke="#a4d9e8"
                fill="none"
                opacity=".6"
                strokeWidth={0.75 / zoom}
              >
                {contours === 're' &&
                  (frame.channel === 'WFI'
                    ? [5, 10, 20, 30, 40]
                    : [2, 5, 8]
                  ).map((r) => (
                    <g key={r}>
                      <circle cx={cx + 0.5} cy={cy + 0.5} r={r * p} />
                      <text
                        x={cx + 0.5 + r * p + 3 / zoom}
                        y={cy - 4 / zoom}
                        fill="#bddce6"
                        stroke="none"
                        fontSize={10 / zoom}
                      >
                        {r} Rᴇ
                      </text>
                    </g>
                  ))}
                <path
                  d={`M ${cx + 0.5 - 5 / zoom} ${cy + 0.5} h ${10 / zoom} M ${cx + 0.5} ${cy + 0.5 - 5 / zoom} v ${10 / zoom}`}
                  opacity="1"
                />
              </g>
              {contours === 'radiance' && isolines?.key === contourKey && (
                <g
                  fill="none"
                  stroke="#ffe5a4"
                  strokeWidth={0.8 / zoom}
                  opacity=".8"
                >
                  {isolines.value.contours.map((level, levelIndex) => (
                    <g key={level.level_kR}>
                      {level.paths.map((path, i) => (
                        <path
                          key={i}
                          d={`M ${path.map((xy) => xy.join(' ')).join(' L ')}`}
                        />
                      ))}
                      {level.paths
                        .filter((path) => path.length > 30)
                        .slice(0, 1)
                        .map((path, i) => {
                          const [x, y] =
                            path[
                              Math.floor(
                                path.length * ((levelIndex * 0.19 + 0.12) % 1),
                              )
                            ];
                          if (Math.hypot(x - cx, y - cy) * zoom < 30)
                            return null;
                          return (
                            <text
                              key={i}
                              x={x}
                              y={y}
                              fill="#ffe5a4"
                              stroke="#0a111b"
                              strokeWidth={2 / zoom}
                              paintOrder="stroke"
                              fontSize={10 / zoom}
                            >
                              {level.level_kR} kR
                            </text>
                          );
                        })}
                    </g>
                  ))}
                </g>
              )}
              <circle
                cx={cx + 0.5}
                cy={cy + 0.5}
                r={p}
                fill="none"
                stroke="#030b19"
                strokeWidth={4 / zoom}
              />
              <circle
                cx={cx + 0.5}
                cy={cy + 0.5}
                r={p}
                fill="none"
                stroke="#308cff"
                strokeWidth={2.4 / zoom}
              />
              <text
                x={cx + 0.5 + p + 4 / zoom}
                y={cy + 0.5 + 12 / zoom}
                fill="#6baeff"
                stroke="#080e15"
                strokeWidth={2 / zoom}
                paintOrder="stroke"
                fontSize={11 / zoom}
              >
                1 Rᴇ
              </text>
              <g
                fill="#81f5c9"
                fillOpacity=".16"
                stroke="#91f6ce"
                strokeWidth={1.2 / zoom}
              >
                {selection}
              </g>
              {paired.map(({ id, label, center, color, roi: sector }) => (
                <g
                  key={id}
                  data-region={id}
                  stroke={color}
                  fill={color}
                  strokeWidth={1.5 / zoom}
                >
                  <path
                    d={sectorPath(
                      sector.angle_start,
                      sector.angle_end,
                      0,
                      fullRadius,
                    )}
                    fillOpacity=".15"
                  />
                  {[sector.angle_start, sector.angle_end].map((angle) => (
                    <circle
                      key={angle}
                      cx={edgePoint(angle, 7)[0]}
                      cy={edgePoint(angle, 7)[1]}
                      r={5 / zoom}
                      fill="#101e27"
                      strokeWidth={2 / zoom}
                    />
                  ))}
                  <text
                    x={edgePoint(center, 32)[0]}
                    y={cy + 0.5 - 7 / zoom}
                    textAnchor="middle"
                    fontSize={12 / zoom}
                    stroke="#080e15"
                    strokeWidth={3 / zoom}
                    paintOrder="stroke"
                  >
                    {label}
                  </text>
                </g>
              ))}
            </svg>
          )}
          <span className="stage-label">
            {frame.channel} · L1C · {zoom > 1 ? `${zoom}×` : 'FULL FRAME'}
          </span>
          {(!loaded || error) && (
            <span className="stage-status" role="status">
              {error || 'Loading frame…'}
            </span>
          )}
          {loaded && cursor && (
            <span className="stage-status mono">
              x {cursor[0].toFixed(2)} · y {cursor[1].toFixed(2)} Rᴇ
            </span>
          )}
        </div>
        {actions && <div className="image-actions">{actions}</div>}
      </div>
      <div className="colorbar">
        <img
          src="/api/colorbar"
          alt="Logarithmic heat color scale from black through red to white"
        />
        <div className="radiance-ticks" aria-label="Radiance scale markings">
          {radianceTicks(...scale).map((t) => (
            <span key={t.value} style={{ left: `${t.fraction * 100}%` }}>
              {radianceLabel(t.value)}
            </span>
          ))}
        </div>
        <div className="colorbar-caption">
          Radiance · kR{' '}
          <span>
            {contourError ||
              (contours === 'radiance'
                ? 'Contours · kR'
                : contours === 're'
                  ? 'Contours · Rᴇ'
                  : '')}{' '}
            · <b>Blue: 1 Rᴇ</b>
          </span>
        </div>
      </div>
    </>
  );
}
