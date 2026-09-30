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
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`width must be a positive integer, got ${width}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error(`height must be a positive integer, got ${height}`);
  }

  const expectedRgbaLength = width * height * 4;
  if (originalData.length !== expectedRgbaLength) {
    throw new Error(
      `originalData.length must equal width * height * 4 (${expectedRgbaLength}), got ${originalData.length}`
    );
  }
  if (generatedData.length !== expectedRgbaLength) {
    throw new Error(
      `generatedData.length must equal width * height * 4 (${expectedRgbaLength}), got ${generatedData.length}`
    );
  }
  const expectedMaskLength = width * height;
  if (maskData.length !== expectedMaskLength) {
    throw new Error(
      `maskData.length must equal width * height (${expectedMaskLength}), got ${maskData.length}`
    );
  }

  const result = new Uint8ClampedArray(expectedRgbaLength);

  for (let i = 0; i < expectedMaskLength; i++) {
    const maskAlpha = maskData[i]!; // single channel 0-255
    const base = i * 4;

    if (maskAlpha === 0) {
      // Exact copy of original RGBA bytes
      result[base] = originalData[base]!;
      result[base + 1] = originalData[base + 1]!;
      result[base + 2] = originalData[base + 2]!;
      result[base + 3] = originalData[base + 3]!;
    } else if (maskAlpha === 255) {
      // Exact copy of generated RGBA bytes
      result[base] = generatedData[base]!;
      result[base + 1] = generatedData[base + 1]!;
      result[base + 2] = generatedData[base + 2]!;
      result[base + 3] = generatedData[base + 3]!;
    } else {
      // Linear blend with deterministic rounding
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
