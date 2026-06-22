export type AiProfile = 'analysis' | 'chat' | 'summary' | 'fast';

export const AI_MODEL_BY_PROFILE: Record<AiProfile, string> = {
  analysis:
    process.env.AI_ANALYSIS_MODEL ??
    process.env.AI_DEFAULT_MODEL ??
    'gpt-4o',

  chat:
    process.env.AI_CHAT_MODEL ??
    process.env.AI_DEFAULT_MODEL ??
    'gpt-4o',

  summary:
    process.env.AI_SUMMARY_MODEL ??
    process.env.AI_DEFAULT_MODEL ??
    'gpt-4o',

  fast:
    process.env.AI_FAST_MODEL ??
    process.env.AI_DEFAULT_MODEL ??
    'gpt-4o-mini',
};

export function getAiModel(profile: AiProfile): string {
  return AI_MODEL_BY_PROFILE[profile];
}
