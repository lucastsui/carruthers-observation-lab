'use client';
import { useEffect, useMemo, useState } from 'react';
import { previewImages } from '@/lib/preview-images';
import { previewURL, type Frame } from '@/lib/research';

type Preview = {
  frame: Frame;
  scale: [number, number];
  url: string;
  image: HTMLImageElement;
};

/** Publish pixels, geometry and brightness scale together, after decoding. */
export function useFramePreview(frame: Frame | undefined, scale: [number, number]) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const url = frame ? previewURL(frame, scale) : '';
  const request = useMemo(() => ({ frame, scale, url }), [frame, scale, url]);
  const [failure, setFailure] = useState<typeof request | null>(null);
  const [waitingFor, setWaitingFor] = useState<typeof request | null>(null);
  useEffect(() => {
    const { frame, scale, url } = request;
    if (!frame) return;
    let active = true;
    // Short cached transitions should not flash a loading badge either.
    const timer = setTimeout(() => setWaitingFor(request), 200);
    void previewImages.get(url).then((image) => {
      if (active) {
        setPreview({ frame, scale, url, image });
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
  const pending = !!frame && preview?.url !== url;
  const error = pending && failure === request;
  const message = error
    ? 'Selected frame could not load. Choose it again to retry.'
    : pending && (!preview || waitingFor === request)
      ? 'Loading selected frame…'
      : '';
  return { preview, pending, message };
}
