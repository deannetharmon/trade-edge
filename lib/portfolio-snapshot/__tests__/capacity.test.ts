// lib/portfolio-snapshot/__tests__/capacity.test.ts
// LCC-0001A PR 2 — coverage-capacity calculation tests.
import { describe, it, expect } from 'vitest';
import { computeCoveredCallCapacity, buildSnapshotCapacityReport } from '../capacity';
import type { EquityHolding, PortfolioSnapshot, WorkingOrder } from '../types';
import type { Position } from '@/lib/portfolio-data/types';

const equity = (symbol: string, quantity: number, basis: number | null, basisComplete = true): EquityHolding => ({
  accountNumber: 'ACC1',
  symbol,
  direction: 'Long',
  quantity,
  settledQuantity: null,
  basis,
  basisComplete,
  currentPrice: null,
  marketValue: null,
  unrealizedPnl: null,
  quoteAsOf: null,
  staleQuote: false,
  deliverable: 'standard',
  dataQualityWarnings: [],
});

const optionPosition = (symbol: string, direction: 'Long' | 'Short', optionType: 'P' | 'C' = 'C'): Position => ({
  symbol,
  accountNumber: 'ACC1',
  legs: [{ symbol: `${symbol}  270115C00100000`, optionType, strikePrice: 100, direction, quantity: 1, avgOpenPrice: 1, currentPrice: 1 }],
} as Position);

const workingOrder = (symbol: string): WorkingOrder => ({
  accountNumber: 'ACC1',
  orderId: 'O1',
  status: 'Live',
  legs: [{ underlyingSymbol: symbol, symbol: null, action: 'Sell to Open', instrumentType: 'Equity Option', optionType: 'C', quantity: 1 }],
});

const snapshot = (
  equities: EquityHolding[],
  options: Position[] = [],
  workingOrders: WorkingOrder[] = [],
): PortfolioSnapshot => ({
  accountNumber: 'ACC1',
  asOf: '2026-08-22T00:00:00.000Z',
  quoteAsOf: null,
  equities,
  options,
  workingOrders,
  coverageEvidence: {
    existingShortCallsBySymbol: Object.fromEntries(options.map(position => [position.symbol, 1])),
    workingShortCallsBySymbol: Object.fromEntries(workingOrders.map(order => [order.legs[0]?.underlyingSymbol ?? '', 1])),
    unclassifiedSymbols: options
      .filter(position => position.legs.some(leg => leg.optionType == null))
      .map(position => position.symbol),
    complete: true,
    warnings: [],
  },
  dataQuality: { status: 'ok', staleQuotes: false, warnings: [] },
});

describe('computeCoveredCallCapacity', () => {
  it('computes gross capacity as floor(shares/100)', () => {
    const result = computeCoveredCallCapacity(250, 0, 0);
    expect(result.grossCoveredContracts).toBe(2);
    expect(result.availableCoveredContracts).toBe(2);
  });

  it('subtracts existing and working short-call contracts', () => {
    const result = computeCoveredCallCapacity(300, 1, 1);
    expect(result.grossCoveredContracts).toBe(3);
    expect(result.availableCoveredContracts).toBe(1);
  });

  it('clamps available capacity to zero and flags oversubscription, never going negative', () => {
    const result = computeCoveredCallCapacity(100, 2, 0);
    expect(result.availableCoveredContracts).toBe(0);
    expect(result.oversubscribed).toBe(true);
  });

  it('treats negative share counts as zero capacity', () => {
    const result = computeCoveredCallCapacity(-50, 0, 0);
    expect(result.grossCoveredContracts).toBe(0);
  });
});

describe('buildSnapshotCapacityReport', () => {
  it('computes capacity only from Long equity holdings, excluding Short (epic invariant 2)', () => {
    const shortHolding: EquityHolding = { ...equity('TSLA', 100, 200), direction: 'Short' };
    const report = buildSnapshotCapacityReport(snapshot([shortHolding]));
    // A Short-only holding with no other exposure never contributes a symbol entry at all --
    // short stock never provides capacity, so there is nothing to report for it.
    expect(report.bySymbol.TSLA).toBeUndefined();
  });

  it('a symbol with both Long and Short holdings computes capacity from the Long side only', () => {
    const holdings: EquityHolding[] = [
      equity('TSLA', 100, 200),
      { ...equity('TSLA', 30, 250), direction: 'Short' },
    ];
    const report = buildSnapshotCapacityReport(snapshot(holdings));
    expect(report.bySymbol.TSLA.sharesOwned).toBe(100);
    expect(report.bySymbol.TSLA.grossCoveredContracts).toBe(1);
  });

  it('combines equities, short-call exposure, and working reservations into one per-symbol map', () => {
    const report = buildSnapshotCapacityReport(snapshot(
      [equity('MSFT', 300, 300)],
      [optionPosition('MSFT', 'Short')],
      [workingOrder('MSFT')],
    ));
    expect(report.bySymbol.MSFT).toMatchObject({
      sharesOwned: 300,
      grossCoveredContracts: 3,
      existingShortCallContracts: 1,
      workingShortCallContracts: 1,
      availableCoveredContracts: 1,
      costBasis: 300,
      costBasisComplete: true,
    });
  });

  it('includes a symbol with only short-call exposure and no equity holding at zero capacity', () => {
    const report = buildSnapshotCapacityReport(snapshot([], [optionPosition('AAPL', 'Short')]));
    expect(report.bySymbol.AAPL.sharesOwned).toBe(0);
    expect(report.bySymbol.AAPL.existingShortCallContracts).toBe(1);
    expect(report.bySymbol.AAPL.oversubscribed).toBe(true);
  });

  it('surfaces incomplete basis without fabricating a value', () => {
    const report = buildSnapshotCapacityReport(snapshot([equity('IBM', 200, null, false)]));
    expect(report.bySymbol.IBM.costBasis).toBeNull();
    expect(report.bySymbol.IBM.costBasisComplete).toBe(false);
  });

  it('surfaces hasUnclassifiedExposure from either short-call or working-order results', () => {
    const ambiguous = optionPosition('NVDA', 'Short');
    ambiguous.legs[0].optionType = null as unknown as 'C';
    ambiguous.legs[0].symbol = 'unparseable';
    const report = buildSnapshotCapacityReport(snapshot([equity('NVDA', 100, 400)], [ambiguous]));
    expect(report.bySymbol.NVDA.hasUnclassifiedExposure).toBe(true);
  });

  it('fails closed from snapshot data quality without reconstructing parallel inputs', () => {
    const unavailable = snapshot([equity('MSFT', 100, 300)]);
    unavailable.dataQuality = {
      status: 'unavailable',
      unavailableReason: 'orders unavailable',
      staleQuotes: false,
      warnings: ['refresh required'],
    };
    unavailable.coverageEvidence.complete = false;
    unavailable.coverageEvidence.warnings = ['refresh required'];
    expect(buildSnapshotCapacityReport(unavailable)).toEqual({
      status: 'unavailable',
      bySymbol: {},
      warnings: ['refresh required'],
      unavailableReason: 'orders unavailable',
    });
  });
});
