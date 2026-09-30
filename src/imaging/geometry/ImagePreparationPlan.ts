import type { RasterMask } from '../../providers/contracts/types';

export interface PreparedGeometry {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly needsResize: boolean;
}

/**
 * Computes target dimensions adhering to OpenAI model constraints:
 * - Multiples of 16
 * - Max edge constraint (default 2048)
 * - Preserves aspect ratio without cropping
 * - Validates aspect ratio (0.25 to 4.0)
 */
export function computeOpenAIGeometry(
  sourceWidth: number,
  sourceHeight: number,
  maxDimension = 2048
): PreparedGeometry {
  if (!Number.isInteger(sourceWidth) || sourceWidth <= 0) {
    throw new Error(`sourceWidth must be a positive integer, got ${sourceWidth}`);
  }
  if (!Number.isInteger(sourceHeight) || sourceHeight <= 0) {
    throw new Error(`sourceHeight must be a positive integer, got ${sourceHeight}`);
  }

  const ratio = sourceWidth / sourceHeight;
  if (ratio < 0.25 || ratio > 4.0) {
    throw new Error(
      `Image aspect ratio (${ratio.toFixed(2)}) is unsupported. Please use an image with aspect ratio between 1:4 and 4:1.`
    );
  }

  let scale = 1.0;
  const maxSource = Math.max(sourceWidth, sourceHeight);
  if (maxSource > maxDimension) {
    scale = maxDimension / maxSource;
  }

  // Multiples of 16
  const targetWidth = Math.max(16, Math.round((sourceWidth * scale) / 16) * 16);
  const targetHeight = Math.max(16, Math.round((sourceHeight * scale) / 16) * 16);

  const needsResize = targetWidth !== sourceWidth || targetHeight !== sourceHeight;

  return {
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    scaleX: targetWidth / sourceWidth,
    scaleY: targetHeight / sourceHeight,
    needsResize,
  };
}

export async function resizeImageBlob(
  blob: Blob,
  targetWidth: number,
  targetHeight: number
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  if (bitmap.width === targetWidth && bitmap.height === targetHeight) {
    bitmap.close();
    return blob;
  }
  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get 2D context for image resize');
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/png' });
}

export function resizeRasterMask(
  mask: RasterMask,
  targetWidth: number,
  targetHeight: number
): RasterMask {
  if (mask.width === targetWidth && mask.height === targetHeight) {
    return mask;
  }
  const result = new Uint8ClampedArray(targetWidth * targetHeight);
  const scaleX = mask.width / targetWidth;
  const scaleY = mask.height / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    const srcY = Math.min(mask.height - 1, Math.floor(y * scaleY));
    const srcRow = srcY * mask.width;
    const destRow = y * targetWidth;
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.min(mask.width - 1, Math.floor(x * scaleX));
      result[destRow + x] = mask.data[srcRow + srcX]!;
    }
  }

  return { width: targetWidth, height: targetHeight, data: result };
}

export async function restoreResultToSourceSpace(
  resultBlob: Blob,
  sourceWidth: number,
  sourceHeight: number
): Promise<Blob> {
  const bitmap = await createImageBitmap(resultBlob);
  if (bitmap.width === sourceWidth && bitmap.height === sourceHeight) {
    bitmap.close();
    return resultBlob;
  }
  const canvas = new OffscreenCanvas(sourceWidth, sourceHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get 2D context for result restoration');
  ctx.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/png' });
}
