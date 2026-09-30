import type { RasterMask } from '../contracts/types';

/**
 * Converts a Vizalyx RasterMask into the format and alpha semantics
 * required by the OpenAI Image Edit API.
 *
 * Vizalyx convention:
 *   0     = preserve original
 *   255   = editable
 *   1-254 = partial blend
 *
 * OpenAI API convention:
 *   Alpha 0 (transparent) = region to edit / inpaint
 *   Alpha 255 (opaque)    = region to preserve
 *   Formula: openAiAlpha = 255 - vizalyxAlpha
 */
export async function convertToOpenAIMaskBlob(mask: RasterMask): Promise<Blob> {
  const { width, height, data } = mask;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get 2D context for OpenAI mask conversion');

  const imgData = ctx.createImageData(width, height);
  const totalPixels = width * height;

  for (let i = 0; i < totalPixels; i++) {
    const vizalyxVal = data[i]!;
    const openAiAlpha = 255 - vizalyxVal; // 255 (editable) -> 0 (transparent)
    const base = i * 4;
    // Color channels can be white or black; alpha defines the edit zone
    imgData.data[base] = 255;
    imgData.data[base + 1] = 255;
    imgData.data[base + 2] = 255;
    imgData.data[base + 3] = openAiAlpha;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}
