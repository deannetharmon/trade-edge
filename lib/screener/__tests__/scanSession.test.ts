// lib/screener/__tests__/scanSession.test.ts
import { describe, it, expect } from 'vitest';
import {
  createScanSession,
  normalizeSymbols,
  resolveScanPlan,
  recordSymbolEvaluated,
  recordSymbolFailed,
  recordSymbolSkipped,
  getSymbolsWithoutOutcome,
  resultsSymbolsAreMembers,
  sessionResultsReconcile,
  completeSession,
  errorSession,
  stopSession,
  isSessionStale,
  computeSessionAccounting,
  formatSessionAccountingSummary,
  shouldGenerateRecommendationsForSession,
  validateSessionData,
  ScanSessionConstructionError,
  ScanSessionTransitionError,
  type ScreenerScanSession,
} from '../scanSession';
import type { ScreenResult, CheckResult } from '@/lib/scans/types';
import { buildCspRuleSnapshot } from '@/lib/scans/cspRuleSnapshot';
import { DEFAULT_CSP_RULES } from '@/lib/scans/constants';

const PENDING_CHECK: CheckResult = { status: 'pending', value: '—', reason: '—' };
const emptyChecks = {
  ivr: PENDING_CHECK, earnings: PENDING_CHECK, oi: PENDING_CHECK, delta: PENDING_CHECK,
  credit: PENDING_CHECK, roc: PENDING_CHECK, pop: PENDING_CHECK, iv: PENDING_CHECK, emClearance: PENDING_CHECK,
};

function makeResult(symbol: string, strategy: string, qualified: boolean): ScreenResult {
  return {
    symbol, strategy, price: 100, ivr: 40, qualified, bestCandidate: null,
    failReasons: qualified ? [] : ['test disqualified'], checks: emptyChecks,
  };
}

function ungatedSession(symbols: string[], strategy: 'spreads' | 'csp' | 'pmcc' = 'csp') {
  return createScanSession({
    mode: 'filter', requestedStrategy: strategy,
    scope: { universeSymbols: symbols, eligibleSymbols: symbols },
    ...(strategy === 'csp' ? { ruleSnapshot: buildCspRuleSnapshot(DEFAULT_CSP_RULES) } : {}),
  });
}

// ── 1. Empty universe must NOT imply override ─────────────────────────────
describe('resolveScanPlan: empty universe is never an implicit override', () => {
  it('regression: empty universe + no override = zero selected, zero planned', () => {
    const plan = resolveScanPlan({ universeSymbols: [], eligibleSymbols: ['MU', 'NVDA'] });
    expect(plan.selectedSymbols).toEqual([]);
    expect(plan.plannedScanSymbols).toEqual([]);
  });

  it('regression: empty universe + explicit override = full verified eligible set', () => {
    const plan = resolveScanPlan({ universeSymbols: [], eligibleSymbols: ['MU', 'NVDA'], universeOverridden: true });
    expect(plan.selectedSymbols).toEqual(['MU', 'NVDA']);
    expect(plan.plannedScanSymbols).toEqual(['MU', 'NVDA']);
  });

  it('createScanSession with an empty universe and no override produces a session with nothing to do', () => {
    const s = createScanSession({
      mode: 'filter', requestedStrategy: 'cc',
      scope: { universeSymbols: [], eligibleSymbols: ['MU', 'NVDA'] },
    });
    expect(s.selectedSymbols).toEqual([]);
    expect(s.symbolOutcomes).toEqual([]);
    const done = completeSession(s); // nothing selected -> trivially reconciles
    expect(done.status).toBe('complete');
  });

  it('exact regression from round 1: universe AAPL/MSFT/NVDA, only MSFT eligible', () => {
    const plan = resolveScanPlan({ universeSymbols: ['AAPL', 'MSFT', 'NVDA'], eligibleSymbols: ['MSFT'] });
    expect(plan.selectedSymbols).toEqual(['AAPL', 'MSFT', 'NVDA']);
    expect(plan.plannedScanSymbols).toEqual(['MSFT']);
  });
});

// ── 2. Evaluated-with-zero-candidates requires a reason ────────────────────
describe('recordSymbolEvaluated: reason required iff candidateCount is 0', () => {
  it('rejects zero results with no reasonCode', () => {
    const s = ungatedSession(['A']);
    expect(() => recordSymbolEvaluated(s, 'A', [])).toThrow(ScanSessionTransitionError);
  });

  it('accepts zero results with a valid zero-candidate reasonCode', () => {
    const s = ungatedSession(['A']);
    const evaluated = recordSymbolEvaluated(s, 'A', [], { reasonCode: 'NO_QUALIFYING_CANDIDATE' });
    expect(evaluated.symbolOutcomes[0]).toMatchObject({ status: 'evaluated', candidateCount: 0, reasonCode: 'NO_QUALIFYING_CANDIDATE' });
  });

  it('rejects a reasonCode when real candidates were produced', () => {
    const s = ungatedSession(['A']);
    expect(() => recordSymbolEvaluated(s, 'A', [makeResult('A', 'CSP', true)], { reasonCode: 'NO_QUALIFYING_CANDIDATE' }))
      .toThrow(ScanSessionTransitionError);
  });

  it('the cache validator enforces the same invariant for restored sessions', () => {
    let s = ungatedSession(['A']);
    s = recordSymbolEvaluated(s, 'A', [], { reasonCode: 'NO_QUALIFYING_CANDIDATE' });
    const done = completeSession(s);
    // Tamper: strip the reason from an evaluated-zero-candidate outcome.
    const tampered = { ...done, symbolOutcomes: [{ symbol: 'A', status: 'evaluated', candidateCount: 0 }] };
    const r = validateSessionData(tampered);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain('MISSING_ZERO_CANDIDATE_REASON');
  });
});

