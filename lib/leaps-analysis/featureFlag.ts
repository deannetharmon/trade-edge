/**
 * `LEAPS_ADVISOR_ENABLED` is the single deployment setting for the feature.
 */
export function isLeapsAnalysisEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.LEAPS_ADVISOR_ENABLED === 'true';
}
