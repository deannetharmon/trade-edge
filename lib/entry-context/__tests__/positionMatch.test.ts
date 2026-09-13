import { describe, it, expect } from 'vitest';
import { findSnapshotForOpenPosition } from '../positionMatch';
import { createCreditSpreadEntrySnapshot, availableEvidence, unavailableEvidence } from '../types';
import type { Position } from '@/lib/portfolio-data/types';

const at = '2026-09-01T14:00:00.000Z';

function snapshot(overrides: Partial<Parameters<typeof createCreditSpreadEntrySnapshot>[0]> = {}) {
  return createCreditSpreadEntrySnapshot({
    accountId: 'acct', executionId: 'open', sourceTransactionIds: ['open'], tradeGroupId: null,
    capturedAt: at, policyVersion: 'v1', strategy: 'BPS', symbol: 'SPY', expiration: '2026-10-16',
    shortStrike: 600, longStrike: 595, quantity: 2,
    fillPrice: unavailableEvidence('n/a'), underlyingPrice: availableEvidence(610, 'x', at),
    shortDelta: unavailableEvidence('n/a'), shortLegIv: unavailableEvidence('n/a'), ivr: unavailableEvidence('n/a'),
    underlyingIv: unavailableEvidence('n/a'), expectedMove: unavailableEvidence('n/a'), earningsDate: unavailableEvidence('n/a'),
    quoteBid: unavailableEvidence('n/a'), quoteAsk: unavailableEvidence('n/a'), quoteMid: unavailableEvidence('n/a'),
    ivTrend: unavailableEvidence('n/a'), realizedVolatility: unavailableEvidence('n/a'), return5d: unavailableEvidence('n/a'), return20d: unavailableEvidence('n/a'),
    scoreMomentum: unavailableEvidence('n/a'), scoreIvr: unavailableEvidence('n/a'), scoreEmClearance: unavailableEvidence('n/a'),
    scoreRange: unavailableEvidence('n/a'), scoreTechnical: unavailableEvidence('n/a'), scoreLiquidity: unavailableEvidence('n/a'),
    scoreBuffer: unavailableEvidence('n/a'), scoreStrategyAlignment: unavailableEvidence('n/a'), scoreDeltaQuality: unavailableEvidence('n/a'),
    scoreComposite: unavailableEvidence('n/a'), profitTarget: unavailableEvidence('n/a'),
    stopLoss: availableEvidence(1.20, 'order plan at entry', at), stopLossPct: availableEvidence(-100, 'order plan at entry', at),
    ...overrides,
  });
}

function position(overrides: Partial<Position> = {}): Position {
  return {
    key: 'k', symbol: 'SPY', expDate: '2026-10-16', dte: 30, strategy: 'BPS', quantity: 2,
    identity: null, structureAmbiguous: false, structureBlockMessage: null,
    legs: [
      { symbol: 'SPY  261016P00600000', optionType: 'P', strikePrice: 600, direction: 'Short', quantity: 2, avgOpenPrice: 0.60, currentPrice: 1.20 },
      { symbol: 'SPY  261016P00595000', optionType: 'P', strikePrice: 595, direction: 'Long', quantity: 2, avgOpenPrice: 0.20, currentPrice: 0.30 },
    ],
    ...overrides,
  } as Position;
}

describe('findSnapshotForOpenPosition', () => {
  it('matches when symbol, expiration, strikes, and quantity all agree', () => {
    const s = snapshot();
    const found = findSnapshotForOpenPosition(position(), [s]);
    expect(found?.entrySnapshotId).toBe(s.entrySnapshotId);
    expect(found?.symbol).toBe('SPY');
  });

  it('does not match a different symbol', () => {
    const found = findSnapshotForOpenPosition(position({ symbol: 'QQQ' }), [snapshot()]);
    expect(found).toBeNull();
  });

  it('does not match a different expiration', () => {
    const found = findSnapshotForOpenPosition(position({ expDate: '2026-11-20' }), [snapshot()]);
    expect(found).toBeNull();
  });

  it('does not match different strikes', () => {
    const found = findSnapshotForOpenPosition(position(), [snapshot({ shortStrike: 610 })]);
    expect(found).toBeNull();
  });

  it('does not match a different quantity', () => {
    const found = findSnapshotForOpenPosition(position({ quantity: 1 }), [snapshot()]);
    expect(found).toBeNull();
  });

  it('returns null when the position has no clear short/long leg pair', () => {
    const found = findSnapshotForOpenPosition(position({ legs: [] }), [snapshot()]);
    expect(found).toBeNull();
  });

  it('prefers the most recently captured snapshot when more than one structurally matches', () => {
    const older = snapshot({ capturedAt: '2026-08-01T00:00:00.000Z' });
    const newer = snapshot({ capturedAt: '2026-09-01T00:00:00.000Z' });
    const found = findSnapshotForOpenPosition(position(), [older, newer]);
    expect(found?.entrySnapshotId).toBe(newer.entrySnapshotId);
  });
});
