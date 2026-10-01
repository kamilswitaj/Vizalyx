import { describe, it, expect } from 'vitest';
import { OpenAIImageEditProvider } from '../../src/providers/openai/OpenAIImageEditProvider';
import type { ImageEditRequest, RasterMask } from '../../src/providers/contracts/types';

declare const process: {
  env: Record<string, string | undefined>;
};

/**
 * Opt-in manual live OpenAI test.
 *
 * To execute:
 *   cmd /c "set OPENAI_API_KEY=sk-... && npx vitest run tests/providers/openAiLiveSmoke.manual.test.ts"
 *
 * This test is automatically SKIPPED in CI and normal npm test runs when
 * OPENAI_API_KEY is not present in process.env.
 */
const apiKey = process.env.OPENAI_API_KEY?.trim();
const hasApiKey = Boolean(apiKey && apiKey.startsWith('sk-'));

describe.runIf(hasApiKey)('OpenAI Image Edit Live Smoke Test (Manual)', () => {
  it('successfully generates an image edit via real OpenAI GPT Image 2.5 API', async () => {
    const provider = new OpenAIImageEditProvider();

    // 1. Create a 1024x1024 solid color source image
    const width = 1024;
    const height = 1024;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');

    ctx.fillStyle = '#4488cc';
    ctx.fillRect(0, 0, width, height);
    const sourceBlob = await canvas.convertToBlob({ type: 'image/png' });

    // 2. Create a 1024x1024 mask with a 256x256 central editable area (255)
    const maskData = new Uint8ClampedArray(width * height);
    const startX = 384;
    const endX = 640;
    const startY = 384;
    const endY = 640;
    for (let y = startY; y < endY; y++) {
      const rowOffset = y * width;
      for (let x = startX; x < endX; x++) {
        maskData[rowOffset + x] = 255;
      }
    }

    const mask: RasterMask = {
      width,
      height,
      data: maskData,
    };

    const request: ImageEditRequest = {
      sourceBlob,
      mask,
      referenceBlobs: [],
      prompt: 'A golden shiny coin resting on the surface',
      modelId: 'gpt-image-2.5-sunburst',
      quality: 'standard',
    };

    const result = await provider.edit(request, { apiKey: apiKey! });

    expect(result.resultBlob).toBeInstanceOf(Blob);
    expect(result.resultBlob.size).toBeGreaterThan(1000);
    expect(result.elapsedMilliseconds).toBeGreaterThan(0);
  }, 120_000); // 120s timeout for live API calls
});
