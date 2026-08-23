// app/portfolio/__tests__/positionStrategyFilter.test.ts
//
// Tests resolvePositionStrategyFilterKey(), the pure classifier backing the Positions Strategy
// Filter (CSP/CC/PMCC/LEAP/BPS/BCS/IC). CSP/CC/PMCC/LEAP resolve from classifyPositionLifecycle()'s
// lifecycle-level classification; BPS/BCS/IC resolve from pos.strategy, since
// classifyPositionLifecycle only tags those as the generic SPREAD bucket and doesn't distinguish
// among them. A position matching none of the seven keys must always return null, since the UI
// treats null as "always show, regardless of filter state" rather than silently hiding it.
import { describe, it, expect } from 'vitest';
import {
  resolvePositionStrategyFilterKey,
  POSITION_STRATEGY_FILTER_KEYS,
  POSITION_STRATEGY_FILTER_GROUPS,
  resolvePositionStrategyDisplayLabel,
  stratColorForFilterKey,
} from '@/lib/portfolio/positionStrategyFilter';
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

  it('resolves a standalone long put (any DTE, ungated) to PUT', () => {
    const shortDated = position({
      strategy: 'NONE',
      legs: [{ symbol: occSymbol('SPY', 15, 'P', 500), optionType: 'P', strikePrice: 500, direction: 'Long', quantity: 1, avgOpenPrice: 3, currentPrice: null }],
    });
    const longDated = position({
      strategy: 'NONE',
      legs: [{ symbol: occSymbol('SPY', 400, 'P', 500), optionType: 'P', strikePrice: 500, direction: 'Long', quantity: 1, avgOpenPrice: 3, currentPrice: null }],
    });
    expect(resolvePositionStrategyFilterKey(shortDated)).toBe('PUT');
    expect(resolvePositionStrategyFilterKey(longDated)).toBe('PUT');
  });

  it('resolves an uncovered (naked) short call with no shares and no long leg to NAKED', () => {
    const pos = position({
      strategy: 'NONE',
      legs: [leg({ optionType: 'C', direction: 'Short', symbol: occSymbol('TSLA', 20, 'C', 300), strikePrice: 300 })],
    });
    expect(resolvePositionStrategyFilterKey(pos)).toBe('NAKED');
  });

  it('resolves two or more uncovered short puts (not a single CSP) to NAKED', () => {
    const pos = position({
      strategy: 'NONE',
      legs: [
        leg({ optionType: 'P', direction: 'Short', symbol: occSymbol('AAPL', 20, 'P', 200), strikePrice: 200 }),
        leg({ optionType: 'P', direction: 'Short', symbol: occSymbol('AAPL', 20, 'P', 190), strikePrice: 190 }),
      ],
    });
    expect(resolvePositionStrategyFilterKey(pos)).toBe('NAKED');
  });

  it('a single uncovered short put still resolves to CSP, not NAKED (no double bucketing)', () => {
    const pos = position({ strategy: 'NONE', legs: [leg({ optionType: 'P', direction: 'Short' })] });
    expect(resolvePositionStrategyFilterKey(pos)).toBe('CSP');
  });

  it('returns null for a position matching none of the nine keys (e.g. assigned stock) -- always shown, never silently filtered', () => {
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

  it('POSITION_STRATEGY_FILTER_KEYS contains exactly the nine required keys, no more, no fewer', () => {
    expect(new Set(POSITION_STRATEGY_FILTER_KEYS)).toEqual(
      new Set(['CSP', 'CC', 'PMCC', 'LEAP', 'BPS', 'BCS', 'IC', 'PUT', 'NAKED']),
    );
    expect(POSITION_STRATEGY_FILTER_KEYS).toHaveLength(9);
  });

  it('Clear All (an empty selected set) still leaves an unclassified position visible -- filtering logic itself, not the button, is what page.tsx applies', () => {
    // Mirrors app/portfolio/page.tsx's filteredPositions predicate:
    // key === null || selected.has(key). An empty Set correctly excludes
    // every classified position while a null-key position remains shown.
    const unclassified = position({
      strategy: 'NONE',
      legs: [],
      stockPosition: { symbol: 'GME', quantity: 100, averageOpenPrice: 20, currentPrice: 22 },
    } as Partial<Position>);
    const classified = position({ strategy: 'NONE', legs: [leg({ optionType: 'P', direction: 'Short' })] });
    const emptySelection = new Set<string>();
    const passes = (pos: Position) => {
      const key = resolvePositionStrategyFilterKey(pos);
      return key === null || emptySelection.has(key);
    };
    expect(passes(unclassified)).toBe(true);
    expect(passes(classified)).toBe(false);
  });
});

