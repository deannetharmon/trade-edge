// lib/portfolio-data/types.ts
//
// TC-0001 corrective round: relocated verbatim from app/portfolio/page.tsx
// (mechanical move only -- no logic changes; see the Implementation
// Report's relocation audit table). These are the canonical position/
// pending-order/snapshot shapes both app/portfolio/page.tsx and the new
// PortfolioDataProvider (components/portfolio-data/PortfolioDataProvider.tsx)
// use -- a single source of truth, not a duplicate of anything.

import type { PositionHealthScore, PortfolioObjective, PortfolioRecommendation, PortfolioPricingDecisionEvidence } from '@/lib/portfolio-intelligence';
import type { PositionValuation } from '@/lib/positionValuation';
import type { CanonicalCloseIdentity } from '@/lib/portfolio/closeOrderSafety';
import type { StopLossPolicy, StopClassification, StopBreachState, QuoteWidthEvidence } from '@/lib/portfolio/stopLossPolicy';

// ── Types ──────────────────────────────────────────────────────────────────
export type ActionType = 'HOLD' | 'WATCH' | 'MANAGE' | 'TAKE_PROFIT' | 'CUT_LOSSES' | 'CLOSE_ROLL' | 'PLACE_GTC';


export interface PositionLeg {
  symbol: string;
  optionType: 'P' | 'C';
  strikePrice: number;
  direction: 'Short' | 'Long';
  quantity: number;
  avgOpenPrice: number;
  currentPrice: number | null;
}


// Trader's reference point for AI analysis. Auto-defaulted from strategy
// (lone short put -> acquisition, everything else -> income) and overridable
// per position; persisted in Redis via /api/position-intent.
export type PositionIntent = 'income' | 'acquisition' | 'neutral';


