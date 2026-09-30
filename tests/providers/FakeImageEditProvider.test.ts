import { describe, it, expect, vi, beforeAll } from 'vitest';
import { FakeImageEditProvider } from '../../src/providers/fake/FakeImageEditProvider';
import type { ImageEditRequest } from '../../src/providers/contracts/types';

beforeAll(() => {
  if (typeof globalThis.createImageBitmap === 'undefined') {
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({
      width: 10,
      height: 10,
      close: vi.fn(),
    } as unknown as ImageBitmap);
  }

  if (typeof globalThis.OffscreenCanvas === 'undefined') {
    const mockCtx = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      globalAlpha: 1,
      fillStyle: '',
    };
    class MockOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return mockCtx;
      }
      async convertToBlob() {
        return new Blob(['fake-png'], { type: 'image/png' });
      }
    }
    globalThis.OffscreenCanvas = MockOffscreenCanvas as unknown as typeof OffscreenCanvas;
  }
});

describe('FakeImageEditProvider', () => {
  const provider = new FakeImageEditProvider();

  it('returns fake descriptor', () => {
    const descriptor = provider.getDescriptor();
    expect(descriptor.id).toBe('fake');
    expect(descriptor.displayName).toBe('Fake (Dev/Test)');
    expect(descriptor.models).toHaveLength(1);
    expect(descriptor.models[0]?.id).toBe('fake-model');
  });

  it('validates credentials successfully', async () => {
    const result = await provider.validateCredentials({ apiKey: 'any-key' });
    expect(result.valid).toBe(true);
  });

  it('executes edit and returns result blob', async () => {
    const request: ImageEditRequest = {
      sourceBlob: new Blob(['source'], { type: 'image/png' }),
      mask: {
        width: 10,
        height: 10,
        data: new Uint8ClampedArray(100),
      },
      referenceBlobs: [],
      prompt: 'a prompt with spaces',
      modelId: 'fake-model',
      quality: 'standard',
    };

    const result = await provider.edit(request, { apiKey: '' });
    expect(result.resultBlob).toBeDefined();
    expect(result.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
  });

  it('cancels edit when aborted', async () => {
    const controller = new AbortController();
    const request: ImageEditRequest = {
      sourceBlob: new Blob(['source'], { type: 'image/png' }),
      mask: {
        width: 10,
        height: 10,
        data: new Uint8ClampedArray(100),
      },
      referenceBlobs: [],
      prompt: 'a prompt with spaces',
      modelId: 'fake-model',
      quality: 'standard',
    };

    const editPromise = provider.edit(request, { apiKey: '' }, controller.signal);
    controller.abort();

    await expect(editPromise).rejects.toThrow('Aborted');
  });
});
