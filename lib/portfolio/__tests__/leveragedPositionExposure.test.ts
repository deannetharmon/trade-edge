import { describe, expect, it } from 'vitest';
import { buildLeveragedPositionExposureGroups } from '../leveragedPositionExposure';
import type { Position } from '@/lib/portfolio-data/types';
import type { EquityHolding } from '@/lib/portfolio-snapshot/types';

function pos(overrides: Partial<Position>): Position {
  return {
    key: 'p',
    symbol: 'NVDA',
    expDate: '2026-12-18',
    dte: 78,
    strategy: 'BPS',
    legs: [],
    quantity: 1,
    identity: null,
    structureAmbiguous: false,
    structureBlockMessage: null,
    entryPriceEffect: 'Credit',
    creditReceived: 1,
    currentValue: 1,
    closeValue: 1,
    closeNowPnl: 0,
    pnl: 0,
    pnlPct: 0,
    pnlReliable: true,
    intent: 'income',
    plOpen: 0,
    targetPrice: 0.5,
    profitTarget: 0.5,
    maxRisk: 500,
    maxRiskReliable: true,
    hitTarget: false,
    needsClose: false,
    entryDte: 45,
    entryDate: null,
    accountNumber: 'acct',
    ivr: 20,
    iv: 30,
    hv30: 25,
    beta: 1,
    netDelta: 0.5,
    netVega: 0,
    pop: 70,
    hasGtc: false,
    gtcOrderId: null,
    gtcOrderPrice: null,
    stopLossStatus: 'none',
    stopLossPrice: null,
    stopLossPolicy: null,
    stopLossDisplayPolicy: null,
    stopLossClassification: 'NO_STOP',
    stopLossOrderStatus: null,
    quoteWidthEvidence: null,
    stockPrice: 100,
    buffer: 10,
    putBufferPct: 10,
    callBufferPct: null,
    theta: 0,
    gamma: 0,
    earningsDate: null,
    ...overrides,
  } as Position;
}

function equity(overrides: Partial<EquityHolding>): EquityHolding {
  return {
    accountNumber: 'acct',
    symbol: 'NVDA',
    direction: 'Long',
    quantity: 100,
    settledQuantity: null,
    basis: 90,
    basisComplete: true,
    currentPrice: 100,
    marketValue: 10000,
    unrealizedPnl: 1000,
    quoteAsOf: '2026-10-01T00:00:00.000Z',
    staleQuote: false,
    deliverable: 'standard',
    dataQualityWarnings: [],
    ...overrides,
  };
}

describe('Gate 8 leveraged position exposure grouping', () => {
  it('groups direct and leveraged positions under the same economic underlying', () => {
    const groups = buildLeveragedPositionExposureGroups({ positions: [
      pos({ key: 'direct', symbol: 'NVDA', netDelta: 0.5, stockPrice: 100, maxRisk: 500 }),
      pos({ key: 'lev', symbol: 'NVDU', netDelta: 0.25, stockPrice: 50, maxRisk: 400 }),
    ] , equityCoverageComplete: true });
    expect(groups).toHaveLength(1);
    expect(groups[0].economicUnderlying).toBe('NVDA');
    expect(groups[0].members.map(member => member.symbol)).toEqual(['NVDA', 'NVDU'] , equityCoverageComplete: true });
    // NVDA: 0.5 * 100 contracts * $100 = $5,000.
    // NVDU: 0.25 * 100 * $50 * 2x = $2,500.
    expect(groups[0].grossBullishExposure).toBeCloseTo(7500);
    expect(groups[0].netDirectionalExposure).toBeCloseTo(7500);
    expect(groups[0].maxCapitalLoss).toBeCloseTo(900);
  });

  it('preserves inverse direction in gross bearish and net exposure', () => {
    const groups = buildLeveragedPositionExposureGroups({ positions: [
      pos({ key: 'long', symbol: 'NVDU', netDelta: 0.25, stockPrice: 50, maxRisk: 400 }),
      pos({ key: 'inverse', symbol: 'NVDD', netDelta: 0.5, stockPrice: 20, maxRisk: 300 }),
    ] , equityCoverageComplete: true });
    expect(groups[0].grossBullishExposure).toBeCloseTo(2500);
    expect(groups[0].grossBearishExposure).toBeCloseTo(1000);
    expect(groups[0].netDirectionalExposure).toBeCloseTo(1500);
  });

  it('fails the whole group closed when a related member lacks required delta evidence', () => {
    const groups = buildLeveragedPositionExposureGroups({ positions: [
      pos({ key: 'lev', symbol: 'NVDU', netDelta: 0.25, stockPrice: 50 }),
      pos({ key: 'direct', symbol: 'NVDA', netDelta: null, stockPrice: 100 }),
    ] , equityCoverageComplete: true });
    expect(groups[0].normalizationAuthoritative).toBe(false);
    expect(groups[0].grossExposure).toBeNull();
    expect(groups[0].netDirectionalExposure).toBeNull();
    expect(groups[0].members.find(member => member.positionKey === 'direct')?.reason).toMatch(/net delta/i);
  });

  it('does not invent a leveraged group when no issuer-catalog-confirmed leveraged product is held', () => {
    expect(buildLeveragedPositionExposureGroups({ positions: [
      pos({ symbol: 'NVDA' }),
      pos({ key: 'msft', symbol: 'MSFT' }),
    ])).toEqual([] , equityCoverageComplete: true });
  });
  it('includes direct equity holdings with leveraged option exposure on the same economic underlying', () => {
    const groups = buildLeveragedPositionExposureGroups({
      positions: [pos({ key: 'lev', symbol: 'NVDU', netDelta: 0.25, stockPrice: 50, maxRisk: 400 })],
      equities: [equity({ symbol: 'NVDA', quantity: 100, currentPrice: 100 })],
      equityCoverageComplete: true,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map(member => member.strategy)).toContain('SHARES');
    expect(groups[0].grossBullishExposure).toBeCloseTo(12500);
    expect(groups[0].netDirectionalExposure).toBeCloseTo(12500);
  });

  it('recognizes a leveraged product held as shares and rolls direct underlying shares into it', () => {
    const groups = buildLeveragedPositionExposureGroups({
      positions: [],
      equities: [
        equity({ symbol: 'NVDU', quantity: 100, currentPrice: 50 }),
        equity({ symbol: 'NVDA', quantity: 20, currentPrice: 100 }),
      ],
      equityCoverageComplete: true,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].economicUnderlying).toBe('NVDA');
    expect(groups[0].grossBullishExposure).toBeCloseTo(12000);
    expect(groups[0].maxCapitalLoss).toBeCloseTo(7000);
  });

  it('fails group totals closed when canonical equity coverage is unavailable', () => {
    const groups = buildLeveragedPositionExposureGroups({
      positions: [pos({ key: 'lev', symbol: 'NVDU', netDelta: 0.25, stockPrice: 50 })],
      equityCoverageComplete: false,
    });
    expect(groups[0].normalizationAuthoritative).toBe(false);
    expect(groups[0].grossExposure).toBeNull();
  });

});
