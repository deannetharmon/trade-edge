// features/portfolio/briefing/__tests__/whatChanged.test.tsx
//
// PI-0004D: pure-logic coverage for "What Changed" diffing and its
// localStorage-backed snapshot persistence.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  BRIEFING_SNAPSHOT_STORAGE_KEY,
  buildBriefingSnapshot,
  computeWhatChanged,
  loadBriefingSnapshot,
  saveBriefingSnapshot,
} from '../whatChanged';
import type { PortfolioObjective } from '@/lib/portfolio-intelligence';

function makeObjective(overrides: Partial<PortfolioObjective> = {}): PortfolioObjective {
  return {
    id: `obj_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: '2026-07-12T00:00:00.000Z',
    version: 'portfolio-objective-v1',
    type: 'REVIEW_THREATENED_POSITION',
    ruleId: 'OBJ-EARNINGS-RISK',
    title: 'Earnings Risk: AMD',
    summary: 'Upcoming earnings before expiration.',
    priority: 'high',
    urgency: 'today',
    actionability: 'ACTION_NEEDED',
    confidence: 86,
    status: 'active',
    source: 'position',
    subject: { type: 'position', id: 'pos_amd', symbol: 'AMD', label: 'AMD' },
    rationale: 'rationale',
    supportingEvidence: [],
    concerns: [],
    portfolioImpact: { direction: 'negative', magnitude: 'medium', explanation: 'n/a' },
    incomeImpact: { direction: 'neutral', magnitude: 'low', explanation: 'n/a' },
    riskImpact: { direction: 'negative', magnitude: 'medium', explanation: 'n/a' },
    capitalImpact: { direction: 'neutral', magnitude: 'low', explanation: 'n/a' },
    reviewTriggers: [],
    metadata: { executionAllowed: false, paperExecutionAllowed: false, rulesEvaluated: [], rulesTriggered: [] },
    ...overrides,
  };
}

function makeWait(): PortfolioObjective {
  return makeObjective({
    type: 'WAIT', ruleId: 'OBJ-WAIT', title: 'No action required', priority: 'informational',
    urgency: 'none', actionability: 'MONITOR', subject: { type: 'portfolio', label: 'Portfolio' },
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe('PI-0004D: buildBriefingSnapshot', () => {
  it('keys entries by the stable ruleId+subject identity, excluding WAIT', () => {
    const snapshot = buildBriefingSnapshot([makeObjective(), makeWait()]);
    const keys = Object.keys(snapshot);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain('OBJ-EARNINGS-RISK');
  });
});

describe('PI-0004D: computeWhatChanged', () => {
  it('returns no changes when there is no baseline (first-ever load)', () => {
    expect(computeWhatChanged([makeObjective()], null)).toEqual([]);
  });

  it('returns no changes when objectives is null', () => {
    expect(computeWhatChanged(null, {})).toEqual([]);
  });

  it('reports a new objective absent from the previous snapshot', () => {
    const changes = computeWhatChanged([makeObjective()], {});
    expect(changes).toEqual([{ id: expect.stringContaining('OBJ-EARNINGS-RISK'), kind: 'new', label: 'Earnings Risk: AMD' }]);
  });

  it('reports no changes when nothing materially differs from the previous snapshot', () => {
    const objective = makeObjective();
    const previous = buildBriefingSnapshot([objective]);
    // Simulate a plain refresh: new id/createdAt, same substance.
    const refreshed = makeObjective({ id: 'new-id', createdAt: '2026-07-13T00:00:00.000Z' });
    expect(computeWhatChanged([refreshed], previous)).toEqual([]);
  });

  it('reports a changed objective when its fingerprint differs (e.g. priority escalated)', () => {
    const original = makeObjective({ priority: 'high' });
    const previous = buildBriefingSnapshot([original]);
    const escalated = makeObjective({ priority: 'critical' });
    const changes = computeWhatChanged([escalated], previous);
    expect(changes).toEqual([{ id: expect.stringContaining('OBJ-EARNINGS-RISK'), kind: 'changed', label: 'Earnings Risk: AMD' }]);
  });

  it('reports a resolved objective present last time but absent now', () => {
    const previous = buildBriefingSnapshot([makeObjective()]);
    const changes = computeWhatChanged([makeWait()], previous);
    expect(changes).toEqual([{ id: expect.stringContaining('OBJ-EARNINGS-RISK'), kind: 'resolved', label: 'Earnings Risk: AMD' }]);
  });

  it('never reports WAIT itself as new/changed/resolved', () => {
    expect(computeWhatChanged([makeWait()], {})).toEqual([]);
    expect(computeWhatChanged([makeWait()], buildBriefingSnapshot([makeWait()]))).toEqual([]);
  });
});

describe('PI-0004D: snapshot persistence', () => {
  it('round-trips through localStorage', () => {
    const snapshot = buildBriefingSnapshot([makeObjective()]);
    saveBriefingSnapshot(snapshot);
    expect(loadBriefingSnapshot()).toEqual(snapshot);
  });

  it('returns null when nothing has been stored yet', () => {
    expect(loadBriefingSnapshot()).toBeNull();
  });

  it('fails closed (null) on corrupted JSON rather than throwing', () => {
    localStorage.setItem(BRIEFING_SNAPSHOT_STORAGE_KEY, '{not json');
    expect(loadBriefingSnapshot()).toBeNull();
  });

  it('writes to the documented storage key', () => {
    saveBriefingSnapshot(buildBriefingSnapshot([makeObjective()]));
    expect(localStorage.getItem(BRIEFING_SNAPSHOT_STORAGE_KEY)).not.toBeNull();
  });
});
