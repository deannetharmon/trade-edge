// lib/paper-trading/types.ts
//
// PT-0001: Manual Paper Trading Sandbox — canonical domain types.
//
// Scope reminder (see docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md):
// this is a MANUAL paper-trading domain. Every open/close is an intentional,
// user-confirmed action. Nothing here ever calls a live-order function, and
// nothing here is reachable from the broker order-submission module or its
// order builders — that boundary is enforced and tested (see
// __tests__/liveIsolation.test.ts).
//
// Persistence note: PT-0001 extends the existing canonical account record
// (lib/autopilot/persistence/paperAccountStore.ts, keyed by
// `autopilot:paper-account:<userId>`) rather than creating a second paper
// account per user. It does this by adding one new, fully optional field
// (`paperTrading`) to lib/autopilot/types.ts's `PaperAccount` interface.
// Every existing field on that interface (currentBalance, peakBalance,
// openPositions, closedPositions, dailyEquityCurve, ...) is untouched and
// keeps meaning exactly what it meant before PT-0001 — those fields belong
// to the separate, still-dormant Autopilot Decision Engine paper framework
// (Sprint 1B/2) and are read by lib/autopilot/decision/*. PT-0001 reads and
// writes only the new `paperTrading` sub-object. A legacy account with no
// `paperTrading` field (i.e. every account that exists today, since the
// Autopilot framework has never actually opened a paper position) is treated
// as "PT-0001 not yet initialized for this user" and lazily given a default
// ledger — no existing data is deleted or overwritten.

export type PaperStrategy = 'CSP' | 'BPS' | 'BCS' | 'IC';

export type PaperOptionType = 'put' | 'call';

// The action the user took when the leg was OPENED. The closing action is
// always the structural opposite (buy_to_open -> sell_to_close later;
// sell_to_open -> buy_to_close later) and is never independently stored —
// see resolveClosingAction() in pricing.ts.
export type PaperLegOpenAction = 'buy_to_open' | 'sell_to_open';
export type PaperLegDirection = 'long' | 'short';
export type PaperLegCloseAction = 'buy_to_close' | 'sell_to_close';

export interface PaperLeg {
  /** Stable within a position: `${optionType}-${strike}-${openAction}`. */
  legId: string;
  optionType: PaperOptionType;
  strike: number;
  expiration: string; // ISO date (YYYY-MM-DD)
  openAction: PaperLegOpenAction;
}

// ---------------------------------------------------------------------------
// Quote evidence (section 7.1)
// ---------------------------------------------------------------------------

export type PaperQuoteSource = 'manual' | 'browser-quote';

export interface PaperLegQuote {
  legId: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  /** ISO timestamp of when this leg's bid/ask/mid were actually observed. */
  quoteTimestamp: string | null;
}

export interface PaperQuoteSnapshot {
  legs: PaperLegQuote[];
  underlyingPrice?: number | null;
  source: PaperQuoteSource;
}

// ---------------------------------------------------------------------------
// Manual fill override (section 7.5)
// ---------------------------------------------------------------------------

export interface PaperManualFillOverride {
  /** Total net price for the whole position (per-contract, same convention as simulatedFillTotal). */
  manualPrice: number;
  reason: string;
  confirmedAt: string;
  confirmedByUser: string;
}

// ---------------------------------------------------------------------------
// Fill evidence attached to an entry or a close
// ---------------------------------------------------------------------------

export type PaperFillPricingSource = 'marketable' | 'stale_confirmed' | 'manual_paper_fill';

export interface PaperFillEvidence {
  pricingSource: PaperFillPricingSource;
  /** Net mid value for the whole position at the time of this fill, dollars (per contract-multiplier-adjusted total), always recorded when derivable. */
  midValue: number | null;
  /** Net marketable (bid/ask-direction) value actually used for the simulated fill, dollars total. Never present when pricingSource is 'manual_paper_fill'. */
  marketableValue: number | null;
  /** The value actually applied to the ledger for this fill, dollars total. */
  simulatedFillValue: number;
  slippage: number | null; // |mid - marketable|, null when mid or marketable unavailable
  quoteAgeSeconds: number | null;
  staleQuoteConfirmed: boolean;
  manualOverride: PaperManualFillOverride | null;
  quoteSnapshot: PaperQuoteSnapshot | null;
  evaluatedAt: string;
}

