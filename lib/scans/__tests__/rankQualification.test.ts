// lib/scans/__tests__/rankQualification.test.ts

// QUAL-STATES-0001 phase 0 (Alan's fixtures): the Ranked scan builds its rows' checks from the
// candidate, derives qualified from those final checks, and uses the shared 10-day earnings
// buffer as a FAIL. Fixed "today" is 2026-09-25 (New York).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exploreAllCandidatesForRank } from '../rank-scoring';
import { DEFAULT_RULES } from '../constants';
import { deriveQualificationState, RANKED_SPREAD_GATE_KEYS } from '../qualificationState';
import { buildRankEarningsCheck, buildRankOiCheck } from '../rankChecks';
import type { CheckResult, SpreadCandidate } from '../types';

const pass: CheckResult = { status: 'pass', value: 'x', reason: 'x' };
const warn: CheckResult = { status: 'warn', value: 'x', reason: 'x' };
const fail: CheckResult = { status: 'fail', value: 'x', reason: 'x' };
const TODAY = '2026-09-25';

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Put chain with a healthy credit so ROC passes; OI configurable. */
function chainFor(expDays: number[], oi: number) {
  const exps = expDays.map(n => addDays(TODAY, n));
  const chains: Record<string, any[]> = {};
  for (const e of exps) {
    chains[e] = [];
    for (let k = 80; k <= 100; k += 5) {
      const mid = (k - 80) / 4;
      chains[e].push({ strikePrice: k, expirationDate: e, optionType: 'P', delta: -((k - 60) / 200), bid: mid - 0.05, ask: mid + 0.05, mid, openInterest: oi, iv: 0.3, occSymbol: `P${k}${e}` });
    }
  }
  return { expirations: exps, chains, isEtfOrIndex: false };
}

function explore(opts: { expDays: number[]; oi?: number; earningsInDays?: number | null; ivRank?: number }) {
  const earnings = opts.earningsInDays == null ? null : addDays(TODAY, opts.earningsInDays);
  return exploreAllCandidatesForRank(
    'TEST', { ivRank: opts.ivRank ?? 50, earningsExpectedDate: earnings, ivx: 30, expirationIvxMap: {} },
    chainFor(opts.expDays, opts.oi ?? 2000), 100, DEFAULT_RULES, undefined, false, DEFAULT_RULES as never,
  );
}

describe('deriveQualificationState', () => {
  it('all gates pass: qualified', () => {
    expect(deriveQualificationState({ ivr: pass, earnings: pass, oi: pass, roc: pass }, RANKED_SPREAD_GATE_KEYS).state).toBe('qualified');
  });
  it('a warning and no failure: caution, naming the warning', () => {
    const r = deriveQualificationState({ ivr: pass, earnings: pass, oi: warn, roc: pass }, RANKED_SPREAD_GATE_KEYS);
    expect(r.state).toBe('caution');
    expect(r.warning).toEqual(['oi']);
  });
  it('a failure wins over a warning: disqualified', () => {
    const r = deriveQualificationState({ ivr: fail, earnings: pass, oi: warn, roc: pass }, RANKED_SPREAD_GATE_KEYS);
    expect(r.state).toBe('disqualified');
    expect(r.failing).toEqual(['ivr']);
  });
  it('a missing or pending gate check fails closed', () => {
    expect(deriveQualificationState({ ivr: pass, earnings: pass, oi: pass }, RANKED_SPREAD_GATE_KEYS).state).toBe('disqualified');
    expect(deriveQualificationState({ ivr: pass, earnings: { ...pass, status: 'pending' }, oi: pass, roc: pass }, RANKED_SPREAD_GATE_KEYS).state).toBe('disqualified');
  });
  it('checks that are not gates are ignored', () => {
    expect(deriveQualificationState({ ivr: pass, earnings: pass, oi: pass, roc: pass, credit: fail, delta: fail, pop: fail }, RANKED_SPREAD_GATE_KEYS).state).toBe('qualified');
  });
});

