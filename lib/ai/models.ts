// lib/ai/models.ts
// Centralized AI model selection by capability/profile.
// Change model names in environment variables instead of editing app code.

export type AiProfile = 'analysis' | 'chat' | 'summary' | 'fast' | 'search';

const DEFAULT_ANALYSIS_MODEL = 'gpt-4o';
const DEFAULT_CHAT_MODEL = 'gpt-4o';
const DEFAULT_SUMMARY_MODEL = 'gpt-4o-mini';
const DEFAULT_FAST_MODEL = 'gpt-4o-mini';
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
