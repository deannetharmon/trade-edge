import { describe, expect, it } from 'vitest';
import { buildPricingVerificationGrounding } from '../pricingVerification';

describe('PI-0014C pricing-verification AI boundary', () => {
  it('returns deterministic MANAGE copy with no model-authored directional prose', () => {
    const grounded = buildPricingVerificationGrounding();

    expect(grounded).toMatchObject({ recommendation: 'MANAGE', confidence: 'LOW' });
    expect(JSON.stringify(grounded)).not.toContain('CUT LOSSES immediately');
    expect(JSON.stringify(grounded)).not.toContain('ROLL or CLOSE now');
  });
});