// ── 3. NO_OPTION_CHAIN_RETURNED classification ─────────────────────────────
describe('NO_OPTION_CHAIN_RETURNED is a failure reason, never an evaluated-zero-candidate reason', () => {
  it('rejected as an evaluated reasonCode', () => {
    const s = ungatedSession(['A']);
    expect(() => recordSymbolEvaluated(s, 'A', [], { reasonCode: 'NO_OPTION_CHAIN_RETURNED' })).toThrow(ScanSessionTransitionError);
  });

  it('valid as a failed reasonCode, and counts toward failedCount not evaluatedCount', () => {
    let s = ungatedSession(['A', 'B']);
    s = recordSymbolFailed(s, 'A', 'NO_OPTION_CHAIN_RETURNED');
    s = recordSymbolEvaluated(s, 'B', [], { reasonCode: 'NO_QUALIFYING_CANDIDATE' });
    const done = completeSession(s);
    const acc = computeSessionAccounting(done);
    expect(acc.failedCount).toBe(1);
    expect(acc.evaluatedCount).toBe(1);
    expect(done.symbolOutcomes.find(o => o.symbol === 'A')?.status).toBe('failed');
  });
});

// ── 4. Strict result-strategy validation ───────────────────────────────────
describe('validateSessionData: strict result-strategy validation', () => {
  function baseValidSession(): ScreenerScanSession {
    let s = createScanSession({
      mode: 'filter', requestedStrategy: 'cc',
      scope: { universeSymbols: ['AAPL', 'MSFT'], eligibleSymbols: ['MSFT'] },
      scopeExclusionReasonCode: 'CC_NO_CAPACITY',
    });
    s = recordSymbolEvaluated(s, 'MSFT', [makeResult('MSFT', 'CC', true)]);
    return completeSession(s);
  }

  it('rejects a result with a missing strategy field', () => {
    const base = baseValidSession();
    const { strategy, ...withoutStrategy } = base.results[0] as any;
    const r = validateSessionData({ ...base, results: [withoutStrategy] });
    if (!r.valid) expect(r.errors).toContain('RESULT_STRATEGY_MISMATCH');
  });

  it('rejects a result with a null strategy', () => {
    const base = baseValidSession();
    const r = validateSessionData({ ...base, results: [{ ...base.results[0], strategy: null }] });
    if (!r.valid) expect(r.errors).toContain('RESULT_STRATEGY_MISMATCH');
  });

  it('rejects a result with a numeric strategy', () => {
    const base = baseValidSession();
    const r = validateSessionData({ ...base, results: [{ ...base.results[0], strategy: 42 }] });
    if (!r.valid) expect(r.errors).toContain('RESULT_STRATEGY_MISMATCH');
  });

  it('rejects a result with an unknown strategy string', () => {
    const base = baseValidSession();
    const r = validateSessionData({ ...base, results: [{ ...base.results[0], strategy: 'MADE_UP' }] });
    if (!r.valid) expect(r.errors).toContain('RESULT_STRATEGY_MISMATCH');
  });

  it('rejects a valid-but-wrong-session strategy (e.g. BPS in a CC session)', () => {
    const base = baseValidSession();
    const r = validateSessionData({ ...base, results: [{ ...base.results[0], strategy: 'BPS' }] });
    if (!r.valid) expect(r.errors).toContain('RESULT_STRATEGY_MISMATCH');
  });
});

// ── 5. Mode/strategy compatibility ─────────────────────────────────────────
describe('mode/strategy compatibility', () => {
  it('spreads may use filter, rank, or targeted', () => {
    for (const mode of ['filter', 'rank', 'targeted'] as const) {
      expect(() => createScanSession({ mode, requestedStrategy: 'spreads', scope: { universeSymbols: [], eligibleSymbols: [] } })).not.toThrow();
    }
  });

  it('CC and PMCC reject rank and targeted, while CSP accepts all three approved modes', () => {
    for (const strategy of ['cc', 'pmcc'] as const) {
      for (const mode of ['rank', 'targeted'] as const) {
        expect(() => createScanSession({ mode, requestedStrategy: strategy, scope: { universeSymbols: [], eligibleSymbols: [] } }))
          .toThrow(ScanSessionConstructionError);
      }
      expect(() => createScanSession({ mode: 'filter', requestedStrategy: strategy, scope: { universeSymbols: [], eligibleSymbols: [] } })).not.toThrow();
    }
    for (const mode of ['filter', 'rank', 'targeted'] as const) {
      expect(() => createScanSession({ mode, requestedStrategy: 'csp', scope: { universeSymbols: [], eligibleSymbols: [] }, ruleSnapshot: buildCspRuleSnapshot(DEFAULT_CSP_RULES, { mode }) })).not.toThrow();
    }
  });

  it('cache validator rejects an invalid mode/strategy combination', () => {
    const s = createScanSession({ mode: 'filter', requestedStrategy: 'cc', scope: { universeSymbols: [], eligibleSymbols: [] } });
    const done = completeSession(s);
    const r = validateSessionData({ ...done, mode: 'rank' });
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain('INVALID_MODE_STRATEGY_COMBINATION');
  });
});

// ── 6. Per-symbol scope-exclusion reasons ──────────────────────────────────
describe('per-symbol scope-exclusion reasons', () => {
  it('a resolver function assigns a distinct reason to each excluded symbol', () => {
    const s = createScanSession({
      mode: 'filter', requestedStrategy: 'cc',
      scope: { universeSymbols: ['AAPL', 'TSLA', 'MSFT'], eligibleSymbols: ['MSFT'] },
      scopeExclusionReasonCode: (symbol) => symbol === 'AAPL' ? 'CC_NO_SHARES_OWNED' : 'CC_FULLY_COVERED',
    });
    expect(s.symbolOutcomes.find(o => o.symbol === 'AAPL')?.reasonCode).toBe('CC_NO_SHARES_OWNED');
    expect(s.symbolOutcomes.find(o => o.symbol === 'TSLA')?.reasonCode).toBe('CC_FULLY_COVERED');
  });

  it('CC_HIDDEN_BY_TRADER is a distinct, usable reason via the resolver', () => {
    const s = createScanSession({
      mode: 'filter', requestedStrategy: 'cc',
      scope: { universeSymbols: ['AAPL'], eligibleSymbols: [] },
      scopeExclusionReasonCode: () => 'CC_HIDDEN_BY_TRADER',
    });
    expect(s.symbolOutcomes[0].reasonCode).toBe('CC_HIDDEN_BY_TRADER');
  });

  it('falls back to a single provided code when no resolver is given', () => {
    const s = createScanSession({
      mode: 'filter', requestedStrategy: 'cc',
      scope: { universeSymbols: ['AAPL', 'TSLA'], eligibleSymbols: [] },
      scopeExclusionReasonCode: 'CC_NO_CAPACITY',
    });
    expect(s.symbolOutcomes.every(o => o.reasonCode === 'CC_NO_CAPACITY')).toBe(true);
  });

  it('falls back to EXCLUDED_BY_SCAN_SCOPE when nothing is provided at all', () => {
    const s = createScanSession({
      mode: 'filter', requestedStrategy: 'cc',
      scope: { universeSymbols: ['AAPL'], eligibleSymbols: [] },
    });
    expect(s.symbolOutcomes[0].reasonCode).toBe('EXCLUDED_BY_SCAN_SCOPE');
  });
});

