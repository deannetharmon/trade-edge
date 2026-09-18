import { describe, expect, it } from 'vitest';
import { debitPnlPctOfCapitalAtRisk } from '../positionMetrics';
import { assessLeapsThesisHealth, longOptionItmPct, singleLongOptionLeg } from '../leapsThesisHealth';
import type { Position } from '@/lib/portfolio-data/types';

function position(overrides: Partial<Position> = {}): Position {
  return {
    key: 'AAPL-LEAP', symbol: 'AAPL', expDate: '2028-01-21', dte: 480, strategy: 'LEAPS', quantity: 1,
    legs: [{ symbol: 'AAPL 280121C00155000', optionType: 'C', strikePrice: 155, direction: 'Long', quantity: 1, avgOpenPrice: 10, currentPrice: 12 }],
    identity: null, structureAmbiguous: false, structureBlockMessage: null, entryPriceEffect: 'Debit', entryCredit: 1000,
    entryEconomicsComplete: true, creditReceived: 1000, currentValue: 1200, closeValue: 1100, closeNowPnl: 100,
    pnl: 100, pnlPct: null, pnlReliable: true, intent: 'neutral', plOpen: 100, targetPrice: 0, profitTarget: 0,
    maxRisk: 1000, maxRiskReliable: false, hitTarget: false, needsClose: false, entryDte: 600, entryDate: null,
    stockPrice: 160, buffer: null, putBufferPct: null, callBufferPct: null, theta: 0, gamma: 0, earningsDate: null,
    ivr: null, iv: null, hv30: null, beta: null, netDelta: 0.72, netVega: null, pop: null, hasGtc: false,
    gtcOrderId: null, gtcOrderPrice: null, stopLossStatus: 'none', stopLossPrice: null, stopLossPolicy: null,
    stopLossDisplayPolicy: null, stopLossClassification: 'NO_STOP', stopLossOrderStatus: null, quoteWidthEvidence: null,
    accountNumber: 'test', snapshotHistory: [{ date: '2026-09-01', dte: 500, currentValue: 1000, closeValue: 1000, pnl: 0, pnlPct: 0, iv: null, ivr: null, theta: null, gamma: null, netDelta: 0.8, netVega: null, pop: null, buffer: null, stockPrice: 200 }],
    ...overrides,
  };
}

describe('LEAPS thesis health', () => {
  it('shows debit P/L as a percent of capital at risk without treating it as credit capture', () => {
    expect(debitPnlPctOfCapitalAtRisk(position())).toBe(10);
    expect(debitPnlPctOfCapitalAtRisk(position({ entryPriceEffect: 'Credit' }))).toBeNull();
  });

  it('uses strike-gap ITM percentages for one long option leg', () => {
    const leg = position().legs[0];
    expect(longOptionItmPct(leg, 160)).toBeCloseTo(3.2258, 3);
    expect(longOptionItmPct(leg, 140)).toBe(0);
    expect(singleLongOptionLeg([{ ...leg }, { ...leg, direction: 'Short' }])).toBeNull();
  });

  it('marks below-5% ITM as critical and clamps erosion when the position improves', () => {
    const critical = assessLeapsThesisHealth(position());
    expect(critical.severity).toBe('critical');
    expect(critical.erosionPp).toBeCloseTo(25.806, 2);

    const improving = assessLeapsThesisHealth(position({ stockPrice: 220 }));
    expect(improving.erosionPp).toBe(0);
    expect(improving.severity).toBe('normal');
  });

  it('does not apply ITM erosion to debit verticals', () => {
    const debitVertical = position({ legs: [
      { ...position().legs[0], strikePrice: 155 },
      { ...position().legs[0], strikePrice: 165, direction: 'Short' },
    ] });
    expect(assessLeapsThesisHealth(debitVertical).applicable).toBe(false);
  });

  it('retains the foundation read after PMCC pairing without applying single-leg erosion', () => {
    const pmcc = position({ strategy: 'PMCC', legs: [
      position().legs[0],
      { ...position().legs[0], symbol: 'AAPL 261220C00180000', strikePrice: 180, direction: 'Short' },
    ] });
    const health = assessLeapsThesisHealth(pmcc);
    expect(health.applicable).toBe(true);
    expect(health.pairedPmcc).toBe(true);
    expect(health.erosionPp).toBeNull();
  });
});
