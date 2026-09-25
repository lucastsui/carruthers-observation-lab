/** Current frame first, then nearby future/past pairs, without wrapping the interval. */
export function previewWindowIndices(count: number, index: number): number[] {
  if (count === 0) return [];
  const center = Math.min(Math.max(0, index), count - 1);
  const indices = [center];
  for (let distance = 1; distance <= 5; distance++) {
    if (center + distance < count) indices.push(center + distance);
    if (center - distance >= 0) indices.push(center - distance);
  }
  return indices;
}

/** Share decoded images between the viewer and a moving, bounded preload window. */
export class PreviewImageCache {
  private images = new Map<string, HTMLImageElement>();
  private pending = new Map<string, Promise<HTMLImageElement>>();
  private load: (url: string) => Promise<HTMLImageElement>;
  private capacity: number;
  private listeners = new Set<() => void>();
  private snapshot: ReadonlySet<string> = new Set();
  private window = new Set<string>();
  private preloadQueue: string[] = [];
  private preloading = new Set<string>();

  /** Stable until decoded cache membership changes; pending loads are excluded. */
  getSnapshot = (): ReadonlySet<string> => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  constructor(
    load: (url: string) => Promise<HTMLImageElement> = async (url) => {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
      await image.decode();
      return image;
    },
    capacity = 12,
  ) {
    this.load = load;
    this.capacity = capacity;
  }

  /** Protect the current window immediately; pause background work during selection. */
  setPreloadWindow(urls: readonly string[], enabled = true): void {
    this.window = new Set(urls);
    // The viewer requests the first (selected) URL directly, ahead of background work.
    this.preloadQueue = enabled ? [...new Set(urls.slice(1))] : [];
    this.preloadNext();
  }

  private preloadNext(): void {
    // This limit spans window changes, including old requests still in flight.
    while (this.preloading.size < 2 && this.preloadQueue.length) {
      const url = this.preloadQueue.shift()!;
      if (this.images.has(url) || this.preloading.has(url)) continue;
      this.preloading.add(url);
      void this.get(url).catch(() => {}).finally(() => {
        this.preloading.delete(url);
        this.preloadNext();
      });
    }
  }

  get(url: string): Promise<HTMLImageElement> {
    const cached = this.images.get(url);
    if (cached) {
      this.images.delete(url);
      this.images.set(url, cached);
      return Promise.resolve(cached);
    }
    const pending = this.pending.get(url);
    if (pending) return pending;
    const request = this.load(url).then((image) => {
      this.images.set(url, image);
      while (this.images.size > this.capacity) {
        const oldestOutsideWindow = [...this.images.keys()].find((key) => !this.window.has(key));
        this.images.delete(oldestOutsideWindow ?? this.images.keys().next().value!);
      }
      // A late response from an old window may be discarded immediately.
      if (this.images.has(url)) {
        this.snapshot = new Set(this.images.keys());
        this.listeners.forEach((listener) => listener());
      }
      return image;
    }).finally(() => this.pending.delete(url));
    this.pending.set(url, request);
    return request;
  }
}

export const previewImages = new PreviewImageCache();
