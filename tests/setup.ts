import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

// In Node/JSDOM, native structuredClone does not clone JSDOM Blobs properly.
// Wrap structuredClone so fake-indexeddb clones JSDOM Blobs as real JSDOM Blobs.
const nativeStructuredClone = globalThis.structuredClone;
if (typeof nativeStructuredClone === 'function') {
  globalThis.structuredClone = function <T>(value: T, options?: StructuredSerializeOptions): T {
    function deepClone(val: unknown): unknown {
      if (val instanceof Blob) {
        return new Blob([val], { type: val.type });
      }
      if (val && typeof val === 'object') {
        if (Array.isArray(val)) {
          return val.map(deepClone);
        }
        if (val.constructor === Object) {
          const res: Record<string, unknown> = {};
          for (const k of Object.keys(val)) {
            res[k] = deepClone((val as Record<string, unknown>)[k]);
          }
          return res;
        }
      }
      return nativeStructuredClone(val, options);
    }
    return deepClone(value) as T;
  };
}

// Canvas 2D context mock that retains pixel data in tests
const createMockCtx = (initialWidth = 1024, initialHeight = 768) => {
  let currentData = new Uint8ClampedArray(initialWidth * initialHeight * 4);
  return {
    drawImage: vi.fn((img: unknown) => {
      const source = img as { __pixelData?: Uint8ClampedArray };
      if (source?.__pixelData) {
        currentData = new Uint8ClampedArray(source.__pixelData);
      }
    }),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    globalAlpha: 1,
    fillStyle: '',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData: vi.fn((imgData: ImageData) => {
      currentData = new Uint8ClampedArray(imgData.data);
    }),
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      if (currentData.length === w * h * 4) {
        return { data: currentData, width: w, height: h };
      }
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    },
    get data() {
      return currentData;
    },
  };
};

// Setup global OffscreenCanvas mock for JSDOM test environment if missing
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  class MockOffscreenCanvas {
    width: number;
    height: number;
    private ctx: ReturnType<typeof createMockCtx>;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
      this.ctx = createMockCtx(w, h);
    }
    getContext() {
      return this.ctx;
    }
    async convertToBlob(_options?: { type?: string; quality?: number }) {
      const blob = new Blob(['mock-png'], { type: _options?.type || 'image/png' });
      Object.assign(blob, {
        __canvasWidth: this.width,
        __canvasHeight: this.height,
        __pixelData: this.ctx.data,
      });
      return blob;
    }
  }

  globalThis.OffscreenCanvas = MockOffscreenCanvas as unknown as typeof OffscreenCanvas;
}

// Setup HTMLCanvasElement getContext mock in JSDOM
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    return createMockCtx(this.width, this.height);
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

// Setup global createImageBitmap mock for JSDOM test environment if missing
if (typeof globalThis.createImageBitmap === 'undefined') {
  globalThis.createImageBitmap = (async (source: unknown) => {
    const s = source as {
      width?: number;
      height?: number;
      __canvasWidth?: number;
      __canvasHeight?: number;
      __pixelData?: Uint8ClampedArray;
    };
    const w = s?.width ?? s?.__canvasWidth ?? 1024;
    const h = s?.height ?? s?.__canvasHeight ?? 768;
    return {
      width: w,
      height: h,
      __pixelData: s?.__pixelData,
      close: () => {},
    } as unknown as ImageBitmap;
  }) as typeof createImageBitmap;
}

