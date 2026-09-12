import {
  createCreditSpreadEntrySnapshot,
  createIronCondorEntrySnapshot,
  unavailableEvidence,
  type CreditSpreadEntrySnapshot,
  type IronCondorEntrySnapshot,
  type Evidence,
} from './types';

export interface ConfirmedOpeningExecution {
  accountId: string;
  transactionId: string;
  /** All confirmed ledger fills that make up this captured opening execution. */
  sourceTransactionIds?: string[];
  executedAt: string;
  symbol: string;
  strategy: 'BPS' | 'BCS';
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
  tradeGroupId?: string | null;
}

/**
 * Builds a snapshot only after a broker transaction confirms an opening fill.
 * An order id is deliberately not accepted here: acknowledgement is not fill
 * evidence and must never create a historical entry record.
 */
export function captureConfirmedCreditSpreadEntry(
  execution: ConfirmedOpeningExecution,
  policyVersion = 'entry-context-v1',
): CreditSpreadEntrySnapshot {
  if (!execution.transactionId || !execution.executedAt) {
    throw new Error('Confirmed broker transaction identity and execution time are required');
  }
  return createCreditSpreadEntrySnapshot({
    accountId: execution.accountId,
    executionId: execution.transactionId,
    sourceTransactionIds: execution.sourceTransactionIds ?? [execution.transactionId],
    tradeGroupId: execution.tradeGroupId ?? null,
    capturedAt: execution.executedAt,
    policyVersion,
    strategy: execution.strategy,
    symbol: execution.symbol,
    expiration: execution.expiration,
    shortStrike: execution.shortStrike,
    longStrike: execution.longStrike,
    quantity: execution.quantity,
    fillPrice: execution.fillPrice,
    underlyingPrice: execution.underlyingPrice,
    shortDelta: execution.shortDelta,
    shortLegIv: execution.shortLegIv,
    ivr: execution.ivr,
    underlyingIv: execution.underlyingIv,
    expectedMove: execution.expectedMove,
    earningsDate: execution.earningsDate,
    quoteBid: execution.quoteBid,
    quoteAsk: execution.quoteAsk,
    quoteMid: execution.quoteMid,
    scoreMomentum: execution.scoreMomentum,
    scoreIvr: execution.scoreIvr,
    scoreEmClearance: execution.scoreEmClearance,
    scoreRange: execution.scoreRange,
    scoreTechnical: execution.scoreTechnical,
    scoreLiquidity: execution.scoreLiquidity,
    scoreBuffer: execution.scoreBuffer,
    scoreStrategyAlignment: execution.scoreStrategyAlignment,
    scoreDeltaQuality: execution.scoreDeltaQuality,
    scoreComposite: execution.scoreComposite,
    profitTarget: execution.profitTarget,
    stopLoss: execution.stopLoss,
    ivTrend: unavailableEvidence('Historical IV series is not configured'),
    realizedVolatility: unavailableEvidence('Historical price series is not configured'),
    return5d: unavailableEvidence('Historical price series is not configured'),
    return20d: unavailableEvidence('Historical price series is not configured'),
  });
}


// TRADE-ENTRY-SNAPSHOT-0001 -- Iron Condor's own confirmed-execution shape,
// parallel to ConfirmedOpeningExecution, matching Ian's separate-type
// decision.
export interface ConfirmedOpeningIronCondorExecution {
  accountId: string;
  transactionId: string;
  sourceTransactionIds?: string[];
  executedAt: string;
  symbol: string;
  strategy: 'IC';
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
  tradeGroupId?: string | null;
}

export function captureConfirmedIronCondorEntry(
  execution: ConfirmedOpeningIronCondorExecution,
  policyVersion = 'entry-context-v1',
): IronCondorEntrySnapshot {
  if (!execution.transactionId || !execution.executedAt) {
    throw new Error('Confirmed broker transaction identity and execution time are required');
  }
  return createIronCondorEntrySnapshot({
    accountId: execution.accountId,
    executionId: execution.transactionId,
    sourceTransactionIds: execution.sourceTransactionIds ?? [execution.transactionId],
    tradeGroupId: execution.tradeGroupId ?? null,
    capturedAt: execution.executedAt,
    policyVersion,
    strategy: execution.strategy,
    symbol: execution.symbol,
    expiration: execution.expiration,
    putShortStrike: execution.putShortStrike,
    putLongStrike: execution.putLongStrike,
    callShortStrike: execution.callShortStrike,
    callLongStrike: execution.callLongStrike,
    quantity: execution.quantity,
    fillPrice: execution.fillPrice,
    underlyingPrice: execution.underlyingPrice,
    putShortDelta: execution.putShortDelta,
    callShortDelta: execution.callShortDelta,
    putShortLegIv: execution.putShortLegIv,
    callShortLegIv: execution.callShortLegIv,
    ivr: execution.ivr,
    underlyingIv: execution.underlyingIv,
    expectedMove: execution.expectedMove,
    earningsDate: execution.earningsDate,
    putQuoteBid: execution.putQuoteBid,
    putQuoteAsk: execution.putQuoteAsk,
    callQuoteBid: execution.callQuoteBid,
    callQuoteAsk: execution.callQuoteAsk,
    scoreMomentum: execution.scoreMomentum,
    scoreIvr: execution.scoreIvr,
    scoreEmClearance: execution.scoreEmClearance,
    scoreRange: execution.scoreRange,
    scoreTechnical: execution.scoreTechnical,
    scoreLiquidity: execution.scoreLiquidity,
    scoreBuffer: execution.scoreBuffer,
    scoreStrategyAlignment: execution.scoreStrategyAlignment,
    scoreDeltaQuality: execution.scoreDeltaQuality,
    scoreComposite: execution.scoreComposite,
    profitTarget: execution.profitTarget,
    stopLoss: execution.stopLoss,
    ivTrend: unavailableEvidence('Historical IV series is not configured'),
    realizedVolatility: unavailableEvidence('Historical price series is not configured'),
    return5d: unavailableEvidence('Historical price series is not configured'),
    return20d: unavailableEvidence('Historical price series is not configured'),
  });
}