describe('Ranked scan rows (golden)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-25T15:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('a chain where every gate passes yields qualified rows (this was always 0 before)', () => {
    const rows = explore({ expDays: [28, 40] });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(r => r.qualified)).toBe(true);
    for (const r of rows) {
      expect(deriveQualificationState(r.checks, RANKED_SPREAD_GATE_KEYS).state).toBe('qualified');
    }
  });

  it('low OI is a warning: the row is not qualified but not failed either', () => {
    const rows = explore({ expDays: [28], oi: 100 });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.checks.oi.status).toBe('warn');
      expect(r.qualified).toBe(false);
      expect(deriveQualificationState(r.checks, RANKED_SPREAD_GATE_KEYS).state).toBe('caution');
    }
  });

  it('IVR below the floor is a hard fail', () => {
    const rows = explore({ expDays: [28], ivRank: 10 });
    for (const r of rows) {
      expect(r.checks.ivr.status).toBe('fail');
      expect(r.qualified).toBe(false);
      expect(deriveQualificationState(r.checks, RANKED_SPREAD_GATE_KEYS).state).toBe('disqualified');
    }
  });

  it('earnings 6 days after expiry is inside the 10-day buffer: a fail, with a reason the follow-up button recognizes', () => {
    const rows = explore({ expDays: [28], earningsInDays: 34 });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.checks.earnings.status).toBe('fail');
      expect(r.checks.earnings.reason).toContain('6d after expiry');
      expect(r.qualified).toBe(false);
      expect(r.failReasons.some(f => f.startsWith('Earnings in 34d'))).toBe(true);
    }
  });

  it('earnings exactly 10 days after expiry passes and shows the margin', () => {
    const rows = explore({ expDays: [28], earningsInDays: 38 });
    for (const r of rows) {
      expect(r.checks.earnings.status).toBe('pass');
      expect(r.checks.earnings.reason).toBe('Earnings 10d after expiry');
      expect(r.qualified).toBe(true);
    }
  });

  it('earnings before expiry fails; no earnings date and a past date pass', () => {
    expect(explore({ expDays: [40], earningsInDays: 20 }).every(r => r.checks.earnings.status === 'fail')).toBe(true);
    expect(explore({ expDays: [28], earningsInDays: null }).every(r => r.checks.earnings.status === 'pass')).toBe(true);
    expect(explore({ expDays: [28], earningsInDays: -5 }).every(r => r.checks.earnings.status === 'pass')).toBe(true);
  });

  it('credit, delta and POP are shown as scored, not gated', () => {
    const rows = explore({ expDays: [28] });
    expect(rows[0].checks.pop.reason).toBe('No floor — ranked by score');
  });
});

describe('Ranked check builders', () => {
  const base: SpreadCandidate = {
    strategy: 'BPS', expiration: '2026-10-23', dte: 28, shortStrike: 95, longStrike: 90, shortDelta: 0.2, shortOI: 208, longOI: 371,
    credit: 1.2, spreadWidth: 5, creditRatio: 0.24, roc: 30, pop: 75,
  } as SpreadCandidate;

  it('OI: short leg below the minimum is a warning that keeps the real numbers; at or above passes', () => {
    expect(buildRankOiCheck(base, 500)).toMatchObject({ status: 'warn', value: '208/371' });
    expect(buildRankOiCheck({ ...base, shortOI: 500 }, 500).status).toBe('pass');
  });
  it('OI: iron condors use the worse short leg and show both sides', () => {
    const ic = { ...base, strategy: 'IC', shortOI: 900, shortCallOI: 120, longOI: 800, longCallOI: 700 } as SpreadCandidate;
    const c = buildRankOiCheck(ic, 500);
    expect(c.status).toBe('warn');
    expect(c.value).toBe('P 900/800 · C 120/700');
  });
  it('earnings: ETFs and index fall back to the supplied check', () => {
    const fb: CheckResult = { status: 'pass', value: 'N/A', reason: 'No earnings events' };
    expect(buildRankEarningsCheck('2026-10-24', '2026-10-23', true, fb)).toEqual({ check: fb, failReason: null });
  });
});
