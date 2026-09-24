// lib/scans/__tests__/pmccEarningsRemoval.test.ts

// SCAN-ALIGN-0001D: PMCC earnings REMOVAL (a pre-pairing filter, not a gate), the after-expiry
// warning tag, held-mode outcome, and the result-count receipt. T = 2026-09-24, X1 = 2026-10-16,
// X2 = 2026-11-20. Run under TZ=UTC and TZ=America/Los_Angeles with identical results.
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PMCC_PAIRING_LIMITS, DEFAULT_PMCC_QUOTE_POLICY } from '../pmccConfig';
import { pairPmccCandidates } from '../pmccPairing';
import { buildPmccScreenResults, runPmccProduction } from '../pmccProduction';
import { earningsRemovalReceipt, partitionShortsByEarnings } from '../pmccEarningsRemoval';
import { earningsRemovedBanner, selectEarningsRemovedBanner } from '../pmccHeldOutcomeDisplay';
import { PMCC_DECISION_POLICY_VERSION } from '../pmccDecision';
import type { HeldPmccLongCandidate } from '../pmccHeldLeaps';
import type { PmccChainLeg, PmccPairingCriteria } from '../pmccTypes';

const ASOF = '2026-09-24T15:00:00.000Z';
const X1 = '2026-10-16';
const X2 = '2026-11-20';
const LONG_EXP = '2027-09-17';
const criteria: PmccPairingCriteria = {
  dte: { shortMin: 15, shortMax: 90, longMin: 270, longMax: 730 },
  longDelta: { min: 0.70, max: 0.85 }, shortDelta: { min: 0.20, max: 0.30 },
  longOiMin: 100, shortOiMin: 100,
  quotePolicy: DEFAULT_PMCC_QUOTE_POLICY, limits: DEFAULT_PMCC_PAIRING_LIMITS,
};
const snapshot = { asOf: ASOF, marketSession: 'open' as const, criteria, decisionPolicyVersion: PMCC_DECISION_POLICY_VERSION };
const occ = (expiration: string, strike: number) => `GS${expiration.slice(2).replace(/-/g, '')}C${String(strike * 1000).padStart(8, '0')}`;
const longLeg = (strike = 720): PmccChainLeg => ({
  underlyingSymbol: 'GS', optionType: 'C', expiration: LONG_EXP, strike, delta: 0.8, openInterest: 500, bid: 320, ask: 322,
  occSymbol: occ(LONG_EXP, strike), quoteTimestamp: '2026-09-24T14:59:30.000Z', delayed: false,
});
const shortLeg = (expiration: string, strike = 1060): PmccChainLeg => ({
  underlyingSymbol: 'GS', optionType: 'C', expiration, strike, delta: 0.25, openInterest: 500, bid: 8, ask: 8.2,
  occSymbol: occ(expiration, strike), quoteTimestamp: '2026-09-24T14:59:30.000Z', delayed: false,
});
const context = (earningsDate: string | null) => ({ symbol: 'GS', price: 1037.55, ivr: 35, underlyingType: 'stock' as const, earningsDate });
const chain = { shortExpirations: [], longExpirations: [], chains: {} };
const run = (earningsDate: string | null, shorts: PmccChainLeg[], held: HeldPmccLongCandidate[] = [], snap = snapshot) =>
  runPmccProduction(chain, context(earningsDate), snap, { adapt: vi.fn(() => ({ longLegs: [longLeg()], shortLegs: shorts })), pair: pairPmccCandidates }, held);
const heldBase: HeldPmccLongCandidate = {
  accountNumber: '5WT00001', positionKey: 'held-gs', underlyingSymbol: 'GS',
  occSymbol: occ(LONG_EXP, 720), expiration: LONG_EXP, dte: 358, strike: 720, quantity: 1, avgOpenPrice: 345,
};
const NEVER = /no short calls found/i;

