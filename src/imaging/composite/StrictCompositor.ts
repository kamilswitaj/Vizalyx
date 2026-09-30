/**
 * Strict Mask compositor.
 *
 * Internal mask convention:
 *   0   = preserve original exactly
 *   255 = use generated fully
 *   1-254 = blend proportionally
 *
 * This is a pure function operating on raw pixel buffers.
 * It does NOT depend on canvas compositing.
 */
export function strictComposite(
  originalData: Uint8ClampedArray,
  generatedData: Uint8ClampedArray,
  maskData: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  if (originalData.length !== generatedData.length) {
    throw new Error('originalData and generatedData must be the same length');
  }
  if (maskData.length < width * height) {
    throw new Error('maskData too short for given dimensions');
  }

  const result = new Uint8ClampedArray(originalData.length);
  const pixelCount = width * height;

  for (let i = 0; i < pixelCount; i++) {
    const maskAlpha = maskData[i]!;  // single channel 0-255
    const base = i * 4;

    if (maskAlpha === 0) {
      // Exact copy of original
      result[base] = originalData[base]!;
      result[base + 1] = originalData[base + 1]!;
      result[base + 2] = originalData[base + 2]!;
      result[base + 3] = originalData[base + 3]!;
    } else if (maskAlpha === 255) {
      // Exact copy of generated
      result[base] = generatedData[base]!;
      result[base + 1] = generatedData[base + 1]!;
      result[base + 2] = generatedData[base + 2]!;
      result[base + 3] = generatedData[base + 3]!;
    } else {
      // Linear blend
      const t = maskAlpha / 255;
      const invT = 1 - t;
      result[base] = Math.round(originalData[base]! * invT + generatedData[base]! * t);
      result[base + 1] = Math.round(originalData[base + 1]! * invT + generatedData[base + 1]! * t);
      result[base + 2] = Math.round(originalData[base + 2]! * invT + generatedData[base + 2]! * t);
      result[base + 3] = Math.round(originalData[base + 3]! * invT + generatedData[base + 3]! * t);
    }
  }

  return result;
}