export interface Position {
  key: string;
  symbol: string;
  expDate: string;
  dte: number;
  strategy: string;
  legs: PositionLeg[];
  // ES-0001 (corrective round): the canonical quantity for this position,
  // mirrored from `identity.quantity` when the structure is unambiguous.
  // Retained for backward-compatible display only -- DO NOT use this field
  // (or re-derive quantity from `legs.find(...)`/`legs[0]`) for any live
  // close/roll/stop-loss/GTC/P&L computation. Use `identity` instead, which
  // is null whenever `structureAmbiguous` is true.
  quantity: number;
  // ES-0001 (corrective round): the canonical close-order identity, built by
  // lib/portfolio/closeOrderSafety's analyzePositionStructure +
  // buildCanonicalCloseIdentity. Null whenever the raw broker legs could not
  // be partitioned into exactly one defensible position structure (or entry
  // economics could not be attributed) -- see `structureAmbiguous` /
  // `structureBlockMessage`. Every close/roll/stop-loss/take-profit/cut-
  // losses/snap-to-breakeven action MUST check this is non-null before
  // proceeding; it is the single source `runCloseOrderSafetyGate` consumes.
  identity: CanonicalCloseIdentity | null;
  // True when this position's raw legs could not be resolved to one
  // defensible structure (multiple valid pairings) or its entry economics
  // could not be attributed. The card still renders (legs, symbol, strategy
  // guess) for visibility, but every action button for this position must
  // be disabled -- per Product Owner ruling, disclosure is not a substitute
  // for a hard block.
  structureAmbiguous: boolean;
  structureBlockMessage: string | null;
  // PM-0001 corrective round: `creditReceived` below floors a net debit to
  // $0.00 for backward-compatible display (calculateSpreadCredit) -- that
  // $0.00 must never be read as a genuine zero-credit entry.
  // `entryPriceEffect` is the explicit, honest tag: 'Credit' for a real
  // net-credit structure, 'Debit' for a detected net-debit structure (this
  // ticket does not add debit-strategy support -- POP/targetPrice/hitTarget
  // are all forced unavailable/inert for these, see loadPositions'
  // isNetDebit guard), 'Unknown' only if the signed premium couldn't be
  // computed at all. The ES-0001 canonical `identity` (signed entry
  // economics) is unaffected by this field -- it remains the sole source
  // for close/roll actions.
  entryPriceEffect: 'Credit' | 'Debit' | 'Unknown';
  creditReceived: number;
  currentValue: number | null;
  closeValue: number | null;    // marketable "if I closed now" buyback (ask for short leg, bid for long leg)
  closeNowPnl: number | null;   // credit - closeValue — matches the close/cut-losses modal exactly
  pnl: number | null;
  pnlPct: number | null;
  pnlReliable: boolean;
  intent: PositionIntent;
  plOpen: number | null;
  targetPrice: number;
  profitTarget: number;
  maxRisk: number;
  hitTarget: boolean;
  needsClose: boolean;
  entryDte: number;
  entryDate: string | null;  // date position was opened (YYYY-MM-DD)
  // Entry snapshot fields are captured the first time TradeEdge sees the open position.
  // For positions opened before this feature existed, the first snapshot will be 'first tracked', not true trade entry.
  entrySnapshotKey?: string | null;
  entrySnapshotCreatedAt?: string | null;
  snapshotHistory?: PositionSnapshot[]; // daily snapshots for this position (for net-edge peak/trend)
  ivAtEntry?: number | null;
  ivrAtEntry?: number | null;
  popAtEntry?: number | null;
  deltaAtEntry?: number | null;
  thetaAtEntry?: number | null;
  gammaAtEntry?: number | null;
  vegaAtEntry?: number | null;
  stockPriceAtEntry?: number | null;
  otmAtEntry?: number | null;
  dteAtEntry?: number | null;
  accountNumber: string;
  // Greeks
  ivr: number | null;
  iv: number | null;          // current implied volatility %
  hv30: number | null;        // 30-day historical volatility %
  beta: number | null;        // beta to SPY
  netDelta: number | null;    // net position delta
  netVega: number | null;     // net position vega
  pop: number | null;         // current probability of profit (breakeven-based), % 0-100
  hasGtc: boolean;
  gtcOrderId: string | null;       // ID of the working profit-target GTC order
  gtcOrderPrice: number | null;    // current limit price on that GTC order
  // Legacy display bucket, retained for backward compatibility with
  // existing consumers (e.g. lib/portfolio-intelligence/health/score.ts).
  // Derived FROM stopLossClassification -- see classifyPositionStopLoss's
  // doc comment for the mapping. Do not add new logic against this field;
  // use stopLossClassification/stopLossPolicy instead.
  stopLossStatus: StopStatus;
  stopLossPrice: number | null;
  // TE-0002: canonical stop-loss model. `stopLossPolicy` is the recorded
  // provenance for the CURRENTLY WORKING broker order when TradeEdge
  // created/replaced it and the record still matches that order's id; null
  // when no stop exists, or when the working order carries no matching
  // TradeEdge-recorded policy (basis is then UNKNOWN -- never fabricated).
  // `stopLossClassification` is the full 6-state classification (see
  // lib/portfolio/stopLossPolicy.ts). `stopLossBreach` is the confirmation-
  // aware breach evaluation used by getRecommendation() -- never a raw
  // mid-OR-marketable check.
  //
  // TE-0002 corrective round 3: this field is an ENFORCEMENT-TRUST
  // boundary, not just a display convenience -- it is non-null ONLY when
  // stopLossClassification is 'ALIGNED' or 'TOO_LOOSE' (a live broker order
  // whose identity AND recorded price both match a TradeEdge-created
  // policy). For every other classification (NO_STOP, TOO_TIGHT,
  // UNKNOWN_PROVENANCE, INVALID) this field is `null`, full stop --
  // regardless of whether a raw broker trigger price exists. This is what
  // lets getRecommendation() pass `stopLossPolicy` straight into
  // evaluateStopBreach() as the authoritative enforcement threshold without
  // re-checking classification itself: an unmatched/untrusted broker order
  // can never reach evaluateStopBreach() through this field, so it can never
  // produce CONFIRMED_BREACH / CUT_LOSSES from a threshold TradeEdge didn't
  // set and hasn't verified. Production incident: a TOO_TIGHT, UNKNOWN
  // -provenance broker stop (never created by TradeEdge, priced well inside
  // the documented 2x-credit default) was previously stored here via
  // buildUnknownProvenancePolicy() "for display," which silently promoted it
  // into evaluateStopBreach()'s authoritative threshold and produced a false
  // CUT_LOSSES. See stopLossDisplayPolicy for the display-only equivalent,
  // and lib/portfolio/stopLossPolicy.ts's module doc for the full writeup.
  stopLossPolicy: StopLossPolicy | null;
  // TE-0002 corrective round 3: DISPLAY-ONLY. Always resolves to SOME
  // StopLossPolicy object whenever a working stop order exists (so the UI
  // never has to re-derive a basis from price/credit itself) -- for an
  // unmatched/untrusted order this is an explicit UNKNOWN-basis policy built
  // by buildUnknownProvenancePolicy(), never a fabricated basis. This field
  // must NEVER be passed to evaluateStopBreach() as an authoritative
  // enforcement policy; getRecommendation() only ever uses it to build a
  // capped, non-authoritative "verify stop" advisory (which can produce
  // MANAGE but never CONFIRMED_BREACH/CUT_LOSSES) for TOO_TIGHT/
  // UNKNOWN_PROVENANCE positions. Equal to stopLossPolicy whenever
  // stopLossPolicy is non-null.
  stopLossDisplayPolicy: StopLossPolicy | null;
  stopLossClassification: StopClassification;
  // Raw broker status string for the currently-matched stop order (e.g.
  // 'Live', 'Filled') -- feeds mapBrokerStopStatus() so getRecommendation()
  // can treat a broker-confirmed trigger/fill as authoritative. Null when
  // there is no working stop order.
  stopLossOrderStatus: string | null;
  // TE-0002 corrective round 2: explicit per-leg/net bid-ask width evidence,
  // computed once during loadPositions from real two-sided leg markets
  // (never a mark/fallback price -- same "never fabricate" convention
  // closeValue already follows). Feeds derivePositionQuoteQuality(), which
  // replaces the old `pnlReliable && closeValue != null` heuristic that
  // couldn't distinguish a narrow market from a genuinely wide one. Null
  // when width couldn't be computed at all (e.g. no market data fetch
  // occurred).
  quoteWidthEvidence: QuoteWidthEvidence | null;
  // PI-0014C: genuine broker quote time only. Null when the market-data
  // payload supplies no trustworthy timestamp; page-load time is never used
  // as a substitute.
  quoteCapturedAt?: string | null;
  // Not persisted/stored -- always recomputed fresh from current
  // currentValue/closeValue/snapshotHistory by getRecommendation() (and
  // available to callers directly via lib/portfolio/stopLossPolicy's
  // evaluateStopBreach + lib/portfolio-data/acquisition's
  // buildStopBreachObservations). Optional here purely so intermediate
  // Position construction in loadPositions() doesn't need to fabricate a
  // value before snapshot history is attached.
  stopLossBreachState?: StopBreachState;
  stockPrice: number | null;
  buffer: number | null;
  // PM-0001: side-specific OTM cushion evidence, independent of broker
  // leg-array ordering (see lib/portfolio/positionMetrics.ts's
  // computeSideBuffers). `buffer` above remains the canonical collapsed
  // value (put-only -> put side; call-only -> call side; iron condor ->
  // MINIMUM of both sides, so a breach on either side is reflected). These
  // two fields are retained even when `buffer` is what the card displays,
  // so explanation UI and tests can reference either side independently.
  // Null when the applicable short strike or stock price is unavailable.
  putBufferPct: number | null;
  callBufferPct: number | null;
  theta: number | null;
  gamma: number | null;
  earningsDate: string | null; // next earnings only if on/before option expiration
  healthScore?: PositionHealthScore;
  // PI-0014: purely observational mid vs. marketable valuation evidence
  // (slippage cost, liquidity tier). Null when currentValue or closeValue is
  // unavailable (same "never fabricate absent data" convention those two
  // fields already follow) -- see lib/positionValuation and
  // docs/design/PI-0014-Marketable-Pricing-Risk-Gating.md.
  valuation?: PositionValuation | null;
  // PI-0014 follow-up (Product Owner review): whether marketable evidence
  // actually changed this position's recommendation, decided by
  // evaluatePositionObjective() (a decision-engine property -- see that
  // function's PositionObjectiveResult doc, and lib/positionValuation's
  // types.ts doc for why this deliberately does NOT live on `valuation`).
  liquidityTrapTriggered?: boolean;
  pricingDecisionEvidence?: PortfolioPricingDecisionEvidence;
  recommendation?: PortfolioRecommendation;
  // PI-0002: canonical objective, computed alongside `recommendation` from
  // the same evaluatePositionObjective() call. Not rendered anywhere yet
  // (no UI change in this slice) -- wired through so a future slice can
  // consume it without another data-plumbing pass. Null when the position
  // needs no action (the old system's "hold" case).
  portfolioObjective?: PortfolioObjective | null;
}