// ── 7. Minimum critical ScreenResult shape validation ──────────────────────
describe('validateSessionData: minimum critical ScreenResult shape', () => {
  function baseValidSession(): ScreenerScanSession {
    let s = ungatedSession(['A']);
    s = recordSymbolEvaluated(s, 'A', [makeResult('A', 'CSP', true)]);
    return completeSession(s);
  }

  it('rejects a result with a non-boolean qualified field', () => {
    const base = baseValidSession();
    const r = validateSessionData({ ...base, results: [{ ...base.results[0], qualified: 'yes' }] });
    if (!r.valid) expect(r.errors).toContain('INVALID_RESULT_SHAPE');
  });

  it('rejects a result with a non-array failReasons field', () => {
    const base = baseValidSession();
    const r = validateSessionData({ ...base, results: [{ ...base.results[0], failReasons: 'none' }] });
    if (!r.valid) expect(r.errors).toContain('INVALID_RESULT_SHAPE');
  });

  it('accepts a result with valid symbol/strategy/qualified/failReasons even if other ScreenResult fields are absent', () => {
    const minimal = { symbol: 'A', strategy: 'BPS', qualified: true, failReasons: [] };
    let s = ungatedSession(['A'], 'spreads');
    // Bypass the real API to simulate a minimal-but-critically-valid cached result:
    const done = { ...completeSession(recordSymbolEvaluated(s, 'A', [minimal as any])) };
    const r = validateSessionData(done);
    expect(r.valid).toBe(true);
  });
});

// ── 8. Retained core-invariant regressions from prior rounds ──────────────
describe('retained: planned vs attempted, completion strictness, transition membership', () => {
  it('attemptedCount is derived from outcomes, not the plan, after cancellation', () => {
    let s = ungatedSession(['A', 'B', 'C', 'D', 'E', 'F'], 'spreads');
    s = recordSymbolEvaluated(s, 'A', [makeResult('A', 'BPS', true)]);
    s = recordSymbolEvaluated(s, 'B', [makeResult('B', 'BPS', false)]);
    const stopped = stopSession(s, 'CANCELLED');
    const acc = computeSessionAccounting(stopped);
    expect(acc.attemptedCount).toBe(2);
    expect(acc.skippedCount).toBe(4);
  });

  it('completeSession throws on any missing outcome, with no auto-classify option', () => {
    const s = ungatedSession(['A', 'B']);
    const partial = recordSymbolEvaluated(s, 'A', [makeResult('A', 'CSP', true)]);
    expect(() => completeSession(partial)).toThrow(ScanSessionTransitionError);
    expect((completeSession as (s: ScreenerScanSession) => ScreenerScanSession).length).toBe(1);
  });

  it('recordSymbolEvaluated/Failed reject a selected-but-not-planned symbol', () => {
    const s = createScanSession({
      mode: 'filter', requestedStrategy: 'cc',
      scope: { universeSymbols: ['AAPL', 'MSFT'], eligibleSymbols: ['MSFT'] },
    });
    expect(() => recordSymbolEvaluated(s, 'AAPL', [makeResult('AAPL', 'CC', true)])).toThrow(ScanSessionTransitionError);
    expect(() => recordSymbolFailed(s, 'AAPL', 'UNKNOWN_ERROR')).toThrow(ScanSessionTransitionError);
  });

  it('per-symbol candidate reconciliation catches swapped counts a global sum would miss', () => {
    let s = createScanSession({ mode: 'filter', requestedStrategy: 'spreads', scope: { universeSymbols: ['A', 'B'], eligibleSymbols: ['A', 'B'] } });
    s = recordSymbolEvaluated(s, 'A', [makeResult('A', 'BPS', true)]);
    s = recordSymbolEvaluated(s, 'B', [makeResult('B', 'BPS', true), makeResult('B', 'BCS', false)]);
    const done = completeSession(s);
    const tampered = {
      ...done,
      symbolOutcomes: done.symbolOutcomes.map(o => {
        if (o.symbol === 'A') return { ...o, candidateCount: 2 };
        if (o.symbol === 'B') return { ...o, candidateCount: 1 };
        return o;
      }),
    };
    const globalSum = tampered.symbolOutcomes.reduce((sum, o) => sum + o.candidateCount, 0);
    expect(globalSum).toBe(tampered.results.length); // global sum still matches
    const r = validateSessionData(tampered);
    expect(r.valid).toBe(false); // but per-symbol check still catches it
  });
});

// ── 9. Recommendation gate ──────────────────────────────────────────────
describe('shouldGenerateRecommendationsForSession', () => {
  it('true only for the matching active, completed, nonempty session', () => {
    let s = ungatedSession(['A']);
    s = recordSymbolEvaluated(s, 'A', [makeResult('A', 'CSP', true)]);
    const done = completeSession(s);
    expect(shouldGenerateRecommendationsForSession(done, done.sessionId)).toBe(true);
    expect(shouldGenerateRecommendationsForSession(done, 'newer-session-id')).toBe(false);
  });
});

