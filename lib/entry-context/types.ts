import { buildCreditSpreadEntryFacts } from './analysis';

export const ENTRY_SNAPSHOT_SCHEMA_VERSION = '1' as const;

export type EvidenceState = 'AVAILABLE' | 'UNAVAILABLE' | 'STALE';

export interface Evidence<T> {
  state: EvidenceState;
  value: T | null;
  source: string | null;
  asOf: string | null;
  reason: string | null;
}

export interface CreditSpreadEntrySnapshot {
  schemaVersion: typeof ENTRY_SNAPSHOT_SCHEMA_VERSION;
  entrySnapshotId: string;
  accountId: string;
  executionId: string;
  sourceTransactionIds: string[];
  tradeGroupId: string | null;
  capturedAt: string;
  policyVersion: string;
  strategy: 'BPS' | 'BCS';
  symbol: string;
  expiration: string;
  shortStrike: number;
  longStrike: number;
  quantity: number;
  fillPrice: Evidence<number>;
  underlyingPrice: Evidence<number>;
  shortDelta: Evidence<number>;
  shortLegIv: Evidence<number>;
  ivr: Evidence<number>;
  underlyingIv: Evidence<number>;
  expectedMove: Evidence<number>;
  earningsDate: Evidence<string>;
  quoteBid: Evidence<number>;
  quoteAsk: Evidence<number>;
  quoteMid: Evidence<number>;
  analysis: {
    otmBufferPct: Evidence<number>;
    expectedMoveClearancePct: Evidence<number>;
    expectedMoveState: 'UNAVAILABLE' | 'INSIDE' | 'OUTSIDE';
  };
  ivTrend: Evidence<number>;
  realizedVolatility: Evidence<number>;
  return5d: Evidence<number>;
  return20d: Evidence<number>;
}

export type CreditSpreadEntrySnapshotInput = Omit<CreditSpreadEntrySnapshot, 'schemaVersion' | 'entrySnapshotId' | 'analysis'>;

export function unavailableEvidence<T>(reason: string): Evidence<T> {
  return { state: 'UNAVAILABLE', value: null, source: null, asOf: null, reason };
}

export function availableEvidence<T>(value: T, source: string, asOf: string): Evidence<T> {
  return { state: 'AVAILABLE', value, source, asOf, reason: null };
}

function assertEvidence<T>(evidence: Evidence<T>, field: string): void {
  if (evidence.state === 'AVAILABLE' && (evidence.value == null || !evidence.source || !evidence.asOf)) {
    throw new Error(`${field} AVAILABLE evidence requires value, source, and asOf`);
  }
  if (evidence.state !== 'AVAILABLE' && evidence.value !== null) {
    throw new Error(`${field} ${evidence.state} evidence cannot contain a value`);
  }
}

export function createCreditSpreadEntrySnapshot(input: CreditSpreadEntrySnapshotInput): CreditSpreadEntrySnapshot {
  if (!input.accountId || !input.executionId) throw new Error('accountId and executionId are required');
  if (!input.sourceTransactionIds.includes(input.executionId)) throw new Error('sourceTransactionIds must include executionId');
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error('quantity must be positive');
  if (!Number.isFinite(input.shortStrike) || !Number.isFinite(input.longStrike)) throw new Error('strikes must be finite');
  const fields: Array<[Evidence<unknown>, string]> = [
    [input.fillPrice, 'fillPrice'], [input.underlyingPrice, 'underlyingPrice'], [input.shortDelta, 'shortDelta'],
    [input.shortLegIv, 'shortLegIv'], [input.ivr, 'ivr'], [input.underlyingIv, 'underlyingIv'],
    [input.expectedMove, 'expectedMove'], [input.earningsDate, 'earningsDate'], [input.quoteBid, 'quoteBid'],
    [input.quoteAsk, 'quoteAsk'], [input.quoteMid, 'quoteMid'], [input.ivTrend, 'ivTrend'],
    [input.realizedVolatility, 'realizedVolatility'], [input.return5d, 'return5d'], [input.return20d, 'return20d'],
  ];
  fields.forEach(([evidence, field]) => assertEvidence(evidence, field));
  const facts = buildCreditSpreadEntryFacts({
    strategy: input.strategy,
    underlyingPrice: input.underlyingPrice.state === 'AVAILABLE' ? input.underlyingPrice.value : null,
    shortStrike: input.shortStrike,
    expectedMove: input.expectedMove.state === 'AVAILABLE' ? input.expectedMove.value : null,
  });
  const derivedAt = input.capturedAt;
  return {
    ...input,
    schemaVersion: ENTRY_SNAPSHOT_SCHEMA_VERSION,
    entrySnapshotId: `entry-v1:${encodeURIComponent(input.accountId)}:${encodeURIComponent(input.executionId)}`,
    sourceTransactionIds: Array.from(new Set(input.sourceTransactionIds)).sort(),
    analysis: {
      otmBufferPct: facts.otmBufferPct == null ? unavailableEvidence('Underlying entry price is unavailable') : availableEvidence(facts.otmBufferPct, 'entry-context formula', derivedAt),
      expectedMoveClearancePct: facts.expectedMoveClearancePct == null ? unavailableEvidence('Expected-move or underlying entry evidence is unavailable') : availableEvidence(facts.expectedMoveClearancePct, 'entry-context formula', derivedAt),
      expectedMoveState: facts.expectedMoveState,
    },
  };
}
