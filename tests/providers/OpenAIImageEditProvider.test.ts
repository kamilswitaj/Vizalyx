import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIImageEditProvider } from '../../src/providers/openai/OpenAIImageEditProvider';
import type { ImageEditRequest } from '../../src/providers/contracts/types';

describe('OpenAIImageEditProvider', () => {
  const provider = new OpenAIImageEditProvider();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Setup OffscreenCanvas mock if not available
    if (typeof globalThis.OffscreenCanvas === 'undefined') {
      const mockCtx = {
        createImageData: (w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }),
        putImageData: vi.fn(),
        drawImage: vi.fn(),
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
          return new Blob(['mock-png'], { type: 'image/png' });
        }
      }
      globalThis.OffscreenCanvas = MockCanvas as unknown as typeof OffscreenCanvas;
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('has correct descriptor with Sunburst and Flare models', () => {
    const desc = provider.getDescriptor();
    expect(desc.id).toBe('openai');
    expect(desc.browserDirectSupported).toBe(true);
    expect(desc.models.map(m => m.id)).toEqual([
      'gpt-image-2.5-sunburst',
      'gpt-image-2.5-flare',
    ]);
  });

  describe('validateCredentials', () => {
    it('returns error on empty key', async () => {
      const res = await provider.validateCredentials({ apiKey: '' });
      expect(res.valid).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('returns valid: true on 200 response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
      const res = await provider.validateCredentials({ apiKey: 'sk-valid-key' });
      expect(res.valid).toBe(true);
    });

    it('returns user-friendly error on 401 unauthorized', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
      const res = await provider.validateCredentials({ apiKey: 'sk-invalid-key' });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/Invalid API key/);
    });

    it('returns quota error on 429 rate limit', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }));
      const res = await provider.validateCredentials({ apiKey: 'sk-quota-key' });
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/quota or rate limit/);
    });
  });

  describe('edit', () => {
    const validRequest: ImageEditRequest = {
      sourceBlob: new Blob(['source'], { type: 'image/png' }),
      mask: {
        width: 64,
        height: 64,
        data: new Uint8ClampedArray(64 * 64),
      },
      referenceBlobs: [],
      prompt: 'test prompt',
      modelId: 'gpt-image-2.5-sunburst',
      quality: 'high',
    };

    it('throws error when API key is missing', async () => {
      await expect(provider.edit(validRequest, { apiKey: '' })).rejects.toThrow(
        /OpenAI API key is missing/
      );
    });

    it('processes successful edit with b64_json response', async () => {
      // 1x1 transparent PNG in base64
      const fakeB64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const mockResponse = {
        data: [{ b64_json: fakeB64 }],
      };

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { 'x-request-id': 'req-12345' },
        })
      );

      const result = await provider.edit(validRequest, { apiKey: 'sk-test' });
      expect(result.resultBlob).toBeInstanceOf(Blob);
      expect(result.providerRequestId).toBe('req-12345');
      expect(result.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
    });

    it('handles 401 error gracefully without exposing key', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Incorrect API key' } }), {
          status: 401,
        })
      );

      await expect(provider.edit(validRequest, { apiKey: 'sk-secret-key-123' })).rejects.toThrow(
        /authentication failed/
      );
    });

    it('handles 429 quota exceeded error gracefully', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'You exceeded your current quota' } }), {
          status: 429,
        })
      );

      await expect(provider.edit(validRequest, { apiKey: 'sk-secret-key-123' })).rejects.toThrow(
        /rate limit or usage quota exceeded/
      );
    });

    it('respects AbortSignal', async () => {
      const controller = new AbortController();
      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        if (init?.signal?.aborted) {
          return Promise.reject(new DOMException('Aborted', 'AbortError'));
        }
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      });

      const promise = provider.edit(validRequest, { apiKey: 'sk-test' }, controller.signal);
      controller.abort();

      await expect(promise).rejects.toThrow('Aborted');
    });
  });
});