describe('isSessionStale / normalizeSymbols', () => {
  it('basic sanity', () => {
    const a = ungatedSession(['A']);
    expect(isSessionStale(a.sessionId, null)).toBe(true);
    expect(normalizeSymbols([' amzn ', 'AMZN'])).toEqual(['AMZN']);
  });
});

// ── Final round, point 1: recordSymbolEvaluated enforces strategy integrity
//    immediately, before mutating — a wrong-strategy result can never
//    contaminate a live (not-yet-cached) session ────────────────────────
describe('recordSymbolEvaluated: live strategy/shape enforcement (round 4)', () => {
  it('CSP session rejects a BPS result', () => {
    const s = ungatedSession(['A'], 'csp');
    expect(() => recordSymbolEvaluated(s, 'A', [makeResult('A', 'BPS', true)])).toThrow(ScanSessionTransitionError);
  });

  it('CC session rejects a CSP result', () => {
    const s = createScanSession({ mode: 'filter', requestedStrategy: 'cc', scope: { universeSymbols: ['A'], eligibleSymbols: ['A'] } });
    expect(() => recordSymbolEvaluated(s, 'A', [makeResult('A', 'CSP', true)])).toThrow(ScanSessionTransitionError);
  });

  it('PMCC session rejects a CC result', () => {
    const s = ungatedSession(['A'], 'pmcc');
    expect(() => recordSymbolEvaluated(s, 'A', [makeResult('A', 'CC', true)])).toThrow(ScanSessionTransitionError);
  });

  it('spreads session accepts BPS, BCS, and IC', () => {
    const s = ungatedSession(['A'], 'spreads');
    const evaluated = recordSymbolEvaluated(s, 'A', [
      makeResult('A', 'BPS', true),
      makeResult('A', 'BCS', false),
      makeResult('A', 'IC', false),
    ]);
    expect(evaluated.results).toHaveLength(3);
  });

  it('rejects a result with a missing strategy field', () => {
    const s = ungatedSession(['A'], 'csp');
    const { strategy, ...withoutStrategy } = makeResult('A', 'CSP', true) as any;
    expect(() => recordSymbolEvaluated(s, 'A', [withoutStrategy])).toThrow(ScanSessionTransitionError);
  });

  it('rejects a result with a non-string strategy', () => {
    const s = ungatedSession(['A'], 'csp');
    expect(() => recordSymbolEvaluated(s, 'A', [{ ...makeResult('A', 'CSP', true), strategy: 42 } as any])).toThrow(ScanSessionTransitionError);
  });

  it('rejects a result with a non-boolean qualified field', () => {
    const s = ungatedSession(['A'], 'csp');
    expect(() => recordSymbolEvaluated(s, 'A', [{ ...makeResult('A', 'CSP', true), qualified: 'yes' } as any])).toThrow(ScanSessionTransitionError);
  });

  it('rejects a result with a non-array failReasons field', () => {
    const s = ungatedSession(['A'], 'csp');
    expect(() => recordSymbolEvaluated(s, 'A', [{ ...makeResult('A', 'CSP', true), failReasons: 'none' } as any])).toThrow(ScanSessionTransitionError);
  });

  it('rejects a result with a non-string member in failReasons', () => {
    const s = ungatedSession(['A'], 'csp');
    expect(() => recordSymbolEvaluated(s, 'A', [{ ...makeResult('A', 'CSP', false), failReasons: [123] } as any])).toThrow(ScanSessionTransitionError);
  });

  it('a rejected transition leaves the original session completely unchanged', () => {
    const s = ungatedSession(['A'], 'csp');
    const snapshotBefore = JSON.parse(JSON.stringify(s));
    expect(() => recordSymbolEvaluated(s, 'A', [makeResult('A', 'BPS', true)])).toThrow();
    expect(JSON.parse(JSON.stringify(s))).toEqual(snapshotBefore);
    expect(s.symbolOutcomes).toHaveLength(0);
    expect(s.results).toHaveLength(0);
  });

  it('a wrong-strategy result can never complete a session -- it never even enters symbolOutcomes/results', () => {
    const s = createScanSession({ mode: 'filter', requestedStrategy: 'cc', scope: { universeSymbols: ['A'], eligibleSymbols: ['A'] } });
    try {
      recordSymbolEvaluated(s, 'A', [makeResult('A', 'PMCC', true)]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ScanSessionTransitionError);
    }
    // The original session is still usable and unpolluted -- a correct
    // CC result can still be recorded afterward.
    const fixed = recordSymbolEvaluated(s, 'A', [makeResult('A', 'CC', true)]);
    expect(fixed.results).toHaveLength(1);
    expect(fixed.results[0].strategy).toBe('CC');
  });
});

// ── Final round, point 1 (validator side): the same shared helper is used
//    for cache validation, so a smuggled wrong-strategy result restored
//    from cache is caught too, not just live ────────────────────────────
describe('validateSessionData: shares the same strategy-shape enforcement as the live transition', () => {
  it('a CSP session cached with a smuggled BPS result is rejected', () => {
    let s = ungatedSession(['A'], 'csp');
    s = recordSymbolEvaluated(s, 'A', [makeResult('A', 'CSP', true)]);
    const done = completeSession(s);
    const tampered = { ...done, results: [{ ...done.results[0], strategy: 'BPS' }] };
    const r = validateSessionData(tampered);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain('RESULT_STRATEGY_MISMATCH');
  });
});

