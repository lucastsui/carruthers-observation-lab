'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/research';
import type { Baseline, ContextSeries, Frame } from '@/lib/research';
export function useBaseline(first: Frame | undefined, exclude: boolean) {
  const fid = first?.id;
  const key = `${fid}:${exclude}`;
  const [state, setState] = useState<{
    key: string;
    value?: Baseline;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!fid) return;
    const controller = new AbortController();
    api<Baseline>(
      `baseline?id=${fid}&exclude=${exclude ? 1 : 0}`,
      undefined,
      controller.signal,
    )
      .then((value) => setState({ key, value }))
      .catch((e) => {
        if (e.name !== 'AbortError') setState({ key, error: e.message });
      });
    return () => controller.abort();
  }, [key, fid, exclude]);
  return state?.key === key ? state : null;
}
export function useContextSeries(
  kind: 'dst' | 'lyman',
  start: string | undefined,
  end: string | undefined,
) {
  const [revision, setRevision] = useState(0);
  const key = `${kind}:${start?.slice(0, 10)}:${end?.slice(0, 10)}:${revision}`;
  const [state, setState] = useState<{
    key: string;
    value?: ContextSeries;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!start || !end) return;
    const controller = new AbortController();
    api<ContextSeries>(
      `context?kind=${kind}&start=${start.slice(0, 10)}&end=${end.slice(0, 10)}`,
      undefined,
      controller.signal,
    )
      .then((value) => setState({ key, value }))
      .catch((e) => {
        if (e.name !== 'AbortError') setState({ key, error: e.message });
      });
    return () => controller.abort();
  }, [key, kind, start, end]);
  return {
    state: state?.key === key ? state : null,
    retry: () => setRevision((v) => v + 1),
  };
}
