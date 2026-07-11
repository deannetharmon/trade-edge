// lib/autopilot/decision/__tests__/candidatePipeline.test.ts
//
// Sprint 2 validation: candidate normalization, validation (missing
// metadata), and duplicate handling (item 7 -- "duplicate handling") at the
// pipeline stage, before any candidate reaches the shared Decision Engine.

import { describe, expect, it } from 'vitest';
import { runCandidatePipeline } from '@/lib/autopilot/decision/candidatePipeline';
import { makeCandidate, makePortfolioState } from '../../../../test/fixtures/autopilotFixtures';

describe('candidate normalization', () => {
  it('uppercases and trims symbols', () => {
    const result = runCandidatePipeline({
      candidates: [makeCandidate({ symbol: ' amd ' })],
      portfolio: makePortfolioState(),
      source: 'manual',
    });
    expect(result.accepted[0].normalized.symbol).toBe('AMD');
  });

  it('coerces non-finite numeric fields to safe defaults instead of NaN', () => {
    const result = runCandidatePipeline({
      candidates: [makeCandidate({ underlyingPrice: NaN, estimatedCredit: undefined as any })],
      portfolio: makePortfolioState(),
      source: 'manual',
    });
    // underlyingPrice becomes 0 -> fails validation (must be > 0), so this
    // candidate lands in rejected, but normalization itself must not throw
    // or produce NaN.
    const normalized = result.rejected[0]?.normalized ?? result.accepted[0]?.normalized;
    expect(Number.isFinite(normalized.underlyingPrice)).toBe(true);
    expect(Number.isFinite(normalized.estimatedCredit)).toBe(true);
  });

  it('floors theoreticalMaxLoss at zero', () => {
    const result = runCandidatePipeline({
      candidates: [makeCandidate({ theoreticalMaxLoss: -500 })],
      portfolio: makePortfolioState(),
      source: 'manual',
    });
    const normalized = result.rejected[0]?.normalized ?? result.accepted[0]?.normalized;
    expect(normalized.theoreticalMaxLoss).toBeGreaterThanOrEqual(0);
  });
});

describe('candidate validation (missing metadata)', () => {
  it('rejects a candidate missing an id', () => {
    const result = runCandidatePipeline({
      candidates: [makeCandidate({ id: '' })],
      portfolio: makePortfolioState(),
      source: 'manual',
    });
    expect(result.totalRejected).toBe(1);
    expect(result.rejected[0].validationIssues.some((i) => i.field === 'id')).toBe(true);
  });

  it('rejects a candidate with underlyingPrice <= 0', () => {
    const result = runCandidatePipeline({
      candidates: [makeCandidate({ underlyingPrice: 0 })],
      portfolio: makePortfolioState(),
      source: 'manual',
    });
    expect(result.totalRejected).toBe(1);
    expect(result.rejected[0].validationIssues.some((i) => i.field === 'underlyingPrice')).toBe(true);
  });

  it('rejects a candidate with zero legs', () => {
    const result = runCandidatePipeline({
      candidates: [makeCandidate({ legs: [] })],
      portfolio: makePortfolioState(),
      source: 'manual',
    });
    expect(result.rejected[0].validationIssues.some((i) => i.field === 'legs')).toBe(true);
  });

  it('rejects an option leg missing optionType', () => {
    const result = runCandidatePipeline({
      candidates: [
        makeCandidate({
          legs: [{ symbol: 'X', underlyingSymbol: 'X', assetType: 'option', direction: 'short', quantity: 1 } as any],
        }),
      ],
      portfolio: makePortfolioState(),
      source: 'manual',
    });
    expect(result.rejected[0].validationIssues.some((i) => i.field === 'legs[0].optionType')).toBe(true);
  });

  it('warns (does not block) on missing sector, and still accepts the candidate', () => {
    const result = runCandidatePipeline({
      candidates: [makeCandidate({ sector: undefined })],
      portfolio: makePortfolioState(),
      source: 'manual',
    });
    expect(result.totalAccepted).toBe(1);
    expect(result.accepted[0].validationIssues.some((i) => i.field === 'sector' && i.severity === 'warning')).toBe(true);
  });

  it('accepts a fully valid candidate with zero issues', () => {
    const result = runCandidatePipeline({
      candidates: [makeCandidate()],
      portfolio: makePortfolioState(),
      source: 'manual',
    });
    expect(result.totalAccepted).toBe(1);
    expect(result.accepted[0].validationIssues).toHaveLength(0);
  });
});

