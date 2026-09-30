/**
 * Applies edge feathering to a single-channel raster mask.
 *
 * Internal mask convention:
 *   0   = preserve original exactly
 *   255 = fully editable
 *   1-254 = partial blend
 *
 * Feather radius is in source-image pixels (0 to 50).
 * Radius 0 returns an exact copy without modification.
 * Pixels outside the feathered region remain strictly 0.
 */
export function featherMask(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
  featherRadius: number
): Uint8ClampedArray {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`width must be a positive integer, got ${width}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error(`height must be a positive integer, got ${height}`);
  }
  if (mask.length !== width * height) {
    throw new Error(`mask length (${mask.length}) does not match width * height (${width * height})`);
  }
  if (featherRadius < 0) {
    throw new Error(`featherRadius must be non-negative, got ${featherRadius}`);
  }

  const radius = Math.round(featherRadius);
  if (radius === 0) {
    return new Uint8ClampedArray(mask);
  }

  // Fast separable box blur (2 passes approximate smooth feather roll-off)
  // Pass 1: horizontal blur from mask -> temp
  // Pass 2: vertical blur from temp -> result
  const temp = new Float32Array(width * height);
  const result = new Uint8ClampedArray(width * height);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let windowSum = 0;
    let windowCount = 0;

    // Initialize window for x = 0
    for (let k = -radius; k <= radius; k++) {
      if (k >= 0 && k < width) {
        windowSum += mask[rowOffset + k]!;
        windowCount++;
      }
    }
    temp[rowOffset] = windowSum / windowCount;

    // Slide window across row
    for (let x = 1; x < width; x++) {
      const addX = x + radius;
      const removeX = x - radius - 1;

      if (addX < width) {
        windowSum += mask[rowOffset + addX]!;
        windowCount++;
      }
      if (removeX >= 0) {
        windowSum -= mask[rowOffset + removeX]!;
        windowCount--;
      }
      temp[rowOffset + x] = windowCount > 0 ? windowSum / windowCount : 0;
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    let windowSum = 0;
    let windowCount = 0;

    // Initialize window for y = 0
    for (let k = -radius; k <= radius; k++) {
      if (k >= 0 && k < height) {
        windowSum += temp[k * width + x]!;
        windowCount++;
      }
    }
    const val0 = Math.round(windowSum / windowCount);
    result[x] = val0 < 1 ? 0 : val0 > 254 ? 255 : val0;

    // Slide window down column
    for (let y = 1; y < height; y++) {
      const addY = y + radius;
      const removeY = y - radius - 1;

      if (addY < height) {
        windowSum += temp[addY * width + x]!;
        windowCount++;
      }
      if (removeY >= 0) {
        windowSum -= temp[removeY * width + x]!;
        windowCount--;
      }

      const avg = windowCount > 0 ? windowSum / windowCount : 0;
      const rounded = Math.round(avg);
      // Clean cutoff for zero preservation outside feathered band
      result[y * width + x] = rounded < 1 ? 0 : rounded > 254 ? 255 : rounded;
    }
  }

  return result;
}
