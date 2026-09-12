import { describe, expect, it } from 'vitest';
import { buildEntryPerformanceRollup } from '../performance';
import { availableEvidence, createCreditSpreadEntrySnapshot, unavailableEvidence } from '../types';

const at = '2026-09-08T14:00:00.000Z';
const snapshot = createCreditSpreadEntrySnapshot({ accountId: 'acct', executionId: 'open', sourceTransactionIds: ['open'], tradeGroupId: null, capturedAt: at, policyVersion: 'v1', strategy: 'BPS', symbol: 'SPY', expiration: '2026-10-16', shortStrike: 600, longStrike: 595, quantity: 1, fillPrice: availableEvidence(1, 'x', at), underlyingPrice: availableEvidence(610, 'x', at), shortDelta: availableEvidence(-.2, 'x', at), shortLegIv: availableEvidence(20, 'x', at), ivr: availableEvidence(30, 'x', at), underlyingIv: availableEvidence(20, 'x', at), expectedMove: availableEvidence(12, 'x', at), earningsDate: unavailableEvidence('n/a'), quoteBid: availableEvidence(1, 'x', at), quoteAsk: availableEvidence(1.1, 'x', at), quoteMid: availableEvidence(1.05, 'x', at), ivTrend: unavailableEvidence('n/a'), realizedVolatility: unavailableEvidence('n/a'), return5d: unavailableEvidence('n/a'), return20d: unavailableEvidence('n/a'), scoreMomentum: unavailableEvidence('n/a'), scoreIvr: unavailableEvidence('n/a'), scoreEmClearance: unavailableEvidence('n/a'), scoreRange: unavailableEvidence('n/a'), scoreTechnical: unavailableEvidence('n/a'), scoreLiquidity: unavailableEvidence('n/a'), scoreBuffer: unavailableEvidence('n/a'), scoreStrategyAlignment: unavailableEvidence('n/a'), scoreDeltaQuality: unavailableEvidence('n/a'), scoreComposite: unavailableEvidence('n/a'), profitTarget: unavailableEvidence('n/a'), stopLoss: unavailableEvidence('n/a') });
const trade = (overrides = {}) => ({ id: 'closed', symbol: 'SPY', strategy: 'BPS', openDate: '2026-09-08', closeDate: '2026-09-10', openTime: '10:00', openDow: 1, expiry: '2026-10-16', holdDays: 2, strikes: '600/595', creditReceived: 100, closePrice: 50, pnl: 50, pnlPct: 50, outcome: 'WIN', quantity: 1, fees: 0, dteAtClose: 30, dteAtEntry: 32, exitType: 'PROFIT_TARGET', reconstructionStatus: 'COMPLETE', closureMechanism: 'CLOSED', openedQuantity: 1, closedQuantity: 1, remainingQuantity: 0, sourceTransactionIds: ['open'], ...overrides }) as any;

describe('entry performance rollup', () => {
  it('uses only complete trades with immutable entry evidence', () => {
    const rollup = buildEntryPerformanceRollup([trade(), trade({ id: 'old', sourceTransactionIds: ['missing'] }), trade({ id: 'partial', reconstructionStatus: 'INCOMPLETE' })], [snapshot]);
    expect(rollup).toMatchObject({ eligibleTrades: 1, missingSnapshotTrades: 1, incompleteReconstructionTrades: 1, realizedPnl: 50, winRate: 1, insideExpectedMove: { count: 1, realizedPnl: 50 } });
  });
  it('does not attribute a multi-leg snapshot when the canonical trade has only one overlapping leg', () => {
    const multiLeg = createCreditSpreadEntrySnapshot({ ...snapshot, entrySnapshotId: undefined, executionId: 'open-a', sourceTransactionIds: ['open-a', 'open-b'] } as never);
    const rollup = buildEntryPerformanceRollup([trade({ sourceTransactionIds: ['open-a', 'close'] })], [multiLeg]);
    expect(rollup).toMatchObject({ eligibleTrades: 0, missingSnapshotTrades: 1 });
  });
});
