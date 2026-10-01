import type { RasterMask } from '../../providers/contracts/types';
import type { RasterOperation } from '../../editor/mask/maskModel';

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

/**
 * Restores a persisted grayscale mask PNG Blob into a RasterOperation.
 * Also builds a visual red overlay for Konva editor rendering.
 */
export async function blobToRasterMaskOperation(blob: Blob): Promise<RasterOperation> {
  const bitmap = await createImageBitmap(blob);
  const width = bitmap.width;
  const height = bitmap.height;

  const grayData = new Uint8ClampedArray(width * height);
  let visualImage: CanvasImageSource | undefined;

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0);
      const imgData = ctx.getImageData(0, 0, width, height);
      for (let i = 0; i < width * height; i++) {
        // Red channel represents the grayscale mask value
        grayData[i] = imgData.data[i * 4]!;
      }
    }
  } else if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0);
      const imgData = ctx.getImageData(0, 0, width, height);
      for (let i = 0; i < width * height; i++) {
        grayData[i] = imgData.data[i * 4]!;
      }
    }
  }

  // Create red visual overlay canvas for Konva editor
  if (typeof document !== 'undefined') {
    const visualCanvas = document.createElement('canvas');
    visualCanvas.width = width;
    visualCanvas.height = height;
    const vCtx = visualCanvas.getContext('2d');
    if (vCtx) {
      const vImgData = vCtx.createImageData(width, height);
      for (let i = 0; i < width * height; i++) {
        const v = grayData[i]!;
        const base = i * 4;
        vImgData.data[base] = 220;     // R
        vImgData.data[base + 1] = 50;  // G
        vImgData.data[base + 2] = 50;  // B
        vImgData.data[base + 3] = v;   // A matches mask value
      }
      vCtx.putImageData(vImgData, 0, 0);
      visualImage = visualCanvas;
    }
  }

  bitmap.close();

  return {
    type: 'raster',
    data: grayData,
    width,
    height,
    image: visualImage,
  };
}
