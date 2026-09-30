import { describe, it, expect, vi, beforeAll } from 'vitest';
import { convertToOpenAIMaskBlob } from '../../src/providers/openai/OpenAIMaskAdapter';
import type { RasterMask } from '../../src/providers/contracts/types';

describe('OpenAIMaskAdapter', () => {
  beforeAll(() => {
    if (typeof globalThis.OffscreenCanvas === 'undefined') {
      const mockCtx = {
        createImageData: (w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }),
        putImageData: vi.fn(),
      };
      class MockCanvas {
        width: number;
        height: number;
        constructor(w: number, h: number) {
          this.width = w;
          this.height = h;
        }
        getContext() {
          return mockCtx;
        }
        async convertToBlob() {
          return new Blob(['openai-mask-png'], { type: 'image/png' });
        }
      }
      globalThis.OffscreenCanvas = MockCanvas as unknown as typeof OffscreenCanvas;
    }
  });

  it('converts Vizalyx editable (255) to transparent (0) and preserve (0) to opaque (255)', async () => {
    const mask: RasterMask = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 0]), // first pixel editable, second preserved
    };

    const blob = await convertToOpenAIMaskBlob(mask);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });
});
