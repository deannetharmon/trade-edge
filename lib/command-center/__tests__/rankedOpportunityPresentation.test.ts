import { describe, expect, it } from 'vitest';
import type { DecisionAnalysis } from '@/lib/decision-engine';
import type { OpportunityRecommendation } from '@/lib/opportunity-engine';
import type { ScreenResult, SpreadCandidate } from '@/lib/scans/types';
import {
  DEFAULT_RANKED_OPPORTUNITY_FILTERS,
  defaultSharedResultSortDirection,
  filterRankedOpportunityEntries,
  mapRankedOpportunitiesToResults,
  passesOpenInterestThreshold,
  requiredOptionLegOpenInterest,
  resultCapitalRequired,
  sortPublishedResults,
  publishScreenResultOrder,
  publishTargetedScoreOrder,
  weakestRequiredOptionLegOpenInterest,
} from '../rankedOpportunityPresentation';

function spread(overrides: Partial<SpreadCandidate> = {}): SpreadCandidate {
  return {
    strategy: 'BPS',
    expiration: '2026-09-18',
    dte: 55,
    shortStrike: 180,
    longStrike: 175,
    shortDelta: -0.22,
    credit: 1.35,
    spreadWidth: 5,
    capitalRequired: 365,
    contractMultiplier: 100,
    creditRatio: 0.27,
    roc: 37,
    pop: 74,
    shortOI: 600,
    longOI: 700,
    ...overrides,
  };
}

function result(symbol: string, overrides: Partial<ScreenResult> = {}): ScreenResult {
  return {
    sourceResultId: `source-${symbol}`,
    symbol,
    strategy: 'BPS',
    price: 190,
    ivr: 55,
    qualified: false,
    bestCandidate: spread(),
    failReasons: [],
    checks: {} as ScreenResult['checks'],
    ...overrides,
  };
}

function analysis(id: string, source: ScreenResult): DecisionAnalysis {
  const candidate = source.bestCandidate!;
  const put = source.strategy === 'BPS' || source.strategy === 'CSP';
  return {
    id,
    createdAt: '2026-07-25T00:00:00.000Z',
    version: 'decision-analysis-v1',
    subject: { type: 'candidate', id: `candidate_${id}`, symbol: source.symbol, strategy: source.strategy, label: source.symbol },
    objective: 'generate_income',
    recommendation: { action: 'WAIT', strategy: source.strategy as any, summary: 'Wait.', status: 'conditional' },
    confidence: { overall: 80, market: 80, portfolio: 80, execution: 80, income: 80, risk: 80 },
    priority: 'normal',
    rationale: 'Canonical reasoning.',
    supportingEvidence: [],
    concerns: [],
    alternatives: [],
    reviewTriggers: [],
    expectedOutcome: { intent: 'income' },
    candidate: {
      id: `candidate_${id}`,
      strategy: source.strategy as any,
      symbol: source.symbol,
      underlyingPrice: source.price!,
      estimatedCredit: candidate.credit,
      theoreticalMaxLoss: 365,
      sourceResultId: source.sourceResultId,
      pop: candidate.pop,
      roc: candidate.roc,
      ivr: source.ivr ?? undefined,
      legs: [
        {
          symbol: source.symbol,
          underlyingSymbol: source.symbol,
          assetType: 'option',
          direction: 'short',
          optionType: put ? 'put' : 'call',
          strike: candidate.shortStrike,
          expiration: candidate.expiration,
          quantity: 1,
        },
        ...(source.strategy === 'CSP' ? [] : [{
          symbol: source.symbol,
          underlyingSymbol: source.symbol,
          assetType: 'option' as const,
          direction: 'long' as const,
          optionType: put ? 'put' as const : 'call' as const,
          strike: candidate.longStrike,
          expiration: source.strategy === 'PMCC'
            ? candidate.longExpiration
            : candidate.expiration,
          quantity: 1,
        }]),
      ],
    },
    metadata: { source: 'screener', executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesBlocked: [] },
  };
}

