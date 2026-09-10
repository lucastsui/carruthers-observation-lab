'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  activeROI,
  analysisSignature,
  regionSignature,
  roiError,
} from '@/lib/research';
import { AutoAnalysis } from '@/lib/auto-analysis';
import type { AnalysisState } from '@/lib/auto-analysis';
import type { Frame, ROI, Measurement, Job, Saved } from '@/lib/research';

export function useAnalysis(
  frame: Frame | undefined,
  frames: Frame[],
  roi: ROI,
  exclude: boolean,
  playing: boolean,
) {
  const [sample, setSample] = useState<{
      key: string;
      value: Measurement;
    } | null>(null),
    [sampleError, setSampleError] = useState('');
  const [result, setResult] = useState<Job | null>(null),
    [saved, setSaved] = useState<Saved[]>([]);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [savedResultIds, setSavedResultIds] = useState<Set<string>>(
      () => new Set(),
    );
  const worker = useRef<AutoAnalysis | null>(null);
  const [automatic, setAutomatic] = useState<AnalysisState>({
    key: null,
    phase: 'idle',
    job: null,
    error: '',
  });
  const signature = regionSignature(roi, exclude),
    sampleKey = `${frame?.id}:${signature}`;
  // Frame scrubbing/playback does not restart the range calculation.
  const selection = useMemo(
    () =>
      frames.length && !roiError(roi)
        ? {
            frame_ids: frames.map((f) => f.id),
            roi,
            exclude_interpolated: exclude,
          }
        : null,
    [frames, signature],
  );
  const selectionKey = selection ? analysisSignature(selection) : null;
  const phase =
    automatic.key === selectionKey
      ? automatic.phase
      : selection
        ? 'waiting'
        : 'idle';
  const job = automatic.key === selectionKey ? automatic.job : null;
  const busy = phase === 'waiting' || phase === 'running';
  useEffect(() => {
    const coordinator = new AutoAnalysis({
      transport: api,
      onState: setAutomatic,
      onResult: (value) => {
        setResult(value);
      },
    });
    worker.current = coordinator;
    return () => coordinator.dispose();
  }, []);
  useEffect(() => {
    setError('');
    worker.current?.setSelection(selection);
  }, [selectionKey]);
  const refreshSaved = useCallback(
    () =>
      api<Saved[]>('saved')
        .then(setSaved)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void refreshSaved();
  }, [refreshSaved]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    setSampleError('');
    if (!frame || playing || roiError(roi)) return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<Measurement>(
        'measure',
        {
          frame_id: frame.id,
          roi: activeROI(roi),
          exclude_interpolated: exclude,
        },
        controller.signal,
      )
        .then((value) => {
          if (active) setSample({ key: sampleKey, value });
        })
        .catch((e) => {
          if (active && e.name !== 'AbortError') setSampleError(e.message);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [sampleKey, playing]);
  const save = async () => {
    if (!result || !resultMatches) return;
    try {
      await api('save', { id: result.id });
      setSavedResultIds((ids) => new Set(ids).add(result.id));
      await refreshSaved();
      setNotice('Analysis saved.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const load = async (id: string) => {
    try {
      const savedResult = await api<Job>(`saved?id=${id}`);
      worker.current?.adopt(savedResult);
      setResult(savedResult);
      setSavedResultIds((ids) => new Set(ids).add(savedResult.id));
      return savedResult;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  };
  const sampleCurrent =
    !playing && sample?.key === sampleKey ? sample.value : null;
  const resultMatches =
    !!result && analysisSignature(result.recipe) === selectionKey;
  return {
    sample: sampleCurrent,
    sampleError,
    job,
    result,
    saved,
    error: error || (automatic.key === selectionKey ? automatic.error : ''),
    notice,
    busy,
    phase,
    retry: () => worker.current?.retry(),
    cancel: () => worker.current?.cancel(),
    save,
    load,
    resultSaved: !!result && savedResultIds.has(result.id),
    resultMatches,
    clearError: () => {
      setError('');
      setAutomatic((state) => ({ ...state, error: '' }));
    },
  };
}
