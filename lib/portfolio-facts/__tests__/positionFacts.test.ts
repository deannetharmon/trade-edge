// lib/portfolio-facts/__tests__/positionFacts.test.ts
//
// RECO-UNIFY-0001A: the facts builder changes no behavior. The verdict the app shows today (scorePortfolioPositionObjective) must equal the
// verdict the evaluator gives when fed the facts' engineInput, on both layers (the legacy `kind` and the ManagementIntent), for a spread of positions.

import { describe, expect, it } from 'vitest';
import { scorePortfolioPositionObjective } from '@/lib/portfolio-data/acquisition';
import { evaluatePositionObjective } from '@/lib/portfolio-intelligence';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';
import { buildPositionFacts } from '../positionFacts';

const NOW = new Date('2026-08-10T18:00:00.000Z');
const shortPut: PositionLeg = { symbol: 'NVDA 260918P00190000', optionType: 'P', strikePrice: 190, direction: 'Short', quantity: 1, avgOpenPrice: 2.0, currentPrice: null } as PositionLeg;

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

const withoutId = (o: unknown) => (o && typeof o === 'object' ? { ...(o as Record<string, unknown>), id: undefined } : o);

const FIXTURES: Array<[string, Position]> = [
  ['calm hold', csp()],
  ['deep loss, income', csp({ intent: 'income', pnl: -300, pnlPct: -150, currentValue: 500, closeValue: 500 })],
  ['deep loss, acquire', csp({ intent: 'acquisition', pnl: -300, pnlPct: -150, currentValue: 500, closeValue: 500 })],
  ['at the profit target', csp({ pnl: 100, pnlPct: 50, hitTarget: true, currentValue: 100, closeValue: 100 })],
  ['21 DTE, income', csp({ intent: 'income', dte: 20 })],
  ['earnings before expiry', csp({ earningsDate: '2026-09-01' })],
  ['no close value', csp({ closeValue: null, closeNowPnl: null })],
  ['incomplete entry economics', csp({ entryEconomicsComplete: false, entryCredit: null })],
];

describe('PositionFacts parity with the live recommendation', () => {
  for (const [name, pos] of FIXTURES) {
    for (const trend of [undefined, 'uptrend', 'downtrend'] as const) {
      it(`${name} / trend ${trend ?? 'none'}: same verdict on both layers`, () => {
        const live = scorePortfolioPositionObjective(pos, NOW, false, trend);
        const facts = buildPositionFacts(pos, { now: NOW, trendDirection: trend });
        const viaFacts = evaluatePositionObjective(facts.engineInput, NOW);
        expect(viaFacts.legacyRecommendation).toEqual(live.recommendation);
        expect(viaFacts.legacyRecommendation.kind).toBe(live.recommendation.kind);
        expect(viaFacts.legacyRecommendation.managementIntent?.intent).toBe(live.recommendation.managementIntent?.intent);
        // The objective's id is random per evaluation; everything else must match.
        expect(withoutId(viaFacts.objective)).toEqual(withoutId(live.objective));
      });
    }
  }
});

describe('PositionFacts content', () => {
  it('reads the figures from the position and nothing else', () => {
    const f = buildPositionFacts(csp(), { now: NOW }, 'snap-1');
    expect(f.snapshotId).toBe('snap-1');
    expect(f.economics.entryCredit).toBe(200);
    expect(f.economics.pctOfCreditCaptured).toBeCloseTo(5);
    expect(f.economics.profitTargetFraction).toBe(0.5);
    expect(f.economics.targetProfitDollars).toBe(100);
    expect(f.time.dte).toBe(40);
    expect(f.greeks).toEqual({ netDelta: 0.2, theta: 0.5, gamma: -0.02, netVega: -0.2 });
    expect(f.volatility).toEqual({ ivr: 50, iv: 40, hv30: 35 });
  });

  it('missing data reads null and flags its group incomplete, never inferred', () => {
    const f = buildPositionFacts(csp({ closeValue: null, closeNowPnl: null, ivr: null, netDelta: null }), { now: NOW });
    expect(f.economics.closeValue).toBeNull();
    expect(f.economics.closeNowPnl).toBeNull();
    expect(f.volatility.ivr).toBeNull();
    expect(f.greeks.netDelta).toBeNull();
    expect(f.technicals).toEqual({ rsi: null, rsiPrevious: null, rsiTurn: null, trend: null });
    expect(f.risk.concentrationSharePct).toBeNull();
    expect(f.complete.economics).toBe(false);
    expect(f.complete.volatility).toBe(false);
    expect(f.complete.greeks).toBe(false);
    expect(f.complete.technicals).toBe(false);
  });

  it('incomplete entry economics gives no credit and no target', () => {
    const f = buildPositionFacts(csp({ entryEconomicsComplete: false, entryCredit: null }), { now: NOW });
    expect(f.economics.entryCredit).toBeNull();
    expect(f.economics.pctOfCreditCaptured).toBeNull();
    expect(f.economics.profitTargetFraction).toBeNull();
  });

  it('RSI current and previous come from the daily closes (RSI exactly as the shared classifier reads them)', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
    const f = buildPositionFacts(csp(), { now: NOW, dailyCloses: closes, trendDirection: 'uptrend' });
    expect(f.technicals.rsi).not.toBeNull();
    expect(f.technicals.rsiPrevious).not.toBeNull();
    expect(f.technicals.rsiTurn).not.toBeNull();
    expect(f.technicals.trend).toBe('uptrend');
  });

  it('is deterministic: same input, same output', () => {
    const a = buildPositionFacts(csp(), { now: NOW }, 's');
    const b = buildPositionFacts(csp(), { now: NOW }, 's');
    expect(a).toEqual(b);
  });

  it('does not change the position it reads', () => {
    const pos = csp();
    const before = JSON.stringify(pos);
    buildPositionFacts(pos, { now: NOW });
    expect(JSON.stringify(pos)).toBe(before);
  });
});