function recommendation(
  id: string,
  symbol: string,
  rank: number,
  strategy: OpportunityRecommendation['strategy'] = 'BPS',
): OpportunityRecommendation {
  return {
    candidateId: `candidate_${id}`,
    source: 'screener',
    symbol,
    strategy,
    rank,
    disposition: rank === 1 ? 'WATCH' : 'REJECTED',
    opportunityScoreTotal: 80 - rank,
    decisionConfidenceTotal: 75,
    primaryReason: 'Canonical reason.',
    supportingFactors: [],
    riskTradeoffs: [],
    portfolioConflicts: [],
    exposureDisclosures: [],
    rejectionReasons: [],
    missingInformationDisclosures: [],
    whatWouldImprove: [],
    decisionAnalysisId: id,
    ruleIds: [],
  };
}

describe('ranked opportunity compact presentation', () => {
  it('maps canonical recommendation order back to the exact retained ScreenResult references', () => {
    const aapl = result('AAPL');
    const msft = result('MSFT', { bestCandidate: spread({ shortStrike: 420, longStrike: 415 }) });
    const analyses = [analysis('a', aapl), analysis('m', msft)];
    const recommendations = [recommendation('m', 'MSFT', 1), recommendation('a', 'AAPL', 2)];

    const entries = mapRankedOpportunitiesToResults(recommendations, analyses, [aapl, msft]).entries;

    expect(entries.map((entry) => entry.recommendation.rank)).toEqual([1, 2]);
    expect(entries.map((entry) => entry.result)).toEqual([msft, aapl]);
  });

  it('maps a published two-expiration PMCC to its exact compact source result', () => {
    const pmcc = result('AAPL', {
      strategy: 'PMCC',
      bestCandidate: spread({
        strategy: 'PMCC',
        shortStrike: 205,
        longStrike: 150,
        expiration: '2026-09-18',
        longExpiration: '2027-01-15',
        shortOI: 900,
        longOI: 1_200,
        netDebit: 30,
        capitalRequired: 3_000,
        longOccSymbolPMCC: 'AAPL270115C00150000',
        shortOccSymbolPMCC: 'AAPL260918C00205000',
      }),
    });
    const mapped = mapRankedOpportunitiesToResults(
      [recommendation('pmcc', 'AAPL', 1, 'PMCC')],
      [analysis('pmcc', pmcc)],
      [pmcc],
    );

    expect(mapped.entries).toHaveLength(1);
    expect(mapped.entries[0].result).toBe(pmcc);
    expect(mapped.entries[0].analysis.candidate?.legs).toEqual([
      expect.objectContaining({ direction: 'short', optionType: 'call', strike: 205, expiration: '2026-09-18' }),
      expect.objectContaining({ direction: 'long', optionType: 'call', strike: 150, expiration: '2027-01-15' }),
    ]);
  });

  it('fails explicitly instead of silently omitting an unmappable publication', () => {
    const aapl = result('AAPL');
    const mapped = mapRankedOpportunitiesToResults(
      [recommendation('missing', 'AAPL', 1)],
      [analysis('missing', aapl)],
      [],
    );
    expect(mapped.entries).toEqual([]);
    expect(mapped.failures).toEqual([
      expect.objectContaining({ code: 'SOURCE_NOT_FOUND', sourceResultId: 'source-AAPL' }),
    ]);
  });

  it('maps structurally identical results by exact source identity and preserves valid cards beside failures', () => {
    const first = result('AAPL', { sourceResultId: 'source-first' });
    const second = result('AAPL', { sourceResultId: 'source-second' });
    const missing = result('MSFT', { sourceResultId: 'source-missing' });
    const mapped = mapRankedOpportunitiesToResults(
      [
        recommendation('first', 'AAPL', 1),
        recommendation('missing', 'MSFT', 2),
        recommendation('second', 'AAPL', 3),
      ],
      [analysis('first', first), analysis('missing', missing), analysis('second', second)],
      [second, first],
    );

    expect(mapped.entries.map((entry) => entry.result.sourceResultId)).toEqual([
      'source-first',
      'source-second',
    ]);
    expect(mapped.entries.map((entry) => entry.recommendation.rank)).toEqual([1, 3]);
    expect(mapped.failures).toEqual([
      expect.objectContaining({
        code: 'SOURCE_NOT_FOUND',
        sourceResultId: 'source-missing',
        recommendation: expect.objectContaining({ rank: 2, disposition: 'REJECTED' }),
      }),
    ]);
  });

  it('reports duplicate source identities as controlled integrity failures', () => {
    const first = result('AAPL', { sourceResultId: 'duplicate' });
    const second = result('MSFT', { sourceResultId: 'duplicate' });
    const mapped = mapRankedOpportunitiesToResults(
      [recommendation('first', 'AAPL', 1)],
      [analysis('first', first)],
      [first, second],
    );
    expect(mapped.entries).toEqual([]);
    expect(mapped.failures).toEqual([
      expect.objectContaining({ code: 'DUPLICATE_SOURCE_ID', sourceResultId: 'duplicate' }),
    ]);
  });

  it('filters the complete canonical population before limiting and preserves original ranks', () => {
    const results = Array.from({ length: 12 }, (_, index) =>
      result(index < 10 ? `DROP${index}` : `KEEP${index}`, {
        bestCandidate: spread({ pop: index < 10 ? 60 : 85 }),
      }));
    const analyses = results.map((item, index) => analysis(`id${index}`, item));
    const recommendations = results.map((item, index) => recommendation(`id${index}`, item.symbol, index + 1));
    const entries = mapRankedOpportunitiesToResults(recommendations, analyses, results).entries;

    const filtered = filterRankedOpportunityEntries(entries, {
      ...DEFAULT_RANKED_OPPORTUNITY_FILTERS,
      limit: 10,
      popMin: 80,
    });

    expect(filtered.matching).toHaveLength(2);
    expect(filtered.visible.map((entry) => entry.recommendation.rank)).toEqual([11, 12]);
  });

  it('defaults to strict >500 OI and preserves candidates whose required legs clear it', () => {
    expect(DEFAULT_RANKED_OPPORTUNITY_FILTERS.openInterestThreshold).toBe(500);
    const items = ['AAPL', 'MSFT'].map((symbol, index) => result(symbol, {
      bestCandidate: spread({ shortStrike: 180 + index * 10, longStrike: 175 + index * 10 }),
    }));
    const analyses = items.map((item, index) => analysis(`neutral${index}`, item));
    const entries = mapRankedOpportunitiesToResults(
      items.map((item, index) => recommendation(`neutral${index}`, item.symbol, index + 1)),
      analyses,
      items,
    ).entries;

    const filtered = filterRankedOpportunityEntries(entries, DEFAULT_RANKED_OPPORTUNITY_FILTERS);
    expect(filtered.matching).toEqual(entries);
    expect(filtered.visible).toEqual(entries);
  });

  it('filters canonical ticker, strategy, disposition, DTE, POP, OTM, and credit-ratio fields', () => {
    const keep = result('AAPL', {
      bestCandidate: spread({ dte: 40, pop: 82, creditRatio: 0.3, shortStrike: 170 }),
    });
    const drop = result('MSFT', {
      bestCandidate: spread({ dte: 15, pop: 60, creditRatio: 0.1, shortStrike: 188 }),
    });
    const entries = mapRankedOpportunitiesToResults(
      [recommendation('keep', 'AAPL', 1), recommendation('drop', 'MSFT', 2)],
      [analysis('keep', keep), analysis('drop', drop)],
      [keep, drop],
    ).entries;

    const filtered = filterRankedOpportunityEntries(entries, {
      ...DEFAULT_RANKED_OPPORTUNITY_FILTERS,
      dteMin: 30,
      dteMax: 45,
      popMin: 80,
      otmMin: 5,
      creditRatioMin: 25,
      strategies: ['BPS'],
      tickers: ['AAPL'],
      dispositions: ['WATCH'],
    });

    expect(filtered.matching.map((entry) => entry.recommendation.candidateId)).toEqual(['candidate_keep']);
  });

  it.each([
    [100, 100, false],
    [100, 101, true],
    [250, 250, false],
    [250, 251, true],
    [500, 500, false],
    [500, 501, true],
    [1000, 1000, false],
    [1000, 1001, true],
  ] as const)('uses strict >%i OI semantics at the boundary', (threshold, value, expected) => {
    expect(passesOpenInterestThreshold(
      result('AAPL', { bestCandidate: spread({ shortOI: value, longOI: value + 100 }) }),
      threshold,
    )).toBe(expected);
  });

  it('requires every vertical and iron-condor option leg and treats missing OI as failure', () => {
    expect(passesOpenInterestThreshold(
      result('AAPL', { bestCandidate: spread({ shortOI: 600, longOI: 240 }) }),
      250,
    )).toBe(false);
    expect(passesOpenInterestThreshold(
      result('AAPL', { bestCandidate: spread({ shortOI: 501, longOI: 700 }) }),
      500,
    )).toBe(true);

    const ic = spread({
      strategy: 'IC',
      shortOI: 900,
      longOI: 800,
      shortCallStrike: 205,
      longCallStrike: 210,
      shortCallOI: 700,
      longCallOI: 250,
    });
    expect(requiredOptionLegOpenInterest('IC', ic)).toEqual([900, 800, 700, 250]);
    expect(passesOpenInterestThreshold(result('SPY', { strategy: 'IC', bestCandidate: ic }), 250)).toBe(false);
    expect(passesOpenInterestThreshold(
      result('AAPL', { bestCandidate: spread({ shortOI: 600, longOI: undefined as any }) }),
      250,
    )).toBe(false);
  });

  it('uses CSP single-put OI, PMCC two-option-leg OI, ignores shares, and Any never restricts', () => {
    expect(requiredOptionLegOpenInterest('CSP', spread({ shortOI: 251, longOI: 0 }))).toEqual([251]);
    expect(requiredOptionLegOpenInterest('CC', spread({ shortOI: 101, longOI: 0 }))).toEqual([101]);
    expect(requiredOptionLegOpenInterest('PMCC', spread({ shortOI: 600, longOI: 240 }))).toEqual([600, 240]);
    expect(passesOpenInterestThreshold(result('AAPL', {
      strategy: 'PMCC',
      bestCandidate: spread({ strategy: 'PMCC', shortOI: 900, longOI: 500 }),
    }), 500)).toBe(false);
    expect(passesOpenInterestThreshold(result('AAPL', {
      strategy: 'PMCC',
      bestCandidate: spread({ strategy: 'PMCC', shortOI: 501, longOI: 900 }),
    }), 500)).toBe(true);
    expect(passesOpenInterestThreshold(result('AAPL', { bestCandidate: undefined }), 0)).toBe(true);
  });

  it('uses only producer-retained canonical capital for every supported strategy', () => {
    for (const [strategy, capitalRequired] of [
      ['BPS', 365],
      ['BCS', 410],
      ['IC', 725],
      ['CSP', 17_865],
      ['PMCC', 3_000],
    ] as const) {
      expect(resultCapitalRequired(result(strategy, {
        strategy,
        bestCandidate: spread({
          strategy,
          capitalRequired,
          netDebit: 30,
          spreadWidth: 99,
          credit: 88,
        }),
      }))).toBe(capitalRequired);
    }
    expect(resultCapitalRequired(result('MISSING', {
      bestCandidate: spread({
        capitalRequired: undefined,
        netDebit: 30,
        spreadWidth: 5,
        credit: 1.35,
      }),
    }))).toBeNull();
  });

  it('sorts canonical numeric metrics with missing values last in either direction', () => {
    const low = result('LOW', {
      price: 200,
      bestCandidate: spread({ shortStrike: 180, shortOI: 600, longOI: 800, credit: 2, creditRatio: 0.2, capitalRequired: 300 }),
    });
    const high = result('HIGH', {
      price: 200,
      bestCandidate: spread({ shortStrike: 170, shortOI: 1200, longOI: 1400, credit: 1, creditRatio: 0.4, capitalRequired: 400 }),
    });
    const missing = result('MISSING', { bestCandidate: undefined });
    const items = [low, missing, high];

    expect(weakestRequiredOptionLegOpenInterest(low)).toBe(600);
    expect(resultCapitalRequired(low)).toBe(300);
    expect(sortPublishedResults(items, { key: 'oi', direction: 'desc' }, (item) => item)
      .map((item) => item.symbol)).toEqual(['HIGH', 'LOW', 'MISSING']);
    expect(sortPublishedResults(items, { key: 'creditRatio', direction: 'asc' }, (item) => item)
      .map((item) => item.symbol)).toEqual(['LOW', 'HIGH', 'MISSING']);
    expect(sortPublishedResults(items, { key: 'otm', direction: 'desc' }, (item) => item)
      .map((item) => item.symbol)).toEqual(['HIGH', 'LOW', 'MISSING']);
    expect(sortPublishedResults(items, { key: 'capitalRequired', direction: 'asc' }, (item) => item)
      .map((item) => item.symbol)).toEqual(['LOW', 'HIGH', 'MISSING']);
    expect(sortPublishedResults(items, { key: 'rank', direction: 'desc' }, (item) => item)
      .map((item) => item.symbol)).toEqual(['HIGH', 'MISSING', 'LOW']);
    expect(defaultSharedResultSortDirection('rank')).toBe('asc');
    expect(defaultSharedResultSortDirection('capitalRequired')).toBe('asc');
    expect(defaultSharedResultSortDirection('oi')).toBe('desc');
  });

  it('publishes Targeted authoritative rank from score, independent of insertion order', () => {
    const published = publishTargetedScoreOrder([
      { id: 'inserted-first', score: 20 },
      { id: 'best-score', score: 90 },
      { id: 'middle-score', score: 50 },
    ]);
    expect(published.map(({ id, publishedRank }) => ({ id, publishedRank }))).toEqual([
      { id: 'best-score', publishedRank: 1 },
      { id: 'middle-score', publishedRank: 2 },
      { id: 'inserted-first', publishedRank: 3 },
    ]);
  });

  it('publishes raw Ranked rank provenance but leaves Filter order unranked', () => {
    const inputs = [result('SECOND'), result('FIRST')];
    expect(publishScreenResultOrder(inputs, true).map((item) => ({
      symbol: item.symbol,
      publishedOrder: item.publishedOrder,
      publishedRank: item.publishedRank,
    }))).toEqual([
      { symbol: 'SECOND', publishedOrder: 1, publishedRank: 1 },
      { symbol: 'FIRST', publishedOrder: 2, publishedRank: 2 },
    ]);
    expect(publishScreenResultOrder(inputs).map((item) => ({
      publishedOrder: item.publishedOrder,
      publishedRank: item.publishedRank,
    }))).toEqual([
      { publishedOrder: 1, publishedRank: undefined },
      { publishedOrder: 2, publishedRank: undefined },
    ]);
  });

  it('assigns unique source identities per publication and preserves retained identities through sorting', () => {
    const firstPublication = publishScreenResultOrder([
      result('AAPL', { sourceResultId: undefined }),
      result('AAPL', { sourceResultId: undefined }),
    ], true);
    const replacement = publishScreenResultOrder([result('AAPL', { sourceResultId: undefined })], true);
    expect(new Set(firstPublication.map((item) => item.sourceResultId)).size).toBe(2);
    expect(replacement[0].sourceResultId).not.toBe(firstPublication[0].sourceResultId);
    expect(sortPublishedResults(
      firstPublication,
      { key: 'oi', direction: 'desc' },
      (item) => item,
    ).map((item) => item.sourceResultId).sort()).toEqual(
      firstPublication.map((item) => item.sourceResultId).sort(),
    );
  });

  it('sorts filtered ranked entries before limiting without changing published ranks', () => {
    const items = [
      result('FIRST', { bestCandidate: spread({ shortOI: 600, longOI: 700 }) }),
      result('SECOND', { bestCandidate: spread({ shortOI: 1500, longOI: 1600 }) }),
    ];
    const entries = mapRankedOpportunitiesToResults(
      items.map((item, index) => recommendation(`sort${index}`, item.symbol, index + 1)),
      items.map((item, index) => analysis(`sort${index}`, item)),
      items,
    ).entries;
    const sorted = filterRankedOpportunityEntries(entries, {
      ...DEFAULT_RANKED_OPPORTUNITY_FILTERS,
      limit: 10,
      sort: { key: 'oi', direction: 'desc' },
    });

    expect(sorted.visible.map((entry) => entry.result.symbol)).toEqual(['SECOND', 'FIRST']);
    expect(sorted.visible.map((entry) => entry.recommendation.rank)).toEqual([2, 1]);
  });
});
