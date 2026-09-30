import { describe, it, expect } from 'vitest';
import { featherMask } from '../../src/imaging/masks/featherMask';

describe('featherMask', () => {
  it('returns identical copy when radius is 0', () => {
    const input = new Uint8ClampedArray([0, 255, 128, 0]);
    const result = featherMask(input, 2, 2, 0);
    expect(Array.from(result)).toEqual([0, 255, 128, 0]);
  });

  it('keeps all-zero mask strictly all zeros', () => {
    const input = new Uint8ClampedArray(100);
    const result = featherMask(input, 10, 10, 5);
    expect(result.every(v => v === 0)).toBe(true);
  });

  it('keeps all-255 mask strictly all 255', () => {
    const input = new Uint8ClampedArray(100).fill(255);
    const result = featherMask(input, 10, 10, 5);
    expect(result.every(v => v === 255)).toBe(true);
  });

  it('produces smooth intermediate transition values across edge', () => {
    // 10x1 image: left 5 pixels 0, right 5 pixels 255
    const input = new Uint8ClampedArray([0, 0, 0, 0, 0, 255, 255, 255, 255, 255]);
    const result = featherMask(input, 10, 1, 2);

    // Pixels at boundary should have intermediate blended values
    expect(result[0]).toBe(0); // Far left remains 0
    expect(result[4]).toBeGreaterThan(0);
    expect(result[4]).toBeLessThan(255);
    expect(result[5]).toBeGreaterThan(0);
    expect(result[5]).toBeLessThan(255);
    expect(result[9]).toBe(255); // Far right remains 255
  });

  it('preserves strictly 0 outside the feathered zone', () => {
    // 20x20 image with a 4x4 block in center (x: 8..11, y: 8..11)
    const input = new Uint8ClampedArray(400);
    for (let y = 8; y <= 11; y++) {
      for (let x = 8; x <= 11; x++) {
        input[y * 20 + x] = 255;
      }
    }

    const feathered = featherMask(input, 20, 20, 2);

    // Check corners (e.g. 0,0 and 19,19) which are far from the mask
    expect(feathered[0]).toBe(0);
    expect(feathered[19]).toBe(0);
    expect(feathered[380]).toBe(0);
    expect(feathered[399]).toBe(0);

    // Center should have high values
    expect(feathered[9 * 20 + 9]).toBeGreaterThan(100);
  });

  it('throws on invalid dimensions or negative radius', () => {
    const valid = new Uint8ClampedArray(16);
    expect(() => featherMask(valid, 2.5, 2, 1)).toThrow(/width must be a positive integer/);
    expect(() => featherMask(valid, 2, 0, 1)).toThrow(/height must be a positive integer/);
    expect(() => featherMask(valid, 2, 2, 1)).toThrow(/mask length/);
    expect(() => featherMask(valid, 4, 4, -1)).toThrow(/featherRadius must be non-negative/);
  });
});
