// lib/portfolio/__tests__/tickSize.test.ts

import { describe, expect, it } from 'vitest';
import {
  isOnTick, keptPct, occRoot, parseTickSizes, roundToTick, sentPriceNote, stopPctOfCredit, tickSizeFor, tickTableFromNestedChain,
  type TickTable,
} from '../tickSize';

// The shape TastyTrade returned for every chain in the 2026-10-04 provider audit.
const PENNY_UNDER_3 = [{ threshold: '3.0', value: '0.01' }, { value: '0.05' }];

describe('parseTickSizes', () => {
  it('parses the published shape and orders bounded steps before the open step', () => {
    expect(parseTickSizes(PENNY_UNDER_3)).toEqual([{ threshold: 3, value: 0.01 }, { threshold: null, value: 0.05 }]);
    expect(parseTickSizes([{ value: '0.05' }, { threshold: '3.0', value: '0.01' }])).toEqual([{ threshold: 3, value: 0.01 }, { threshold: null, value: 0.05 }]);
    expect(parseTickSizes([{ value: '0.01' }])).toEqual([{ threshold: null, value: 0.01 }]);
  });

  it('returns null rather than guessing for missing or malformed tables', () => {
    expect(parseTickSizes(undefined)).toBeNull();
    expect(parseTickSizes([])).toBeNull();
    expect(parseTickSizes([{ threshold: '3.0', value: '0.01' }])).toBeNull(); // no open step
    expect(parseTickSizes([{ value: 'abc' }])).toBeNull();
    expect(parseTickSizes([{ threshold: 'x', value: '0.01' }, { value: '0.05' }])).toBeNull();
  });
});

describe('tickSizeFor and roundToTick at the $3.00 boundary', () => {
  const table = parseTickSizes(PENNY_UNDER_3) as TickTable;

  it('uses $0.01 below $3.00 and $0.05 at or above', () => {
    expect(tickSizeFor(2.99, table)).toBe(0.01);
    expect(tickSizeFor(3.0, table)).toBe(0.05);
    expect(tickSizeFor(3.05, table)).toBe(0.05);
  });

  it('rounds to the nearest valid tick in the band the price falls in', () => {
    expect(roundToTick(2.99, table)).toBe(2.99);
    expect(roundToTick(2.994, table)).toBe(2.99);
    expect(roundToTick(2.998, table)).toBe(3.0); // rounds up into the $0.05 band, which 3.00 satisfies
    expect(roundToTick(3.02, table)).toBe(3.0);
    expect(roundToTick(3.03, table)).toBe(3.05);
    expect(roundToTick(3.78, table)).toBe(3.8); // Ian's example: 30% of a $5.40 credit
    expect(roundToTick(10.8, table)).toBe(10.8);
  });

  it('never returns less than one tick', () => {
    expect(roundToTick(0.001, table)).toBe(0.01);
  });

  it('falls back to whole cents without a table (today\'s behaviour)', () => {
    expect(roundToTick(3.78, null)).toBe(3.78);
    expect(roundToTick(2.704, null)).toBe(2.7);
    expect(isOnTick(3.78, null)).toBe(true);
    expect(isOnTick(3.78, table)).toBe(false);
  });
});

describe('tickTableFromNestedChain', () => {
  const chain = (items: unknown[]) => ({ data: { items } });

  it('matches the item for the option\'s own root (adjusted roots included)', () => {
    const adjusted = chain([
      { 'root-symbol': 'AAPL', 'tick-sizes': PENNY_UNDER_3 },
      { 'root-symbol': 'AAPL1', 'tick-sizes': [{ threshold: '3.0', value: '0.05' }, { value: '0.10' }] },
    ]);
    expect(tickTableFromNestedChain(adjusted, 'AAPL1 271217C00190000')).toEqual([{ threshold: 3, value: 0.05 }, { threshold: null, value: 0.1 }]);
    expect(tickTableFromNestedChain(adjusted, 'AAPL  271217C00190000')).toEqual([{ threshold: 3, value: 0.01 }, { threshold: null, value: 0.05 }]);
  });

  it('uses a single-item chain when no root matches, and returns null otherwise', () => {
    expect(tickTableFromNestedChain(chain([{ 'root-symbol': 'X', 'tick-sizes': PENNY_UNDER_3 }]), 'SOXL  261106P00120000')).not.toBeNull();
    expect(tickTableFromNestedChain(chain([{ 'root-symbol': 'X' }, { 'root-symbol': 'Y' }]), 'SOXL  261106P00120000')).toBeNull();
    expect(tickTableFromNestedChain({}, 'SOXL  261106P00120000')).toBeNull();
  });

  it('reads the OCC root from the space-padded symbol', () => {
    expect(occRoot('SOXL  261106P00120000')).toBe('SOXL');
    expect(occRoot('AAPL1 271217C00190000')).toBe('AAPL1');
  });
});

describe('percent and price round-trips (SOXL, $5.40 credit)', () => {
  const table = parseTickSizes(PENNY_UNDER_3) as TickTable;
  const credit = 5.4;

  it('50% kept -> $2.70 -> 50%', () => {
    const price = roundToTick(credit * (1 - 50 / 100), table);
    expect(price).toBe(2.7);
    expect(keptPct(credit, price)).toBe(50);
  });

  it('30% kept is sent as $3.80 and shown as 29.6%, with a note', () => {
    const price = roundToTick(credit * (1 - 30 / 100), table);
    expect(price).toBe(3.8);
    expect(keptPct(credit, price)).toBe(29.6);
    expect(sentPriceNote(30, price, keptPct(credit, price))).toBe('sent $3.80 · 29.6%');
  });

  it('no note when the typed percentage is exactly what is sent', () => {
    expect(sentPriceNote(50, 2.7, 50)).toBeNull();
  });

  it('stop 200% -> $10.80 -> 200%', () => {
    const trigger = roundToTick(credit * 200 / 100, table);
    expect(trigger).toBe(10.8);
    expect(stopPctOfCredit(credit, trigger)).toBe(200);
  });

  it('returns null for impossible inputs', () => {
    expect(keptPct(0, 1)).toBeNull();
    expect(keptPct(5.4, 0)).toBeNull();
    expect(stopPctOfCredit(5.4, Number.NaN)).toBeNull();
  });
});
