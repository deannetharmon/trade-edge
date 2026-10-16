// lib/tradeLookup/__tests__/coverage.test.ts

import { describe, expect, it } from 'vitest';
import { evaluateCoverage } from '../coverage';
import type { CoveredCallCapacityReport } from '@/lib/scans/covered-call-capacity';
import type { PmccFoundationReport } from '@/lib/scans/pmcc-foundations';

function capacity(avail: number | null, status: 'ok' | 'unavailable' = 'ok'): CoveredCallCapacityReport {
  const bySymbol: Record<string, unknown> = {};
  if (avail !== null) bySymbol.BITX = { availableCoveredContracts: avail };
  return { status, bySymbol, warnings: [] } as unknown as CoveredCallCapacityReport;
}
function leaps(avail: number, expiration = '2027-01-15', status: 'ok' | 'unavailable' = 'ok'): PmccFoundationReport {
  return {
    status,
    warnings: [],
    foundations: [{ underlyingSymbol: 'BITX', expiration, strike: 20, availableShortCallContracts: avail }],
  } as unknown as PmccFoundationReport;
}
const base = { strategy: 'CC' as const, symbol: 'BITX', contracts: 1, expiration: '2026-08-28' };

describe('evaluateCoverage', () => {
  it('CSP is not applicable and can order', () => {
    const r = evaluateCoverage({ ...base, strategy: 'CSP', capacity: null, foundations: null });
    expect(r.status).toBe('not_applicable');
    expect(r.canOrder).toBe(true);
  });
  it('covered by shares', () => {
    const r = evaluateCoverage({ ...base, capacity: capacity(3), foundations: leaps(0) });
    expect(r.status).toBe('covered_by_shares');
    expect(r.canOrder).toBe(true);
  });
  it('covered by a LEAP that expires after the call', () => {
    const r = evaluateCoverage({ ...base, capacity: capacity(0), foundations: leaps(1) });
    expect(r.status).toBe('covered_by_leap');
  });
  it('a LEAP that expires before or on the call date does not cover it', () => {
    expect(evaluateCoverage({ ...base, capacity: capacity(0), foundations: leaps(1, '2026-08-28') }).status).toBe('not_covered');
    expect(evaluateCoverage({ ...base, capacity: capacity(0), foundations: leaps(1, '2026-08-21') }).status).toBe('not_covered');
  });
  it('not enough contracts is not covered and cannot order', () => {
    const r = evaluateCoverage({ ...base, contracts: 2, capacity: capacity(1), foundations: leaps(1) });
    expect(r.status).toBe('not_covered');
    expect(r.canOrder).toBe(false);
  });
  it('no holding of the symbol is not covered', () => {
    expect(evaluateCoverage({ ...base, capacity: capacity(null), foundations: leaps(0) }).status).toBe('not_covered');
  });
  it('unavailable reports mean unknown and no ordering', () => {
    expect(evaluateCoverage({ ...base, capacity: null, foundations: null }).status).toBe('unknown');
    expect(evaluateCoverage({ ...base, capacity: capacity(0, 'unavailable'), foundations: leaps(0) }).status).toBe('unknown');
    expect(evaluateCoverage({ ...base, capacity: capacity(0), foundations: leaps(0, '2027-01-15', 'unavailable') }).canOrder).toBe(false);
  });
  it('shares still cover when the LEAP report is unavailable', () => {
    expect(evaluateCoverage({ ...base, capacity: capacity(1), foundations: null }).status).toBe('covered_by_shares');
  });
  it('LEAP still covers when the share report is unavailable', () => {
    expect(evaluateCoverage({ ...base, capacity: null, foundations: leaps(1) }).status).toBe('covered_by_leap');
  });
  it('matches the symbol case-insensitively', () => {
    expect(evaluateCoverage({ ...base, symbol: 'bitx', capacity: capacity(1), foundations: null }).status).toBe('covered_by_shares');
  });
});
