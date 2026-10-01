import { describe, it, expect } from 'vitest';
import {
  OPENAI_GPT_IMAGE_PRICING_2026_10_01,
  OPENAI_GPT_IMAGE_PRICING_V1,
  calculateOpenAiImageCostUsd,
  getPricingForModel,
  getPricingById,
  type OpenAiModelPricing,
} from '../../src/accounting/pricing/openAiPricing';

describe('openAiPricing', () => {
  describe('auditable pricing metadata', () => {
    it('defines auditable pricingId and verifiedAt for GPT Image 2.5 standard direct pricing', () => {
      expect(OPENAI_GPT_IMAGE_PRICING_2026_10_01.pricingId).toBe(
        'openai-gpt-image-2.5-standard-2026-10-01'
      );
      expect(OPENAI_GPT_IMAGE_PRICING_2026_10_01.verifiedAt).toBe('2026-10-01');
      expect(OPENAI_GPT_IMAGE_PRICING_2026_10_01.inputImageUsdPerMillion).toBe(8);
      expect(OPENAI_GPT_IMAGE_PRICING_2026_10_01.inputTextUsdPerMillion).toBe(5);
      expect(OPENAI_GPT_IMAGE_PRICING_2026_10_01.outputImageUsdPerMillion).toBe(30);
      expect(OPENAI_GPT_IMAGE_PRICING_2026_10_01.modelIds).toContain('gpt-image-2.5-sunburst');
      expect(OPENAI_GPT_IMAGE_PRICING_2026_10_01.modelIds).toContain('gpt-image-2.5-flare');

      // V1 alias matches current verified pricing
      expect(OPENAI_GPT_IMAGE_PRICING_V1).toBe(OPENAI_GPT_IMAGE_PRICING_2026_10_01);
    });

    it('resolves pricing for supported models with pricingId', () => {
      const sunburstPricing = getPricingForModel('gpt-image-2.5-sunburst');
      expect(sunburstPricing).toBeDefined();
      expect(sunburstPricing?.pricingId).toBe('openai-gpt-image-2.5-standard-2026-10-01');
      expect(sunburstPricing?.inputImageUsdPerMillion).toBe(8);

      const flarePricing = getPricingForModel('gpt-image-2.5-flare');
      expect(flarePricing).toBeDefined();
      expect(flarePricing?.pricingId).toBe('openai-gpt-image-2.5-standard-2026-10-01');
      expect(flarePricing?.outputImageUsdPerMillion).toBe(30);
    });

    it('resolves pricing by explicit pricingId', () => {
      const pricing = getPricingById('openai-gpt-image-2.5-standard-2026-10-01');
      expect(pricing).toBeDefined();
      expect(pricing?.verifiedAt).toBe('2026-10-01');
      expect(pricing?.outputImageUsdPerMillion).toBe(30);

      expect(getPricingById('nonexistent-pricing')).toBeUndefined();
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

    it('calculates using explicitly selected pricing schedule', () => {
      const customPricing: OpenAiModelPricing = {
        pricingId: 'custom-promo-2027-01-01',
        verifiedAt: '2027-01-01',
        modelIds: ['gpt-image-2.5-sunburst'],
        inputImageUsdPerMillion: 4,
        inputTextUsdPerMillion: 2.5,
        outputImageUsdPerMillion: 15,
      };

      const cost = calculateOpenAiImageCostUsd(
        {
          inputImageTokens: 1_000_000,
          inputTextTokens: 1_000_000,
          outputImageTokens: 1_000_000,
        },
        customPricing
      );

      // 4 + 2.5 + 15 = 21.5
      expect(cost).toBe(21.5);
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
