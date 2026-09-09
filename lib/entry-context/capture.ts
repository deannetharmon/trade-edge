import {
  createCreditSpreadEntrySnapshot,
  unavailableEvidence,
  type CreditSpreadEntrySnapshot,
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
    ivTrend: unavailableEvidence('Historical IV series is not configured'),
    realizedVolatility: unavailableEvidence('Historical price series is not configured'),
    return5d: unavailableEvidence('Historical price series is not configured'),
    return20d: unavailableEvidence('Historical price series is not configured'),
  });
}
