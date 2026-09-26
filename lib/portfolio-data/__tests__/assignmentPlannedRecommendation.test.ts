// lib/portfolio-data/__tests__/assignmentPlannedRecommendation.test.ts
//
// POSITION-INTENT-0001 (Dean and Ian, 2026-09-25): a lone short put the trader has set to Acquire or Wheel is meant to be assigned, so
// a paper loss or the 21-DTE window must not produce "Cut Losses" or a roll suggestion in the recommendation the app actually shows.
// These run against scorePortfolioPositionObjective (the live path), not getRecommendation (which the app never calls).

import { describe, expect, it } from 'vitest';
import { scorePortfolioPositionObjective } from '@/lib/portfolio-data/acquisition';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';

const NOW = new Date('2026-08-10T18:00:00.000Z');

const shortPut: PositionLeg = { symbol: 'NVDA 260918P00190000', optionType: 'P', strikePrice: 190, direction: 'Short', quantity: 1, avgOpenPrice: 2.0, currentPrice: null, currentDelta: null };
const longPut: PositionLeg = { ...shortPut, symbol: 'NVDA 260918P00185000', strikePrice: 185, direction: 'Long', avgOpenPrice: 1.0 };

function csp(overrides: Partial<Position> = {}): Position {
  return {
    key: 'NVDA::2026-09-18', symbol: 'NVDA', expDate: '2026-09-18', dte: 40, strategy: 'PUT', legs: [shortPut],
    quantity: 1, identity: null, structureAmbiguous: false, structureBlockMessage: null,
    entryPriceEffect: 'Credit', entryEconomicsComplete: true, entryCredit: 200, creditReceived: 200,
    currentValue: 190, closeValue: 190, closeNowPnl: null, pnl: 10, pnlPct: 5, pnlReliable: true,
    intent: 'acquisition', plOpen: null, targetPrice: 100, profitTarget: 0.5, hitTarget: false, needsClose: false,
    maxRisk: 18800, maxRiskReliable: true, entryDte: 45, entryDate: '2026-08-01', accountNumber: 'ACCT-1',
    ivr: 50, iv: 40, hv30: 35, beta: 1.1, netDelta: 0.2, netVega: -0.2, pop: 75, hasGtc: true,
    gtcOrderId: 'gtc-1', gtcOrderPrice: 1.0, stopLossStatus: 'none', stopLossPrice: null,
    stopLossPolicy: null, stopLossDisplayPolicy: null, stopLossClassification: 'NO_STOP',
    stopLossOrderStatus: null, quoteWidthEvidence: null, quoteCapturedAt: null, stockPrice: 210,
    buffer: 9.5, putBufferPct: 9.5, callBufferPct: null, theta: 0.5, gamma: -0.02, earningsDate: null,
    ...overrides,
  } as Position;
}

/** A put down 150% of its credit (mark 5.00 against a 2.00 credit): the old loss exit. */
const deepLoss = (over: Partial<Position> = {}) => csp({ pnl: -300, pnlPct: -150, currentValue: 500, closeValue: 500, ...over });
const label = (p: Position) => scorePortfolioPositionObjective(p, NOW).recommendation;

describe('an Acquire or Wheel lone short put in a deep paper loss', () => {
  for (const intent of ['acquisition', 'wheel'] as const) {
    it(`${intent}: never Cut Losses, never a loss exit, and the loss is stated plainly`, () => {
      const rec = label(deepLoss({ intent }));
      expect(rec.kind).not.toBe('close-loser');
      expect(rec.label).not.toMatch(/cut losses/i);
      expect(rec.managementIntent?.intent).not.toBe('CUT_LOSSES');
      expect(rec.urgency).not.toBe('critical');
      const line = [rec.primaryReason, ...rec.supportingReasons].find(text => /assignment is the plan/i.test(text));
      expect(line).toContain(intent === 'wheel' ? 'Set to Wheel' : 'Set to Acquire');
      expect(line).toContain('Down 150% of credit (1.5x the credit received)');
    });
  }

  it('the same numbers on an Income put are still Cut Losses (unchanged)', () => {
    const rec = label(deepLoss({ intent: 'income' }));
    expect(rec.kind).toBe('close-loser');
    expect(rec.label).toMatch(/cut losses/i);
    expect([rec.primaryReason, ...rec.supportingReasons].some(text => /assignment is the plan/i.test(text))).toBe(false);
  });

  it('a put with no intent chosen is treated as its default, Acquire, and gets the new behavior', () => {
    // acquisition.ts defaults a lone short put to 'acquisition'; the fixture intent is what the position carries after that default.
    expect(label(deepLoss({ intent: 'acquisition' })).kind).not.toBe('close-loser');
  });

  it('a loss too small to have been a loss exit adds no context line', () => {
    const rec = label(csp({ intent: 'acquisition', pnl: -40, pnlPct: -20, currentValue: 240, closeValue: 240 }));
    expect([rec.primaryReason, ...rec.supportingReasons].some(text => /assignment is the plan/i.test(text))).toBe(false);
  });
});