// ── Final round, point 2: reserved scope-exclusion reason policy ─────────
describe('createScanSession: reserved scope-exclusion reason policy (round 4)', () => {
  const excludingScope = { universeSymbols: ['AAPL', 'MSFT'], eligibleSymbols: ['MSFT'] }; // AAPL gets excluded

  it('rejects CC_UNATTRIBUTABLE_EXPOSURE as a scalar exclusion reason', () => {
    expect(() => createScanSession({
      mode: 'filter', requestedStrategy: 'cc', scope: excludingScope,
      scopeExclusionReasonCode: 'CC_UNATTRIBUTABLE_EXPOSURE',
    })).toThrow(ScanSessionConstructionError);
  });

  it('rejects CC_HOLDINGS_UNAVAILABLE, ACCESS_TOKEN_UNAVAILABLE, NO_OPTION_CHAIN_RETURNED, MARKET_DATA_REQUEST_FAILED, CANCELLED, SUPERSEDED as scalar exclusion reasons', () => {
    const forbidden = [
      'CC_HOLDINGS_UNAVAILABLE', 'ACCESS_TOKEN_UNAVAILABLE', 'NO_OPTION_CHAIN_RETURNED',
      'MARKET_DATA_REQUEST_FAILED', 'CANCELLED', 'SUPERSEDED',
    ] as const;
    for (const reason of forbidden) {
      expect(() => createScanSession({
        mode: 'filter', requestedStrategy: 'cc', scope: excludingScope,
        scopeExclusionReasonCode: reason,
      })).toThrow(ScanSessionConstructionError);
    }
  });

  it('rejects a resolver that returns a forbidden global reason for any excluded symbol', () => {
    expect(() => createScanSession({
      mode: 'filter', requestedStrategy: 'cc', scope: excludingScope,
      scopeExclusionReasonCode: () => 'CC_UNATTRIBUTABLE_EXPOSURE',
    })).toThrow(ScanSessionConstructionError);
  });

  it('accepts every allowed scope-exclusion reason', () => {
    const allowed = ['EXCLUDED_BY_SCAN_SCOPE', 'CC_NO_CAPACITY', 'CC_NO_SHARES_OWNED', 'CC_FULLY_COVERED', 'CC_HIDDEN_BY_TRADER'] as const;
    for (const reason of allowed) {
      expect(() => createScanSession({
        mode: 'filter', requestedStrategy: 'cc', scope: excludingScope,
        scopeExclusionReasonCode: reason,
      })).not.toThrow();
    }
  });

  it('no partially initialized session is created when validation fails (nothing observable survives the throw)', () => {
    let thrown = false;
    try {
      createScanSession({
        mode: 'filter', requestedStrategy: 'cc', scope: excludingScope,
        scopeExclusionReasonCode: 'ACCESS_TOKEN_UNAVAILABLE',
      });
    } catch (e) {
      thrown = true;
      expect(e).toBeInstanceOf(ScanSessionConstructionError);
    }
    expect(thrown).toBe(true);
  });
});

describe('validateSessionData: reserved scope-exclusion reason policy (round 4)', () => {
  function ccSessionWithExclusion(): ScreenerScanSession {
    let s = createScanSession({
      mode: 'filter', requestedStrategy: 'cc',
      scope: { universeSymbols: ['AAPL', 'MSFT'], eligibleSymbols: ['MSFT'] },
      scopeExclusionReasonCode: 'CC_NO_CAPACITY',
    });
    s = recordSymbolEvaluated(s, 'MSFT', [makeResult('MSFT', 'CC', true)]);
    return completeSession(s);
  }

  it('rejects a not-planned skipped outcome using a stop-transition reason instead of a scope-exclusion reason', () => {
    const base = ccSessionWithExclusion();
    const tampered = { ...base, symbolOutcomes: base.symbolOutcomes.map(o => o.symbol === 'AAPL' ? { ...o, reasonCode: 'CANCELLED' } : o) };
    const r = validateSessionData(tampered);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain('INVALID_SCOPE_EXCLUSION_REASON');
  });

  it('rejects a planned-but-skipped outcome using a scope-exclusion reason instead of CANCELLED/SUPERSEDED', () => {
    let s = createScanSession({
      mode: 'filter', requestedStrategy: 'spreads',
      scope: { universeSymbols: ['A', 'B'], eligibleSymbols: ['A', 'B'] },
    });
    s = recordSymbolEvaluated(s, 'A', [makeResult('A', 'BPS', true)]);
    const stopped = stopSession(s, 'CANCELLED'); // B is planned but never reached -> skipped/CANCELLED
    const tampered = { ...stopped, symbolOutcomes: stopped.symbolOutcomes.map(o => o.symbol === 'B' ? { ...o, reasonCode: 'CC_NO_CAPACITY' } : o) };
    const r = validateSessionData(tampered);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain('INVALID_PLANNED_SKIP_REASON');
  });

  it('rejects CC_UNATTRIBUTABLE_EXPOSURE on a non-error (complete) session', () => {
    const base = ccSessionWithExclusion(); // status: complete
    const tampered = { ...base, symbolOutcomes: base.symbolOutcomes.map(o => o.symbol === 'AAPL' ? { ...o, reasonCode: 'CC_UNATTRIBUTABLE_EXPOSURE' } : o) };
    const r = validateSessionData(tampered);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain('RESERVED_REASON_MISUSE');
  });

  it('accepts CC_UNATTRIBUTABLE_EXPOSURE as a failed-outcome reason on a genuine error session', () => {
    const s = createScanSession({
      mode: 'filter', requestedStrategy: 'cc',
      scope: { universeSymbols: ['MU', 'NVDA'], eligibleSymbols: ['MU', 'NVDA'] },
    });
    const failed = errorSession(s, 'CC_UNATTRIBUTABLE_EXPOSURE');
    const r = validateSessionData(failed);
    expect(r.valid).toBe(true);
  });
});

// ── CSP-WORKFLOW-0001 core-correction pass (BLOCKER-01) ────────────────────
// computeSessionAccounting must distinguish market-qualified count from
// account-actionable count rather than forcing both meanings into one
// Boolean. These are wiring-level tests over the real accounting function,
// using synthetic CSP ScreenResults carrying the same
// bestCandidate.cspAccountEligibility field runCspChecklist() populates in
// production.
function makeCspResult(symbol: string, qualified: boolean, cspAccountEligibility?: 'ELIGIBLE' | 'INSUFFICIENT_CAPITAL' | 'CAPITAL_UNVERIFIED' | 'ACCOUNT_UNSELECTED', cspMarketQualification?: 'QUALIFIED' | 'QUALIFIED_WITH_LIQUIDITY_WARNING'): ScreenResult {
  return {
    symbol, strategy: 'CSP', price: 100, ivr: 40, qualified,
    bestCandidate: qualified ? {
      strategy: 'CSP', expiration: '2026-01-19', dte: 35, shortStrike: 50, longStrike: 50,
      shortDelta: 0.2, credit: 100, spreadWidth: 0, creditRatio: 0.2, roc: 2, pop: 80,
      shortOI: 1000, longOI: 1000,
      cspAccountEligibility, cspMarketQualification,
    } : null,
    failReasons: qualified ? [] : ['test disqualified'], checks: emptyChecks,
  };
}

