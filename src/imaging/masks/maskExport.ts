import type { RasterMask } from '../../providers/contracts/types';

/**
 * Converts a Vizalyx RasterMask into a standard grayscale PNG Blob.
 * Value 0 = black (preserve), 255 = white (editable).
 */
export async function rasterMaskToBlob(mask: RasterMask): Promise<Blob> {
  const { width, height, data } = mask;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get 2D context for mask export');

  const imgData = ctx.createImageData(width, height);
  const totalPixels = width * height;
  for (let i = 0; i < totalPixels; i++) {
    const val = data[i]!;
    const base = i * 4;
    imgData.data[base] = val;
    imgData.data[base + 1] = val;
    imgData.data[base + 2] = val;
    imgData.data[base + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}
