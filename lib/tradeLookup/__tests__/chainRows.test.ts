// lib/tradeLookup/__tests__/chainRows.test.ts

import { describe, expect, it } from 'vitest';
import { normalizeChainRows } from '../chainRows';

const raw = (over: Record<string, unknown> = {}) => ({
  strikePrice: 120, expirationDate: '2026-11-06', optionType: 'P', bid: 5.4, ask: 5.6, delta: -0.3,
  openInterest: 12, iv: 63, occSymbol: 'X', quoteUpdatedAt: 't', ...over,
});

describe('normalizeChainRows', () => {
  it('maps getChain output', () => {
    const rows = normalizeChainRows({ '2026-11-06': [raw()] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ strike: 120, right: 'P', expiration: '2026-11-06', bid: 5.4, ask: 5.6, iv: 63, occSymbol: 'X' });
  });
  it('returns [] for null or undefined', () => {
    expect(normalizeChainRows(null)).toEqual([]);
    expect(normalizeChainRows(undefined)).toEqual([]);
  });
  it('skips bad strike, right, or expiration', () => {
    const rows = normalizeChainRows({
      '2026-11-06': [raw({ strikePrice: 'abc' }), raw({ optionType: 'X' }), raw({ strikePrice: 0 }), raw({ expirationDate: 'nope' }), null as unknown, raw({ strikePrice: 75.5 })],
    });
    expect(rows.map((r) => r.strike)).toEqual([75.5]);
  });
  it('keeps non-numeric fields as null, never 0', () => {
    const [r] = normalizeChainRows({ '2026-11-06': [raw({ bid: 'x', delta: undefined, openInterest: null, iv: '' })] });
    expect(r.bid).toBeNull();
    expect(r.delta).toBeNull();
    expect(r.openInterest).toBeNull();
    expect(r.iv).toBeNull();
  });
  it('falls back to the group key when expirationDate is missing', () => {
    const [r] = normalizeChainRows({ '2026-12-18': [raw({ expirationDate: undefined })] });
    expect(r.expiration).toBe('2026-12-18');
  });

  it('converts a decimal IV (0.8 = 80%) to percent so POP is not pinned at 100%, and leaves percent alone', () => {
    const [dec] = normalizeChainRows({ '2026-11-06': [raw({ iv: 0.8 })] });
    const [pct] = normalizeChainRows({ '2026-11-06': [raw({ iv: 63 })] });
    expect(dec.iv).toBeCloseTo(80, 10);
    expect(pct.iv).toBe(63);
  });
});