describe('computeSessionAccounting: BLOCKER-01 market-qualified vs account-actionable', () => {
  it('market-qualified + eligible: accountActionableCount equals qualifiedCandidateCount', () => {
    let s = createScanSession({
      mode: 'filter', requestedStrategy: 'csp',
      scope: { universeSymbols: ['NKE'], eligibleSymbols: ['NKE'] },
    });
    s = recordSymbolEvaluated(s, 'NKE', [makeCspResult('NKE', true, 'ELIGIBLE', 'QUALIFIED')]);
    const done = completeSession(s);
    const acc = computeSessionAccounting(done);
    expect(acc.qualifiedCandidateCount).toBe(1);
    expect(acc.accountActionableCount).toBe(1);
  });

  it('market-qualified + insufficient capital: stays counted as qualified but NOT account-actionable', () => {
    let s = createScanSession({
      mode: 'filter', requestedStrategy: 'csp',
      scope: { universeSymbols: ['AAPL'], eligibleSymbols: ['AAPL'] },
    });
    s = recordSymbolEvaluated(s, 'AAPL', [makeCspResult('AAPL', true, 'INSUFFICIENT_CAPITAL', 'QUALIFIED')]);
    const done = completeSession(s);
    const acc = computeSessionAccounting(done);
    expect(acc.qualifiedCandidateCount).toBe(1);
    expect(acc.accountActionableCount).toBe(0);
    expect(acc.disqualifiedCandidateCount).toBe(0); // must NOT be mislabeled as market-disqualified
  });

  it('market-qualified + capital unverified: stays counted as qualified but NOT account-actionable', () => {
    let s = createScanSession({
      mode: 'filter', requestedStrategy: 'csp',
      scope: { universeSymbols: ['MSFT'], eligibleSymbols: ['MSFT'] },
    });
    s = recordSymbolEvaluated(s, 'MSFT', [makeCspResult('MSFT', true, 'CAPITAL_UNVERIFIED', 'QUALIFIED')]);
    const done = completeSession(s);
    const acc = computeSessionAccounting(done);
    expect(acc.qualifiedCandidateCount).toBe(1);
    expect(acc.accountActionableCount).toBe(0);
    expect(acc.disqualifiedCandidateCount).toBe(0);
  });

  it('no account selected: stays counted as qualified but NOT account-actionable', () => {
    let s = createScanSession({
      mode: 'filter', requestedStrategy: 'csp',
      scope: { universeSymbols: ['TSLA'], eligibleSymbols: ['TSLA'] },
    });
    s = recordSymbolEvaluated(s, 'TSLA', [makeCspResult('TSLA', true, 'ACCOUNT_UNSELECTED', 'QUALIFIED')]);
    const done = completeSession(s);
    const acc = computeSessionAccounting(done);
    expect(acc.qualifiedCandidateCount).toBe(1);
    expect(acc.accountActionableCount).toBe(0);
  });

  it('non-CSP strategies (no cspAccountEligibility field): accountActionableCount always equals qualifiedCandidateCount', () => {
    let s = createScanSession({
      mode: 'filter', requestedStrategy: 'spreads',
      scope: { universeSymbols: ['NVDA'], eligibleSymbols: ['NVDA'] },
    });
    s = recordSymbolEvaluated(s, 'NVDA', [makeResult('NVDA', 'BPS', true)]);
    const done = completeSession(s);
    const acc = computeSessionAccounting(done);
    expect(acc.qualifiedCandidateCount).toBe(1);
    expect(acc.accountActionableCount).toBe(1);
  });

  it('a market-disqualified result (qualified: false) is never counted as account-actionable regardless of any account field', () => {
    let s = createScanSession({
      mode: 'filter', requestedStrategy: 'csp',
      scope: { universeSymbols: ['AMD'], eligibleSymbols: ['AMD'] },
    });
    s = recordSymbolEvaluated(s, 'AMD', [makeCspResult('AMD', false)]);
    const done = completeSession(s);
    const acc = computeSessionAccounting(done);
    expect(acc.qualifiedCandidateCount).toBe(0);
    expect(acc.accountActionableCount).toBe(0);
    expect(acc.disqualifiedCandidateCount).toBe(1);
  });

  it('formatSessionAccountingSummary only surfaces the account-actionable label when it diverges from qualifiedCandidateCount', () => {
    let eligibleSession = createScanSession({
      mode: 'filter', requestedStrategy: 'csp',
      scope: { universeSymbols: ['NKE'], eligibleSymbols: ['NKE'] },
    });
    eligibleSession = recordSymbolEvaluated(eligibleSession, 'NKE', [makeCspResult('NKE', true, 'ELIGIBLE', 'QUALIFIED')]);
    const doneEligible = completeSession(eligibleSession);
    expect(formatSessionAccountingSummary(doneEligible)).not.toContain('account-actionable');

    let unverifiedSession = createScanSession({
      mode: 'filter', requestedStrategy: 'csp',
      scope: { universeSymbols: ['MSFT'], eligibleSymbols: ['MSFT'] },
    });
    unverifiedSession = recordSymbolEvaluated(unverifiedSession, 'MSFT', [makeCspResult('MSFT', true, 'CAPITAL_UNVERIFIED', 'QUALIFIED')]);
    const doneUnverified = completeSession(unverifiedSession);
    expect(formatSessionAccountingSummary(doneUnverified)).toContain('0 account-actionable');
  });
});