describe('removal is a pre-pairing filter', () => {
  it('two expiries, E = 10-30: the earlier expiry X1 is KEPT and silent; X2 (on or after E) is REMOVED', () => {
    const results = run('2026-10-30', [shortLeg(X1), shortLeg(X2)]);
    expect(results).toHaveLength(1);
    expect(results[0].pmccPair?.shortLeg.expiration).toBe(X1);
    expect(results[0].qualified).toBe(true);
    const codes = results[0].pmccDecision?.gates.map(g => g.code) ?? [];
    expect(codes).not.toContain('EARNINGS_BEFORE_SHORT_EXPIRY');
    expect(codes).not.toContain('EARNINGS_AFTER_SHORT_EXPIRY');
    expect(results[0].pmccEarningsRemoval).toMatchObject({ removedCount: 1, earningsDate: '2026-10-30', allShortsRemoved: false, heldMode: false });
    expect(results[0].pmccPairingCounts?.eligibleShortLegs).toBe(1);
  });

  it('E = X exact and E between T and X are removed; E = T-1 (past) is silent', () => {
    expect(run('2026-10-16', [shortLeg(X1)])[0].pmccPair).toBeUndefined();
    expect(run('2026-10-01', [shortLeg(X1)])[0].pmccPair).toBeUndefined();
    expect(run('2026-09-24', [shortLeg(X1)])[0].pmccPair).toBeUndefined();
    const past = run('2026-09-23', [shortLeg(X1)]);
    expect(past[0].pmccPair).toBeDefined();
    expect(past[0].pmccEarningsRemoval).toBeUndefined();
    expect(past[0].pmccDecision?.gates.map(g => g.code)).not.toContain('EARNINGS_BEFORE_SHORT_EXPIRY');
  });

  it('malformed or missing E never excludes', () => {
    ['2026-13-45', '', 'N/A', '2026-02-30', null].forEach(e => {
      const results = run(e, [shortLeg(X1)]);
      expect(results[0].pmccPair).toBeDefined();
      expect(results[0].pmccEarningsRemoval).toBeUndefined();
    });
  });

  it('non-held, every short removed: audit result says why (not a bare "no eligible short legs")', () => {
    const results = run('2026-10-01', [shortLeg(X1), shortLeg(X2)]);
    expect(results).toHaveLength(1);
    expect(results[0].pmccPair).toBeUndefined();
    expect(results[0].failReasons.join(' ')).toContain('2 short calls removed: earnings on 2026-10-01 falls on or before expiry');
  });
});

describe('after-expiry warning tag (warning only)', () => {
  it('E = X+1bd warns with N = 1, does not change qualification, and stays out of failReasons', () => {
    const withTag = run('2026-10-19', [shortLeg(X1)]);
    const without = run(null, [shortLeg(X1)]);
    const gate = withTag[0].pmccDecision?.gates.find(g => g.code === 'EARNINGS_AFTER_SHORT_EXPIRY');
    expect(gate).toMatchObject({ status: 'warning', observedValue: 1 });
    expect(withTag[0].qualified).toBe(without[0].qualified);
    expect(withTag[0].pmccDecision?.qualification).toBe(without[0].pmccDecision?.qualification);
    expect(withTag[0].pmccDecision?.action).toBe(without[0].pmccDecision?.action);
    expect(withTag[0].failReasons.join(' ')).not.toMatch(/after expiry/i);
    expect(withTag[0].pmccEarningsRemoval).toBeUndefined();
  });

  it('Saturday just after expiry (N = 0) warns; X+5bd warns; X+6bd is silent', () => {
    const observed = (e: string) => run(e, [shortLeg(X1)])[0].pmccDecision?.gates.find(g => g.code === 'EARNINGS_AFTER_SHORT_EXPIRY')?.observedValue;
    expect(observed('2026-10-17')).toBe(0);
    expect(observed('2026-10-23')).toBe(5);
    expect(observed('2026-10-26')).toBeUndefined();
  });
});

