export type AiProfile =
  | 'analysis'
  | 'chat'
  | 'summary'
  | 'fast';

export const AI_MODEL_BY_PROFILE: Record<AiProfile, string> = {
  analysis:
    process.env.AI_ANALYSIS_MODEL ??
    process.env.AI_DEFAULT_MODEL ??
    'claude-sonnet-4-20250514',

  chat:
    process.env.AI_CHAT_MODEL ??
    process.env.AI_DEFAULT_MODEL ??
    'claude-sonnet-4-20250514',

  summary:
    process.env.AI_SUMMARY_MODEL ??
    process.env.AI_DEFAULT_MODEL ??
    'claude-sonnet-4-20250514',

  fast:
    process.env.AI_FAST_MODEL ??
    process.env.AI_DEFAULT_MODEL ??
    'claude-sonnet-4-20250514',
};

export function getAiModel(profile: AiProfile): string {
  return AI_MODEL_BY_PROFILE[profile];
}
