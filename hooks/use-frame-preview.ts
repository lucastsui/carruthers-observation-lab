'use client';
import { useEffect, useMemo, useState } from 'react';
import { framePreviews, framePreviewKey, type FrameAssets } from '@/lib/frame-previews';
import type { Frame } from '@/lib/research';
import type { ContourMode } from '@/lib/display';

type Preview = FrameAssets & {
  frame: Frame;
  scale: [number, number];
  key: string;
  contours: ContourMode;
  exclude: boolean;
};

/** Swap pixels, contours, geometry and scale in one render once all assets are ready. */
export function useFramePreview(frame: Frame | undefined, scale: [number, number], contours: ContourMode, exclude: boolean) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = frame ? framePreviewKey(frame, scale, contours, exclude) : '';
  const request = useMemo(() => ({ frame, scale, key, contours, exclude, attempt }), [frame, scale, key, contours, exclude, attempt]);
  const [failure, setFailure] = useState<typeof request | null>(null);
  const [waitingFor, setWaitingFor] = useState<typeof request | null>(null);
  useEffect(() => {
    const { frame, scale, key, contours, exclude } = request;
    if (!frame) return;
    let active = true;
    // Short cached transitions should not flash a loading badge either.
    const timer = setTimeout(() => setWaitingFor(request), 200);
    void framePreviews.get(key).then((assets) => {
      if (active) {
        setPreview({ frame, scale, key, contours, exclude, ...assets });
        setFailure(null);
      }
    }).catch(() => {
      if (active) setFailure(request);
    }).finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [request]);
  const pending = !!frame && (preview?.key !== key || preview?.contours !== contours);
  const error = pending && failure === request;
  const message = error
    ? 'Selected image or contours could not load.'
    : pending && (!preview || waitingFor === request)
      ? 'Loading selected frame…'
      : '';
  return { preview, pending, message, error, retry: () => setAttempt((value) => value + 1) };
}