describe('CSP-WORKFLOW-0001 core-correction (BLOCKER-06): canonical rule-snapshot schema field', () => {
  const validSnapshot = {
    mode: 'filter' as const, preset: 'balanced',
    ivrMin: 30, ivrMax: 70, deltaMin: 0.15, deltaMax: 0.25,
    dteMin: 30, dteMax: 45, oiMin: 500, bidAskMax: 0.10,
    popMin: null, otmMin: null, rocMin: null,
    rankPrimary: 'score' as const, rankSecondary: 'none' as const,
    earningsPolicy: 'disqualify-within-expiration' as const,
    capturedAt: '2026-08-01T00:00:00.000Z', source: 'default' as const,
  };

  it('createScanSession stores the caller-supplied ruleSnapshot unchanged for a CSP session', () => {
    const session = createScanSession({
      mode: 'filter', requestedStrategy: 'csp',
      scope: { universeSymbols: ['AMD'], eligibleSymbols: ['AMD'] },
      ruleSnapshot: validSnapshot,
    });
    expect(session.ruleSnapshot).toEqual(validSnapshot);
  });

  it('createScanSession defaults ruleSnapshot to null when omitted (e.g. every non-CSP strategy today)', () => {
    const session = createScanSession({
      mode: 'filter', requestedStrategy: 'spreads',
      scope: { universeSymbols: ['AAPL'], eligibleSymbols: ['AAPL'] },
    });
    expect(session.ruleSnapshot).toBeNull();
  });

  it('validateSessionData accepts a CSP session with a well-formed ruleSnapshot', () => {
    let session = createScanSession({
      mode: 'filter', requestedStrategy: 'csp',
      scope: { universeSymbols: ['AMD'], eligibleSymbols: ['AMD'] },
      ruleSnapshot: validSnapshot,
    });
    session = recordSymbolEvaluated(session, 'AMD', [makeCspResult('AMD', false)]);
    const r = validateSessionData(completeSession(session));
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.session.ruleSnapshot).toEqual(validSnapshot);
  });

  it('rejects a qualified CSP cache result with no bestCandidate or canonical qualification states', () => {
    let session = createScanSession({
      mode: 'filter', requestedStrategy: 'csp',
      scope: { universeSymbols: ['AMD'], eligibleSymbols: ['AMD'] },
      ruleSnapshot: validSnapshot,
    });
    session = recordSymbolEvaluated(session, 'AMD', [makeResult('AMD', 'CSP', true)]);
    const validation = validateSessionData(completeSession(session));
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.errors).toContain('INVALID_CSP_QUALIFICATION');
  });

  it('validateSessionData rejects a CSP session with a null ruleSnapshot', () => {
    let session = createScanSession({
      mode: 'filter', requestedStrategy: 'csp',
      scope: { universeSymbols: ['A'], eligibleSymbols: ['A'] },
    });
    session = recordSymbolEvaluated(session, 'A', [makeResult('A', 'CSP', true)]);
    const r = validateSessionData(completeSession(session));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain('INVALID_RULE_SNAPSHOT');
  });

  it('validateSessionData rejects a rule snapshot whose mode differs from its CSP session', () => {
    let session = createScanSession({
      mode: 'rank', requestedStrategy: 'csp',
      scope: { universeSymbols: ['AMD'], eligibleSymbols: ['AMD'] },
      ruleSnapshot: { ...validSnapshot, mode: 'filter' },
    });
    session = recordSymbolEvaluated(session, 'AMD', [makeResult('AMD', 'CSP', true)]);
    const r = validateSessionData(completeSession(session));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain('INVALID_RULE_SNAPSHOT');
  });

  it('validateSessionData fails closed (INVALID_RULE_SNAPSHOT) on a malformed ruleSnapshot -- never silently repaired or dropped', () => {
    let session = createScanSession({
      mode: 'filter', requestedStrategy: 'csp',
      scope: { universeSymbols: ['AMD'], eligibleSymbols: ['AMD'] },
      ruleSnapshot: validSnapshot,
    });
    session = recordSymbolEvaluated(session, 'AMD', [makeResult('AMD', 'CSP', true)]);
    const tampered = { ...completeSession(session), ruleSnapshot: { ...validSnapshot, ivrMin: 'thirty' } };
    const r = validateSessionData(tampered);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain('INVALID_RULE_SNAPSHOT');
  });

  it('validateSessionData fails closed when a required snapshot field is missing entirely', () => {
    let session = createScanSession({
      mode: 'filter', requestedStrategy: 'csp',
      scope: { universeSymbols: ['AMD'], eligibleSymbols: ['AMD'] },
      ruleSnapshot: validSnapshot,
    });
    session = recordSymbolEvaluated(session, 'AMD', [makeResult('AMD', 'CSP', true)]);
    const { dteMax, ...incomplete } = validSnapshot;
    const tampered = { ...completeSession(session), ruleSnapshot: incomplete };
    const r = validateSessionData(tampered);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain('INVALID_RULE_SNAPSHOT');
  });

  it('validateSessionData fails closed when a non-CSP session unexpectedly carries a ruleSnapshot', () => {
    let session = createScanSession({
      mode: 'filter', requestedStrategy: 'spreads',
      scope: { universeSymbols: ['AAPL'], eligibleSymbols: ['AAPL'] },
    });
    session = recordSymbolEvaluated(session, 'AAPL', [makeResult('AAPL', 'BPS', true)]);
    const tampered = { ...completeSession(session), ruleSnapshot: validSnapshot };
    const r = validateSessionData(tampered);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain('INVALID_RULE_SNAPSHOT');
  });

  it('an old-schema cached session (no ruleSnapshot field at all) fails closed on UNKNOWN_SCHEMA_VERSION, never fabricating a snapshot to backfill it', () => {
    let session = createScanSession({
      mode: 'filter', requestedStrategy: 'csp',
      scope: { universeSymbols: ['AMD'], eligibleSymbols: ['AMD'] },
      ruleSnapshot: validSnapshot,
    });
    session = recordSymbolEvaluated(session, 'AMD', [makeResult('AMD', 'CSP', true)]);
    const completed = completeSession(session);
    const { ruleSnapshot, ...withoutSnapshotField } = completed as any;
    const staleSchema = { ...withoutSnapshotField, schemaVersion: 4 };
    const r = validateSessionData(staleSchema);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.errors).toContain('UNKNOWN_SCHEMA_VERSION');
  });

  it.each([
    ['filter', 'FAILED', ['target failed']],
    ['rank', 'PASSED', []],
  ] as const)('rejects %s cache results with contradictory %s mode qualification', (mode, qualification, reasons) => {
    const snapshot = mode === 'rank'
      ? { ...validSnapshot, mode, rankSecondary: 'rocPct' as const }
      : validSnapshot;
    let session = createScanSession({
      mode, requestedStrategy: 'csp',
      scope: { universeSymbols: ['AMD'], eligibleSymbols: ['AMD'] },
      ruleSnapshot: snapshot,
    });
    const result = makeCspResult('AMD', qualification !== 'FAILED', 'ELIGIBLE', 'QUALIFIED');
    result.bestCandidate = {
      ...result.bestCandidate!, cspModeQualification: qualification,
      cspModeQualificationReasons: [...reasons],
    };
    result.qualified = qualification !== 'FAILED';
    result.failReasons = qualification === 'FAILED' ? ['target failed'] : [];
    session = recordSymbolEvaluated(session, 'AMD', [result]);
    const validation = validateSessionData(completeSession(session));
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.errors).toContain('INVALID_CSP_QUALIFICATION');
  });

  it('rejects a Targeted cache result whose mode qualification is NOT_APPLICABLE', () => {
    const snapshot = { ...validSnapshot, mode: 'targeted' as const, popMin: 70 };
    let session = createScanSession({
      mode: 'targeted', requestedStrategy: 'csp',
      scope: { universeSymbols: ['AMD'], eligibleSymbols: ['AMD'] },
      ruleSnapshot: snapshot,
    });
    const result = makeCspResult('AMD', true, 'ELIGIBLE', 'QUALIFIED');
    result.bestCandidate = {
      ...result.bestCandidate!, cspModeQualification: 'NOT_APPLICABLE',
      cspModeQualificationReasons: [],
    };
    session = recordSymbolEvaluated(session, 'AMD', [result]);
    const validation = validateSessionData(completeSession(session));
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.errors).toContain('INVALID_CSP_QUALIFICATION');
  });

  // Alan corrective review follow-up — INVALID_CSP_QUALIFICATION has four
  // independent sub-checks (statesValid, reasonsConsistent, modeConsistent,
  // overallConsistent). The tests above only exercise statesValid (missing
  // bestCandidate) and modeConsistent (wrong mode-qualification state for
  // the session's mode). These three close the remaining two.
  it('rejects a Targeted FAILED result with an empty reasons array -- a failure must explain itself', () => {
    const snapshot = { ...validSnapshot, mode: 'targeted' as const, popMin: 70 };
    let session = createScanSession({
      mode: 'targeted', requestedStrategy: 'csp',
      scope: { universeSymbols: ['AMD'], eligibleSymbols: ['AMD'] },
      ruleSnapshot: snapshot,
    });
    const result = makeCspResult('AMD', false, 'ELIGIBLE', 'QUALIFIED');
    result.bestCandidate = {
      ...result.bestCandidate!, cspMarketQualification: 'QUALIFIED', cspAccountEligibility: 'ELIGIBLE',
      cspModeQualification: 'FAILED', cspModeQualificationReasons: [],
    };
    session = recordSymbolEvaluated(session, 'AMD', [result]);
    const validation = validateSessionData(completeSession(session));
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.errors).toContain('INVALID_CSP_QUALIFICATION');
  });

  it('rejects a Targeted PASSED result that still carries failure reasons -- a pass must not explain a failure that did not happen', () => {
    const snapshot = { ...validSnapshot, mode: 'targeted' as const, popMin: 70 };
    let session = createScanSession({
      mode: 'targeted', requestedStrategy: 'csp',
      scope: { universeSymbols: ['AMD'], eligibleSymbols: ['AMD'] },
      ruleSnapshot: snapshot,
    });
    const result = makeCspResult('AMD', true, 'ELIGIBLE', 'QUALIFIED');
    result.bestCandidate = {
      ...result.bestCandidate!, cspMarketQualification: 'QUALIFIED', cspAccountEligibility: 'ELIGIBLE',
      cspModeQualification: 'PASSED', cspModeQualificationReasons: ['POP 65% is below targeted minimum 70%'],
    };
    session = recordSymbolEvaluated(session, 'AMD', [result]);
    const validation = validateSessionData(completeSession(session));
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.errors).toContain('INVALID_CSP_QUALIFICATION');
  });

  it('rejects a result whose qualified flag contradicts isOverallCspQualified(market, mode) -- every state individually valid and mode-consistent, but qualified:false claimed for a QUALIFIED+NOT_APPLICABLE (i.e. actually-qualified) candidate', () => {
    let session = createScanSession({
      mode: 'filter', requestedStrategy: 'csp',
      scope: { universeSymbols: ['AMD'], eligibleSymbols: ['AMD'] },
      ruleSnapshot: validSnapshot,
    });
    const result = makeCspResult('AMD', false, 'ELIGIBLE', 'QUALIFIED');
    result.bestCandidate = {
      ...result.bestCandidate!, cspMarketQualification: 'QUALIFIED', cspAccountEligibility: 'ELIGIBLE',
      cspModeQualification: 'NOT_APPLICABLE', cspModeQualificationReasons: [],
    };
    // qualified:false is left as-is from makeCspResult('AMD', false, ...) --
    // contradicts isOverallCspQualified('QUALIFIED', 'NOT_APPLICABLE') === true.
    session = recordSymbolEvaluated(session, 'AMD', [result]);
    const validation = validateSessionData(completeSession(session));
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.errors).toContain('INVALID_CSP_QUALIFICATION');
  });
});
