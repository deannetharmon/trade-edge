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
// Manual fill override -- CLIENT input shape (corrective round, fix #4)
// ---------------------------------------------------------------------------
//
// The client may express its own price and reason and the fact that it has
// confirmed the override, but it can NEVER supply an authoritative
// confirmation identity or timestamp -- those are always derived
// server-side from the authenticated request (see
// service.ts's resolveManualOverride()) and stamped into the full
// PaperManualFillOverride above before it reaches pricing.ts or the audit
// trail. API routes accept only this narrower shape from the request body
// and silently ignore any `confirmedByUser`/`confirmedAt` the client sends.
export interface PaperManualFillOverrideInput {
  manualPrice: number;
  reason: string;
  confirmed: boolean;
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
  | 'manual_fill_override_confirmed'
  // Corrective round: explicit mark-refresh audit coverage, added when
  // refreshPaperMark() was moved onto the same atomic, lease-fenced commit
  // path as open/close/reset (persistence/commit.ts always requires a
  // full audit event as part of its commit unit).
  | 'mark_refreshed';

export interface PaperAuditEvent {
  id: string;
  userId: string;
  eventType: PaperAuditEventType;
  operation: 'open' | 'close' | 'reset' | 'mark';
  positionId?: string;
  timestamp: string;
  /** Absent for operations with no caller-supplied idempotency key (mark refresh is not idempotency-guarded — section 9.1/12). */
  idempotencyKey?: string;
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
  | 'UNAUTHORIZED'
  // Corrective round (fix #2/#3): the mutation lock's lease was lost (TTL
  // expired and a different caller acquired it) before this mutation's
  // atomic commit could complete, so the commit was safely aborted instead
  // of applied. Always safe to retry -- nothing was persisted.
  | 'LOCK_LOST'
  // Corrective round (fix #3): the atomic ledger+audit+idempotency commit
  // itself failed (a persistence write reported an error), OR a
  // network/connection failure during commit was confirmed, after
  // re-reading authoritative state, to mean the operation did NOT persist.
  // No partial state was left behind for this operation in either case;
  // safe to retry.
  | 'COMMIT_FAILED'
  // PO Round 2 (item 4): a commit's outcome was ambiguous (the commit
  // script's response was lost) and, on re-reading authoritative state to
  // resolve the ambiguity, the ledger, audit trail, and/or idempotency
  // record DISAGREED about whether it committed. This module's own atomic
  // commit path cannot itself produce that disagreement, so it signals
  // persistence state was altered outside this path. Never assumed to be
  // safe to retry -- requires investigation.
  | 'INTEGRITY_FAILURE'
  // PO Round 5: a commit's outcome was ambiguous (the commit script's
  // response was lost) AND the follow-up attempt to re-read authoritative
  // state (the ledger, the audit trail, or the idempotency record) itself
  // failed -- so whether the operation committed is genuinely UNKNOWN, not
  // confirmed either way. Never safe to assume rejected; never safe to
  // retry under a NEW idempotency key (that could double-apply an operation
  // that actually did commit) -- the caller must retry/reconcile using the
  // SAME idempotency key, which will correctly replay the original result
  // once persistence state becomes reachable again.
  | 'OUTCOME_UNKNOWN';

/**
 * PO Round 5: classifies every error capable of leaving
 * persistence/commit.ts's commitPaperMutation() into exactly one of three
 * outcomes, so callers (service.ts) can decide what audit evidence, if any,
 * is safe to record WITHOUT inferring anything from error message text:
 *
 *   - 'CONFIRMED_NOT_COMMITTED': the script (or a pre-EVAL guard) positively
 *     confirmed nothing was written -- a LOCK_LOST/TYPE_ERROR/INVALID_ARG
 *     script result, an ambiguous outcome that reconciliation successfully
 *     resolved to "did not commit", a pre-EVAL TypeScript-side validation
 *     failure, or a pure build()/domain rejection that never reached EVAL at
 *     all. Safe to record a rejected-audit event and safe to retry.
 *   - 'OUTCOME_UNKNOWN': the EVAL acknowledgement was lost AND the
 *     reconciliation read(s) needed to resolve that ambiguity themselves
 *     failed. Whether the mutation committed cannot be determined right
 *     now. NEVER safe to record a rejected-audit event (the accepted
 *     mutation may already exist) and never safe to retry under a
 *     different idempotency key -- only a reconciliation retry under the
 *     SAME key is safe.
 *   - 'INTEGRITY_FAILURE': reconciliation reads all succeeded, but the
 *     signals they returned disagree with each other -- a state this
 *     module's own atomic commit cannot itself produce. NEVER safe to
 *     record a rejected-audit event, and never safe to auto-retry or
 *     auto-repair; requires investigation.
 */
export type PaperCommitOutcomeClass = 'CONFIRMED_NOT_COMMITTED' | 'OUTCOME_UNKNOWN' | 'INTEGRITY_FAILURE';

export class PaperTradingError extends Error {
  code: PaperTradingErrorCode;
  details?: Record<string, unknown>;
  /**
   * Only meaningful for errors that can leave commitPaperMutation() (see
   * PaperCommitOutcomeClass's doc comment above). Undefined for every other
   * PaperTradingError in this codebase (validation, capital, pricing, ...).
   * service.ts's catch blocks branch on THIS field, never on `message` text,
   * to decide whether recording a rejected-audit event is safe.
   */
  commitOutcome?: PaperCommitOutcomeClass;

  constructor(code: PaperTradingErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PaperTradingError';
    this.code = code;
    this.details = details;
  }
}
