// lib/scans/__tests__/ccHiddenNote.test.ts

// CC-SIMPLIFY-0001 phase 1 -- the line that says what was left out of the best covered-call pick.

import { describe, it, expect } from 'vitest';
import { diagnoseCcExclusions, formatCcHiddenNote, formatCcExclusionSummary, type CcExclusionReport } from '../covered-call-finder';
import type { CcRulesType } from '../constants';

const RULES: CcRulesType = { DELTA_MIN: 0.2, DELTA_MAX: 0.35, DTE_MIN: 21, DTE_MAX: 45, OI_MIN: 100, WIDTH_PCT_MAX: 10, WIDTH_CEILING: 0.5 };

function isoDate(daysOut: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
}

function report(overrides: Partial<CcExclusionReport> = {}): CcExclusionReport {
  return {
    floor: 50, callsTotal: 40, outsideDte: 10, inWindow: 30,
    rejected: { NOT_CALL: 0, NO_DELTA: 0, BAD_STRIKE: 0, BAD_OI: 0, DELTA_WINDOW: 0, BELOW_FLOOR: 0, BAD_QUOTE: 0, CROSSED_QUOTE: 0, WIDTH: 0 },
    eligible: 30, removedByEarnings: 0, bestDeltaAtFloor: null,
    ...overrides,
  };
}

describe('formatCcHiddenNote', () => {
  it('is null when nothing was left out', () => {
    expect(formatCcHiddenNote(report(), RULES)).toBeNull();
  });

  it('is null when the chain returned no calls', () => {
    expect(formatCcHiddenNote(report({ callsTotal: 0, inWindow: 0, outsideDte: 0 }), RULES)).toBeNull();
  });

  it('names each rule that removed calls, with counts and the DTE range that was fetched', () => {
    const r = report({
      rejected: { NOT_CALL: 0, NO_DELTA: 1, BAD_STRIKE: 0, BAD_OI: 2, DELTA_WINDOW: 12, BELOW_FLOOR: 5, BAD_QUOTE: 3, CROSSED_QUOTE: 1, WIDTH: 4 },
      removedByEarnings: 6,
    });
    const note = formatCcHiddenNote(r, RULES)!;
    expect(note).toContain('DTE 21-45');
    expect(note).toContain('5 with strike below the $50.00 floor');
    expect(note).toContain('12 with delta outside 0.2-0.35');
    expect(note).toContain('4 with a bid/ask too wide');
    expect(note).toContain('4 with no usable quote');
    expect(note).toContain('3 with missing data or no open interest');
    expect(note).toContain('6 too close to earnings');
  });

  it('uses the same counts as the empty-result summary, so the two never disagree', () => {
    const r = report({ rejected: { NOT_CALL: 0, NO_DELTA: 0, BAD_STRIKE: 0, BAD_OI: 0, DELTA_WINDOW: 7, BELOW_FLOOR: 0, BAD_QUOTE: 0, CROSSED_QUOTE: 0, WIDTH: 2 }, eligible: 21 });
    expect(formatCcExclusionSummary(r, RULES)).toContain('delta outside 0.2-0.35 7');
    expect(formatCcExclusionSummary(r, RULES)).toContain('bid/ask too wide 2');
    const note = formatCcHiddenNote(r, RULES)!;
    expect(note).toContain('7 with delta outside');
    expect(note).toContain('2 with a bid/ask too wide');
  });

  it('works end to end on a real chain: a wide call and an out-of-window call are counted, the good call is not', () => {
    const exp = isoDate(30);
    const mk = (strike: number, delta: number, bid: number, ask: number, oi = 500) => ({
      strikePrice: strike, expirationDate: exp, optionType: 'C' as const, delta, bid, ask, mid: (bid + ask) / 2, openInterest: oi, occSymbol: `T_${strike}`,
    });
    const chain = { expirations: [exp], chains: { [exp]: [mk(55, 0.28, 1.0, 1.05), mk(56, 0.27, 0.5, 1.5), mk(70, 0.05, 0.1, 0.12)] } };
    const capacity = { costBasis: 50, availableCoveredContracts: 1 } as never;
    const note = formatCcHiddenNote(diagnoseCcExclusions(chain, { rules: RULES, capacity, stockPrice: 52, earningsDate: null }), RULES)!;
    expect(note).toContain('1 with a bid/ask too wide');
    expect(note).toContain('1 with delta outside 0.2-0.35');
  });
});
