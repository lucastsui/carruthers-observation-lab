'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/research';
import { matchingModelOverlay, modelOverlayKey } from '@/lib/model-overlay';
import type { ModelChoice, ModelContours } from '@/lib/model-overlay';

const cache = new Map<string, ModelContours>();

export function useModelOverlay(
  fid: string | undefined,
  model: ModelChoice,
  irradiance: number,
  exclude: boolean,
  enabled: boolean,
) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    value?: ModelContours;
    error?: string;
  } | null>(null);
  const key =
    fid && model !== 'off' && enabled
      ? modelOverlayKey(fid, model, irradiance, exclude)
      : '';
  useEffect(() => {
    if (!key || !fid) return;
    const controller = new AbortController();
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return;
    }
    // Let scrubbing settle; do not precompute model images for the preview window.
    const timer = setTimeout(() => {
      api<ModelContours>(key, undefined, controller.signal)
        .then((value) => {
          if (controller.signal.aborted) return;
          if (!matchingModelOverlay(value, fid, model, irradiance, exclude))
            throw new Error(
              'Model contours do not match the displayed observation.',
            );
          cache.set(key, value);
          while (cache.size > 64) cache.delete(cache.keys().next().value!);
          setState({ key, value });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setState({ key, error: error.message });
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, fid, model, irradiance, exclude, attempt]);
  const current = key && state?.key === key ? state : null;
  const value = cache.get(key) ?? current?.value ?? null;
  return {
    value,
    error: current?.error ?? '',
    pending: !!key && !current && !value,
    retry: () => {
      setState(null);
      setAttempt((n) => n + 1);
    },
  };
}
