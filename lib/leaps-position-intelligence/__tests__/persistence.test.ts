import { describe, expect, it, vi } from 'vitest';
import { appendLedgerEvent, saveMandate, type LeapsIdentity, type LeapsLedgerEvent } from '../persistence/repository';

const identity: LeapsIdentity = { userId: 'u1', canonicalAccountId: 'opaque-a', longOccSymbol: 'NVDA280119C00155000' };
const event = (requestId = 'r1'): LeapsLedgerEvent => ({ id: `event-${requestId}`, at: '2026-09-19T15:00:00.000Z', policyVersion: 'LEAPS-PI-1.1', type: 'outcome-recorded', actor: 'trader', requestId, retention: 'append-only', recovery: 'rebuild-from-ledger', payload: {} });

describe('LEAPS immutable ledger persistence boundary', () => {
  it('uses atomic idempotency for generic event retries', async () => {
    const redis = { eval: vi.fn().mockResolvedValueOnce('saved').mockResolvedValueOnce('replayed') } as any;
    await appendLedgerEvent(redis, identity, event());
    await appendLedgerEvent(redis, identity, event());
    expect(redis.eval).toHaveBeenCalledTimes(2);
  });

  it('rejects mandate events whose immutable request identity differs', async () => {
    const redis = { eval: vi.fn() } as any;
    await expect(saveMandate(redis, identity, { mandate: { version: 'LEAPS-PI-1.1', thesis: 'x', invalidation: 'x', thesisTargetHigh: 200, invalidationPrice: 100, posture: 'balanced', incomeCapStrike: 180, minimumCycleCredit: .2, allowKnownEarningsCycle: false }, updatedAt: '2026-09-19T15:00:00.000Z' }, event('different'), 'request')).rejects.toThrow('identity must match');
    expect(redis.eval).not.toHaveBeenCalled();
  });
});
