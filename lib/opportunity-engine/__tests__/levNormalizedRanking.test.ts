import { describe, expect, it } from 'vitest';
import { rankOpportunityCandidates } from '../rankOpportunityCandidates';
import { buildOpportunityCandidateFixture } from './decisionAnalysisFixture';

const context = {
  availableCapital: 100_000,
  generatedAt: '2026-10-01T00:00:00.000Z',
};

describe('LEV-0001 normalized opportunity ranking', () => {
  it('allows a leveraged expression to rank first when its canonical score is highest and risk is clear', () => {
    const leveraged = buildOpportunityCandidateFixture({
      id: 'decision-nvdu',
      symbol: 'NVDU',
      opportunityScoreTotal: 92,
      candidateOverrides: {
        id: 'nvdu',
        normalizedRisk: {
          economicUnderlying: 'NVDA',
          normalizationAuthoritative: true,
          initialEffectiveExposure: 20_000,
          capitalEfficiency: 2,
          hardRiskGatePassed: true,
        },
      },
    });
    const ordinary = buildOpportunityCandidateFixture({
      id: 'decision-nvda',
      symbol: 'NVDA',
      opportunityScoreTotal: 85,
      candidateOverrides: {
        id: 'nvda',
        normalizedRisk: {
          economicUnderlying: 'NVDA',
          normalizationAuthoritative: true,
          initialEffectiveExposure: 10_000,
          capitalEfficiency: 1,
          hardRiskGatePassed: true,
        },
      },
    });

    const ranked = rankOpportunityCandidates([ordinary, leveraged], context);
    expect(ranked[0]).toMatchObject({ candidateId: 'nvdu', comparableRank: 1, economicUnderlying: 'NVDA' });
    expect(ranked[1]).toMatchObject({ candidateId: 'nvda', comparableRank: 2 });
  });

  it('does not award leverage a bonus when canonical scores favor the ordinary expression', () => {
    const leveraged = buildOpportunityCandidateFixture({
      symbol: 'NVDU',
      opportunityScoreTotal: 70,
      candidateOverrides: {
        id: 'leveraged',
        normalizedRisk: {
          economicUnderlying: 'NVDA',
          normalizationAuthoritative: true,
          capitalEfficiency: 2,
          hardRiskGatePassed: true,
        },
      },
    });
    const ordinary = buildOpportunityCandidateFixture({
      symbol: 'NVDA',
      opportunityScoreTotal: 90,
      candidateOverrides: {
        id: 'ordinary',
        normalizedRisk: {
          economicUnderlying: 'NVDA',
          normalizationAuthoritative: true,
          capitalEfficiency: 1,
          hardRiskGatePassed: true,
        },
      },
    });

    expect(rankOpportunityCandidates([leveraged, ordinary], context)[0].candidateId).toBe('ordinary');
  });

  it('withholds comparable rank when normalization is incomplete', () => {
    const incomplete = buildOpportunityCandidateFixture({
      symbol: 'MYSTERY',
      opportunityScoreTotal: 99,
      candidateOverrides: {
        id: 'incomplete',
        normalizedRisk: {
          economicUnderlying: null,
          normalizationAuthoritative: false,
          hardRiskGatePassed: false,
        },
      },
    });
    const ranked = rankOpportunityCandidates([incomplete], context);
    expect(ranked[0]).toMatchObject({ disposition: 'WATCH', comparableRank: null });
    expect(ranked[0].ruleIds).toContain('oe_normalization_incomplete');
  });

  it('hard risk failure remains rejected regardless of score', () => {
    const failed = buildOpportunityCandidateFixture({
      symbol: 'NVDU',
      opportunityScoreTotal: 100,
      candidateOverrides: {
        id: 'failed',
        normalizedRisk: {
          economicUnderlying: 'NVDA',
          normalizationAuthoritative: true,
          hardRiskGatePassed: false,
          hardRiskGateReasons: ['Underlying gross exposure exceeds configured limit.'],
        },
      },
    });
    const safe = buildOpportunityCandidateFixture({
      symbol: 'NVDA',
      opportunityScoreTotal: 50,
      candidateOverrides: {
        id: 'safe',
        normalizedRisk: {
          economicUnderlying: 'NVDA',
          normalizationAuthoritative: true,
          hardRiskGatePassed: true,
        },
      },
    });
    const ranked = rankOpportunityCandidates([failed, safe], context);
    expect(ranked.find(r => r.candidateId === 'failed')).toMatchObject({ disposition: 'REJECTED', comparableRank: null });
    expect(ranked.find(r => r.candidateId === 'safe')).toMatchObject({ comparableRank: 1 });
  });

  it('preserves legacy candidate behavior when normalizedRisk is absent', () => {
    const a = buildOpportunityCandidateFixture({ opportunityScoreTotal: 90, candidateOverrides: { id: 'a' } });
    const b = buildOpportunityCandidateFixture({ opportunityScoreTotal: 80, candidateOverrides: { id: 'b' } });
    const ranked = rankOpportunityCandidates([b, a], context);
    expect(ranked.map(r => [r.candidateId, r.comparableRank])).toEqual([['a', 1], ['b', 2]]);
  });
});
