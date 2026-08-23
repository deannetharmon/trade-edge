// app/portfolio/__tests__/positionStrategyFilter.test.ts
//
// Tests resolvePositionStrategyFilterKey(), the pure classifier backing the Positions Strategy
// Filter (CSP/CC/PMCC/LEAP/BPS/BCS/IC). CSP/CC/PMCC/LEAP resolve from classifyPositionLifecycle()'s
// lifecycle-level classification; BPS/BCS/IC resolve from pos.strategy, since
// classifyPositionLifecycle only tags those as the generic SPREAD bucket and doesn't distinguish
// among them. A position matching none of the seven keys must always return null, since the UI
// treats null as "always show, regardless of filter state" rather than silently hiding it.
import { describe, it, expect } from 'vitest';
import { resolvePositionStrategyFilterKey, POSITION_STRATEGY_FILTER_KEYS } from '@/lib/portfolio/positionStrategyFilter';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';

// Real, dynamically-computed OCC symbols, matching the convention already established in
// lib/portfolio/__tests__/positionLifecycle.test.ts -- avoids hardcoded-expiration flakiness.
function occSymbol(root: string, daysFromNow: number, type: 'C' | 'P', strike: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${root}${yy}${mm}${dd}${type}${String(strike * 1000).padStart(8, '0')}`;
}

function leg(overrides: Partial<PositionLeg> = {}): PositionLeg {
  return {
    symbol: occSymbol('MU', 30, 'P', 95),
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
    key: 'MU::test', symbol: 'MU', expDate: '2026-09-18', dte: 30,
    strategy: 'BPS', legs: [leg()],
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
  } as Position;
}

describe('resolvePositionStrategyFilterKey', () => {
  it('resolves a single short put with no hedge to CSP', () => {
    const pos = position({ legs: [leg({ optionType: 'P', direction: 'Short' })] });
    expect(resolvePositionStrategyFilterKey(pos)).toBe('CSP');
  });

  it('resolves stock plus a short call to CC', () => {
    const pos = position({
      legs: [leg({ optionType: 'C', direction: 'Short', symbol: occSymbol('AAPL', 30, 'C', 200) })],
      stockPosition: { symbol: 'AAPL', quantity: 100, averageOpenPrice: 190, currentPrice: 195 },
    } as Partial<Position>);
    expect(resolvePositionStrategyFilterKey(pos)).toBe('CC');
  });

  it('resolves a real PMCC shape to PMCC', () => {
    const pos = position({
      legs: [
        leg({ optionType: 'C', direction: 'Short', symbol: occSymbol('NVDA', 30, 'C', 900), strikePrice: 900 }),
        leg({ optionType: 'C', direction: 'Long', symbol: occSymbol('NVDA', 400, 'C', 600), strikePrice: 600 }),
      ],
    });
    expect(resolvePositionStrategyFilterKey(pos)).toBe('PMCC');
  });

  it('resolves a standalone long-dated call to LEAP', () => {
    const pos = position({
      legs: [leg({ optionType: 'C', direction: 'Long', symbol: occSymbol('UBER', 390, 'C', 60), strikePrice: 60 })],
    });
    expect(resolvePositionStrategyFilterKey(pos)).toBe('LEAP');
  });

  it('resolves pos.strategy BPS/BCS/IC for spreads classifyPositionLifecycle only tags as SPREAD', () => {
    const bps = position({
      strategy: 'BPS',
      legs: [
        leg({ optionType: 'P', direction: 'Short', strikePrice: 100 }),
        leg({ optionType: 'P', direction: 'Long', strikePrice: 95 }),
      ],
    });
    const bcs = position({
      strategy: 'BCS',
      legs: [
        leg({ optionType: 'C', direction: 'Short', strikePrice: 100 }),
        leg({ optionType: 'C', direction: 'Long', strikePrice: 105 }),
      ],
    });
    const ic = position({
      strategy: 'IC',
      legs: [
        leg({ optionType: 'P', direction: 'Short', strikePrice: 95 }),
        leg({ optionType: 'P', direction: 'Long', strikePrice: 90 }),
        leg({ optionType: 'C', direction: 'Short', strikePrice: 105 }),
        leg({ optionType: 'C', direction: 'Long', strikePrice: 110 }),
      ],
    });
    expect(resolvePositionStrategyFilterKey(bps)).toBe('BPS');
    expect(resolvePositionStrategyFilterKey(bcs)).toBe('BCS');
    expect(resolvePositionStrategyFilterKey(ic)).toBe('IC');
  });

  it('returns null for a position matching none of the seven keys (e.g. assigned stock) -- always shown, never silently filtered', () => {
    const pos = position({
      strategy: 'NONE',
      legs: [],
      stockPosition: { symbol: 'GME', quantity: 100, averageOpenPrice: 20, currentPrice: 22 },
    } as Partial<Position>);
    expect(resolvePositionStrategyFilterKey(pos)).toBeNull();
  });

  it('returns null for UNKNOWN-classified positions', () => {
    const pos = position({ strategy: 'UNKNOWN', legs: [] });
    expect(resolvePositionStrategyFilterKey(pos)).toBeNull();
  });

  it('POSITION_STRATEGY_FILTER_KEYS contains exactly the seven required keys, no more, no fewer', () => {
    expect(new Set(POSITION_STRATEGY_FILTER_KEYS)).toEqual(
      new Set(['CSP', 'CC', 'PMCC', 'LEAP', 'BPS', 'BCS', 'IC']),
    );
    expect(POSITION_STRATEGY_FILTER_KEYS).toHaveLength(7);
  });
});
