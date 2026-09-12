import { buildCreditSpreadEntryFacts, buildIronCondorEntryFacts } from './analysis';

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

  // TRADE-ENTRY-SNAPSHOT-0001 -- the scoring engine's own breakdown at
  // entry, for outcome correlation and Sam's redundancy analysis. Not
  // recomputed later; this is what the engine said at the moment of entry.
  scoreMomentum: Evidence<number>;
  scoreIvr: Evidence<number>;
  scoreEmClearance: Evidence<number>;
  scoreRange: Evidence<number>;
  scoreTechnical: Evidence<number>;
  scoreLiquidity: Evidence<number>;
  scoreBuffer: Evidence<number>;
  scoreStrategyAlignment: Evidence<number>;
  scoreDeltaQuality: Evidence<number>;
  scoreComposite: Evidence<number>;

  // TRADE-ENTRY-SNAPSHOT-0001 -- Ian's plan-vs-actual fields. The plan as
  // it stood at entry; whether the eventual exit matched it is computed
  // separately at reconciliation, against ClosedTrade, not stored here.
  profitTarget: Evidence<number>;
  stopLoss: Evidence<number>;
}

export type CreditSpreadEntrySnapshotInput = Omit<CreditSpreadEntrySnapshot, 'schemaVersion' | 'entrySnapshotId' | 'analysis'>;

// v1 schema predates the score/plan fields above -- existing captured
// snapshots and any in-flight pending entries won't have them yet.
// Treating that as an honest UNAVAILABLE, not a validation failure, so
// this extension doesn't break anything already in flight.
export const SCORE_AND_PLAN_FIELD_NAMES = [
  'scoreMomentum', 'scoreIvr', 'scoreEmClearance', 'scoreRange', 'scoreTechnical',
  'scoreLiquidity', 'scoreBuffer', 'scoreStrategyAlignment', 'scoreDeltaQuality',
  'scoreComposite', 'profitTarget', 'stopLoss',
] as const;

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
    [input.scoreMomentum, 'scoreMomentum'], [input.scoreIvr, 'scoreIvr'], [input.scoreEmClearance, 'scoreEmClearance'],
    [input.scoreRange, 'scoreRange'], [input.scoreTechnical, 'scoreTechnical'], [input.scoreLiquidity, 'scoreLiquidity'],
    [input.scoreBuffer, 'scoreBuffer'], [input.scoreStrategyAlignment, 'scoreStrategyAlignment'],
    [input.scoreDeltaQuality, 'scoreDeltaQuality'], [input.scoreComposite, 'scoreComposite'],
    [input.profitTarget, 'profitTarget'], [input.stopLoss, 'stopLoss'],
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

// TRADE-ENTRY-SNAPSHOT-0001 -- Iron Condor's own snapshot type, parallel
// to CreditSpreadEntrySnapshot rather than an extension of it (Ian's
// call): a BPS/BCS record with four always-empty IC-only fields is the
// same "missing vs. doesn't apply" confusion this file's own Evidence<T>
// convention exists to avoid. Same schema/id/transaction-id/score/plan
// conventions, own strike shape.
export interface IronCondorEntrySnapshot {
  schemaVersion: typeof ENTRY_SNAPSHOT_SCHEMA_VERSION;
  entrySnapshotId: string;
  accountId: string;
  executionId: string;
  sourceTransactionIds: string[];
  tradeGroupId: string | null;
  capturedAt: string;
  policyVersion: string;
  strategy: 'IC';
  symbol: string;
  expiration: string;
  putShortStrike: number;
  putLongStrike: number;
  callShortStrike: number;
  callLongStrike: number;
  quantity: number;
  fillPrice: Evidence<number>;
  underlyingPrice: Evidence<number>;
  putShortDelta: Evidence<number>;
  callShortDelta: Evidence<number>;
  putShortLegIv: Evidence<number>;
  callShortLegIv: Evidence<number>;
  ivr: Evidence<number>;
  underlyingIv: Evidence<number>;
  expectedMove: Evidence<number>;
  earningsDate: Evidence<string>;
  putQuoteBid: Evidence<number>;
  putQuoteAsk: Evidence<number>;
  callQuoteBid: Evidence<number>;
  callQuoteAsk: Evidence<number>;
  ivTrend: Evidence<number>;
  realizedVolatility: Evidence<number>;
  return5d: Evidence<number>;
  return20d: Evidence<number>;
  scoreMomentum: Evidence<number>;
  scoreIvr: Evidence<number>;
  scoreEmClearance: Evidence<number>;
  scoreRange: Evidence<number>;
  scoreTechnical: Evidence<number>;
  scoreLiquidity: Evidence<number>;
  scoreBuffer: Evidence<number>;
  scoreStrategyAlignment: Evidence<number>;
  scoreDeltaQuality: Evidence<number>;
  scoreComposite: Evidence<number>;
  profitTarget: Evidence<number>;
  stopLoss: Evidence<number>;
  analysis: {
    otmBufferPct: Evidence<number>;
    expectedMoveClearancePct: Evidence<number>;
    expectedMoveState: 'UNAVAILABLE' | 'INSIDE' | 'OUTSIDE';
  };
}

export type IronCondorEntrySnapshotInput = Omit<IronCondorEntrySnapshot, 'schemaVersion' | 'entrySnapshotId' | 'analysis'>;

export function createIronCondorEntrySnapshot(input: IronCondorEntrySnapshotInput): IronCondorEntrySnapshot {
  if (!input.accountId || !input.executionId) throw new Error('accountId and executionId are required');
  if (!input.sourceTransactionIds.includes(input.executionId)) throw new Error('sourceTransactionIds must include executionId');
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error('quantity must be positive');
  if (!Number.isFinite(input.putShortStrike) || !Number.isFinite(input.putLongStrike)
    || !Number.isFinite(input.callShortStrike) || !Number.isFinite(input.callLongStrike)) {
    throw new Error('all four strikes must be finite');
  }
  const facts = buildIronCondorEntryFacts({
    underlyingPrice: input.underlyingPrice.state === 'AVAILABLE' ? input.underlyingPrice.value : null,
    putShortStrike: input.putShortStrike,
    callShortStrike: input.callShortStrike,
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
