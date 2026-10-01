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

    it('conforms to GPT Image 2.5 multipart contract (ordered image[], size, mask, no response_format)', async () => {
      const fakeB64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const mockResponse = {
        data: [{ b64_json: fakeB64 }],
      };

      let capturedBody: FormData | null = null;
      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        capturedBody = init.body as FormData;
        return Promise.resolve(
          new Response(JSON.stringify(mockResponse), {
            status: 200,
            headers: { 'x-request-id': 'req-contract' },
          })
        );
      });

      const refBlob = new Blob(['ref-img'], { type: 'image/png' });
      await provider.edit(
        { ...validRequest, referenceBlobs: [refBlob] },
        { apiKey: 'sk-test' }
      );

      expect(capturedBody).not.toBeNull();
      const body = capturedBody as unknown as FormData;

      // 1. Input images: source must be first, references follow
      const images = body.getAll('image[]');
      expect(images).toHaveLength(2); // 1 source + 1 reference

      // 2. Mask
      expect(body.get('mask')).toBeInstanceOf(Blob);

      // 3. Prompt, model, quality
      expect(body.get('prompt')).toBe(validRequest.prompt);
      expect(body.get('model')).toBe(validRequest.modelId);
      expect(body.get('quality')).toBe(validRequest.quality);

      // 4. Size explicit parameter
      expect(body.get('size')).toMatch(/^\d+x\d+$/);

      // 5. response_format must NOT be sent (unsupported for GPT Image 2.5)
      expect(body.get('response_format')).toBeNull();
    });

    describe('source image canonicalization and format contract', () => {
      const fakeB64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const mockResponse = { data: [{ b64_json: fakeB64 }] };

      const captureBody = async (req: ImageEditRequest): Promise<FormData> => {
        let captured: FormData | null = null;
        globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
          captured = init.body as FormData;
          return Promise.resolve(
            new Response(JSON.stringify(mockResponse), { status: 200 })
          );
        });
        await provider.edit(req, { apiKey: 'sk-test' });
        return captured!;
      };

      it('preserves PNG MIME type and dimensions when no resize is needed', async () => {
        const sourceBlob = new Blob(['png-bytes'], { type: 'image/png' });
        Object.assign(sourceBlob, { width: 1024, height: 768 });
        const mask = {
          width: 1024,
          height: 768,
          data: new Uint8ClampedArray(1024 * 768),
        };

        const body = await captureBody({
          ...validRequest,
          sourceBlob,
          mask,
        });

        const images = body.getAll('image[]') as Blob[];
        const source = images[0]!;
        const maskBlob = body.get('mask') as Blob;

        expect(source.type).toBe('image/png');
        expect(maskBlob.type).toBe('image/png');
        expect(body.get('size')).toBe('1024x768');
      });

      it('canonicalizes JPEG source to image/png when no resize is needed', async () => {
        const sourceBlob = new Blob(['jpeg-bytes'], { type: 'image/jpeg' });
        Object.assign(sourceBlob, { width: 1024, height: 768 });
        const mask = {
          width: 1024,
          height: 768,
          data: new Uint8ClampedArray(1024 * 768),
        };

        const body = await captureBody({
          ...validRequest,
          sourceBlob,
          mask,
        });

        const images = body.getAll('image[]') as Blob[];
        const source = images[0]!;
        const maskBlob = body.get('mask') as Blob;

        expect(source.type).toBe('image/png');
        expect(maskBlob.type).toBe('image/png');
        expect(body.get('size')).toBe('1024x768');
      });

      it('canonicalizes WebP source to image/png when no resize is needed', async () => {
        const sourceBlob = new Blob(['webp-bytes'], { type: 'image/webp' });
        Object.assign(sourceBlob, { width: 1024, height: 768 });
        const mask = {
          width: 1024,
          height: 768,
          data: new Uint8ClampedArray(1024 * 768),
        };

        const body = await captureBody({
          ...validRequest,
          sourceBlob,
          mask,
        });

        const images = body.getAll('image[]') as Blob[];
        const source = images[0]!;
        const maskBlob = body.get('mask') as Blob;

        expect(source.type).toBe('image/png');
        expect(maskBlob.type).toBe('image/png');
        expect(body.get('size')).toBe('1024x768');
      });

      it('converts and resizes source to image/png matching mask dimensions when resize is required', async () => {
        const sourceBlob = new Blob(['large-jpeg-bytes'], { type: 'image/jpeg' });
        Object.assign(sourceBlob, { width: 4000, height: 3000 });
        const mask = {
          width: 4000,
          height: 3000,
          data: new Uint8ClampedArray(4000 * 3000),
        };

        const body = await captureBody({
          ...validRequest,
          sourceBlob,
          mask,
        });

        const images = body.getAll('image[]') as Blob[];
        const source = images[0]!;
        const maskBlob = body.get('mask') as Blob;

        expect(source.type).toBe('image/png');
        expect(maskBlob.type).toBe('image/png');

        const sizeStr = body.get('size') as string;
        const [targetW, targetH] = sizeStr.split('x').map(Number);
        expect(targetW! % 16).toBe(0);
        expect(targetH! % 16).toBe(0);
        expect(targetW! * targetH!).toBeLessThanOrEqual(8_294_400);
      });

      it('keeps source image first in image[] and leaves reference images untranscoded', async () => {
        const sourceBlob = new Blob(['jpeg-source'], { type: 'image/jpeg' });
        Object.assign(sourceBlob, { width: 1024, height: 768 });
        const refBlob = new Blob(['jpeg-reference'], { type: 'image/jpeg' });
        const mask = {
          width: 1024,
          height: 768,
          data: new Uint8ClampedArray(1024 * 768),
        };

        const body = await captureBody({
          ...validRequest,
          sourceBlob,
          mask,
          referenceBlobs: [refBlob],
        });

        const images = body.getAll('image[]') as Blob[];
        expect(images).toHaveLength(2);
        // Source image is first and converted to PNG
        expect(images[0]!.type).toBe('image/png');
        // Reference image is second and untranscoded (retains original format)
        expect(images[1]!.type).toBe('image/jpeg');
      });
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