// ── Pending Orders ───────────────────────────────────────────────────────
// An unfilled OTOCO entry/opening order -- the trigger leg of a complex
// order that hasn't filled yet, so it has no corresponding Position. These
// come from the same /complex-orders fetch loadPositions already does for
// gtcSymbols, filtered down to legs with Sell to Open / Buy to Open actions
// (as opposed to Buy to Close / Sell to Close, which mark GTC/stop orders
// protecting an already-open position -- those are tracked separately via
// Position.hasGtc / gtcOrderId / stopLossStatus, not here).
export interface PendingOrderLeg {
  symbol: string;       // OCC option symbol, space-padded as TastyTrade returns it
  action: string;       // 'Sell to Open' | 'Buy to Open' | etc.
  optionType: 'P' | 'C' | null;
  strikePrice: number;
  quantity: number;     // needed to rebuild the order body on Replace
}


export interface PendingOrder {
  id: string;                 // complex-order id -- pending orders are always complex-order-sourced
  accountNumber: string;
  symbol: string;              // underlying symbol
  strategy: string;             // inferred from legs: BPS / BCS / IC / UNKNOWN
  legs: PendingOrderLeg[];
  expDate: string | null;       // expiration date of the option legs, if parseable
  limitPrice: number | null;    // trigger order's limit price
  priceEffect: string | null;   // 'Credit' | 'Debit'
  status: string;               // raw status string from the trigger/nested order
  createdAt: string | null;
  orderType: string | null;     // 'Limit' etc. — preserved on Replace
  timeInForce: string | null;   // 'GTC' | 'Day' — preserved on Replace
}


