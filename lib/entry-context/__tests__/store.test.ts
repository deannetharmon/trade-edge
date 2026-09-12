import { describe, expect, it } from 'vitest';
import { availableEvidence, createCreditSpreadEntrySnapshot, unavailableEvidence } from '../types';
import { entrySnapshotOwnerScope, entrySnapshotRedisKey, readEntrySnapshot, readEntrySnapshotsForAccount, saveImmutableEntrySnapshot } from '../store';
import { captureConfirmedCreditSpreadEntry } from '../capture';
import { confirmedOpeningTransactionIds } from '../reconcile';

class MemoryRedis {
  values = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: string, mode: 'NX') {
    if (mode !== 'NX') throw new Error('Expected NX');
    if (this.values.has(key)) return null;
    this.values.set(key, value); return 'OK' as const;
  }
  async sadd(key: string, ...members: string[]) { const set = this.sets.get(key) ?? new Set<string>(); this.sets.set(key, set); const before = set.size; members.forEach(member => set.add(member)); return set.size - before; }
  async smembers(key: string) { return Array.from(this.sets.get(key) ?? new Set<string>()); }
}

const at = '2026-09-08T14:00:00.000Z';
const snapshot = (executionId = 'open-1') => createCreditSpreadEntrySnapshot({
  accountId: 'acct-1', executionId, sourceTransactionIds: [executionId], tradeGroupId: 'group-1', capturedAt: at,
  policyVersion: 'entry-context-v1', strategy: 'BPS', symbol: 'SPY', expiration: '2026-10-16', shortStrike: 600, longStrike: 595, quantity: 1,
  fillPrice: availableEvidence(1.2, 'broker execution', at), underlyingPrice: availableEvidence(610, 'quote', at),
  shortDelta: availableEvidence(-0.2, 'chain', at), shortLegIv: availableEvidence(22, 'chain', at), ivr: availableEvidence(35, 'market metrics', at),
  underlyingIv: availableEvidence(20, 'market metrics', at), expectedMove: availableEvidence(12, 'formula', at), earningsDate: unavailableEvidence('ETF'),
  quoteBid: availableEvidence(1.1, 'chain', at), quoteAsk: availableEvidence(1.3, 'chain', at), quoteMid: availableEvidence(1.2, 'chain', at),
  ivTrend: unavailableEvidence('Historical IV series is not configured'), realizedVolatility: unavailableEvidence('Historical price series is not configured'),
  return5d: unavailableEvidence('Historical price series is not configured'), return20d: unavailableEvidence('Historical price series is not configured'),
  scoreMomentum: unavailableEvidence('n/a'), scoreIvr: unavailableEvidence('n/a'), scoreEmClearance: unavailableEvidence('n/a'), scoreRange: unavailableEvidence('n/a'),
  scoreTechnical: unavailableEvidence('n/a'), scoreLiquidity: unavailableEvidence('n/a'), scoreBuffer: unavailableEvidence('n/a'), scoreStrategyAlignment: unavailableEvidence('n/a'),
  scoreDeltaQuality: unavailableEvidence('n/a'), scoreComposite: unavailableEvidence('n/a'), profitTarget: unavailableEvidence('n/a'), stopLoss: unavailableEvidence('n/a'),
});

describe('entry snapshot store', () => {
  it('persists one immutable snapshot per account and execution', async () => {
    const redis = new MemoryRedis(); const first = snapshot(); const changed = { ...snapshot(), policyVersion: 'changed' };
    expect((await saveImmutableEntrySnapshot(first, redis)).created).toBe(true);
    const duplicate = await saveImmutableEntrySnapshot(changed, redis);
    expect(duplicate.created).toBe(false); expect(duplicate.snapshot.policyVersion).toBe('entry-context-v1');
    expect(await readEntrySnapshot('acct-1', 'open-1', redis)).toEqual(first);
  });
  it('isolates accounts and preserves unavailable evidence', async () => {
    const redis = new MemoryRedis(); const one = snapshot(); const two = { ...snapshot(), accountId: 'acct-2', entrySnapshotId: 'entry-v1:acct-2:open-1' };
    await saveImmutableEntrySnapshot(one, redis); await saveImmutableEntrySnapshot(two, redis);
    expect(entrySnapshotRedisKey('acct-1', 'open-1')).not.toBe(entrySnapshotRedisKey('acct-2', 'open-1'));
    expect((await readEntrySnapshot('acct-1', 'open-1', redis))?.ivTrend.state).toBe('UNAVAILABLE');
  });
  it('requires execution identity to be preserved for Trade Log linkage', () => {
    expect(() => createCreditSpreadEntrySnapshot({ ...snapshot(), executionId: 'other' } as never)).toThrow('sourceTransactionIds must include executionId');
  });
  it('refuses to treat an order acknowledgement as a confirmed entry', () => {
    const s = snapshot();
    expect(() => captureConfirmedCreditSpreadEntry({
      ...s, transactionId: '', executedAt: '',
    })).toThrow('Confirmed broker transaction identity and execution time are required');
  });
  it('requires every expected opening transaction rather than matching by symbol or time', () => {
    const pending = { accountId: 'acct-1', openingTransactionIds: ['leg-a', 'leg-b'] };
    expect(confirmedOpeningTransactionIds(pending, [{ id: 'leg-a', 'transaction-type': 'Trade', 'executed-at': at }])).toBeNull();
    expect(confirmedOpeningTransactionIds(pending, [
      { id: 'leg-a', 'transaction-type': 'Trade', 'executed-at': at },
      { id: 'leg-b', 'transaction-type': 'Trade', 'executed-at': at },
    ])).toEqual(['leg-a', 'leg-b']);
  });
  it('persists derived entry facts rather than requiring Performance to recalculate them', () => {
    expect(snapshot().analysis).toMatchObject({ otmBufferPct: { state: 'AVAILABLE', value: expect.any(Number) }, expectedMoveClearancePct: { state: 'AVAILABLE', value: expect.any(Number) }, expectedMoveState: 'INSIDE' });
  });
  it('lists account-scoped snapshots for Performance without reading current market data', async () => {
    const redis = new MemoryRedis(); await saveImmutableEntrySnapshot(snapshot('open-1'), redis); await saveImmutableEntrySnapshot(snapshot('open-2'), redis);
    expect((await readEntrySnapshotsForAccount('acct-1', redis)).map(s => s.executionId).sort()).toEqual(['open-1', 'open-2']);
  });
  it('isolates the same broker account across authenticated owners', async () => {
    const redis = new MemoryRedis(); const one = snapshot('open-1'); const two = { ...snapshot('open-1'), policyVersion: 'other' };
    await saveImmutableEntrySnapshot(one, redis, entrySnapshotOwnerScope('user-a', 'acct-1'));
    await saveImmutableEntrySnapshot(two, redis, entrySnapshotOwnerScope('user-b', 'acct-1'));
    expect((await readEntrySnapshotsForAccount('acct-1', redis, entrySnapshotOwnerScope('user-a', 'acct-1')))[0].policyVersion).toBe('entry-context-v1');
    expect((await readEntrySnapshotsForAccount('acct-1', redis, entrySnapshotOwnerScope('user-b', 'acct-1')))[0].policyVersion).toBe('other');
  });
});
