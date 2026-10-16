// lib/scans/__tests__/ccOrderSubmission.test.ts

import { describe, expect, it, vi } from 'vitest';
import { guardCcOrder, submitCcOrderIfSafe, type CcOrderRequest } from '../ccOrderSubmission';
import type { CoverageReports } from '@/lib/tradeLookup/loadLookup';

function reports(over: { shares?: number | null; capStatus?: 'ok' | 'unavailable'; leap?: { exp: string; avail: number } | null; foundStatus?: 'ok' | 'unavailable'; basis?: number | null } = {}): CoverageReports {
  const bySymbol: Record<string, unknown> = {};
  if (over.shares !== null) bySymbol.BITX = { availableCoveredContracts: over.shares === undefined ? 2 : over.shares, costBasis: over.basis ?? null, costBasisComplete: over.basis != null };
  return {
    capacity: { status: over.capStatus || 'ok', bySymbol, warnings: [] } as never,
    foundations: {
      status: over.foundStatus || 'ok',
      warnings: [],
      foundations: over.leap ? [{ underlyingSymbol: 'BITX', expiration: over.leap.exp, strike: 10, availableShortCallContracts: over.leap.avail }] : [],
    } as never,
  };
}

const req = (over: Partial<CcOrderRequest> = {}): CcOrderRequest => ({
  symbol: 'BITX', expiration: '2026-11-06', strike: 16, quantity: 1, entryPerShare: 0.4, costBasis: 14, belowCostBasisAcknowledged: false, ...over,
});

describe('guardCcOrder', () => {
  it('allows a call covered by shares, with the assignment numbers', () => {
    const g = guardCcOrder(reports(), req());
    expect(g.allowed).toBe(true);
    if (g.allowed) {
      expect(g.coverage.status).toBe('covered_by_shares');
      expect(g.assignment.gainVsCostBasis).toBe(200);
    }
  });
  it('allows a call covered by a LEAP that expires after it', () => {
    const g = guardCcOrder(reports({ shares: 0, leap: { exp: '2027-01-15', avail: 1 } }), req());
    expect(g.allowed && g.coverage.status).toBe('covered_by_leap');
  });
  it('refuses when the LEAP expires on or before the call', () => {
    expect(guardCcOrder(reports({ shares: 0, leap: { exp: '2026-11-06', avail: 1 } }), req()).allowed).toBe(false);
    expect(guardCcOrder(reports({ shares: 0, leap: { exp: '2026-10-30', avail: 1 } }), req()).allowed).toBe(false);
  });
  it('refuses a quantity above the covered contracts', () => {
    const g = guardCcOrder(reports({ shares: 1 }), req({ quantity: 2 }));
    expect(g.allowed).toBe(false);
  });
  it('refuses a symbol you hold no shares or LEAP in', () => {
    expect(guardCcOrder(reports({ shares: null }), req()).allowed).toBe(false);
  });
  it('fails closed when coverage is unknown or unavailable', () => {
    expect(guardCcOrder(null, req()).allowed).toBe(false);
    expect(guardCcOrder(reports({ capStatus: 'unavailable' }), req()).allowed).toBe(false);
    expect(guardCcOrder({ capacity: null, foundations: null }, req()).allowed).toBe(false);
    expect(guardCcOrder(reports({ shares: 0, foundStatus: 'unavailable' }), req()).allowed).toBe(false);
  });
  it('requires acknowledgment when the strike is below the cost basis, and only then', () => {
    const below = req({ strike: 12, costBasis: 14 });
    expect(guardCcOrder(reports(), below).allowed).toBe(false);
    expect(guardCcOrder(reports(), { ...below, belowCostBasisAcknowledged: true }).allowed).toBe(true);
    expect(guardCcOrder(reports(), req({ strike: 14, costBasis: 14 })).allowed).toBe(true);
  });
  it('unknown cost basis needs no acknowledgment', () => {
    expect(guardCcOrder(reports(), req({ costBasis: null, strike: 1 })).allowed).toBe(true);
  });
  it('refuses bad quantity, price and strike before reading coverage', () => {
    expect(guardCcOrder(reports(), req({ quantity: 0 })).allowed).toBe(false);
    expect(guardCcOrder(reports(), req({ entryPerShare: 0 })).allowed).toBe(false);
    expect(guardCcOrder(reports(), req({ entryPerShare: Number.NaN })).allowed).toBe(false);
    expect(guardCcOrder(reports(), req({ strike: 0 })).allowed).toBe(false);
  });
  it('a refusal carries a readable reason', () => {
    const g = guardCcOrder(null, req());
    expect(!g.allowed && g.reason).toMatch(/verify coverage|ordering stays off/i);
  });
});

describe('submitCcOrderIfSafe', () => {
  it('reads coverage fresh, then calls the broker once', async () => {
    const read = vi.fn(async () => reports());
    const send = vi.fn(async () => 'ok');
    const r = await submitCcOrderIfSafe(read, req(), send);
    expect(read).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ submitted: true, result: 'ok' });
  });
  it('never calls the broker when coverage is insufficient', async () => {
    const send = vi.fn(async () => 'ok');
    const r = await submitCcOrderIfSafe(async () => reports({ shares: 0 }), req(), send);
    expect(send).not.toHaveBeenCalled();
    expect(r.submitted).toBe(false);
  });
  it('never calls the broker when the coverage read throws', async () => {
    const send = vi.fn(async () => 'ok');
    const r = await submitCcOrderIfSafe(async () => { throw new Error('network'); }, req(), send);
    expect(send).not.toHaveBeenCalled();
    expect(r.submitted).toBe(false);
  });
  it('never calls the broker below cost basis without acknowledgment', async () => {
    const send = vi.fn(async () => 'ok');
    const r = await submitCcOrderIfSafe(async () => reports(), req({ strike: 12 }), send);
    expect(send).not.toHaveBeenCalled();
    expect(r.submitted).toBe(false);
  });
  it('uses the fresh reading, not an earlier one', async () => {
    let calls = 0;
    const read = async () => (++calls === 1 ? reports({ shares: 2 }) : reports({ shares: 0 }));
    await read(); // an earlier "dialog open" reading was fine...
    const send = vi.fn(async () => 'ok');
    const r = await submitCcOrderIfSafe(read, req(), send); // ...the pre-Place reading is not
    expect(send).not.toHaveBeenCalled();
    expect(r.submitted).toBe(false);
  });
});
