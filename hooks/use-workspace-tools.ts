'use client';
import { useEffect, useRef } from 'react';
type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};
type ModelContext = {
  registerTool: (
    tool: Tool,
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
export function useWorkspaceTools(state: unknown) {
  const current = useRef(state);
  useEffect(() => {
    current.current = state;
  }, [state]);
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'get_observation_workspace',
            description:
              'Read the current Carruthers camera, time interval, selected region, current-frame measurement, and extraction status visible in this local workspace.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: false },
            execute(input) {
              if (
                !input ||
                typeof input !== 'object' ||
                Array.isArray(input) ||
                Object.keys(input).length
              )
                throw new Error('Expected an empty object');
              return current.current;
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {
        /* Browser support is optional; the normal interface remains available. */
      });
    } catch {
      /* Unsupported or unavailable browser registry. */
    }
    return () => lifecycle.abort();
  }, []);
}