// ── Position Snapshots ───────────────────────────────────────────────────
// Daily snapshot of a position's live state, captured client-side whenever
// the Portfolio page loads (TastyTrade can't be called server-side, so this
// can only run while the browser is open — see project notes). Kept
// permanently once captured; only the "Clear Snapshot History" button
// removes them. This is what lets a future 21-vs-30-DTE exit comparison use
// real recorded values instead of a modeled estimate.
export interface PositionSnapshot {
  date: string;          // YYYY-MM-DD, the day this snapshot was taken
  dte: number;
  currentValue: number | null;
  // TE-0002: marketable "if I closed now" buyback value, same convention as
  // Position.closeValue. Optional/absent on snapshots captured before this
  // field existed -- treated as "no marketable observation" (never
  // backfilled/fabricated), which is exactly what evaluateStopBreach's
  // observation model already expects for missing marketableValue.
  closeValue?: number | null;
  // TE-0002 corrective round 2: full ISO 8601 capture timestamp. Optional/
  // absent on snapshots captured before this field existed, or if a caller
  // only ever recorded the date. buildStopBreachObservations() treats its
  // absence as `preciseTimestamp: false` -- a date-only historical entry
  // remains valid CONTEXTUAL evidence but can never by itself satisfy an
  // intraday stop-confirmation streak (see stopLossPolicy.ts's
  // BreachObservation doc comment).
  capturedAt?: string | null;
  pnl: number | null;
  pnlPct: number | null;
  iv: number | null;
  ivr: number | null;
  theta: number | null;
  gamma: number | null;
  netDelta: number | null;
  netVega: number | null;
  pop: number | null;
  buffer: number | null;
  stockPrice: number | null;
}


