import { describe, expect, it } from 'vitest';
import { groupRecommendationsByEconomicUnderlying } from '../groupByEconomicUnderlying';
import type { OpportunityRecommendation } from '../types';

const rec = (symbol: string, underlying?: string): OpportunityRecommendation => ({
  candidateId: symbol,
  source: 'screener',
  symbol,
  strategy: 'BPS',
  rank: 1,
  disposition: 'RECOMMENDED',
  opportunityScoreTotal: 80,
  decisionConfidenceTotal: 80,
  primaryReason: 'fixture',
  supportingFactors: [],
  riskTradeoffs: [],
  portfolioConflicts: [],
  exposureDisclosures: [],
  rejectionReasons: [],
  missingInformationDisclosures: [],
  whatWouldImprove: [],
  decisionAnalysisId: symbol,
  ruleIds: [],
  economicUnderlying: underlying,
});

describe('economic underlying grouping', () => {
  it('groups alternate expressions under their economic underlying', () => {
    const groups = groupRecommendationsByEconomicUnderlying([
      rec('NVDA', 'NVDA'),
      rec('NVDU', 'NVDA'),
      rec('MSFT', 'MSFT'),
    ]);
    expect(groups.find(g => g.economicUnderlying === 'NVDA')?.recommendations.map(r => r.symbol)).toEqual(['NVDA', 'NVDU']);
  });
});