describe('held-LEAP mode', () => {
  it('every short removed: symbol-level removedByEarnings outcome, banner is the only reason, never "no short calls found"', () => {
    const results = run('2026-10-16', [shortLeg(X1), shortLeg(X2)], [heldBase]);
    expect(results).toHaveLength(1);
    expect(results[0].pmccPair).toBeUndefined();
    expect(results[0].pmccEarningsRemoval).toMatchObject({ removedCount: 2, earningsDate: '2026-10-16', allShortsRemoved: true, heldMode: true });
    const banner = 'Short calls not offered: earnings on 2026-10-16 falls on or before every expiry in your DTE range.';
    expect(earningsRemovedBanner('2026-10-16')).toBe(banner);
    expect(selectEarningsRemovedBanner(results[0].pmccEarningsRemoval)).toBe(banner);
    expect(results[0].failReasons).toEqual([banner]);
    expect(banner).not.toMatch(NEVER);
    expect(results[0].failReasons.join(' ')).not.toMatch(NEVER);
  });

  it('COST_BASIS_UNAVAILABLE wins: an earnings-removed held LEAP with no usable cost shows the not-checked outcome, not the earnings banner', () => {
    const results = run('2026-10-16', [shortLeg(X1), shortLeg(X2)], [{ ...heldBase, avgOpenPrice: null }]);
    expect(results.length).toBeGreaterThan(0);
    results.forEach(result => {
      expect(result.pmccPair?.failureReasons.some(r => r.code === 'COST_BASIS_UNAVAILABLE')).toBe(true);
      expect(result.qualified).toBe(false);
      expect(selectEarningsRemovedBanner(result.pmccEarningsRemoval)).toBeNull();
    });
  });

  it('multi-lot (quantity 2) also wins over earnings removal', () => {
    const results = run('2026-10-16', [shortLeg(X1)], [{ ...heldBase, quantity: 2 }]);
    expect(results[0].pmccPair?.failureReasons[0]).toMatchObject({ code: 'COST_BASIS_UNAVAILABLE' });
  });

  it('some shorts survive: held pairs are offered for the kept expiry, no banner', () => {
    const results = run('2026-10-30', [shortLeg(X1), shortLeg(X2)], [heldBase]);
    expect(results[0].pmccPair?.shortLeg.expiration).toBe(X1);
    expect(results[0].pmccEarningsRemoval).toMatchObject({ removedCount: 1, allShortsRemoved: false, heldMode: true });
    expect(selectEarningsRemovedBanner(results[0].pmccEarningsRemoval)).toBeNull();
  });

  it('selectEarningsRemovedBanner returns null for non-held, partial or cost-basis-not-checked cases', () => {
    const base = { removedCount: 1, earningsDate: '2026-10-16', allShortsRemoved: true, heldMode: true, asOfUnknown: false };
    expect(selectEarningsRemovedBanner(base)).toBe(earningsRemovedBanner('2026-10-16'));
    expect(selectEarningsRemovedBanner({ ...base, heldMode: false })).toBeNull();
    expect(selectEarningsRemovedBanner({ ...base, allShortsRemoved: false })).toBeNull();
    expect(selectEarningsRemovedBanner(base, true)).toBeNull();
    expect(selectEarningsRemovedBanner(undefined)).toBeNull();
  });
});

describe('unknown asOf and the post-pairing safety net', () => {
  it('partition with a zoneless asOf still removes E <= X and flags the unknown T', () => {
    const p = partitionShortsByEarnings([shortLeg(X1), shortLeg(X2)], '2026-10-16', '2026-09-24T15:00:00', { shortMin: 15, shortMax: 90 });
    expect(p.asOfUnknown).toBe(true);
    expect(p.removed).toHaveLength(2);
    expect(p.kept).toHaveLength(0);
  });

  it('runPmccProduction logs when removal runs without a valid asOf', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const results = run('2026-10-16', [shortLeg(X1)], [], { ...snapshot, asOf: '2026-09-24T15:00:00' });
      expect(results[0].pmccPair).toBeUndefined();
      expect(warn.mock.calls.some(call => String(call[0]).includes('without a valid asOf'))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('buildPmccScreenResults drops an in-window pair even when the caller paired without the filter', () => {
    const pairing = pairPmccCandidates({
      symbol: 'GS', underlyingPrice: 1037.55, longLegs: [longLeg()], shortLegs: [shortLeg(X1)],
      criteria, asOf: new Date(ASOF), marketSession: 'open',
    });
    const results = buildPmccScreenResults(pairing, context('2026-10-01'));
    expect(results).toHaveLength(1);
    expect(results[0].pmccPair).toBeUndefined();
    expect(results[0].pmccEarningsRemoval).toMatchObject({ removedCount: 1, earningsDate: '2026-10-01' });
  });
});

describe('result-count receipt', () => {
  it('counts exclusions once per symbol, singular and plural, empty when none', () => {
    expect(earningsRemovalReceipt([])).toBe('');
    expect(earningsRemovalReceipt([{ pmccEarningsRemoval: undefined }])).toBe('');
    const meta = (n: number) => ({ removedCount: n, earningsDate: '2026-10-16', allShortsRemoved: false, heldMode: false, asOfUnknown: false });
    expect(earningsRemovalReceipt([{ pmccEarningsRemoval: meta(1) }])).toBe(' · 1 short call removed for earnings');
    expect(earningsRemovalReceipt([{ pmccEarningsRemoval: meta(2) }, {}, { pmccEarningsRemoval: meta(3) }])).toBe(' · 5 short calls removed for earnings');
  });

  it('the meta rides on exactly one result per symbol', () => {
    const results = run('2026-10-30', [shortLeg(X1, 1060), shortLeg(X1, 1070), shortLeg(X2)]);
    expect(results.length).toBeGreaterThan(1);
    expect(results.filter(result => result.pmccEarningsRemoval != null)).toHaveLength(1);
    expect(earningsRemovalReceipt(results)).toBe(' · 1 short call removed for earnings');
  });
});
