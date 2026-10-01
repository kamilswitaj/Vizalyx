import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIImageEditProvider, parseOpenAIError } from '../../src/providers/openai/OpenAIImageEditProvider';
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
      expect(res.error).toMatch(/request limit reached/);
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

    describe('OpenAI error diagnostics and 429 handling', () => {
      it('handles credit_balance_exhausted payload with code and request ID', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                message: 'You have exhausted your credit balance. Please add funds to your account.',
                type: 'credit_balance_exhausted',
                code: 'credit_balance_exhausted',
              },
            }),
            {
              status: 429,
              headers: { 'x-request-id': 'req_credit_123' },
            }
          )
        );

        await expect(provider.edit(validRequest, { apiKey: 'sk-secret-key-123' })).rejects.toThrow(
          /OpenAI credit balance exhausted: You have exhausted your credit balance.*\[Code: credit_balance_exhausted, Request ID: req_credit_123\]/
        );
      });

      it('handles project_spend_limit_exceeded payload with code and request ID', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                message: 'Project monthly spend limit reached.',
                type: 'project_spend_limit_exceeded',
                code: 'project_spend_limit_exceeded',
              },
            }),
            {
              status: 429,
              headers: { 'x-request-id': 'req_spend_456' },
            }
          )
        );

        await expect(provider.edit(validRequest, { apiKey: 'sk-secret-key-123' })).rejects.toThrow(
          /OpenAI project spend limit exceeded: Project monthly spend limit reached.*\[Code: project_spend_limit_exceeded, Request ID: req_spend_456\]/
        );
      });

      it('handles real rate limit payload (RPM / requests limit)', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                message: 'Rate limit reached for requests per minute (RPM). Please slow down.',
                type: 'requests',
                code: 'rate_limit_exceeded',
              },
            }),
            {
              status: 429,
              headers: { 'x-request-id': 'req_rate_789' },
            }
          )
        );

        await expect(provider.edit(validRequest, { apiKey: 'sk-secret-key-123' })).rejects.toThrow(
          /OpenAI rate limit exceeded: Rate limit reached for requests per minute.*\[Code: rate_limit_exceeded, Request ID: req_rate_789\]/
        );
      });

      it('handles unknown 429 payload preserving message and status/type without collapsing', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                message: 'Custom throttle from proxy',
                type: 'custom_throttle',
                code: null,
              },
            }),
            {
              status: 429,
              headers: { 'x-request-id': 'req_custom_999' },
            }
          )
        );

        const errorPromise = provider.edit(validRequest, { apiKey: 'sk-secret-key-123' });
        await expect(errorPromise).rejects.toThrow(
          /OpenAI request limit reached \(HTTP 429\): Custom throttle from proxy.*\[Type: custom_throttle, Request ID: req_custom_999\]/
        );
        // Guarantee it does NOT collapse into the old generic string
        await expect(errorPromise).rejects.not.toThrow(
          'OpenAI rate limit or usage quota exceeded.'
        );
      });

      it('handles organization_spend_limit_exceeded and organization_usage_limit_exceeded', () => {
        const orgSpend = parseOpenAIError(
          429,
          {
            error: {
              message: 'Organization spend limit reached.',
              type: 'organization_spend_limit_exceeded',
              code: 'organization_spend_limit_exceeded',
            },
          },
          'req_org_1'
        );
        expect(orgSpend).toContain('OpenAI organization spend limit exceeded');
        expect(orgSpend).toContain('Code: organization_spend_limit_exceeded');
        expect(orgSpend).toContain('Request ID: req_org_1');

        const orgUsage = parseOpenAIError(
          429,
          {
            error: {
              message: 'Organization usage limit reached.',
              type: 'organization_usage_limit_exceeded',
              code: 'organization_usage_limit_exceeded',
            },
          },
          'req_org_2'
        );
        expect(orgUsage).toContain('OpenAI organization usage limit exceeded');
        expect(orgUsage).toContain('Code: organization_usage_limit_exceeded');
      });

      it('handles insufficient_quota payload separately', () => {
        const quotaErr = parseOpenAIError(
          429,
          {
            error: {
              message: 'You exceeded your current quota.',
              type: 'insufficient_quota',
              code: 'insufficient_quota',
            },
          },
          'req_quota_1'
        );
        expect(quotaErr).toContain('OpenAI quota exceeded (insufficient quota)');
        expect(quotaErr).toContain('Code: insufficient_quota');
        expect(quotaErr).toContain('Request ID: req_quota_1');
      });

      it('never includes or leaks API key in error messages', async () => {
        const secretKey = 'sk-super-secret-production-key-1234567890';
        globalThis.fetch = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                message: `Failed request with key ${secretKey}`,
                type: 'invalid_request',
                code: 'bad_request',
              },
            }),
            {
              status: 400,
            }
          )
        );

        let caughtMessage = '';
        try {
          await provider.edit(validRequest, { apiKey: secretKey });
        } catch (e) {
          caughtMessage = (e as Error).message;
        }

        expect(caughtMessage).not.toContain(secretKey);
        expect(caughtMessage).toContain('[REDACTED]');
      });

      it('validateCredentials also preserves structured diagnostics for 429', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                message: 'Credit balance exhausted.',
                type: 'credit_balance_exhausted',
                code: 'credit_balance_exhausted',
              },
            }),
            {
              status: 429,
              headers: { 'x-request-id': 'req_val_123' },
            }
          )
        );

        const res = await provider.validateCredentials({ apiKey: 'sk-test' });
        expect(res.valid).toBe(false);
        expect(res.error).toContain('OpenAI credit balance exhausted');
        expect(res.error).toContain('Request ID: req_val_123');
      });
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

    describe('Token usage capture & cost calculation', () => {
      it('extracts structured usage and calculates USD cost from successful 200 response', async () => {
        const mockB64Png =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        globalThis.fetch = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              data: [{ b64_json: mockB64Png }],
              usage: {
                input_tokens: 5200,
                input_tokens_details: {
                  image_tokens: 5000,
                  text_tokens: 200,
                },
                output_tokens: 1000,
                output_tokens_details: {
                  image_tokens: 1000,
                },
                total_tokens: 6200,
              },
            }),
            {
              status: 200,
              headers: { 'x-request-id': 'req_usage_test_1' },
            }
          )
        );

        const result = await provider.edit(validRequest, { apiKey: 'sk-test' });

        expect(result.usage).toBeDefined();
        expect(result.usage?.inputImageTokens).toBe(5000);
        expect(result.usage?.inputTextTokens).toBe(200);
        expect(result.usage?.outputImageTokens).toBe(1000);
        expect(result.usage?.totalTokens).toBe(6200);

        // Expected cost calculation:
        // 5000 * 8 / 1e6 = 0.04
        // 200 * 5 / 1e6 = 0.001
        // 1000 * 30 / 1e6 = 0.03
        // Total = 0.071 USD
        expect(result.costUsd).toBeCloseTo(0.071, 6);
        expect(result.providerRequestId).toBe('req_usage_test_1');
      });

      it('gracefully succeeds when usage object is omitted by the API', async () => {
        const mockB64Png =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        globalThis.fetch = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              data: [{ b64_json: mockB64Png }],
            }),
            {
              status: 200,
            }
          )
        );

        const result = await provider.edit(validRequest, { apiKey: 'sk-test' });

        expect(result.resultBlob).toBeInstanceOf(Blob);
        expect(result.usage).toBeUndefined();
        expect(result.costUsd).toBeUndefined();
      });
    });
  });
});