export type StopStatus = 'live' | 'loose' | 'none' | 'unknown';


export interface GtcOrderLeg { symbol: string; action: string; }


export interface GtcOrder {
  id: string; price: string; stopPrice: string | null;
  orderType: string; timeInForce: string; legs: GtcOrderLeg[];
  complexOrderId?: string; // set when this order is part of a complex/OCO order
  // TE-0002: raw broker status string (e.g. 'Live', 'Filled', 'Cancelled'),
  // used to detect an authoritative broker-confirmed stop trigger/fill --
  // see lib/portfolio/stopLossPolicy.ts's BrokerStopStatus. Null when the
  // raw order payload didn't carry a status field.
  status?: string | null;
}


export interface StopLossInfo {
  status: StopStatus;
  price: number | null;
  // TE-0002 additions -- see the Position interface's doc comment.
  // TE-0002 corrective round 3: `policy` is now the ENFORCEMENT-TRUST-gated
  // field (non-null only for ALIGNED/TOO_LOOSE); `displayPolicy` is the
  // always-resolved display-only counterpart. See Position.stopLossPolicy /
  // Position.stopLossDisplayPolicy's doc comments for the full contract.
  policy: StopLossPolicy | null;
  displayPolicy: StopLossPolicy | null;
  classification: StopClassification;
  orderId: string | null;
  orderStatus: string | null;
}


export interface PriceSupportAnalysis {
  verdict: 'GOOD' | 'CAUTION' | 'BAD' | 'UNKNOWN';
  score: number;
  lookbackDays: number;
  price: number | null;
  shortStrike: number | null;
  nearestSupport: number | null;
  supportZoneLow: number | null;
  supportZoneHigh: number | null;
  low20: number | null;
  low50: number | null;
  swingLow: number | null;
  ma20: number | null;
  ma50: number | null;
  strikeVsSupportPct: number | null;
  priceVsMa20Pct: number | null;
  priceVsMa50Pct: number | null;
  reason: string;
}


export interface TrendResult {
  trend: 'uptrend' | 'downtrend' | 'sideways' | 'unknown';
  strategy: 'BPS' | 'BCS' | 'IC' | 'NO_TRADE';
  confidence: number;
  reason: string;
  supportAnalysis?: PriceSupportAnalysis;
}


// ── Entry Snapshot Tracking ────────────────────────────────────────────────
export interface EntrySnapshot {
  key: string;
  createdAt: string;
  symbol: string;
  strategy: string;
  expDate: string;
  entryDate: string | null;
  ivAtEntry: number | null;
  ivrAtEntry: number | null;
  popAtEntry: number | null;
  deltaAtEntry: number | null;
  thetaAtEntry: number | null;
  gammaAtEntry: number | null;
  vegaAtEntry: number | null;
  stockPriceAtEntry: number | null;
  otmAtEntry: number | null;
  dteAtEntry: number | null;
}


// ── Recommendation Engine ──────────────────────────────────────────────────
export interface Recommendation { action: ActionType; detail: string; }