// ---------------------------------------------------------------------------
// Position (section 6.2)
// ---------------------------------------------------------------------------

export type PaperPositionStatus = 'open' | 'closed';

export interface PaperTradingPosition {
  positionId: string;
  idempotencyKey: string;
  userId: string;
  symbol: string;
  strategy: PaperStrategy;
  legs: PaperLeg[];
  expiration: string; // ISO date, shared across all legs
  /** Number of spread/CSP/IC units. Every leg's actual contract count is quantity * contractMultiplier / 100 spreads -- i.e. quantity IS the contract count per leg. */
  quantity: number;
  contractMultiplier: number; // always 100 for supported strategies

  entryTimestamp: string;
  entryFill: PaperFillEvidence;
  /** Net credit received at entry, dollars, positive. */
  entryCredit: number;
  /** Capital reserved against this position for as long as it is open. */
  capitalReserved: number;
  theoreticalMaxLoss: number;
  entryRationale: string | null;

  status: PaperPositionStatus;

  // Current mark (set by an explicit mark-refresh action, never by open/close
  // mutations). Absent until the user has refreshed a mark at least once.
  currentMark: PaperFillEvidence | null;
  unrealizedPnl: number | null;

  closeTimestamp: string | null;
  closeFill: PaperFillEvidence | null;
  realizedPnl: number | null;

  auditRefs: string[];
}

// ---------------------------------------------------------------------------
// Account ledger (section 6.1)
// ---------------------------------------------------------------------------

export interface PaperEquityPoint {
  timestamp: string;
  equity: number;
}

export interface PaperTradingLedger {
  schemaVersion: 1;
  userId: string;
  startingBalance: number;
  cash: number;
  reservedCapital: number;
  peakEquity: number;
  openPositions: PaperTradingPosition[];
  closedPositions: PaperTradingPosition[];
  equityHistory: PaperEquityPoint[];
  createdAt: string;
  updatedAt: string;
}

// Derived, never independently persisted — see ledger.ts's deriveLedgerView().
export interface PaperTradingLedgerView {
  ledger: PaperTradingLedger;
  availableCapital: number;
  currentEquity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  openRisk: number;
}

// ---------------------------------------------------------------------------
// Audit (section 9.3)
// ---------------------------------------------------------------------------

export type PaperAuditEventType =
  | 'account_initialized'
  | 'account_reset'
  | 'entry_accepted'
  | 'entry_rejected'
  | 'entry_duplicate_replayed'
  | 'close_accepted'
  | 'close_rejected'
  | 'close_duplicate_replayed'
  | 'stale_quote_confirmed'
  | 'manual_fill_override_confirmed';

export interface PaperAuditEvent {
  id: string;
  userId: string;
  eventType: PaperAuditEventType;
  operation: 'open' | 'close' | 'reset';
  positionId?: string;
  timestamp: string;
  idempotencyKey: string;
  pricingSource?: PaperFillPricingSource;
  quoteAgeSeconds?: number | null;
  capitalBefore?: number;
  capitalAfter?: number;
  cashBefore?: number;
  cashAfter?: number;
  ruleIds: string[];
  failureReason?: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type PaperTradingErrorCode =
  | 'VALIDATION_ERROR'
  | 'INSUFFICIENT_CAPITAL'
  | 'INVALID_QUOTE'
  | 'STALE_QUOTE_CONFIRMATION_REQUIRED'
  | 'MANUAL_OVERRIDE_CONFIRMATION_REQUIRED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'POSITION_NOT_FOUND'
  | 'POSITION_ALREADY_CLOSED'
  | 'UNAUTHORIZED';

export class PaperTradingError extends Error {
  code: PaperTradingErrorCode;
  details?: Record<string, unknown>;

  constructor(code: PaperTradingErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PaperTradingError';
    this.code = code;
    this.details = details;
  }
}
