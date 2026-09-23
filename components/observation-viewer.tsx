'use client';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Info } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { Frame, ROI, Contours } from '@/lib/research';
import {
  api,
  roiError,
  snapPointToPixel,
  pairedSectors,
  pairedOpeningAngle,
  isPairedROI,
  pairedAnnularFromDrag,
  pairedAnnularCorners,
  pairedAnnularDragAnchor,
} from '@/lib/research';

import { radianceTicks, radianceLabel } from '@/lib/display';
import type { ContourMode } from '@/lib/display';

export function ObservationViewer({
  actions,
  frame,
  image,
  interactive,
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
  image: HTMLImageElement | null;
  interactive: boolean;
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
    contourFailure === contourKey ? 'Brightness contours unavailable' : '';
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
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const drag = useRef<{ origin: [number, number] } | null>(null),
    lastWheel = useRef(0);
  const loaded = !!image;
  const size = frame.shape[1],
    span = size / zoom,
    cx = frame.earth_xy[0],
    cy = frame.earth_xy[1],
    left = (size - span) / 2,
    top = (frame.shape[0] - span) / 2;
  const p = frame.pixels_per_re;
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#080e15';
    ctx.fillRect(0, 0, size, size);
    if (loaded && image) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, left, top, span, span, 0, 0, size, size);
      onReady(frame.id);
    }
  }, [image, loaded, size, left, top, span, frame.id, onReady]);
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
    if (roi.kind === 'paired_annular_sectors') {
      const bounds = pairedAnnularFromDrag(a, b);
      if (bounds) onROI({ ...roi, ...bounds });
    } else if (roi.kind === 'rectangle')
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
  // Keep paired handles and labels the same visible size for both camera rasters.
  const pairedMarkScale = span / 512;
  const paired =
    validROI && isPairedROI(roi)
      ? pairedSectors(
          roi.kind === 'paired_sectors' ? { ...roi, outer: fullRadius } : roi,
        )
      : [];
  const corners =
    validROI && roi.kind === 'paired_annular_sectors'
      ? pairedAnnularCorners(roi)
      : [];
  function edgePoint(degrees: number, inset = 0) {
    const dx = Math.cos((degrees * Math.PI) / 180),
      dy = -Math.sin((degrees * Math.PI) / 180);
    const pad = inset * pairedMarkScale;
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
            if (!loaded || !interactive) return;
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            const origin = position(e);
            drag.current = {
              origin:
                roi.kind === 'paired_annular_sectors' && validROI
                  ? pairedAnnularDragAnchor(
                      roi,
                      origin,
                      (10 * span) /
                        e.currentTarget.getBoundingClientRect().width /
                        p,
                    )
                  : origin,
            };
            if (roi.kind === 'point') update(origin, origin);
          }}
          onPointerMove={(e) => {
            if (!interactive) {
              drag.current = null;
              return;
            }
            const xy = position(e);
            setCursor(xy);
            if (drag.current) update(drag.current.origin, xy);
          }}
          onPointerUp={(e) => {
            if (drag.current && interactive) {
              update(drag.current.origin, position(e));
            }
            drag.current = null;
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
                  strokeWidth={1.5 * pairedMarkScale}
                >
                  <path
                    d={sectorPath(
                      sector.angle_start,
                      sector.angle_end,
                      sector.inner,
                      sector.outer,
                    )}
                    fillOpacity=".15"
                  />
                  {roi.kind === 'paired_sectors' &&
                    [sector.angle_start, sector.angle_end].map((angle) => (
                      <circle
                        key={angle}
                        cx={edgePoint(angle, 7)[0]}
                        cy={edgePoint(angle, 7)[1]}
                        r={5 * pairedMarkScale}
                        fill="#101e27"
                        strokeWidth={2 * pairedMarkScale}
                      />
                    ))}
                  {corners
                    .filter((corner) => corner.id === id)
                    .map(({ point }, i) => (
                      <circle
                        key={i}
                        data-corner={i}
                        cx={vx(point[0])}
                        cy={vy(point[1])}
                        r={5 * pairedMarkScale}
                        fill="#101e27"
                        strokeWidth={2 * pairedMarkScale}
                      />
                    ))}
                  <text
                    x={
                      roi.kind === 'paired_sectors'
                        ? edgePoint(center, 32)[0]
                        : vx(
                            ((sector.inner + sector.outer) / 2) *
                              Math.cos(
                                (((sector.angle_start + sector.angle_end) / 2) *
                                  Math.PI) /
                                  180,
                              ),
                          )
                    }
                    y={
                      roi.kind === 'paired_sectors'
                        ? cy + 0.5 - 7 * pairedMarkScale
                        : vy(
                            ((sector.inner + sector.outer) / 2) *
                              Math.sin(
                                (((sector.angle_start + sector.angle_end) / 2) *
                                  Math.PI) /
                                  180,
                              ),
                          )
                    }
                    textAnchor="middle"
                    fontSize={12 * pairedMarkScale}
                    stroke="#080e15"
                    strokeWidth={3 * pairedMarkScale}
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
          {loaded && interactive && cursor && (
            <span className="stage-status mono">
              x {cursor[0].toFixed(2)} · y {cursor[1].toFixed(2)} Rᴇ
            </span>
          )}
        </div>
        <div className="image-orientation">
          <div className="north-indicator">
            <span className="north-arrow" aria-hidden="true">
              ↑
            </span>
            <Popover>
              <PopoverTrigger
                className="north-info"
                aria-label="Why does the arrow point to ecliptic north?"
              >
                <Info aria-hidden="true" />
              </PopoverTrigger>
              <PopoverContent className="north-explanation" align="start">
                <PopoverTitle>Why ecliptic north?</PopoverTitle>
                <PopoverDescription>
                  Ecliptic north (GSE +Z) is perpendicular to Earth’s orbital
                  plane. It is different from Earth’s geographic or magnetic
                  north.
                </PopoverDescription>
                <p>
                  Section 8 of the Carruthers calibration paper specifies that
                  registered images place projected ecliptic north upward,
                  toward decreasing row numbers. CEDA preserves this row order.
                </p>
                <p>
                  The NetCDF headers provide camera and spacecraft attitudes,
                  but do not explicitly label the image “north up.” This arrow
                  marks the documented registration convention: our geometry
                  check of all 1,794 March 2026 frames found differences of up
                  to 2.2° from vertical, so exact alignment remains unverified.
                </p>
                <a
                  href="https://arxiv.org/html/2606.21606v1#S8"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Read the calibration paper · Section 8
                </a>
              </PopoverContent>
            </Popover>
            <span className="north-label">Ecliptic north</span>
          </div>
        </div>
        {actions && <div className="image-actions">{actions}</div>}
      </div>
      <div className="colorbar">
        <img
          src="/api/colorbar"
          alt="Logarithmic heat color scale from black through red to white"
        />
        <div className="radiance-ticks" aria-label="Brightness scale markings">
          {radianceTicks(...scale).map((t) => (
            <span key={t.value} style={{ left: `${t.fraction * 100}%` }}>
              {radianceLabel(t.value)}
            </span>
          ))}
        </div>
        <div className="colorbar-caption">
          Brightness · kR{' '}
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
