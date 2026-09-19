/** Keep a small decoded working set, shared by the viewer and adjacent-frame preload. */
export class PreviewImageCache {
  private images = new Map<string, HTMLImageElement>();
  private pending = new Map<string, Promise<HTMLImageElement>>();
  private load: (url: string) => Promise<HTMLImageElement>;
  private capacity: number;

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
      while (this.images.size > this.capacity)
        this.images.delete(this.images.keys().next().value!);
      return image;
    }).finally(() => this.pending.delete(url));
    this.pending.set(url, request);
    return request;
  }
}

export const previewImages = new PreviewImageCache();
