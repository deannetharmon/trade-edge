// lib/portfolio-ai/__tests__/fromPositions.test.ts

import { describe, expect, it } from 'vitest';
import type { Position } from '@/lib/portfolio-data/types';
import { toPortfolioAiPositions } from '../fromPositions';

const make = (over: Record<string, unknown>) => ({
  key: 'a', symbol: 'AAA', strategy: 'Bull Put Spread', dte: 25, legs: [],
  entryPriceEffect: 'Credit', entryCredit: 1, entryEconomicsComplete: true, creditReceived: 1,
  pnl: 0.25, maxRisk: 400, maxRiskReliable: true, buffer: 6.5,
  needsClose: false, hitTarget: false, hasGtc: true, recommendation: null, ...over,
}) as unknown as Position;

describe('toPortfolioAiPositions', () => {
  it('uses the fail-closed helpers and the canonical recommendation', () => {
    const [p] = toPortfolioAiPositions([make({
      recommendation: { label: 'Hold', suggestedAction: 'Keep monitoring', primaryReason: 'r', kind: 'hold' },
    })]);
    expect(p.entryPnlPct).toBe(25);
    expect(p.maxRisk).toBe(400);
    expect(p.recommendationLabel).toBe('Hold');
    expect(p.recommendationDetail).toBe('Keep monitoring');
  });

  it('nulls max risk and P&L when entry economics are not reliable, and has no action without a canonical rec', () => {
    const [p] = toPortfolioAiPositions([make({ maxRiskReliable: false, entryEconomicsComplete: false, buffer: null })]);
    expect(p.maxRisk).toBeNull();
    expect(p.entryPnlPct).toBeNull();
    expect(p.bufferPct).toBeNull();
    expect(p.recommendationLabel).toBeNull();
  });
});

describe('full position record (PORTFOLIO-AI-0002)', () => {
  // The UBER long 67.5C row from the Positions screen: debit $2,130, close now $1,355, P&L -$735 mid.
  const uber = make({
    symbol: 'UBER', strategy: 'CALL', quantity: 1, expDate: '2027-09-17', dte: 339, dteAtEntry: 392,
    entryDate: '2026-08-20', entryPriceEffect: 'Debit', entryCredit: 2130, creditReceived: 2130,
    legs: [{ symbol: 'UBER', optionType: 'C', strikePrice: 67.5, direction: 'Long', quantity: 1, avgOpenPrice: 21.3, currentPrice: 13.95, currentDelta: 0.636 }],
    stockPrice: 71.5, stockPriceAtEntry: 78.67, closeValue: 1355, currentValue: 1395, pnl: -735, closeNowPnl: -775,
    equityEffectClose: 1355, equityEffectMid: 1395, intent: 'hold', iv: 43, ivr: 63, ivAtEntry: 39, ivrAtEntry: 23,
    netDelta: 0.636, deltaAtEntry: 0.711, theta: -0.017, thetaAtEntry: -0.017, gamma: 0.012, gammaAtEntry: 0.009, netVega: 0.259, vegaAtEntry: 0.279,
    maxRiskReliable: false, identity: { quantity: 1 }, structureAmbiguous: false, snapshotHistory: [], gtcOrderPrice: null,
    stopLossClassification: 'NO_STOP', stopLossPrice: null, nextEarningsDate: null, pop: null, popVsStrike: null,
  });
  const text = () => toPortfolioAiPositions([uber], Date.parse('2026-10-13T12:00:00Z'))[0].factLines!.join('\n');

  it('carries the fields the screen shows', () => {
    const t = text();
    expect(t).toContain('Long 67.5C');
    expect(t).toContain('Expiration: 2027-09-17; DTE 392 at first tracking, 339 now');
    expect(t).toContain('Underlying: $78.67 at first tracking, $71.50 now');
    expect(t).toContain('Capital: Capital at risk $2,130');
    expect(t).toContain('Value: close now $1,355 of $2,130 paid (64% left)');
    expect(t).toContain('P&L: -$775.00');
    expect(t).toContain('Break-even at expiration: $88.80');
    expect(t).toContain('delta: 0.711 at first tracking, 0.636 now');
    expect(t).toContain('IV 39.0% at entry, 43.0% now');
  });

  it('never invents a missing field', () => {
    const t = toPortfolioAiPositions([make({ stockPrice: null, iv: null })], 0)[0].factLines!.join('\n');
    expect(t).toContain('Price buffer: not available');
    expect(t).toContain('Intrinsic / extrinsic: not available');
    expect(t).not.toContain('NaN');
    expect(t).not.toContain('undefined');
  });
});
