const PREVIEW_CACHE_CAPACITY = 201;

/** Current frame first, then nearby future/past pairs, without wrapping the interval. */
export function previewWindowIndices(count: number, index: number): number[] {
  if (count === 0) return [];
  const center = Math.min(Math.max(0, index), count - 1);
  const indices = [center];
  for (let distance = 1; indices.length < count; distance++) {
    if (center + distance < count) indices.push(center + distance);
    if (center - distance >= 0) indices.push(center - distance);
  }
  return indices;
}

/** Prioritized loading with either a fixed cache or space for the entire active sequence. */
export class PreviewCache<T> {
  private entries = new Map<string, T>();
  private pending = new Map<string, Promise<T>>();
  private load: (url: string) => Promise<T>;
  private capacity: number;
  private listeners = new Set<() => void>();
  private snapshot: ReadonlySet<string> = new Set();
  private window = new Set<string>();
  private preloadQueue: string[] = [];
  private preloading = new Set<string>();
  private preloadTimer: ReturnType<typeof setTimeout> | undefined;
  private preloadIntervalMs: number;
  private retainWindow: boolean;

  /** Stable until complete cache membership changes; pending loads are excluded. */
  getSnapshot = (): ReadonlySet<string> => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  constructor(
    load: (url: string) => Promise<T>,
    capacity = PREVIEW_CACHE_CAPACITY,
    preloadIntervalMs = 150,
    retainWindow = false,
  ) {
    this.load = load;
    this.capacity = capacity;
    this.preloadIntervalMs = preloadIntervalMs;
    this.retainWindow = retainWindow;
  }

  /** Protect the current window immediately; pause background work during selection. */
  setPreloadWindow(urls: readonly string[], enabled = true): void {
    this.window = new Set(urls);
    this.trim();
    this.publish();
    // The viewer requests the first (selected) URL directly, ahead of background work.
    this.preloadQueue = enabled ? [...new Set(urls.slice(1))] : [];
    this.preloadNext();
  }

  private trim(): void {
    const capacity = this.retainWindow ? Math.max(this.capacity, this.window.size) : this.capacity;
    while (this.entries.size > capacity) {
      const oldestOutsideWindow = [...this.entries.keys()].find((key) => !this.window.has(key));
      this.entries.delete(oldestOutsideWindow ?? this.entries.keys().next().value!);
    }
  }

  private publish(): void {
    if (this.entries.size === this.snapshot.size && [...this.entries.keys()].every((key) => this.snapshot.has(key))) return;
    this.snapshot = new Set(this.entries.keys());
    this.listeners.forEach((listener) => listener());
  }

  discard(url: string): void {
    if (this.entries.delete(url)) this.publish();
  }

  private preloadNext(): void {
    if (this.preloadTimer !== undefined) return;
    // This limit spans window changes, including old requests still in flight.
    while (this.preloading.size < 2 && this.preloadQueue.length) {
      const url = this.preloadQueue.shift()!;
      if (this.entries.has(url) || this.preloading.has(url)) continue;
      this.preloading.add(url);
      // Pace even fast cached responses, leaving request capacity for interaction.
      // Keep this cooldown across window changes so scrubbing cannot reset the limit.
      if (this.preloadIntervalMs > 0) {
        this.preloadTimer = setTimeout(() => {
          this.preloadTimer = undefined;
          this.preloadNext();
        }, this.preloadIntervalMs);
      }
      void this.get(url).catch(() => {}).finally(() => {
        this.preloading.delete(url);
        this.preloadNext();
      });
      if (this.preloadTimer !== undefined) break;
    }
  }

  get(url: string): Promise<T> {
    const cached = this.entries.get(url);
    if (cached) {
      this.entries.delete(url);
      this.entries.set(url, cached);
      return Promise.resolve(cached);
    }
    const pending = this.pending.get(url);
    if (pending) return pending;
    const request = this.load(url).then((image) => {
      this.entries.set(url, image);
      this.trim();
      // A late response from an old window may be discarded immediately.
      this.publish();
      return image;
    }).finally(() => this.pending.delete(url));
    this.pending.set(url, request);
    return request;
  }
}

export async function decodePreviewImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  return image;
}

export class PreviewImageCache extends PreviewCache<HTMLImageElement> {
  constructor(load = decodePreviewImage, capacity = PREVIEW_CACHE_CAPACITY, preloadIntervalMs = 150) {
    super(load, capacity, preloadIntervalMs);
  }
}
