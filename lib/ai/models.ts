// lib/ai/models.ts
// Centralized AI model selection by capability/profile.
// Change model names in environment variables instead of editing app code.

export type AiProfile = 'analysis' | 'chat' | 'summary' | 'fast' | 'search';

// AI-POLICY-0001 D3 (Dean, 2026-10-06): decision tier gpt-5.6-terra, economy tier gpt-5.6-luna; gpt-4o-mini retired.
// Search stays on gpt-4o until web search is verified on the 5.6 models.
const DEFAULT_ANALYSIS_MODEL = 'gpt-5.6-terra';
const DEFAULT_CHAT_MODEL = 'gpt-5.6-terra';
const DEFAULT_SUMMARY_MODEL = 'gpt-5.6-luna';
const DEFAULT_FAST_MODEL = 'gpt-5.6-luna';
const DEFAULT_SEARCH_MODEL = 'gpt-4o';

export const AI_MODEL_BY_PROFILE: Record<AiProfile, string> = {
  analysis:
    process.env.AI_ANALYSIS_MODEL ??
    process.env.AI_DEFAULT_MODEL ??
    DEFAULT_ANALYSIS_MODEL,

  chat:
    process.env.AI_CHAT_MODEL ??
    process.env.AI_DEFAULT_MODEL ??
    DEFAULT_CHAT_MODEL,

  summary:
    process.env.AI_SUMMARY_MODEL ??
    process.env.AI_FAST_MODEL ??
    process.env.AI_DEFAULT_MODEL ??
    DEFAULT_SUMMARY_MODEL,

  fast:
    process.env.AI_FAST_MODEL ??
    process.env.AI_DEFAULT_MODEL ??
    DEFAULT_FAST_MODEL,

  search:
    process.env.AI_SEARCH_MODEL ??
    process.env.AI_CHAT_MODEL ??
    process.env.AI_DEFAULT_MODEL ??
    DEFAULT_SEARCH_MODEL,
};

export function isAiProfile(value: unknown): value is AiProfile {
  return (
    value === 'analysis' ||
    value === 'chat' ||
    value === 'summary' ||
    value === 'fast' ||
    value === 'search'
  );
}

export function getAiModel(profile: AiProfile = 'analysis'): string {
  return AI_MODEL_BY_PROFILE[profile];
}

// AI-POLICY-0001 D3: LEAPS routes default to the decision tier; the old models stay allowed for rollback via env.
export const DEFAULT_LEAPS_MODEL = 'gpt-5.6-terra';
export const DEFAULT_LEAPS_ALLOWED_MODELS = 'gpt-5.6-terra,gpt-5.6-luna,gpt-4o-mini,gpt-4o,gpt-5-mini,gpt-5';

/**
 * Chat Completions token and temperature parameters per model family. Reasoning models (gpt-5.x, o-series) reject
 * max_tokens and any temperature other than the default, and spend part of the budget thinking, so they get
 * max_completion_tokens with a 4,000 floor (billing is for tokens used) and no temperature.
 */
export function completionParams(model: string, maxTokens: number, temperature?: number): Record<string, number> {
  if (/^(?:gpt-[5-9]|o\d)/.test(model)) return { max_completion_tokens: Math.max(maxTokens, 4000) };
  return temperature == null ? { max_tokens: maxTokens } : { max_tokens: maxTokens, temperature };
}
