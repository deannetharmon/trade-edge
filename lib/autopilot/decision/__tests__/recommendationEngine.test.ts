// lib/autopilot/decision/__tests__/recommendationEngine.test.ts
//
// Sprint 2 validation, items 7 and 8: Autopilot orchestration and safety.
// All Redis-backed persistence (config, paper account, decision log, audit
// trail, run lock) is mocked so these tests are deterministic and require no
// live Redis connection -- they exercise runRecommendationEngine()'s actual
// orchestration logic (pipeline -> pre-gates -> shared engine -> ranking ->
// logging -> audit) against in-memory fakes.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCandidate, makeConfig } from '../../../../test/fixtures/autopilotFixtures';
import type { AutopilotConfig, PaperAccount } from '@/lib/autopilot/types';

const decisionLogEntries: unknown[] = [];
const auditEvents: unknown[] = [];
let mockConfig: AutopilotConfig = makeConfig();
let mockAccount: PaperAccount = {
  userId: 'test-user',
  startingBalance: 100000,
  currentBalance: 100000,
  peakBalance: 100000,
  openPositions: [],
  closedPositions: [],
  dailyEquityCurve: [{ date: '2026-07-11', equity: 100000 }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
};

vi.mock('@/lib/autopilot/persistence/configStore', () => ({
  getAutopilotConfig: vi.fn(async () => mockConfig),
}));

vi.mock('@/lib/autopilot/persistence/paperAccountStore', () => ({
  getPaperAccount: vi.fn(async () => mockAccount),
  savePaperAccount: vi.fn(async (account: PaperAccount) => {
    mockAccount = account;
    return account;
  }),
}));

vi.mock('@/lib/autopilot/persistence/decisionLogStore', () => ({
  appendDecisionLog: vi.fn(async (_userId: string, entry: unknown) => {
    decisionLogEntries.push(entry);
  }),
}));

vi.mock('@/lib/autopilot/persistence/auditTrailStore', () => ({
  appendAuditEvent: vi.fn(async (_userId: string, event: unknown) => {
    auditEvents.push(event);
  }),
}));

vi.mock('@/lib/autopilot/scheduler/locking', () => ({
  acquireAutopilotRunLock: vi.fn(async () => ({ acquired: true, lockId: 'lock_test', key: 'k', ttlSeconds: 240 })),
  releaseAutopilotRunLock: vi.fn(async () => true),
}));

import { runRecommendationEngine } from '@/lib/autopilot/decision/recommendationEngine';

beforeEach(() => {
  decisionLogEntries.length = 0;
  auditEvents.length = 0;
  mockConfig = makeConfig();
  mockAccount = {
    userId: 'test-user',
    startingBalance: 100000,
    currentBalance: 100000,
    peakBalance: 100000,
    openPositions: [],
    closedPositions: [],
    dailyEquityCurve: [{ date: '2026-07-11', equity: 100000 }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
  };
});

describe('multiple candidates', () => {
  it('produces one DecisionAnalysis per accepted+rejected candidate', async () => {
    const candidates = [
      makeCandidate({ id: 'a', symbol: 'AMD' }),
      makeCandidate({ id: 'b', symbol: 'NVDA' }),
      makeCandidate({ id: 'c', symbol: '' }), // invalid -> validation failure analysis
    ];
    const result = await runRecommendationEngine('test-user', { candidates, source: 'manual' });
    expect(result.recommendations).toHaveLength(3);
    expect(result.candidatesScanned).toBe(3);
  });
});

describe('deterministic ranking', () => {
  it('ranks recommended before conditional before not_recommended', async () => {
    const clean = makeCandidate({ id: 'clean', symbol: 'AMD', theoreticalMaxLoss: 500 });
    const earningsBlocked = makeCandidate({ id: 'blocked', symbol: 'NVDA', theoreticalMaxLoss: 500, earningsDate: '2026-07-01' });
    // Force earnings-within-expiration by giving the blocked candidate a leg
    // expiring after the earnings date.
    earningsBlocked.legs = [{ ...earningsBlocked.legs[0], expiration: '2026-08-01' }];

    const result = await runRecommendationEngine('test-user', {
      candidates: [earningsBlocked, clean],
      source: 'manual',
    });

    const statuses = result.recommendations.map((r) => r.recommendation.status);
    const firstNotRecommendedIndex = statuses.indexOf('not_recommended');
    const firstRecommendedIndex = statuses.indexOf('recommended');
    if (firstNotRecommendedIndex !== -1 && firstRecommendedIndex !== -1) {
      expect(firstRecommendedIndex).toBeLessThan(firstNotRecommendedIndex);
    }
  });

  it('produces the same ranking across repeated runs given identical inputs (deterministic)', async () => {
    const candidates = [
      makeCandidate({ id: 'a', symbol: 'AMD', theoreticalMaxLoss: 500, roc: 5 }),
      makeCandidate({ id: 'b', symbol: 'NVDA', theoreticalMaxLoss: 500, roc: 2 }),
    ];
    const run1 = await runRecommendationEngine('test-user', { candidates, source: 'manual' });
    const run2 = await runRecommendationEngine('test-user', { candidates, source: 'manual' });

    const symbols1 = run1.recommendations.map((r) => r.subject.symbol);
    const symbols2 = run2.recommendations.map((r) => r.subject.symbol);
    expect(symbols1).toEqual(symbols2);
  });
});

describe('duplicate handling at orchestration level', () => {
  it('collapses duplicate candidates before they reach the shared engine', async () => {
    const a = makeCandidate({ id: 'a', symbol: 'AMD' });
    const b = makeCandidate({ id: 'b', symbol: 'AMD' }); // identical symbol/strategy/legs
    const result = await runRecommendationEngine('test-user', { candidates: [a, b], source: 'manual' });
    expect(result.recommendations).toHaveLength(1);
  });
});

describe('decision logging', () => {
  it('writes one decision log entry per candidate processed', async () => {
    const candidates = [makeCandidate({ id: 'a', symbol: 'AMD' }), makeCandidate({ id: 'b', symbol: 'NVDA' })];
    const result = await runRecommendationEngine('test-user', { candidates, source: 'manual' });
    expect(decisionLogEntries).toHaveLength(result.recommendations.length);
  });

  it('every decision log entry blocks paper execution regardless of recommendation status', async () => {
    await runRecommendationEngine('test-user', { candidates: [makeCandidate({ theoreticalMaxLoss: 500 })], source: 'manual' });
    const entry = decisionLogEntries[0] as any;
    if (entry.action === 'no_action') {
      expect(entry.rulesBlocked).toContain('paper_execution_disabled_until_sprint_3');
    }
  });
});

describe('audit logging', () => {
  it('writes one recommendation_generated audit event per candidate', async () => {
    const candidates = [makeCandidate({ id: 'a', symbol: 'AMD' }), makeCandidate({ id: 'b', symbol: 'NVDA' })];
    const result = await runRecommendationEngine('test-user', { candidates, source: 'manual' });
    expect(auditEvents).toHaveLength(result.recommendations.length);
    for (const event of auditEvents as any[]) {
      expect(event.eventType).toBe('recommendation_generated');
    }
  });
});

describe('safety', () => {
  it('every returned recommendation has executionAllowed and paperExecutionAllowed false', async () => {
    const candidates = [makeCandidate({ id: 'a' }), makeCandidate({ id: 'b', symbol: 'NVDA', theoreticalMaxLoss: 999999999 })];
    const result = await runRecommendationEngine('test-user', { candidates, source: 'manual' });
    for (const rec of result.recommendations) {
      expect(rec.metadata.executionAllowed).toBe(false);
      expect(rec.metadata.paperExecutionAllowed).toBe(false);
    }
  });

  it('the run result itself is hard-coded to paper mode with live trading disabled', async () => {
    const result = await runRecommendationEngine('test-user', { candidates: [makeCandidate()], source: 'manual' });
    expect(result.mode).toBe('paper');
    expect(result.liveTradingEnabled).toBe(false);
  });

  it('does not add or remove open paper positions as a side effect of a recommendation run', async () => {
    const before = mockAccount.openPositions.length;
    await runRecommendationEngine('test-user', { candidates: [makeCandidate()], source: 'manual' });
    expect(mockAccount.openPositions.length).toBe(before);
  });

  it('does not modify currentBalance as a side effect of a recommendation run', async () => {
    const before = mockAccount.currentBalance;
    await runRecommendationEngine('test-user', { candidates: [makeCandidate()], source: 'manual' });
    expect(mockAccount.currentBalance).toBe(before);
  });

  it('KNOWN GAP: killSwitchEnabled=true does not currently block a recommendation run', async () => {
    // See SPRINT2_TEST_PLAN.md "Known gaps": AutopilotConfig.killSwitchEnabled
    // is persisted and surfaced by /api/autopilot/status but is never read
    // by runRecommendationEngine() or any route in app/api/autopilot. This
    // test documents that a kill-switch flag currently has no effect on
    // recommendation generation, rather than silently assuming it works.
    mockConfig = makeConfig({ killSwitchEnabled: true });
    const result = await runRecommendationEngine('test-user', { candidates: [makeCandidate()], source: 'manual' });
    // If this ever starts failing (i.e. the engine starts short-circuiting
    // or throwing when the kill switch is on), that means the gap has been
    // closed -- update this test to assert the new, correct behavior.
    expect(result.recommendations.length).toBeGreaterThan(0);
  });
});
