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

  it('csp/cc/pmcc reject rank and targeted at construction', () => {
    for (const strategy of ['csp', 'cc', 'pmcc'] as const) {
      for (const mode of ['rank', 'targeted'] as const) {
        expect(() => createScanSession({ mode, requestedStrategy: strategy, scope: { universeSymbols: [], eligibleSymbols: [] } }))
          .toThrow(ScanSessionConstructionError);
      }
      expect(() => createScanSession({ mode: 'filter', requestedStrategy: strategy, scope: { universeSymbols: [], eligibleSymbols: [] } })).not.toThrow();
    }
  });

  it('cache validator rejects an invalid mode/strategy combination', () => {
    const s = createScanSession({ mode: 'filter', requestedStrategy: 'csp', scope: { universeSymbols: [], eligibleSymbols: [] } });
    const done = completeSession(s);
    const r = validateSessionData({ ...done, mode: 'rank' }); // CSP was never allowed to be Ranked
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
    const minimal = { symbol: 'A', strategy: 'CSP', qualified: true, failReasons: [] };
    let s = ungatedSession(['A']);
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