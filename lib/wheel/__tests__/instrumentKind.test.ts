// lib/wheel/__tests__/instrumentKind.test.ts
//
// WHEEL-SYSTEM-0001 (W1) -- the wheel plan reuses the screener's ETF / index / stock detection.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const classifyUnderlying = vi.fn();
vi.mock('@/lib/scans/tastytrade-client', () => ({ classifyUnderlying: (...a: unknown[]) => classifyUnderlying(...a) }));

import { fetchInstrumentKind } from '../instrumentKind';

beforeEach(() => {
  classifyUnderlying.mockReset();
});

describe('fetchInstrumentKind', () => {
  it.each([
    ['etf', 'etf'],
    ['index', 'etf'],
    ['stock', 'stock'],
    ['unsupported', null],
  ] as const)('the screener says %s -> %s', async (classification, expected) => {
    classifyUnderlying.mockResolvedValue(classification);
    expect(await fetchInstrumentKind('XLF', 'token')).toBe(expected);
    expect(classifyUnderlying).toHaveBeenCalledWith('XLF', 'token');
  });

  it('a thrown error is null, never a crash', async () => {
    classifyUnderlying.mockImplementation(async () => { throw new Error('network'); });
    expect(await fetchInstrumentKind('XLF', 'token')).toBeNull();
  });
});
