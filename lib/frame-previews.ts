import { decodePreviewImage, PreviewCache } from './preview-images.ts';
import { api, previewURL } from './research.ts';
import type { Contours, Frame } from './research.ts';
import type { ContourMode } from './display.ts';

export type FrameAssets = { image: HTMLImageElement; isolines: Contours | null };

/** Cache identity includes every asynchronously loaded part of the displayed frame. */
export function framePreviewKey(frame: Frame, scale: [number, number], contours: ContourMode, exclude: boolean) {
  return JSON.stringify([
    previewURL(frame, scale),
    contours === 'radiance' ? `contours?id=${encodeURIComponent(frame.id)}&exclude=${exclude ? 1 : 0}` : null,
  ]);
}

export async function loadFrameAssets(
  key: string,
  loadImage = decodePreviewImage,
  loadContours: (path: string) => Promise<Contours> = (path) => api<Contours>(path),
): Promise<FrameAssets> {
  const [imageURL, contourPath] = JSON.parse(key) as [string, string | null];
  const [image, isolines] = await Promise.all([
    loadImage(imageURL),
    contourPath ? loadContours(contourPath) : Promise.resolve(null),
  ]);
  if (isolines && isolines.frame_id !== new URLSearchParams(imageURL.split('?')[1]).get('id'))
    throw new Error('Image and contour frame identities do not match.');
  return { image, isolines };
}

// Each background bundle may make two requests. Pace bundles to leave room for interaction.
export const framePreviews = new PreviewCache(loadFrameAssets, undefined, 300);
