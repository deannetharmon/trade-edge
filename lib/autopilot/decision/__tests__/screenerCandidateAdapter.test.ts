// lib/autopilot/decision/__tests__/screenerCandidateAdapter.test.ts
//
// CSP-WORKFLOW-0001 core-correction (BLOCKER-04) — screenResultsToAutopilotCandidates()
// must carry ScreenResult.candidateId through unchanged as
// AutopilotCandidate.screenerCandidateId, the first hop of the canonical
// candidateId propagation chain (ScreenResult -> adapter -> recommendation
// request -> recommendation response -> Best Opportunities -> React keys ->
// CSV -> cache). Confirms this is a straight pass-through, never re-derived
// from this adapter's own internal `id` field, and that two CSP contracts
// on the same symbol (the multi-candidate case) each keep their own,
// distinct canonical id rather than colliding.

import { describe, expect, it } from 'vitest';
import { screenResultsToAutopilotCandidates } from '../screenerCandidateAdapter';
import type { ScreenResult, SpreadCandidate } from '@/lib/scans/types';

function cspCandidate(overrides: Partial<SpreadCandidate> = {}): SpreadCandidate {
  return {
    strategy: 'CSP',
    expiration: '2026-09-18',
    dte: 30,
    shortStrike: 95,
    longStrike: 0,
    shortDelta: -0.2,
    credit: 1.5,
    spreadWidth: 0,
    creditRatio: 0,
    roc: 5,
    pop: 80,
    shortOI: 500,
    longOI: 0,
    requiredCash: 9500,
    ...overrides,
  } as SpreadCandidate;
}

function cspResult(overrides: Partial<ScreenResult> = {}): ScreenResult {
  return {
    symbol: 'AMD',
    strategy: 'CSP',
    price: 200,
    ivr: 50,
    qualified: true,
    bestCandidate: cspCandidate(),
    failReasons: [],
    checks: {} as any,
    candidateId: 'occ:AMD240119P00415000',
    ...overrides,
  };
}

describe('screenResultsToAutopilotCandidates -- BLOCKER-04 canonical candidateId propagation', () => {
  it('carries ScreenResult.candidateId through unchanged as AutopilotCandidate.screenerCandidateId', () => {
    const { candidates } = screenResultsToAutopilotCandidates([cspResult({ candidateId: 'occ:AMD240119P00415000' })]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].screenerCandidateId).toBe('occ:AMD240119P00415000');
  });

  it('the adapter internal id and the canonical screenerCandidateId are different id spaces -- screenerCandidateId is never re-derived from the internal id', () => {
    const { candidates } = screenResultsToAutopilotCandidates([cspResult({ candidateId: 'occ:AMD240119P00415000' })]);
    expect(candidates[0].id).not.toBe(candidates[0].screenerCandidateId);
    expect(candidates[0].id).toBe('screen_AMD_CSP_2026-09-18_95');
  });

  it('two CSP contracts on the same symbol each keep their own distinct canonical candidateId -- no collision', () => {
    const { candidates } = screenResultsToAutopilotCandidates([
      cspResult({ candidateId: 'occ:AMD240119P00415000', bestCandidate: cspCandidate({ shortStrike: 415 }) }),
      cspResult({ candidateId: 'occ:AMD240119P00405000', bestCandidate: cspCandidate({ shortStrike: 405 }) }),
    ]);
    expect(candidates).toHaveLength(2);
    const ids = candidates.map(c => c.screenerCandidateId);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain('occ:AMD240119P00415000');
    expect(ids).toContain('occ:AMD240119P00405000');
  });

  it('a ScreenResult with no candidateId (e.g. a strategy that has not adopted canonical identity yet) yields screenerCandidateId undefined, never fabricated', () => {
    const { candidates } = screenResultsToAutopilotCandidates([cspResult({ candidateId: undefined as any })]);
    expect(candidates[0].screenerCandidateId).toBeUndefined();
  });
});
