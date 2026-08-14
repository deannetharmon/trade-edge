import { describe, expect, it } from 'vitest';
import {
  attachSnapshotHistory,
  deriveMarketableQuoteFreshness,
  derivePositionQuoteCapturedAt,
  extractBrokerQuoteTimestamp,
  MARKETABLE_QUOTE_MAX_AGE_MS,
  scorePortfolioPositionObjective,
  scorePortfolioRemainingOpportunity,
  computeRawPositionValuation,
} from '@/lib/portfolio-data/acquisition';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';

const NOW = new Date('2026-08-10T18:00:00.000Z');

function leg(overrides: Partial<PositionLeg> = {}): PositionLeg {
  return {
    symbol: 'MU   260918P00095000',
    optionType: 'P',
    strikePrice: 95,
    direction: 'Short',
    quantity: 1,
    avgOpenPrice: 2.5,
    currentPrice: null,
    ...overrides,
  };
}

function position(overrides: Partial<Position> = {}): Position {
  return {
    key: 'MU::2026-09-18', symbol: 'MU', expDate: '2026-09-18', dte: 30,
    strategy: 'BPS', legs: [leg(), leg({ symbol: 'MU   260918P00090000', strikePrice: 90, direction: 'Long', avgOpenPrice: 2 })],
    quantity: 1, identity: null, structureAmbiguous: false, structureBlockMessage: null,
    entryPriceEffect: 'Credit', creditReceived: 50, currentValue: 45, closeValue: null,
    closeNowPnl: null, pnl: 5, pnlPct: 10, pnlReliable: false, intent: 'income', plOpen: null,
    targetPrice: 25, profitTarget: 0.5, maxRisk: 450, hitTarget: false, needsClose: false,
    entryDte: 45, entryDate: '2026-08-01', accountNumber: 'ACCT-1', ivr: 50, iv: 40,
    hv30: 35, beta: 1.1, netDelta: -0.1, netVega: -0.2, pop: 70, hasGtc: true,
    gtcOrderId: 'gtc-1', gtcOrderPrice: 0.25, stopLossStatus: 'none', stopLossPrice: null,
    stopLossPolicy: null, stopLossDisplayPolicy: null, stopLossClassification: 'NO_STOP',
    stopLossOrderStatus: null, quoteWidthEvidence: null, quoteCapturedAt: null, stockPrice: 110,
    buffer: 8, putBufferPct: 8, callBufferPct: null, theta: 0.5, gamma: -0.02,
    earningsDate: null,
    ...overrides,
  };
}

describe('PI-0014C broker quote freshness', () => {
  it('propagates realistic Tastytrade market-data timestamps and uses the oldest leg', () => {
    const shortLegPayload = {
      symbol: 'MU  260904P00800000', bid: '31.00', ask: '38.00', mark: '34.50',
      'updated-at': '2026-08-10T17:59:45.000Z',
    };
    const longLegPayload = {
      symbol: 'MU  260904P00790000', bid: '24.00', ask: '29.00', mark: '26.50',
      'received-at': '2026-08-10T17:59:40.000Z',
    };
    const timestamps = {
      MU260904P00800000: extractBrokerQuoteTimestamp(shortLegPayload),
      MU260904P00790000: extractBrokerQuoteTimestamp(longLegPayload),
    };

    expect(timestamps).toEqual({
      MU260904P00800000: '2026-08-10T17:59:45.000Z',
      MU260904P00790000: '2026-08-10T17:59:40.000Z',
    });
    expect(derivePositionQuoteCapturedAt(
      [{ symbol: 'MU  260904P00800000' }, { symbol: 'MU  260904P00790000' }],
      timestamps as Record<string, string>,
    )).toBe('2026-08-10T17:59:40.000Z');
  });

  it('fails position timestamp propagation closed when any leg lacks broker provenance', () => {
    expect(derivePositionQuoteCapturedAt(
      [{ symbol: 'MU  260904P00800000' }, { symbol: 'MU  260904P00790000' }],
      { MU260904P00800000: '2026-08-10T17:59:45.000Z' },
    )).toBeNull();
    expect(derivePositionQuoteCapturedAt([], {})).toBeNull();
  });
  it('fails closed when a real broker timestamp is absent or invalid', () => {
    expect(deriveMarketableQuoteFreshness(null, NOW)).toBe('UNKNOWN');
    expect(deriveMarketableQuoteFreshness('not-a-date', NOW)).toBe('UNKNOWN');
  });

  it('accepts a broker timestamp inside the bounded freshness window', () => {
    const captured = new Date(NOW.getTime() - MARKETABLE_QUOTE_MAX_AGE_MS).toISOString();
    expect(deriveMarketableQuoteFreshness(captured, NOW)).toBe('FRESH');
  });

  it('rejects a stale broker timestamp', () => {
    const captured = new Date(NOW.getTime() - MARKETABLE_QUOTE_MAX_AGE_MS - 1).toISOString();
    expect(deriveMarketableQuoteFreshness(captured, NOW)).toBe('STALE');
  });

  it('does not treat a materially future timestamp as fresh', () => {
    const captured = new Date(NOW.getTime() + 5_000).toISOString();
    expect(deriveMarketableQuoteFreshness(captured, NOW)).toBe('UNKNOWN');
  });
});

