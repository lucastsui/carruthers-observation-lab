import { decodePreviewImage, PreviewCache } from './preview-images.ts';
import { api, previewURL } from './research.ts';
import type { Contours, Frame } from './research.ts';
import type { ContourMode } from './display.ts';

export type FrameAssets = { image: HTMLImageElement; isolines: Contours | null };
export type FrameSource = { image: Blob; isolines: Contours | null };

/** Cache identity includes every asynchronously loaded part of the displayed frame. */
export function framePreviewKey(frame: Frame, scale: [number, number], contours: ContourMode, exclude: boolean) {
  return JSON.stringify([
    previewURL(frame, scale),
    contours === 'radiance' ? `contours?id=${encodeURIComponent(frame.id)}&exclude=${exclude ? 1 : 0}` : null,
  ]);
}

export async function loadFrameAssets(
  key: string,
  loadImage = downloadPreviewImage,
  loadContours: (path: string) => Promise<Contours> = (path) => api<Contours>(path),
): Promise<FrameSource> {
  const [imageURL, contourPath] = JSON.parse(key) as [string, string | null];
  const [image, isolines] = await Promise.all([
    loadImage(imageURL),
    contourPath ? loadContours(contourPath) : Promise.resolve(null),
  ]);
  if (isolines && isolines.frame_id !== new URLSearchParams(imageURL.split('?')[1]).get('id'))
    throw new Error('Image and contour frame identities do not match.');
  return { image, isolines };
}

async function downloadPreviewImage(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Preview image could not load.');
  return response.blob();
}

async function decodeFrame(source: FrameSource): Promise<FrameAssets> {
  const url = URL.createObjectURL(source.image);
  try {
    return { image: await decodePreviewImage(url), isolines: source.isolines };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Keep the entire sequence compressed, with a small decoded working set near the slider. */
export class FramePreviewCache {
  private sources: PreviewCache<FrameSource>;
  private decoded: PreviewCache<FrameAssets>;
  private order: readonly string[] = [];
  private enabled = false;
  private decodedCapacity: number;

  constructor(load = loadFrameAssets, decode = decodeFrame, intervalMs = 300, decodedCapacity = 33) {
    // Each background bundle may make two requests; preserve the service's pacing.
    this.sources = new PreviewCache(load, 0, intervalMs, true);
    this.decodedCapacity = decodedCapacity;
    this.decoded = new PreviewCache(async (key) => {
      const source = await this.sources.get(key);
      try {
        return await decode(source);
      } catch (error) {
        this.sources.discard(key);
        throw error;
      }
    }, decodedCapacity, 0);
    this.sources.subscribe(() => this.prepareNearby());
  }

  getSnapshot = (): ReadonlySet<string> => this.sources.getSnapshot();
  getDecodedSnapshot = (): ReadonlySet<string> => this.decoded.getSnapshot();
  subscribe = (listener: () => void): (() => void) => this.sources.subscribe(listener);
  get = async (key: string): Promise<FrameAssets> => {
    await this.sources.get(key);
    return this.decoded.get(key);
  };

  setPreloadWindow(keys: readonly string[], enabled = true): void {
    this.order = keys;
    this.enabled = enabled;
    this.sources.setPreloadWindow(keys, enabled);
    this.prepareNearby();
  }

  private prepareNearby(): void {
    const [selected, ...nearby] = this.order.slice(0, this.decodedCapacity);
    const ready = selected ? [selected, ...nearby.filter((key) => this.sources.getSnapshot().has(key))] : [];
    // Decode only already-downloaded neighbors; foreground selection always bypasses the queue.
    this.decoded.setPreloadWindow(ready, this.enabled);
  }
}

export const framePreviews = new FramePreviewCache();
