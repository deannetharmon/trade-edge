// lib/scans/__tests__/checklistStrictExpiryBoundary.test.ts
// Strict-mode boundary: earnings on the same New York day as an expiration excludes that
// expiry (and the earnings fail reason appears); earnings the day after the expiration keeps it.
// Run under both TZ=UTC and TZ=America/Los_Angeles (same results: the basis is New York).
//
// Observability note: in strict mode runChecklist never picks a candidate, and because the
// earnings buffer is DTE_MAX + 5 any in-window expiry always yields an "Earnings in Nd" fail
// reason, so the kept/excluded distinction is asserted through the shared inclusion predicate
// the strict filter calls, alongside the fail reason and the absence of fallback reasons.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runChecklist } from '../checklist';
import { DEFAULT_RULES } from '../constants';
import { earningsOnOrBeforeExpiration } from '../earningsPrecheck';

const EXP = '2026-10-26';
const NOWS: Array<[string, string]> = [
  ['09:00 ET', '2026-09-24T13:00:00Z'],
  ['17:00 ET', '2026-09-24T21:00:00Z'],
  ['23:30 ET', '2026-09-25T03:30:00Z'],
];

function run(earnings: string | null) {
  return runChecklist(
    'TEST', 'BPS',
    { ivRank: 50, earningsExpectedDate: earnings },
    { expirations: [EXP], chains: {} }, 100, DEFAULT_RULES, undefined, undefined, undefined, undefined, true,
  );
}

describe('strict-mode expiry vs earnings boundary (New York basis)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it.each(NOWS)('earnings on the expiration day at %s: expiry excluded, earnings fail reason present', (_n, iso) => {
    vi.setSystemTime(new Date(iso));
    expect(earningsOnOrBeforeExpiration(EXP, EXP)).toBe(true); // excluded
    const r = run(EXP);
    expect(r.checks.earnings.status).toBe('fail');
    expect(r.failReasons.some(x => x.startsWith('Earnings in '))).toBe(true);
    expect(r.failReasons).not.toContain('No qualifying strikes found');
    expect(r.failReasons.some(x => x.includes('DTE expirations'))).toBe(false);
    expect(r.bestCandidate).toBeNull();
    expect(r.qualified).toBe(false);
  });

  it.each(NOWS)('earnings the day after the expiration at %s: expiry kept', (_n, iso) => {
    vi.setSystemTime(new Date(iso));
    expect(earningsOnOrBeforeExpiration('2026-10-27', EXP)).toBe(false); // kept
    const r = run('2026-10-27');
    expect(r.failReasons.some(x => x.includes('DTE expirations'))).toBe(false); // the expiry is in the window
    expect(r.bestCandidate).toBeNull();
    expect(r.qualified).toBe(false);
  });
});
