import { describe, it, expect } from 'vitest';
import {
  computeOpenAIGeometry,
  resizeRasterMask,
} from '../../src/imaging/geometry/ImagePreparationPlan';

describe('ImagePreparationPlan', () => {
  it('keeps dimensions that are already multiples of 16 and within limits', () => {
    const geo = computeOpenAIGeometry(1024, 768);
    expect(geo.targetWidth).toBe(1024);
    expect(geo.targetHeight).toBe(768);
    expect(geo.needsResize).toBe(false);
  });

  it('rounds dimensions to nearest multiple of 16', () => {
    const geo = computeOpenAIGeometry(1025, 770);
    expect(geo.targetWidth % 16).toBe(0);
    expect(geo.targetHeight % 16).toBe(0);
    expect(geo.targetWidth).toBe(1024);
    expect(geo.targetHeight).toBe(768);
    expect(geo.needsResize).toBe(true);
  });

  it('downscales large images exceeding GPT Image limits while preserving aspect ratio', () => {
    const geo = computeOpenAIGeometry(4000, 3000);
    expect(geo.targetWidth).toBeLessThanOrEqual(3840);
    expect(geo.targetHeight).toBeLessThanOrEqual(3840);
    expect(geo.targetWidth * geo.targetHeight).toBeLessThanOrEqual(8_294_400);
    expect(geo.targetWidth * geo.targetHeight).toBeGreaterThanOrEqual(655_360);
    expect(geo.targetWidth % 16).toBe(0);
    expect(geo.targetHeight % 16).toBe(0);
    // Aspect ratio roughly 4:3
    expect(geo.targetWidth / geo.targetHeight).toBeCloseTo(4 / 3, 1);
  });

  it('upscales small images below minimum pixel limit while preserving aspect ratio', () => {
    const geo = computeOpenAIGeometry(200, 200);
    expect(geo.targetWidth * geo.targetHeight).toBeGreaterThanOrEqual(655_360);
    expect(geo.targetWidth * geo.targetHeight).toBeLessThanOrEqual(8_294_400);
    expect(geo.targetWidth % 16).toBe(0);
    expect(geo.targetHeight % 16).toBe(0);
    expect(geo.targetWidth).toBe(geo.targetHeight);
  });

  it('rejects aspect ratios exceeding 3:1 limit with clear validation error', () => {
    expect(() => computeOpenAIGeometry(100, 350)).toThrow(/Image aspect ratio/);
    expect(() => computeOpenAIGeometry(350, 100)).toThrow(/Image aspect ratio/);
    // 3:1 and 1:3 are acceptable
    expect(() => computeOpenAIGeometry(900, 300)).not.toThrow();
    expect(() => computeOpenAIGeometry(300, 900)).not.toThrow();
  });

  it('guarantees valid constraints for boundary near-3:1 and near-1:3 dimensions', () => {
    const boundaryCases = [
      [1790, 598],
      [1271, 3802],
      [2747, 918],
      // Mirrored portrait cases
      [598, 1790],
      [3802, 1271],
      [918, 2747],
      // Exact edge cases
      [3840, 1280],
      [1280, 3840],
      [1440, 480],
      [480, 1440],
    ] as const;

    for (const [w, h] of boundaryCases) {
      const geo = computeOpenAIGeometry(w, h);
      const ratio = geo.targetWidth / geo.targetHeight;
      const totalPixels = geo.targetWidth * geo.targetHeight;

      expect(geo.targetWidth % 16).toBe(0);
      expect(geo.targetHeight % 16).toBe(0);
      expect(geo.targetWidth).toBeLessThanOrEqual(3840);
      expect(geo.targetHeight).toBeLessThanOrEqual(3840);
      expect(totalPixels).toBeGreaterThanOrEqual(655_360);
      expect(totalPixels).toBeLessThanOrEqual(8_294_400);
      expect(ratio).toBeGreaterThanOrEqual(1 / 3 - 1e-9);
      expect(ratio).toBeLessThanOrEqual(3.0 + 1e-9);
    }
  });

  it('satisfies all GPT Image 2.5 constraints across representative dimension spectrum', () => {
    // Test a grid of diverse aspect ratios and sizes
    const widths = [300, 500, 800, 1024, 1271, 1790, 1920, 2560, 2747, 3840, 4000, 5000];
    const heights = [300, 480, 598, 768, 918, 1080, 1280, 1440, 2048, 3000, 3802, 4500];

    for (const w of widths) {
      for (const h of heights) {
        const inputRatio = w / h;
        if (inputRatio < 1 / 3 || inputRatio > 3.0) continue;

        const geo = computeOpenAIGeometry(w, h);
        const ratio = geo.targetWidth / geo.targetHeight;
        const total = geo.targetWidth * geo.targetHeight;

        expect(geo.targetWidth % 16).toBe(0);
        expect(geo.targetHeight % 16).toBe(0);
        expect(geo.targetWidth).toBeLessThanOrEqual(3840);
        expect(geo.targetHeight).toBeLessThanOrEqual(3840);
        expect(total).toBeGreaterThanOrEqual(655_360);
        expect(total).toBeLessThanOrEqual(8_294_400);
        expect(ratio).toBeGreaterThanOrEqual(1 / 3 - 1e-9);
        expect(ratio).toBeLessThanOrEqual(3.0 + 1e-9);
      }
    }
  });

  it('throws on non-positive dimensions', () => {
    expect(() => computeOpenAIGeometry(0, 100)).toThrow(/sourceWidth/);
    expect(() => computeOpenAIGeometry(100, -5)).toThrow(/sourceHeight/);
  });

  it('resizes raster mask accurately', () => {
    // 2x2 mask with bottom-right corner 255
    const mask = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([0, 0, 0, 255]),
    };
    const resized = resizeRasterMask(mask, 4, 4);
    expect(resized.width).toBe(4);
    expect(resized.height).toBe(4);
    expect(resized.data[0]).toBe(0); // Top-left
    expect(resized.data[15]).toBe(255); // Bottom-right
  });
});
