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
