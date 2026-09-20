import { describe, expect, it } from 'vitest';
import { isLeapsAnalysisEnabled } from '../featureFlag';

describe('LEAPS analysis feature flag', () => {
  it('uses the established advisor flag', () => {
    expect(isLeapsAnalysisEnabled({ LEAPS_ADVISOR_ENABLED: 'true' })).toBe(true);
  });

  it('fails closed for absent or non-exact values', () => {
    expect(isLeapsAnalysisEnabled({})).toBe(false);
    expect(isLeapsAnalysisEnabled({ LEAPS_ADVISOR_ENABLED: 'TRUE' })).toBe(false);
  });
});
