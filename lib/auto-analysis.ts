import { activeROI, analysisSignature } from './research.ts';
import type { Job, Recipe, ROI } from './research.ts';

export type AnalysisSelection = Pick<
  Recipe,
  'frame_ids' | 'exclude_interpolated'
> & { roi: ROI };
export type AnalysisState = {
  key: string | null;
  phase: 'idle' | 'waiting' | 'running' | 'complete' | 'cancelled' | 'error';
  job: Job | null;
  error: string;
};
type Transport = <T>(path: string, body?: unknown) => Promise<T>;
const terminal = (job: Job) =>
  ['complete', 'cancelled', 'error'].includes(job.status);
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Debounce changes and serialize owned jobs, including cancellation acknowledgements.
 * A job-start POST is never aborted: its ID is needed to cancel it safely.
 */
export class AutoAnalysis {
  private transport: Transport;
  private onState: (state: AnalysisState) => void;
  private onResult: (result: Job) => void;
  private debounceMs: number;
  private pollMs: number;
  private retryMs: number;
  private desired: AnalysisSelection | null = null;
  private key: string | null = null;
  private generation = 0;
  private attempted = -1;
  private ready = false;
  private working = false;
  private disposed = false;
  private cached: Job | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: {
    transport: Transport;
    onState: (state: AnalysisState) => void;
    onResult: (result: Job) => void;
    debounceMs?: number;
    pollMs?: number;
    retryMs?: number;
  }) {
    this.transport = options.transport;
    this.onState = options.onState;
    this.onResult = options.onResult;
    this.debounceMs = options.debounceMs ?? 400;
    this.pollMs = options.pollMs ?? 250;
    this.retryMs = options.retryMs ?? 1500;
  }

  setSelection(selection: AnalysisSelection | null, force = false) {
    if (this.disposed) return;
    const key = selection ? analysisSignature(selection) : null;
    if (!force && this.key === key) return;
    this.desired = selection;
    this.key = key;
    this.generation++;
    this.ready = false;
    clearTimeout(this.timer);
    if (!selection) {
      this.publish('idle');
    } else if (this.cached && analysisSignature(this.cached.recipe) === key) {
      this.publish('complete', this.cached);
    } else {
      this.publish('waiting');
      this.timer = setTimeout(() => {
        this.ready = true;
        this.startLatest();
      }, this.debounceMs);
    }
  }

  adopt(result: Job) {
    this.cached = result;
    this.setSelection(result.recipe, true);
  }

  cancel() {
    if (this.disposed || !this.desired) return;
    this.generation++;
    this.ready = false;
    clearTimeout(this.timer);
    this.publish('cancelled');
  }

  retry() {
    this.cached = null;
    this.setSelection(this.desired, true);
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    clearTimeout(this.timer);
    // The owned worker finishes cancelling its job without publishing any more UI state.
  }

  private current(generation: number) {
    return !this.disposed && this.generation === generation;
  }

  private publish(
    phase: AnalysisState['phase'],
    job: Job | null = null,
    error = '',
  ) {
    if (!this.disposed) this.onState({ key: this.key, phase, job, error });
  }

  private startLatest() {
    if (
      this.disposed ||
      this.working ||
      !this.ready ||
      !this.desired ||
      this.attempted === this.generation
    )
      return;
    this.working = true;
    this.attempted = this.generation;
    void this.run(this.desired, this.generation);
  }

  private async readJob(
    generation: number,
    path: string,
    body?: unknown,
  ): Promise<Job> {
    let failures = 0;
    for (;;) {
      try {
        return await this.transport<Job>(path, body);
      } catch (error) {
        const status = (error as Error & { status?: number }).status;
        if (
          status === 400 ||
          status === 404 ||
          (this.disposed && ++failures >= 3)
        )
          throw error;
        // Keep ownership across a transient outage; never start a second job
        // while the service may still be processing this one.
        if (this.current(generation))
          this.publish(
            'waiting',
            null,
            'Connection interrupted. Retrying automatically…',
          );
        await delay(this.retryMs);
      }
    }
  }

  private async run(selection: AnalysisSelection, generation: number) {
    try {
      let job = await this.transport<Job>('jobs', {
        ...selection,
        roi: activeROI(selection.roi),
      });
      for (;;) {
        if (
          !this.current(generation) &&
          !terminal(job) &&
          job.status !== 'cancelling'
        ) {
          job = await this.readJob(generation, 'cancel', { id: job.id });
        }
        if (terminal(job)) {
          if (this.current(generation)) {
            if (job.status === 'complete') {
              const result = await this.readJob(
                generation,
                `jobs?id=${job.id}&rows=1`,
              );
              if (this.current(generation)) {
                this.cached = result;
                this.onResult(result);
                this.publish('complete', result);
              }
            } else if (job.status === 'error') {
              this.publish('error', job, job.error || 'Analysis failed.');
            } else {
              this.publish('cancelled', job);
            }
          }
          return;
        }
        if (this.current(generation)) this.publish('running', job);
        await delay(this.pollMs);
        job = await this.readJob(generation, `jobs?id=${job.id}`);
      }
    } catch (error) {
      if (this.current(generation))
        this.publish('error', null, (error as Error).message);
    } finally {
      this.working = false;
      this.startLatest();
    }
  }
}
