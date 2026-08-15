import { describe, expect, it } from 'vitest';
import { DEFAULT_PMCC_QUOTE_POLICY } from '../pmccConfig';
import { evaluatePmccQuoteQuality } from '../pmccQuoteQuality';
import type { PmccChainLeg } from '../pmccTypes';

const asOf = new Date('2026-08-14T20:00:00.000Z');

function leg(overrides: Partial<PmccChainLeg> = {}): PmccChainLeg {
  return {
    underlyingSymbol: 'GS',
    optionType: 'C',
    expiration: '2026-09-18',
    strike: 1070,
    delta: 0.23,
    openInterest: 860,
    bid: 99,
    ask: 101,
    occSymbol: 'GS260918C01070000',
    quoteTimestamp: '2026-08-14T19:59:30.000Z',
    delayed: false,
    ...overrides,
  };
}

describe('evaluatePmccQuoteQuality', () => {
  it('calculates midpoint, width, and percentage against midpoint exactly', () => {
    const result = evaluatePmccQuoteQuality(leg(), DEFAULT_PMCC_QUOTE_POLICY, asOf, 'open');
    expect(result.midpoint).toBe(100);
    expect(result.width).toBe(2);
    expect(result.spreadPct).toBe(2);
    expect(result.status).toBe('acceptable');
    expect(result.readyInput).toBe(true);
  });

  it.each([
    [{ bid: null }, 'insufficient'],
    [{ bid: 0 }, 'insufficient'],
    [{ ask: 0 }, 'insufficient'],
    [{ bid: 102, ask: 101 }, 'insufficient'],
  ] as const)('rejects invalid two-sided quotes %o', (overrides, status) => {
    expect(evaluatePmccQuoteQuality(leg(overrides), DEFAULT_PMCC_QUOTE_POLICY, asOf, 'open').status).toBe(status);
  });

  it('treats exactly 5% as acceptable', () => {
    const result = evaluatePmccQuoteQuality(leg({ bid: 97.5, ask: 102.5 }), DEFAULT_PMCC_QUOTE_POLICY, asOf, 'open');
    expect(result.spreadPct).toBe(5);
    expect(result.status).toBe('acceptable');
  });

  it('warns above 5% through exactly 10%', () => {
    const aboveFive = evaluatePmccQuoteQuality(leg({ bid: 97, ask: 103 }), DEFAULT_PMCC_QUOTE_POLICY, asOf, 'open');
    const exactlyTen = evaluatePmccQuoteQuality(leg({ bid: 95, ask: 105 }), DEFAULT_PMCC_QUOTE_POLICY, asOf, 'open');
    expect(aboveFive.status).toBe('wide_warning');
    expect(exactlyTen.status).toBe('wide_warning');
    expect(exactlyTen.structurallyUsable).toBe(true);
  });

  it('disqualifies a spread above 10%', () => {
    const result = evaluatePmccQuoteQuality(leg({ bid: 94, ask: 106 }), DEFAULT_PMCC_QUOTE_POLICY, asOf, 'open');
    expect(result.status).toBe('too_wide');
    expect(result.structurallyUsable).toBe(false);
  });

  it('uses the supplied as-of time and treats exactly 120 seconds as fresh', () => {
    const result = evaluatePmccQuoteQuality(leg({ quoteTimestamp: '2026-08-14T19:58:00.000Z' }), DEFAULT_PMCC_QUOTE_POLICY, asOf, 'open');
    expect(result.ageSeconds).toBe(120);
    expect(result.readyInput).toBe(true);
  });

  it.each([
    [{ quoteTimestamp: '2026-08-14T19:57:59.000Z' }, 'open', 'stale'],
    [{ quoteTimestamp: null }, 'open', 'timestamp_missing'],
    [{ delayed: true }, 'open', 'delayed'],
    [{}, 'closed', 'market_closed'],
  ] as const)('blocks the quote readiness input for %o', (overrides, session, status) => {
    const result = evaluatePmccQuoteQuality(leg(overrides), DEFAULT_PMCC_QUOTE_POLICY, asOf, session);
    expect(result.status).toBe(status);
    expect(result.readyInput).toBe(false);
    expect(result.structurallyUsable).toBe(true);
  });

  it('is deterministic for identical explicit inputs', () => {
    const first = evaluatePmccQuoteQuality(leg(), DEFAULT_PMCC_QUOTE_POLICY, asOf, 'open');
    const second = evaluatePmccQuoteQuality(leg(), DEFAULT_PMCC_QUOTE_POLICY, asOf, 'open');
    expect(second).toEqual(first);
  });
});