describe('PI-0014C acquisition-level verification continuity', () => {
  it('carries unresolved provenance through an assignment action and restores Verify Pricing afterward', () => {
    const initial = attachSnapshotHistory([position()], {})[0];
    const priorVerify: Position = {
      ...initial,
      recommendation: { ...initial.recommendation!, kind: 'verify-pricing', label: 'Verify Pricing' },
      pricingDecisionEvidence: {
        ...initial.pricingDecisionEvidence!,
        verificationUnresolved: true,
        status: 'VERIFY_PRICING',
      },
    };

    const assignment = attachSnapshotHistory(
      [position({ dte: 5, buffer: 1.5, putBufferPct: 1.5 })],
      {},
      [priorVerify],
    )[0];
    expect(assignment.recommendation?.kind).toBe('assignment-risk');
    expect(assignment.pricingDecisionEvidence?.verificationUnresolved).toBe(true);

    const assignmentCleared = attachSnapshotHistory(
      [position({ dte: 30, buffer: 8, putBufferPct: 8 })],
      {},
      [assignment],
    )[0];
    expect(assignmentCleared.recommendation?.kind).toBe('verify-pricing');
    expect(assignmentCleared.pricingDecisionEvidence).toMatchObject({
      verificationUnresolved: true,
      status: 'VERIFY_PRICING',
      marketableDecisionEligible: false,
    });
    expect(assignmentCleared.recommendation?.primaryReason).toContain('current broker leg quotes are incomplete');
  });
});

describe('PM-0002 incomplete entry economics decision boundary', () => {
  it('requires explicit supported-credit Max Risk provenance for raw valuation', () => {
    const supported = position({
      entryEconomicsComplete: true, entryCredit: 50, entryPriceEffect: 'Credit',
      maxRisk: 450, maxRiskReliable: true, currentValue: 45, closeValue: 55,
    });
    expect(computeRawPositionValuation(supported)).not.toBeNull();
    expect(computeRawPositionValuation({ ...supported, maxRiskReliable: undefined })).toBeNull();
    expect(computeRawPositionValuation({ ...supported, entryPriceEffect: 'Debit' })).toBeNull();
    expect(computeRawPositionValuation({ ...supported, entryEconomicsComplete: false })).toBeNull();
  });

  it('keeps a complete debit out of credit-oriented objective and Remaining Opportunity logic', () => {
    const debit = position({
      entryPriceEffect: 'Debit', entryCredit: 500, entryEconomicsComplete: true,
      creditReceived: 0, pnl: null, pnlPct: null, closeNowPnl: null,
      targetPrice: 0, hitTarget: false, hasGtc: false,
    });
    const result = scorePortfolioPositionObjective(debit, NOW);
    expect(result.valuation).toBeNull();
    expect(result.recommendation.kind).not.toBe('place-gtc');
    expect(result.recommendation.kind).not.toBe('close-winner');
    expect(result.recommendation.kind).not.toBe('close-loser');
    expect(scorePortfolioRemainingOpportunity(debit)).toMatchObject({
      opportunityCapturedPct: null,
      remainingOpportunityPct: null,
    });
  });

  it('keeps compatibility zero out of valuation, remaining opportunity, and entry-dependent actions', () => {
    const incomplete = position({
      entryPriceEffect: 'Unknown', entryCredit: null, entryEconomicsComplete: false,
      creditReceived: 0, pnl: null, pnlPct: null, closeNowPnl: null,
      targetPrice: 0, hitTarget: false, maxRisk: 500, maxRiskReliable: false,
      hasGtc: false,
    });
    const result = scorePortfolioPositionObjective(incomplete, NOW);
    expect(result.valuation).toBeNull();
    expect(result.recommendation.kind).not.toBe('place-gtc');
    expect(result.recommendation.kind).not.toBe('close-winner');
    expect(result.recommendation.kind).not.toBe('close-loser');
    expect(scorePortfolioRemainingOpportunity(incomplete)).toMatchObject({
      opportunityCapturedPct: null,
      remainingOpportunityPct: null,
    });
  });
});
