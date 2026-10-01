import { describe, it, expect } from 'vitest';
import {
  OPENAI_GPT_IMAGE_PRICING_V1,
  calculateOpenAiImageCostUsd,
  getPricingForModel,
} from '../../src/accounting/pricing/openAiPricing';

describe('openAiPricing', () => {
  describe('pricing schedule v1', () => {
    it('defines correct official pricing rates for GPT Image 2.5', () => {
      expect(OPENAI_GPT_IMAGE_PRICING_V1.inputImageUsdPerMillion).toBe(8);
      expect(OPENAI_GPT_IMAGE_PRICING_V1.inputTextUsdPerMillion).toBe(5);
      expect(OPENAI_GPT_IMAGE_PRICING_V1.outputImageUsdPerMillion).toBe(30);
      expect(OPENAI_GPT_IMAGE_PRICING_V1.modelIds).toContain('gpt-image-2.5-sunburst');
      expect(OPENAI_GPT_IMAGE_PRICING_V1.modelIds).toContain('gpt-image-2.5-flare');
    });

    it('resolves pricing for supported models', () => {
      const sunburstPricing = getPricingForModel('gpt-image-2.5-sunburst');
      expect(sunburstPricing).toBeDefined();
      expect(sunburstPricing?.inputImageUsdPerMillion).toBe(8);

      const flarePricing = getPricingForModel('gpt-image-2.5-flare');
      expect(flarePricing).toBeDefined();
      expect(flarePricing?.outputImageUsdPerMillion).toBe(30);
    });

    it('returns undefined for unknown models', () => {
      expect(getPricingForModel('unknown-model')).toBeUndefined();
      expect(getPricingForModel('fake-model')).toBeUndefined();
    });
  });

  describe('calculateOpenAiImageCostUsd', () => {
    it('calculates cost accurately for 1M tokens of each type', () => {
      expect(
        calculateOpenAiImageCostUsd({
          inputImageTokens: 1_000_000,
          inputTextTokens: 0,
          outputImageTokens: 0,
        })
      ).toBe(8);

      expect(
        calculateOpenAiImageCostUsd({
          inputImageTokens: 0,
          inputTextTokens: 1_000_000,
          outputImageTokens: 0,
        })
      ).toBe(5);

      expect(
        calculateOpenAiImageCostUsd({
          inputImageTokens: 0,
          inputTextTokens: 0,
          outputImageTokens: 1_000_000,
        })
      ).toBe(30);
    });

    it('handles realistic generation token mix without internal rounding', () => {
      // 5,000 input image tokens: 5000 * 8 / 1e6 = 0.04
      // 200 input text tokens: 200 * 5 / 1e6 = 0.001
      // 1,000 output image tokens: 1000 * 30 / 1e6 = 0.03
      // Total: 0.071 USD
      const cost = calculateOpenAiImageCostUsd({
        inputImageTokens: 5_000,
        inputTextTokens: 200,
        outputImageTokens: 1_000,
      });

      expect(cost).toBeCloseTo(0.071, 6);
    });

    it('returns 0 for all zero tokens', () => {
      const cost = calculateOpenAiImageCostUsd({
        inputImageTokens: 0,
        inputTextTokens: 0,
        outputImageTokens: 0,
      });
      expect(cost).toBe(0);
    });

    it('handles omitted / undefined token fields gracefully as zero', () => {
      expect(calculateOpenAiImageCostUsd({})).toBe(0);
      expect(calculateOpenAiImageCostUsd({ outputImageTokens: 500 })).toBeCloseTo(0.015, 6);
    });
  });
});
