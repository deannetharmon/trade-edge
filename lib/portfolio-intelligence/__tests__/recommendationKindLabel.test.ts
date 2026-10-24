// lib/portfolio-intelligence/__tests__/recommendationKindLabel.test.ts

import { describe, expect, it } from 'vitest';
import { RECOMMENDATION_KIND_LABEL } from '../objectives/positionObjective';

describe('LABEL-CONSISTENCY-0001: engine kinds display in Title Case, never as raw kinds', () => {
  it('covers every kind with a Title Case label', () => {
    const kinds = ['hold', 'watch', 'let-expire', 'earnings-risk', 'assignment-risk', 'verify-pricing', 'place-gtc', 'close-winner', 'close-loser', 'roll-soon'];
    expect(Object.keys(RECOMMENDATION_KIND_LABEL).sort()).toEqual([...kinds].sort());
    for (const label of Object.values(RECOMMENDATION_KIND_LABEL)) expect(label).toMatch(/^([A-Z][a-z]+)( [A-Z][a-z]+)*$/);
  });
  it('uses the same words as the management-intent vocabulary where they mean the same thing', () => {
    expect(RECOMMENDATION_KIND_LABEL.hold).toBe('Hold Position');
    expect(RECOMMENDATION_KIND_LABEL['close-winner']).toBe('Take Profit');
    expect(RECOMMENDATION_KIND_LABEL['close-loser']).toBe('Cut Losses');
    expect(RECOMMENDATION_KIND_LABEL['roll-soon']).toBe('Roll Position');
    expect(RECOMMENDATION_KIND_LABEL['place-gtc']).toBe('Set Profit Target');
  });
});