describe('duplicate handling', () => {
  it('deduplicates identical symbol+strategy+legs candidates, keeping only the first', () => {
    const candidate = makeCandidate({ id: 'dup-1' });
    const duplicate = makeCandidate({ id: 'dup-2' }); // same symbol/strategy/legs, different id
    const result = runCandidatePipeline({
      candidates: [candidate, duplicate],
      portfolio: makePortfolioState(),
      source: 'manual',
    });
    expect(result.totalReceived).toBe(2);
    expect(result.totalAccepted + result.totalRejected).toBe(1);
    expect(result.totalDuplicates).toBe(1);
  });

  it('records a structured DuplicateCandidateRecord instead of silently dropping', () => {
    const candidate = makeCandidate({ id: 'dup-1' });
    const duplicate = makeCandidate({ id: 'dup-2' });
    const result = runCandidatePipeline({
      candidates: [candidate, duplicate],
      portfolio: makePortfolioState(),
      source: 'manual',
    });

    expect(result.duplicates).toHaveLength(1);
    const record = result.duplicates[0];
    expect(record.droppedCandidateId).toBe('dup-2');
    expect(record.retainedCandidateId).toBe('dup-1');
    expect(record.reason).toBe('duplicate_candidate');
    expect(typeof record.dedupeKey).toBe('string');
    expect(record.dedupeKey.length).toBeGreaterThan(0);
  });

  it('a duplicate is inspectable without requiring a full DecisionAnalysis', () => {
    // Duplicates never reach the shared Decision Engine -- they don't carry
    // recommendation/confidence/evidence/etc, only the four required
    // tracking fields. This test guards against someone later "upgrading"
    // a DuplicateCandidateRecord into something that quietly duplicates
    // Decision Engine reasoning.
    const result = runCandidatePipeline({
      candidates: [makeCandidate({ id: 'dup-1' }), makeCandidate({ id: 'dup-2' })],
      portfolio: makePortfolioState(),
      source: 'manual',
    });
    const record = result.duplicates[0];
    expect(Object.keys(record).sort()).toEqual(
      ['dedupeKey', 'droppedCandidateId', 'reason', 'retainedCandidateId'].sort(),
    );
  });

  it('records one entry per extra duplicate when three candidates collide', () => {
    const result = runCandidatePipeline({
      candidates: [
        makeCandidate({ id: 'a' }),
        makeCandidate({ id: 'b' }),
        makeCandidate({ id: 'c' }),
      ],
      portfolio: makePortfolioState(),
      source: 'manual',
    });
    expect(result.totalDuplicates).toBe(2);
    expect(result.duplicates.map((d) => d.droppedCandidateId).sort()).toEqual(['b', 'c']);
    expect(result.duplicates.every((d) => d.retainedCandidateId === 'a')).toBe(true);
  });

  it('count reconciliation is always exact: totalReceived === accepted + rejected + duplicates', () => {
    const result = runCandidatePipeline({
      candidates: [
        makeCandidate({ id: 'valid-1', symbol: 'AMD' }),
        makeCandidate({ id: 'valid-1-dup', symbol: 'AMD' }), // duplicate of valid-1
        makeCandidate({ id: 'invalid-1', symbol: '' }), // fails validation
        makeCandidate({ id: 'valid-2', symbol: 'NVDA' }),
      ],
      portfolio: makePortfolioState(),
      source: 'manual',
    });
    expect(result.totalReceived).toBe(4);
    expect(result.totalAccepted + result.totalRejected + result.totalDuplicates).toBe(result.totalReceived);
  });

  it('does not deduplicate candidates that differ by strike (different legs)', () => {
    const a = makeCandidate({ id: 'a', legs: [{ symbol: 'AMD  260821P00150000', underlyingSymbol: 'AMD', assetType: 'option', direction: 'short', optionType: 'put', strike: 150, quantity: 1 } as any] });
    const b = makeCandidate({ id: 'b', legs: [{ symbol: 'AMD  260821P00145000', underlyingSymbol: 'AMD', assetType: 'option', direction: 'short', optionType: 'put', strike: 145, quantity: 1 } as any] });
    const result = runCandidatePipeline({
      candidates: [a, b],
      portfolio: makePortfolioState(),
      source: 'manual',
    });
    expect(result.totalAccepted).toBe(2);
    expect(result.totalDuplicates).toBe(0);
  });

  it('does not deduplicate the same symbol across different strategies', () => {
    const csp = makeCandidate({ id: 'csp', strategy: 'CSP' });
    const cc = makeCandidate({ id: 'cc', strategy: 'CC' });
    const result = runCandidatePipeline({
      candidates: [csp, cc],
      portfolio: makePortfolioState(),
      source: 'manual',
    });
    expect(result.totalAccepted).toBe(2);
    expect(result.totalDuplicates).toBe(0);
  });

  it('assigns each surviving candidate a unique pipelineId', () => {
    const result = runCandidatePipeline({
      candidates: [makeCandidate({ id: 'a', symbol: 'AMD' }), makeCandidate({ id: 'b', symbol: 'NVDA' })],
      portfolio: makePortfolioState(),
      source: 'manual',
    });
    const ids = result.accepted.map((c) => c.metadata.pipelineId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('portfolio context computation', () => {
  it('projects ticker exposure as current + candidate max loss', () => {
    const result = runCandidatePipeline({
      candidates: [makeCandidate({ symbol: 'AMD', theoreticalMaxLoss: 2000 })],
      portfolio: makePortfolioState({ tickerExposure: { AMD: 3000 } }),
      source: 'manual',
    });
    expect(result.accepted[0].portfolioContext.projectedTickerExposure).toBe(5000);
  });
});
