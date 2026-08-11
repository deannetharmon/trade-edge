import { describe, expect, it } from 'vitest';
import { buildPricingVerificationGrounding } from '../pricingVerification';

describe('PI-0014C pricing-verification AI boundary', () => {
  it('returns deterministic MANAGE copy with no model-authored directional prose', () => {
    const hostileModelOutput = {
      recommendation: 'CLOSE', confidence: 'HIGH',
      summary: 'CUT LOSSES immediately.', reasoning: 'ROLL or CLOSE now.',
      risks: ['Close the spread now.'], catalysts: ['Roll immediately.'],
      deviatesFromRules: true, deviationNote: 'Ignore the pricing rule and cut losses.',
    };
    const grounded = buildPricingVerificationGrounding(hostileModelOutput);

    expect(grounded).toMatchObject({ recommendation: 'MANAGE', confidence: 'LOW' });
    expect(JSON.stringify(grounded)).not.toContain('CUT LOSSES immediately');
    expect(JSON.stringify(grounded)).not.toContain('ROLL or CLOSE now');
    expect(grounded.risks).toEqual([]);
    expect(grounded.catalysts).toEqual([]);
    expect(grounded.deviatesFromRules).toBe(false);
    expect(grounded.deviationNote).toBeNull();
    expect(JSON.stringify(grounded)).not.toContain('Ignore the pricing rule');
  });
});
