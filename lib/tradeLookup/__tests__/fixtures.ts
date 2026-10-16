// lib/tradeLookup/__tests__/fixtures.ts

import type { ChainRow } from '../lookupTypes';
import type { ParsedContract } from '../types';

export function row(strike: number, over: Partial<ChainRow> = {}): ChainRow {
  return {
    strike,
    right: 'P',
    expiration: '2026-11-06',
    bid: 5.4,
    ask: 5.6,
    delta: -0.3,
    openInterest: 1000,
    iv: 63,
    occSymbol: 'SOXL  261106P' + strike,
    quoteUpdatedAt: '2026-10-15T15:00:00Z',
    ...over,
  };
}

export function contract(over: Partial<ParsedContract> = {}): ParsedContract {
  return {
    kind: 'contract',
    strategy: 'CSP',
    ticker: 'SOXL',
    right: 'P',
    strike: 120,
    expiry: { month: 11, day: 6, year: null },
    postedPrice: 5.47,
    postedAt: null,
    isRollLike: false,
    ...over,
  };
}
