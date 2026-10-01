export interface OpenAiModelPricing {
  readonly version: string;
  readonly effectiveFrom: string; // ISO date string e.g. "2025-01-01"
  readonly modelIds: readonly string[];
  readonly inputImageUsdPerMillion: number;
  readonly inputTextUsdPerMillion: number;
  readonly outputImageUsdPerMillion: number;
}

/**
 * Current official OpenAI GPT Image 2.5 pricing rates:
 * - Image input: $8 per 1,000,000 tokens
 * - Text input: $5 per 1,000,000 tokens
 * - Image output: $30 per 1,000,000 tokens
 * Applies to both Sunburst and Flare models.
 */
export const OPENAI_GPT_IMAGE_PRICING_V1: OpenAiModelPricing = {
  version: '2025-01-01',
  effectiveFrom: '2025-01-01',
  modelIds: ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'],
  inputImageUsdPerMillion: 8,
  inputTextUsdPerMillion: 5,
  outputImageUsdPerMillion: 30,
};

export const PRICING_VERSIONS: readonly OpenAiModelPricing[] = [
  OPENAI_GPT_IMAGE_PRICING_V1,
];

/**
 * Resolves the effective pricing schedule for a model.
 */
export function getPricingForModel(modelId: string): OpenAiModelPricing | undefined {
  return PRICING_VERSIONS.find(p => p.modelIds.includes(modelId));
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
  pricing: OpenAiModelPricing = OPENAI_GPT_IMAGE_PRICING_V1
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
