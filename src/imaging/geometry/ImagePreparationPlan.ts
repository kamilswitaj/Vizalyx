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

export const GPT_IMAGE_CONSTRAINTS = {
  MIN_TOTAL_PIXELS: 655_360,
  MAX_TOTAL_PIXELS: 8_294_400,
  MAX_EDGE: 3840,
  MIN_ASPECT_RATIO: 1 / 3, // 1:3 (0.333...)
  MAX_ASPECT_RATIO: 3.0,   // 3:1
  GRID_SIZE: 16,
} as const;

/**
 * Computes target dimensions adhering to OpenAI GPT Image 2.5 constraints:
 * - Dimensions divisible by 16
 * - Maximum aspect ratio 3:1 (0.333... to 3.0)
 * - Maximum edge 3840 pixels
 * - Total pixel count between 655,360 and 8,294,400 pixels
 * - Preserves aspect ratio without silent cropping
 */
export function computeOpenAIGeometry(
  sourceWidth: number,
  sourceHeight: number
): PreparedGeometry {
  if (!Number.isInteger(sourceWidth) || sourceWidth <= 0) {
    throw new Error(`sourceWidth must be a positive integer, got ${sourceWidth}`);
  }
  if (!Number.isInteger(sourceHeight) || sourceHeight <= 0) {
    throw new Error(`sourceHeight must be a positive integer, got ${sourceHeight}`);
  }

  const ratio = sourceWidth / sourceHeight;
  if (ratio < GPT_IMAGE_CONSTRAINTS.MIN_ASPECT_RATIO || ratio > GPT_IMAGE_CONSTRAINTS.MAX_ASPECT_RATIO) {
    throw new Error(
      `Image aspect ratio (${ratio.toFixed(2)}) exceeds the 3:1 limit supported by GPT Image 2.5. Please use an image with an aspect ratio between 1:3 and 3:1.`
    );
  }

  let scale = 1.0;
  const currentPixels = sourceWidth * sourceHeight;
  const currentMaxEdge = Math.max(sourceWidth, sourceHeight);

  if (currentPixels < GPT_IMAGE_CONSTRAINTS.MIN_TOTAL_PIXELS) {
    scale = Math.sqrt(GPT_IMAGE_CONSTRAINTS.MIN_TOTAL_PIXELS / currentPixels);
  } else if (currentPixels > GPT_IMAGE_CONSTRAINTS.MAX_TOTAL_PIXELS) {
    scale = Math.sqrt(GPT_IMAGE_CONSTRAINTS.MAX_TOTAL_PIXELS / currentPixels);
  }

  // Ensure max edge doesn't exceed 3840px
  if (currentMaxEdge * scale > GPT_IMAGE_CONSTRAINTS.MAX_EDGE) {
    scale = GPT_IMAGE_CONSTRAINTS.MAX_EDGE / currentMaxEdge;
  }

  // Snap to multiples of 16
  const grid = GPT_IMAGE_CONSTRAINTS.GRID_SIZE;
  let targetWidth = Math.max(grid, Math.round((sourceWidth * scale) / grid) * grid);
  let targetHeight = Math.max(grid, Math.round((sourceHeight * scale) / grid) * grid);

  // If rounding pushed total pixels below MIN_TOTAL_PIXELS, increment by grid (16)
  while (targetWidth * targetHeight < GPT_IMAGE_CONSTRAINTS.MIN_TOTAL_PIXELS) {
    if (targetWidth / targetHeight < sourceWidth / sourceHeight) {
      targetWidth += grid;
    } else {
      targetHeight += grid;
    }
  }

  // If rounding pushed total pixels above MAX_TOTAL_PIXELS or edge above MAX_EDGE, decrement by grid
  while (
    targetWidth * targetHeight > GPT_IMAGE_CONSTRAINTS.MAX_TOTAL_PIXELS ||
    targetWidth > GPT_IMAGE_CONSTRAINTS.MAX_EDGE ||
    targetHeight > GPT_IMAGE_CONSTRAINTS.MAX_EDGE
  ) {
    if (targetWidth / targetHeight > sourceWidth / sourceHeight && targetWidth > grid) {
      targetWidth -= grid;
    } else if (targetHeight > grid) {
      targetHeight -= grid;
    } else {
      break;
    }
  }

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
