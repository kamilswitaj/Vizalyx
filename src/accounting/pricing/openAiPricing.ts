export interface OpenAiModelPricing {
  readonly pricingId: string;
  readonly verifiedAt: string; // ISO date string e.g. "2026-10-01"
  readonly modelIds: readonly string[];
  readonly inputImageUsdPerMillion: number;
  readonly inputTextUsdPerMillion: number;
  readonly outputImageUsdPerMillion: number;
}

/**
 * Current verified OpenAI GPT Image 2.5 standard direct pricing rates:
 * - Image input: $8 per 1,000,000 tokens
 * - Text input: $5 per 1,000,000 tokens
 * - Image output: $30 per 1,000,000 tokens
 * Note: Cached-input pricing does not apply to direct /v1/images/edits requests.
 * Applies to both Sunburst and Flare models.
 */
export const OPENAI_GPT_IMAGE_PRICING_2026_10_01: OpenAiModelPricing = {
  pricingId: 'openai-gpt-image-2.5-standard-2026-10-01',
  verifiedAt: '2026-10-01',
  modelIds: ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'],
  inputImageUsdPerMillion: 8,
  inputTextUsdPerMillion: 5,
  outputImageUsdPerMillion: 30,
};

// Backward-compatible alias for existing imports
export const OPENAI_GPT_IMAGE_PRICING_V1 = OPENAI_GPT_IMAGE_PRICING_2026_10_01;

export const PRICING_VERSIONS: readonly OpenAiModelPricing[] = [
  OPENAI_GPT_IMAGE_PRICING_2026_10_01,
];

/**
 * Resolves the effective pricing schedule for a model.
 */
export function getPricingForModel(modelId: string): OpenAiModelPricing | undefined {
  return PRICING_VERSIONS.find(p => p.modelIds.includes(modelId));
}

/**
 * Resolves pricing schedule by explicit pricingId.
 */
export function getPricingById(pricingId: string): OpenAiModelPricing | undefined {
  return PRICING_VERSIONS.find(p => p.pricingId === pricingId);
}

/**
 * Computes exact USD cost from actual token usage and pricing schedule.
 * Does NOT round internally to preserve exact mathematical precision.
 * Formula:
 *   usd = inputImageTokens * 8 / 1_000_000
 *       + inputTextTokens  * 5 / 1_000_000
 *       + outputImageTokens * 30 / 1_000_000
 */
export function calculateOpenAiImageCostUsd(
  usage: {
    inputImageTokens?: number;
    inputTextTokens?: number;
    outputImageTokens?: number;
  },
  pricing: OpenAiModelPricing = OPENAI_GPT_IMAGE_PRICING_2026_10_01
): number {
  const inputImage = usage.inputImageTokens ?? 0;
  const inputText = usage.inputTextTokens ?? 0;
  const outputImage = usage.outputImageTokens ?? 0;

  const cost =
    (inputImage * pricing.inputImageUsdPerMillion) / 1_000_000 +
    (inputText * pricing.inputTextUsdPerMillion) / 1_000_000 +
    (outputImage * pricing.outputImageUsdPerMillion) / 1_000_000;

  return cost;
}