describe('POSITION_STRATEGY_FILTER_GROUPS', () => {
  it('covers exactly the nine keys across its groups, with no duplicates or omissions', () => {
    const flattened = POSITION_STRATEGY_FILTER_GROUPS.flatMap(g => g.keys);
    expect(new Set(flattened)).toEqual(new Set(POSITION_STRATEGY_FILTER_KEYS));
    expect(flattened).toHaveLength(POSITION_STRATEGY_FILTER_KEYS.length);
  });

  it('places CSP last in Income and PUT first in Directional, so they render adjacent across the group boundary', () => {
    const income = POSITION_STRATEGY_FILTER_GROUPS.find(g => g.label === 'Income')!;
    const directional = POSITION_STRATEGY_FILTER_GROUPS.find(g => g.label === 'Directional')!;
    expect(income.keys[income.keys.length - 1]).toBe('CSP');
    expect(directional.keys[0]).toBe('PUT');
  });

  it('NAKED is its own group, distinct from Income and Directional', () => {
    const risk = POSITION_STRATEGY_FILTER_GROUPS.find(g => g.label === 'Risk')!;
    expect(risk.keys).toEqual(['NAKED']);
  });
});

describe('resolvePositionStrategyDisplayLabel', () => {
  it('labels a standalone long put as LONG PUT, distinct from a CSP\'s bare CSP label', () => {
    const csp = position({ strategy: 'NONE', legs: [leg({ optionType: 'P', direction: 'Short' })] });
    const longPut = position({
      strategy: 'NONE',
      legs: [{ symbol: occSymbol('SPY', 30, 'P', 500), optionType: 'P', strikePrice: 500, direction: 'Long', quantity: 1, avgOpenPrice: 3, currentPrice: null }],
    });
    expect(resolvePositionStrategyDisplayLabel(csp)).toBe('CSP');
    expect(resolvePositionStrategyDisplayLabel(longPut)).toBe('LONG PUT');
  });

  it('labels an uncovered short call as NAKED CALL, an uncovered short put group as NAKED PUT, and both together as NAKED STRANGLE', () => {
    const nakedCall = position({
      strategy: 'NONE',
      legs: [leg({ optionType: 'C', direction: 'Short', symbol: occSymbol('TSLA', 20, 'C', 300), strikePrice: 300 })],
    });
    const nakedPuts = position({
      strategy: 'NONE',
      legs: [
        leg({ optionType: 'P', direction: 'Short', symbol: occSymbol('AAPL', 20, 'P', 200), strikePrice: 200 }),
        leg({ optionType: 'P', direction: 'Short', symbol: occSymbol('AAPL', 20, 'P', 190), strikePrice: 190 }),
      ],
    });
    const nakedStrangle = position({
      strategy: 'NONE',
      legs: [
        leg({ optionType: 'C', direction: 'Short', symbol: occSymbol('AAPL', 20, 'C', 220), strikePrice: 220 }),
        leg({ optionType: 'P', direction: 'Short', symbol: occSymbol('AAPL', 20, 'P', 190), strikePrice: 190 }),
      ],
    });
    expect(resolvePositionStrategyDisplayLabel(nakedCall)).toBe('NAKED CALL');
    expect(resolvePositionStrategyDisplayLabel(nakedPuts)).toBe('NAKED PUT');
    expect(resolvePositionStrategyDisplayLabel(nakedStrangle)).toBe('NAKED STRANGLE');
  });

  it('matches the plain filter key for CSP/CC/PMCC/LEAP/BPS/BCS/IC', () => {
    const bps = position({
      strategy: 'BPS',
      legs: [
        leg({ optionType: 'P', direction: 'Short', strikePrice: 100 }),
        leg({ optionType: 'P', direction: 'Long', strikePrice: 95 }),
      ],
    });
    expect(resolvePositionStrategyDisplayLabel(bps)).toBe('BPS');
  });

  it('falls back to pos.strategy unchanged for a position outside the nine buckets', () => {
    const pos = position({ strategy: 'UNKNOWN', legs: [] });
    expect(resolvePositionStrategyDisplayLabel(pos)).toBe('UNKNOWN');
  });
});

describe('stratColorForFilterKey', () => {
  it('returns a distinct color for NAKED (risk-flagged) and PUT (directional)', () => {
    expect(stratColorForFilterKey('NAKED')).toContain('red');
    expect(stratColorForFilterKey('PUT')).toContain('amber');
    expect(stratColorForFilterKey('LEAP')).toContain('violet');
  });

  it('returns null for CSP/CC/PMCC and for an unclassified (null) key, deferring to the caller\'s existing color logic', () => {
    expect(stratColorForFilterKey('CSP')).toBeNull();
    expect(stratColorForFilterKey('CC')).toBeNull();
    expect(stratColorForFilterKey('PMCC')).toBeNull();
    expect(stratColorForFilterKey(null)).toBeNull();
  });
});
