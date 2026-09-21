// lib/ai-policy/pricing.ts
//
// Per-model USD price table and worst-case cost estimator. An unpriced model is unavailable (fail closed).
// Prices are USD per 1M tokens, Standard processing, short context, taken from OpenAI's official pricing page
// (https://developers.openai.com/api/docs/pricing) on 2026-09-21. `gpt-4o-mini`, the epic's suggested economy model,
// is NOT on that page any more, so it is deliberately absent until Dean names an economy model (D3) and it is priced.
// Prompts are bounded far below any long-context threshold, so only short-context rates are used.

export interface ModelPrice {
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
  verifiedOn: string;
  source: string;
}

const SOURCE = 'https://developers.openai.com/api/docs/pricing (Standard, short context)';
const VERIFIED = '2026-09-21';

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'gpt-5.6-luna': { inputPerMTokUsd: 0.2, outputPerMTokUsd: 1.2, verifiedOn: VERIFIED, source: SOURCE },
  'gpt-5.6-terra': { inputPerMTokUsd: 2, outputPerMTokUsd: 12, verifiedOn: VERIFIED, source: SOURCE },
  'gpt-5.6-sol': { inputPerMTokUsd: 4, outputPerMTokUsd: 20, verifiedOn: VERIFIED, source: SOURCE },
  'gpt-6-astra': { inputPerMTokUsd: 10, outputPerMTokUsd: 50, verifiedOn: VERIFIED, source: SOURCE },
};

export function pricingFor(model: string): ModelPrice | null {
  return Object.prototype.hasOwnProperty.call(MODEL_PRICES, model) ? MODEL_PRICES[model] : null;
}

/** Conservative token estimate: 1 token per 3 characters, rounded up, plus fixed request overhead. */
export function estimateInputTokens(characters: number): number {
  return Math.ceil(characters / 3) + 64;
}

function costMicros(price: ModelPrice, inputTokens: number, outputTokens: number): number {
  const usd = (inputTokens * price.inputPerMTokUsd + outputTokens * price.outputPerMTokUsd) / 1_000_000;
  return Math.ceil(usd * 1_000_000 - 1e-9);
}

/** Worst case: the estimated prompt plus the full output allowance (reasoning tokens bill as output). Null when unpriced. */
export function estimateWorstCaseMicros(model: string, promptCharacters: number, maxOutputTokens: number): number | null {
  const price = pricingFor(model);
  if (!price) return null;
  return costMicros(price, estimateInputTokens(promptCharacters), maxOutputTokens);
}

export function actualCostMicros(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = pricingFor(model);
  if (!price) return null;
  return costMicros(price, inputTokens, outputTokens);
}
