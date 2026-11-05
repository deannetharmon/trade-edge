// lib/portfolio-ai/__tests__/fromPositions.test.ts

import { describe, expect, it } from 'vitest';
import type { Position } from '@/lib/portfolio-data/types';
import { toPortfolioAiPositions } from '../fromPositions';
import { redactUnsupportedFigures } from '../snapshot';

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


describe('cash needed at assignment and leg figures (PORTFOLIO-AI-FIGURES-0001)', () => {
  const leg = (over: Record<string, unknown>) => ({ symbol: 'METU', optionType: 'P', strikePrice: 28.5, direction: 'Short', quantity: 1, avgOpenPrice: 1.57, currentPrice: 4.1, currentDelta: -0.7, ...over });
  const metu = make({ symbol: 'METU', strategy: 'CSP', quantity: 1, dte: 1, legs: [leg({})], stockPrice: 24.2, entryPriceEffect: 'Credit', entryCredit: 157, creditReceived: 157, maxRisk: 2693 });
  const facts = (p: Position) => toPortfolioAiPositions([p], 0)[0];

  it('states the cash needed for a single short put as strike x 100 x contracts, apart from max risk', () => {
    const t = facts(metu).factLines!.join('\n');
    expect(t).toContain('Cash needed if assigned: $2,850 (strike x 100 x 1 contract)');
    expect(facts(metu).maxRisk).toBe(2693);
  });

  it('scales with contracts', () => {
    const p = make({ symbol: 'SOXL', strategy: 'CSP', quantity: 2, legs: [leg({ symbol: 'SOXL', strikePrice: 90, quantity: 2 })] });
    expect(facts(p).factLines!.join('\n')).toContain('Cash needed if assigned: $18,000 (strike x 100 x 2 contracts)');
  });

  it('does not add the line for spreads, long options or multi-leg positions', () => {
    const spread = make({ legs: [leg({}), leg({ strikePrice: 25, direction: 'Long' })] });
    const longPut = make({ legs: [leg({ direction: 'Long' })] });
    const call = make({ legs: [leg({ optionType: 'C' })] });
    for (const p of [spread, longPut, call]) expect(facts(p).factLines!.join('\n')).not.toContain('Cash needed if assigned');
  });

  it('allows leg strikes and prices through the figure guard', () => {
    const f = facts(metu);
    const out = redactUnsupportedFigures('The $28.50 strike needs $2,850 if assigned; the put is at $4.10.', f.factFigures!);
    expect(out.removedCount).toBe(0);
    expect(redactUnsupportedFigures('That is $9,999 of cash.', f.factFigures!).removedCount).toBe(1);
  });
});