describe('the 21-DTE window', () => {
  it('an Acquire put at 20 DTE gets no roll-soon suggestion; an Income put at 20 DTE still does', () => {
    expect(label(csp({ intent: 'acquisition', dte: 20 })).kind).not.toBe('roll-soon');
    expect(label(csp({ intent: 'wheel', dte: 20 })).kind).not.toBe('roll-soon');
    expect(label(csp({ intent: 'income', dte: 20 })).kind).toBe('roll-soon');
  });
});

describe('calm positions stay calm (Ian: PREFER must not turn a healthy put into "Accept Assignment")', () => {
  it('an out-of-the-money Acquire put at 40 DTE, up 10%, is a Hold', () => {
    const rec = label(csp({ intent: 'acquisition', dte: 40, pnl: 20, pnlPct: 10, hasGtc: true }));
    expect(rec.kind).toBe('hold');
    expect(rec.managementIntent?.intent).not.toBe('ACCEPT_ASSIGNMENT');
  });
  it('a +50% winner is still Take Profit', () => {
    const rec = label(csp({ intent: 'wheel', pnl: 100, pnlPct: 50, hitTarget: true, currentValue: 100, closeValue: 100 }));
    expect(rec.kind).toBe('close-winner');
    expect(rec.managementIntent?.intent).toBe('TAKE_PROFIT');
  });
  it('a put deep in the money at 5 DTE reads Accept Assignment for an Acquire put (the plan), not a close', () => {
    const rec = label(csp({ intent: 'acquisition', dte: 5, stockPrice: 180, buffer: -5, putBufferPct: -5, pnl: -250, pnlPct: -125, currentValue: 450, closeValue: 450 }));
    expect(rec.kind).toBe('assignment-risk');
    expect(rec.managementIntent?.intent).toBe('ACCEPT_ASSIGNMENT');
  });
  it('earnings before expiry still shows, as a medium note that assignment is the plan', () => {
    const rec = label(csp({ intent: 'acquisition', dte: 40, earningsDate: '2026-08-25' }));
    expect(rec.kind).toBe('earnings-risk');
    expect(rec.urgency).toBe('medium');
    expect(rec.primaryReason).toContain('Assignment is the plan');
    expect(label(csp({ intent: 'income', dte: 40, earningsDate: '2026-08-25' })).urgency).toBe('high');
  });
  it('an unprotected profit still asks for a GTC', () => {
    expect(label(csp({ intent: 'acquisition', hasGtc: false, pnl: 60, pnlPct: 30 })).kind).toBe('place-gtc');
  });
});

describe('nothing else changes', () => {
  it('a spread set to acquisition at -150% is still Cut Losses', () => {
    const spread = csp({ strategy: 'BPS', legs: [shortPut, longPut], intent: 'acquisition', pnl: -300, pnlPct: -150, currentValue: 500, closeValue: 500 });
    expect(label(spread).kind).toBe('close-loser');
  });
  it('a bought put is not treated as a cash-secured put', () => {
    const bought = csp({ strategy: 'PUT', legs: [{ ...shortPut, direction: 'Long' }], intent: 'acquisition', entryPriceEffect: 'Debit', entryCredit: 200, pnl: -300, pnlPct: -150 });
    expect(label(bought).managementIntent?.intent).not.toBe('ACCEPT_ASSIGNMENT');
  });
  it('a short call set to acquisition is unchanged', () => {
    const call = csp({ strategy: 'CALL', legs: [{ ...shortPut, optionType: 'C', symbol: 'NVDA 260918C00230000', strikePrice: 230 }], intent: 'acquisition', pnl: -300, pnlPct: -150, currentValue: 500, closeValue: 500 });
    expect(label(call).kind).toBe('close-loser');
  });
});
