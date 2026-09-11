import { describe, expect, it } from 'vitest';
import { compareQualifiedPmcc, PMCC_RANKING_WEIGHTS_V1, scoreQualifiedPmcc, type QualifiedPmccRankingInput } from '../pmccRankingPolicy';

const input = (overrides: Partial<QualifiedPmccRankingInput> = {}): QualifiedPmccRankingInput => ({
  qualified: true,
  dimensions: { safety: 1, liquidity: 1, leapsQuality: 1, capitalEfficiency: 1, premiumQuality: 1, upsideParticipation: 1 },
  tieBreakers: { cushionPerShare: 3, worstLegLiquidity: 0.8, modeledSlippage: 0.2, leapsExtrinsicBurden: 0.1, capitalRequired: 5000, stableOccKey: 'AAA' },
  ...overrides,
});

describe('canonical PMCC ranking policy V1 shadow', () => {
  it('weights sum to 100', () => {
    expect(Object.values(PMCC_RANKING_WEIGHTS_V1).reduce((sum, weight) => sum + weight, 0)).toBe(100);
  });

  it('awards 100 only when every normalized dimension is full', () => {
    expect(scoreQualifiedPmcc(input())).toMatchObject({ available: true, total: 100 });
  });

  it('never ranks an unqualified or incomplete candidate', () => {
    expect(scoreQualifiedPmcc(input({ qualified: false })).available).toBe(false);
    const incomplete = input();
    incomplete.dimensions.premiumQuality = null;
    expect(scoreQualifiedPmcc(incomplete)).toMatchObject({ available: false, total: null, incompleteDimensions: ['premiumQuality'] });
  });

  it('clamps normalized dimensions rather than creating scores outside 0–100', () => {
    const extreme = input({ dimensions: { safety: 3, liquidity: -4, leapsQuality: 1, capitalEfficiency: 1, premiumQuality: 1, upsideParticipation: 1 } });
    expect(scoreQualifiedPmcc(extreme).total).toBe(80);
  });

  it('uses the approved deterministic tie-break order', () => {
    const aInput = input();
    const bInput = input({ tieBreakers: { ...input().tieBreakers, cushionPerShare: 4, stableOccKey: 'ZZZ' } });
    const sorted = [
      { input: aInput, result: scoreQualifiedPmcc(aInput) },
      { input: bInput, result: scoreQualifiedPmcc(bInput) },
    ].sort(compareQualifiedPmcc);
    expect(sorted[0].input.tieBreakers.cushionPerShare).toBe(4);
  });
});
