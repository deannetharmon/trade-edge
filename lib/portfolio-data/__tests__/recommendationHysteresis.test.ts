// lib/portfolio-data/__tests__/recommendationHysteresis.test.ts

import { describe, expect, it } from 'vitest';
import { confirmRecommendationChange, recommendationKey } from '../recommendationHysteresis';
import type { PortfolioRecommendation } from '@/lib/portfolio-intelligence/objectives/positionObjective';

const rec = (kind: string, intent?: string, label = kind): PortfolioRecommendation =>
  ({ kind, label, managementIntent: intent ? { intent } : undefined } as unknown as PortfolioRecommendation);

const HOLD = rec('hold', 'HOLD_POSITION', 'Hold Position');
const SET_TARGET = rec('place-gtc', 'SET_PROFIT_TARGET', 'Set Profit Target');
const CUT = rec('close-loser', 'CUT_LOSSES', 'Cut Losses');

describe('confirmRecommendationChange', () => {
  it('first load (no previous result) shows the result as computed', () => {
    expect(confirmRecommendationChange(undefined, { recommendation: SET_TARGET })).toMatchObject({ recommendation: SET_TARGET, recommendationPending: null });
  });

  it('an unchanged recommendation passes through with its fresh text', () => {
    const fresh = rec('hold', 'HOLD_POSITION', 'Hold Position');
    expect(confirmRecommendationChange({ recommendation: HOLD }, { recommendation: fresh }).recommendation).toBe(fresh);
  });

  it('Hold -> Set Profit Target: held on the first refresh, shown on the second', () => {
    const first = confirmRecommendationChange({ recommendation: HOLD, portfolioObjective: null }, { recommendation: SET_TARGET });
    expect(first.recommendation).toBe(HOLD);
    expect(first.recommendationPending).toEqual({ key: 'place-gtc|SET_PROFIT_TARGET', label: 'Set Profit Target' });
    const second = confirmRecommendationChange(first, { recommendation: SET_TARGET });
    expect(second.recommendation).toBe(SET_TARGET);
    expect(second.recommendationPending).toBeNull();
  });

  it('flip-flopping around a threshold never changes what is shown', () => {
    let state = confirmRecommendationChange(undefined, { recommendation: HOLD });
    for (const next of [SET_TARGET, HOLD, SET_TARGET, HOLD]) state = confirmRecommendationChange(state, { recommendation: next });
    expect(state.recommendation).toBe(HOLD);
  });

  it('works in both directions: Set Profit Target -> Hold also needs a second refresh', () => {
    const first = confirmRecommendationChange({ recommendation: SET_TARGET }, { recommendation: HOLD });
    expect(first.recommendation).toBe(SET_TARGET);
    expect(confirmRecommendationChange(first, { recommendation: HOLD }).recommendation).toBe(HOLD);
  });

  it('a change TO an urgent recommendation shows at once', () => {
    for (const kind of ['close-loser', 'assignment-risk', 'earnings-risk', 'verify-pricing']) {
      const urgent = rec(kind);
      expect(confirmRecommendationChange({ recommendation: HOLD }, { recommendation: urgent }).recommendation).toBe(urgent);
    }
  });

  it('leaving an urgent recommendation still needs the second refresh', () => {
    const first = confirmRecommendationChange({ recommendation: CUT }, { recommendation: HOLD });
    expect(first.recommendation).toBe(CUT);
    expect(confirmRecommendationChange(first, { recommendation: HOLD }).recommendation).toBe(HOLD);
  });

  it('keys on kind plus winning intent', () => {
    expect(recommendationKey(SET_TARGET)).toBe('place-gtc|SET_PROFIT_TARGET');
    expect(recommendationKey(undefined)).toBeNull();
  });
});
