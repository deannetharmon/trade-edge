import { describe, expect, it } from 'vitest';
import { buildSnapshot, requestFingerprint, validateAnalysisOutput } from '../analysisService';

const review: any = {
  qualification: { status: 'CONTRACT_QUALIFIED', gates: [], extrinsicPctOfCost: 20, spreadPct: 2, policyVersion: 'test-v1' },
  occSymbol: 'MSFT  270101C00300000', symbol: 'MSFT', strike: 300, expiration: '2027-01-01', dte: 300,
  bid: 205, ask: 207, spot: 500, delta: 0.8, openInterest: 1000, impliedVolatility: 0.25,
  optionQuoteTimestamp: new Date().toISOString(), underlyingQuoteTimestamp: new Date().toISOString(),
  instrumentType: 'Equity Option', multiplier: 100, provider: 'tastytrade', fetchedAt: new Date().toISOString(),
};

describe('LEAPS analysis snapshot', () => {
  it('computes contract mechanics from the immutable provider evidence', () => {
    const snapshot = buildSnapshot(review, 'future_pmcc', 2, 'income later');
    expect(snapshot.mechanics.midPerShare).toBe(206);
    expect(snapshot.mechanics.intrinsicPerShare).toBe(200);
    expect(snapshot.mechanics.extrinsicPerShare).toBe(6);
    expect(snapshot.mechanics.costPerContract).toBe(20_600);
    expect(snapshot.mechanics.totalEstimatedCost).toBe(41_200);
    expect(snapshot.provenance.provider).toBe('tastytrade');
  });

  it('canonicalizes nested objects before hashing', () => {
    expect(requestFingerprint({ b: { y: 2, x: 1 }, a: 0 })).toBe(requestFingerprint({ a: 0, b: { x: 1, y: 2 } }));
  });
});

describe('LEAPS AI output boundary', () => {
  const valid = { posture: 'SUPPORTS_FURTHER_REVIEW', evidence: [{ field: 'delta', fact: '0.80' }], inferences: [{ statement: 'Extrinsic cost is limited relative to the midpoint.', uncertainty: 'Quote may change.' }], mechanics: 'The call has intrinsic and extrinsic value.', tradeoffs: 'Capital, delta, DTE, liquidity, IV, and breakeven remain relevant.', cautions: ['Wide markets can change fills.'], missing: [] };
  it('accepts the strict non-authoritative schema', () => expect(validateAnalysisOutput(valid).valid).toBe(true));
  it('rejects transaction direction language', () => expect(validateAnalysisOutput({ ...valid, mechanics: 'Buy this contract.' }).valid).toBe(false));
  it('rejects additional top-level fields', () => expect(validateAnalysisOutput({ ...valid, ranking: 1 }).valid).toBe(false));
});
