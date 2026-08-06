// lib/portfolio/stopLossPolicy.ts
//
// TE-0002 corrective round: canonical stop-loss model. Replaces the old
// `live | loose` classification (which silently passed a 1.25x-credit stop
// as "live" because it only checked `price <= creditPerContract * 2`) and
// the `midBreached || marketableBreached` hard-exit OR rule in
// getRecommendation() (which let a single noisy snapshot -- midpoint noise
// or a wide-market marketable estimate -- independently fire CUT_LOSSES on
// a freshly-opened position).
//
// Everything in this file is pure and framework-free: no fetch, no
// localStorage, no React. Persistence (lib/portfolio-data/stopPolicyStore.ts)
// and wiring (lib/portfolio-data/acquisition.ts, app/portfolio/page.tsx)
// consume these functions; they do not reimplement this logic.
//
// Design notes:
// - `anchorBasis`/`source` are NEVER inferred from `triggerPrice / credit`
//   at render/classify time for an unrecorded order -- an order with no
//   TradeEdge-recorded StopLossPolicy is `UNKNOWN` basis, full stop. The
//   only thing classification is allowed to do with the raw price in that
//   case is a materiality sanity check (used purely to decide whether to
//   report TOO_TIGHT vs UNKNOWN_PROVENANCE -- never to invent a basis or a
//   "×credit" label).
// - Breach confirmation requires either an authoritative broker order
//   status (filled/triggered) or a sustained streak of observations at/above
//   the threshold, with a small hysteresis band so a brief cross-and-retreat
//   doesn't leave a stale streak. A single observation, or a quote of
//   unreliable/degraded quality, can never alone produce CONFIRMED_BREACH.

export type StopAnchorBasis =
  | 'ORIGINAL_CREDIT'
  | 'CURRENT_SPREAD_VALUE'
  | 'MANUAL_ABSOLUTE'
  | 'UNKNOWN';

export type StopSource =
  | 'DEFAULT'
  | 'AI_SUGGESTION'
  | 'MANUAL'
  | 'BROKER_EXTERNAL'
  | 'UNKNOWN';

export interface StopLossPolicy {
  triggerPrice: number;
  anchorBasis: StopAnchorBasis;
  anchorValue: number | null;
  multiple: number | null;
  source: StopSource;
  createdAt: string | null;
  // The individual broker order id for the stop leg itself -- this is what
  // classification prefers to match against (see matchesStopOrderIdentity).
  brokerOrderId: string | null;
  // TE-0002 corrective round 2: an OCO stop is submitted as one nested order
  // inside a parent complex order. The two ids are NOT interchangeable --
  // TastyTrade's /orders/live + /complex-orders reconstruction (see
  // acquisition.ts's collectRawOrders/mapGtcOrder) identifies the working
  // stop by its OWN order id, never the parent's. `complexOrderId` is
  // recorded as a secondary identity signal ONLY: when the broker response
  // to an OCO submission doesn't clearly echo back the nested stop order's
  // own id, matching falls back to "this order belongs to the same OCO
  // envelope TradeEdge created," which is still a real identity check (a
  // replacement made outside TradeEdge gets an entirely new complex-order
  // id) -- never "accept any id."
  complexOrderId: string | null;
}

// The six states the corrective mandate requires: no stop; working and
// policy-aligned; materially too tight; materially too loose; unknown
// basis/provenance; invalid/unparseable.
export type StopClassification =
  | 'NO_STOP'
  | 'ALIGNED'
  | 'TOO_TIGHT'
  | 'TOO_LOOSE'
  | 'UNKNOWN_PROVENANCE'
  | 'INVALID';

// Deterministic entry default: 2x original credit. This is the ONLY
// silent default allowed for a newly opened defined-risk credit spread --
// the persisted "last stop multiple" (which can be as low as 1.5x, or
// whatever the trader last typed) must never substitute for this without
// an explicit, recorded policy decision.
export const DEFAULT_ENTRY_STOP_MULTIPLE = 2;

// Tolerance bands. EPS absorbs float/rounding noise (cents); the
// materiality band is the "materially too tight/loose" threshold.
const PRICE_EPS = 0.02;
const MATERIALITY_BAND = 0.10; // 10%

export interface StopPolicyIdentityOpts {
  brokerOrderId?: string | null;
  complexOrderId?: string | null;
}

export function buildOriginalCreditDefaultPolicy(
  creditPerContract: number,
  opts: {
    source?: StopSource;
    createdAt?: string | null;
    multiple?: number;
  } & StopPolicyIdentityOpts = {}
): StopLossPolicy {
  const multiple = opts.multiple ?? DEFAULT_ENTRY_STOP_MULTIPLE;
  return {
    triggerPrice: parseFloat((creditPerContract * multiple).toFixed(2)),
    anchorBasis: 'ORIGINAL_CREDIT',
    anchorValue: creditPerContract,
    multiple,
    source: opts.source ?? 'DEFAULT',
    createdAt: opts.createdAt ?? null,
    brokerOrderId: opts.brokerOrderId ?? null,
    complexOrderId: opts.complexOrderId ?? null,
  };
}

export function buildCurrentValueAnchoredPolicy(
  currentValuePerContract: number,
  multiple: number,
  opts: { source?: StopSource; createdAt?: string | null } & StopPolicyIdentityOpts = {}
): StopLossPolicy {
  return {
    triggerPrice: parseFloat((currentValuePerContract * multiple).toFixed(2)),
    anchorBasis: 'CURRENT_SPREAD_VALUE',
    anchorValue: currentValuePerContract,
    multiple,
    source: opts.source ?? 'AI_SUGGESTION',
    createdAt: opts.createdAt ?? null,
    brokerOrderId: opts.brokerOrderId ?? null,
    complexOrderId: opts.complexOrderId ?? null,
  };
}

export function buildManualAbsolutePolicy(
  triggerPrice: number,
  opts: { createdAt?: string | null } & StopPolicyIdentityOpts = {}
): StopLossPolicy {
  return {
    triggerPrice: parseFloat(triggerPrice.toFixed(2)),
    anchorBasis: 'MANUAL_ABSOLUTE',
    anchorValue: null,
    multiple: null,
    source: 'MANUAL',
    createdAt: opts.createdAt ?? null,
    brokerOrderId: opts.brokerOrderId ?? null,
    complexOrderId: opts.complexOrderId ?? null,
  };
}

// An order that exists at the broker but carries no TradeEdge-recorded
// policy (never created by TradeEdge, or the recorded policy's identity no
// longer matches the live order -- e.g. it was replaced outside the app).
// Basis is UNKNOWN; the caller must not invent one.
export function buildUnknownProvenancePolicy(
  triggerPrice: number,
  brokerOrderId: string | null = null,
  complexOrderId: string | null = null
): StopLossPolicy {
  return {
    triggerPrice: parseFloat(triggerPrice.toFixed(2)),
    anchorBasis: 'UNKNOWN',
    anchorValue: null,
    multiple: null,
    source: 'UNKNOWN',
    createdAt: null,
    brokerOrderId,
    complexOrderId,
  };
}

// TE-0002 corrective round 2: centralizes "does this recorded policy belong
// to this live broker order" so acquisition.ts doesn't reimplement identity
// matching inline. Prefers an exact match on the stop leg's OWN order id;
// only falls back to the shared OCO complex-order id when the direct id
// isn't recorded/matched. Both are real identity checks -- neither branch
// accepts an unrelated id. A replacement made outside TradeEdge fails both
// (different order id AND a different/absent complex-order id).
export function matchesStopOrderIdentity(
  policy: Pick<StopLossPolicy, 'brokerOrderId' | 'complexOrderId'>,
  liveOrder: { id: string; complexOrderId?: string | null }
): boolean {
  if (policy.brokerOrderId != null && policy.brokerOrderId === liveOrder.id) return true;
  if (policy.complexOrderId != null && liveOrder.complexOrderId != null && policy.complexOrderId === liveOrder.complexOrderId) {
    return true;
  }
  return false;
}

export interface ClassifyStopInput {
  hasStopOrder: boolean;
  // Raw broker trigger price, independent of any recorded policy -- used
  // as the source of truth for "does this order's price look dangerous"
  // when we have no (or a stale/mismatched) recorded policy.
  orderTriggerPrice: number | null;
  // Recorded provenance for THIS order (already resolved by the caller:
  // null unless the store has an entry whose brokerOrderId matches the
  // live order). Never fabricated here.
  policy: StopLossPolicy | null;
  creditPerContract: number;
}

export function classifyStopLossPolicy(input: ClassifyStopInput): StopClassification {
  const { hasStopOrder, orderTriggerPrice, policy, creditPerContract } = input;

  if (!hasStopOrder) return 'NO_STOP';
  if (orderTriggerPrice == null || !Number.isFinite(orderTriggerPrice) || orderTriggerPrice <= 0) {
    return 'INVALID';
  }

  const reference = creditPerContract * DEFAULT_ENTRY_STOP_MULTIPLE;

  // No usable recorded policy (never created by TradeEdge, or the record
  // doesn't match this live order). We still perform a materiality sanity
  // check against the deterministic entry reference so a dangerously tight
  // externally-created stop is never silently treated as healthy -- but we
  // never claim to know WHY it's set where it is.
  if (!policy || policy.anchorBasis === 'UNKNOWN' || policy.source === 'UNKNOWN') {
    if (!Number.isFinite(reference) || reference <= 0) return 'UNKNOWN_PROVENANCE';
    return orderTriggerPrice < reference * (1 - MATERIALITY_BAND) - PRICE_EPS
      ? 'TOO_TIGHT'
      : 'UNKNOWN_PROVENANCE';
  }

  // We have a recorded, matched policy. First check internal consistency --
  // does the recorded trigger price still match anchorValue * multiple? A
  // mismatch means the record is stale/corrupt, not a legitimate policy.
  if (policy.anchorValue != null && policy.multiple != null) {
    const expected = policy.anchorValue * policy.multiple;
    if (Math.abs(policy.triggerPrice - expected) > Math.max(PRICE_EPS, expected * 0.01)) {
      return 'INVALID';
    }
  }
  if (Math.abs(policy.triggerPrice - orderTriggerPrice) > Math.max(PRICE_EPS, orderTriggerPrice * 0.01)) {
    // Recorded policy no longer matches what's actually working at the
    // broker -- treat as unknown rather than asserting a stale basis.
    return orderTriggerPrice < reference * (1 - MATERIALITY_BAND) - PRICE_EPS
      ? 'TOO_TIGHT'
      : 'UNKNOWN_PROVENANCE';
  }

  if (policy.anchorBasis === 'ORIGINAL_CREDIT') {
    if (!Number.isFinite(reference) || reference <= 0) return 'INVALID';
    const lower = reference * (1 - MATERIALITY_BAND);
    const upper = reference * (1 + MATERIALITY_BAND);
    if (policy.triggerPrice < lower - PRICE_EPS) return 'TOO_TIGHT';
    if (policy.triggerPrice > upper + PRICE_EPS) return 'TOO_LOOSE';
    return 'ALIGNED';
  }

  // CURRENT_SPREAD_VALUE / MANUAL_ABSOLUTE: explicitly-selected alternate
  // bases. Per the corrective mandate, an explicitly recorded, internally
  // consistent policy on one of these bases is not judged against the
  // 2x-original-credit yardstick -- that yardstick is the ENTRY default,
  // not a universal rule.
  return 'ALIGNED';
}

// ── Display ──────────────────────────────────────────────────────────────
// Renders the RECORDED policy. Never derives a "×credit" label by dividing
// price by credit for a policy whose basis is UNKNOWN.
export function describeStopLossPolicy(policy: StopLossPolicy | null): string {
  if (!policy) return 'No stop order';
  switch (policy.anchorBasis) {
    case 'ORIGINAL_CREDIT': {
      const mult = policy.multiple ??
        (policy.anchorValue && policy.anchorValue > 0 ? policy.triggerPrice / policy.anchorValue : null);
      return mult != null ? `${mult.toFixed(1)}× original credit` : 'Original-credit-anchored stop';
    }
    case 'CURRENT_SPREAD_VALUE': {
      const mult = policy.multiple ??
        (policy.anchorValue && policy.anchorValue > 0 ? policy.triggerPrice / policy.anchorValue : null);
      return mult != null ? `${mult.toFixed(1)}× current spread value at creation` : 'Current-value-anchored stop';
    }
    case 'MANUAL_ABSOLUTE':
      return 'Manual absolute stop';
    case 'UNKNOWN':
    default:
      return 'Basis unknown — broker order not created by TradeEdge';
  }
}

// ── Quote-quality evidence ──────────────────────────────────────────────
// TE-0002 corrective round 2: `pnlReliable && closeValue != null` only
// proves quotes EXIST -- it says nothing about whether they're narrow
// enough to trust a marketable print as confirmation evidence. A two-sided
// but $3-5-wide leg market (the reported MU condition) satisfied the old
// check and was treated as RELIABLE, letting a single wide-market
// marketable read count toward breach confirmation. This section adds
// explicit, deterministic spread-width evidence.

export type QuoteQuality = 'RELIABLE' | 'DEGRADED' | 'UNKNOWN';
export type BrokerStopStatus = 'TRIGGERED' | 'WORKING' | 'UNKNOWN';

// Deterministic thresholds. Both must hold for a quote to be treated as
// narrow -- a position can have a tight NET percentage while still resting
// on individual legs with genuinely wide, illiquid markets (or vice versa),
// so neither measure alone is sufficient.
export const QUOTE_WIDTH_THRESHOLDS = {
  // Per-leg bid/ask width, dollars per contract. The reported MU condition
  // ($3-5-wide leg markets) is roughly 6-10x this.
  maxNarrowLegWidthDollars: 0.50,
  // Net combo bid/ask width as a fraction of the position's own mid value.
  maxNarrowNetWidthPctOfMid: 0.15,
} as const;

export interface QuoteWidthEvidence {
  // Per-leg bid/ask widths in dollars/contract (ask - bid). `null` for a
  // leg with no real two-sided market (see acquisition.ts's
  // oneSidedSymbols) -- never fabricated from a mark/fallback price.
  legWidthsDollars: readonly (number | null)[];
  // Net combo width in dollars at position scale (matches
  // Position.currentValue/closeValue's convention: sum of leg widths *
  // quantity * 100). Null when ANY leg lacks a real two-sided market --
  // a partial combo width is not meaningful evidence.
  netWidthDollars: number | null;
  // netWidthDollars as a fraction of the position's own mid value
  // (Position.currentValue). Null when netWidthDollars or the mid value is
  // unavailable/non-positive.
  netWidthPctOfMid: number | null;
  // True when any leg's ask < bid -- a crossed/stale/invalid market. Quote
  // quality can never be RELIABLE when this is true, regardless of width.
  crossed: boolean;
}

// Pure classification from the raw width evidence -- deterministic
// thresholds only, no access to Position/network state. A wide two-sided
// market (evidence exists, `crossed` is false) still classifies DEGRADED,
// not RELIABLE, unless it clears BOTH width thresholds.
export function classifyQuoteQuality(evidence: QuoteWidthEvidence | null): QuoteQuality {
  if (!evidence) return 'UNKNOWN';
  if (evidence.crossed) return 'DEGRADED';
  if (evidence.netWidthDollars == null || evidence.netWidthPctOfMid == null) return 'UNKNOWN';

  const legsNarrow = evidence.legWidthsDollars.length > 0 &&
    evidence.legWidthsDollars.every(w => w != null && w <= QUOTE_WIDTH_THRESHOLDS.maxNarrowLegWidthDollars);
  const netNarrow = evidence.netWidthPctOfMid <= QUOTE_WIDTH_THRESHOLDS.maxNarrowNetWidthPctOfMid;

  return legsNarrow && netNarrow ? 'RELIABLE' : 'DEGRADED';
}

export interface BreachObservation {
  // Full ISO 8601 timestamp. Observations reconstructed from a date-only
  // daily snapshot (no time-of-day) should still supply a parseable
  // timestamp (e.g. midnight UTC of that date) for ordering purposes, but
  // MUST set `preciseTimestamp: false` -- see that field's doc comment.
  at: string;
  // Total buyback value across the whole position (not per-contract), same
  // scale as Position.currentValue / Position.closeValue.
  midValue: number | null;
  marketableValue: number | null;
  // TE-0002 corrective round 2: true only when `at` is a genuine capture
  // timestamp (time-of-day is real, not a reconstructed midnight/date-only
  // placeholder). An intraday confirmation streak may ONLY be built from
  // `preciseTimestamp: true` observations -- an old date-only daily
  // snapshot combined with one current tick must never fabricate a
  // 2-observation confirmation. Date-only observations remain valid
  // CONTEXTUAL evidence (may still be shown to the trader / used for
  // trend context) but cannot themselves satisfy requiredConfirmations.
  preciseTimestamp: boolean;
}

export type StopBreachState =
  | 'NO_STOP'
  | 'NOT_BREACHED'
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED_BREACH'
  | 'VERIFY_STOP';

export interface StopBreachEvaluation {
  state: StopBreachState;
  confirmedBy: 'BROKER_ORDER' | 'OBSERVATION_STREAK' | null;
  streak: number;
  requiredConfirmations: number;
  explanation: string;
}

export interface EvaluateStopBreachInput {
  policy: StopLossPolicy | null;
  quantity: number;
  observations: readonly BreachObservation[];
  brokerStopStatus?: BrokerStopStatus;
  quoteQuality?: QuoteQuality;
  requiredConfirmations?: number;
  hysteresisPct?: number;
  // TE-0002 corrective round 2: minimum elapsed time between two
  // observations for them to count as SEPARATE confirmations. Observations
  // closer together than this (e.g. two renders reading the same quote
  // tick, or a duplicated same-day snapshot) collapse into one.
  minConfirmationIntervalMs?: number;
}

const DEFAULT_REQUIRED_CONFIRMATIONS = 2;
const DEFAULT_HYSTERESIS_PCT = 0.02;
// Five minutes -- long enough that two renders of the same underlying quote
// tick (or a duplicated same-day snapshot capture) never count as two
// independent confirmations, short enough not to block a genuinely fast
// adverse move within a trading session.
const DEFAULT_MIN_CONFIRMATION_INTERVAL_MS = 5 * 60 * 1000;

// Replaces `stopLossBreachedMid || stopLossBreachedMarketable`. A single
// noisy snapshot (midpoint OR a wide-market marketable estimate) can never
// alone produce CONFIRMED_BREACH. Only an authoritative broker fill/trigger,
// or a sustained streak of `requiredConfirmations` consecutive, distinctly-
// timed, PRECISE observations at/above threshold (with hysteresis so a
// brief retreat resets the streak), counts as confirmed. Anything short of
// that downgrades to VERIFY_STOP/PENDING_CONFIRMATION so the caller can map
// it to MANAGE instead of CUT_LOSSES.
export function evaluateStopBreach(input: EvaluateStopBreachInput): StopBreachEvaluation {
  const {
    policy,
    quantity,
    observations,
    brokerStopStatus = 'UNKNOWN',
    quoteQuality = 'UNKNOWN',
    requiredConfirmations = DEFAULT_REQUIRED_CONFIRMATIONS,
    hysteresisPct = DEFAULT_HYSTERESIS_PCT,
    minConfirmationIntervalMs = DEFAULT_MIN_CONFIRMATION_INTERVAL_MS,
  } = input;

  if (!policy || !Number.isFinite(policy.triggerPrice) || policy.triggerPrice <= 0 || quantity <= 0) {
    return {
      state: 'NO_STOP', confirmedBy: null, streak: 0, requiredConfirmations,
      explanation: 'No working stop order to evaluate.',
    };
  }

  // Authoritative: broker-confirmed trigger/fill overrides everything else,
  // including any grace period a caller applies -- a real fill is a real
  // fill regardless of position age or observation history.
  if (brokerStopStatus === 'TRIGGERED') {
    return {
      state: 'CONFIRMED_BREACH', confirmedBy: 'BROKER_ORDER', streak: 0, requiredConfirmations,
      explanation: 'Broker reports the stop order has triggered/filled.',
    };
  }

  const thresholdTotal = policy.triggerPrice * 100 * quantity;
  const hysteresisFloor = thresholdTotal * (1 - hysteresisPct);

  // Freshness/ordering validation: drop anything with an unparseable
  // timestamp entirely -- it cannot be placed in the confirmation window at
  // all, and must not silently sort to either end.
  const parsed = observations
    .map(obs => ({ obs, ts: Date.parse(obs.at) }))
    .filter((entry): entry is { obs: BreachObservation; ts: number } => Number.isFinite(entry.ts));

  const newestFirstAll = [...parsed].sort((a, b) => b.ts - a.ts);

  const isEffectiveBreach = (obs: BreachObservation): boolean => {
    const midBreach = obs.midValue != null && obs.midValue >= thresholdTotal;
    const marketableBreach = obs.marketableValue != null && obs.marketableValue >= thresholdTotal;
    // Wide/unreliable quotes: a marketable-only breach (worst-case ask/bid
    // pricing on a wide market) must not, by itself, be more aggressive
    // than a reliable mid-based read. Only count mid-breach toward the
    // confirmation streak when quote quality isn't RELIABLE.
    return quoteQuality === 'RELIABLE' ? (midBreach || marketableBreach) : midBreach;
  };

  // Only precisely-timestamped observations can build a confirmation
  // streak -- a date-only daily snapshot combined with one current tick
  // must never fabricate a 2-observation confirmation (see
  // BreachObservation.preciseTimestamp's doc comment).
  const preciseNewestFirst = newestFirstAll.filter(e => e.obs.preciseTimestamp);

  // Deduplicate: collapse observations that land within
  // minConfirmationIntervalMs of an already-kept (more recent) observation
  // -- two renders of the same tick, or a duplicated same-day capture, must
  // count once, not twice.
  const dedupedNewestFirst: typeof preciseNewestFirst = [];
  for (const entry of preciseNewestFirst) {
    const last = dedupedNewestFirst[dedupedNewestFirst.length - 1];
    if (last && last.ts - entry.ts < minConfirmationIntervalMs) continue;
    dedupedNewestFirst.push(entry);
  }

  let streak = 0;
  for (const { obs } of dedupedNewestFirst) {
    if (isEffectiveBreach(obs)) { streak++; continue; }
    const referenceValue = obs.midValue ?? obs.marketableValue;
    const retreated = referenceValue != null && referenceValue <= hysteresisFloor;
    if (retreated) break; // hysteresis: fully retreated below the band, stop the streak here
    // else: within the hysteresis band -- treat as neutral noise, keep scanning further back
  }

  if (streak >= requiredConfirmations) {
    return {
      state: 'CONFIRMED_BREACH', confirmedBy: 'OBSERVATION_STREAK', streak, requiredConfirmations,
      explanation: `Threshold confirmed across ${streak} distinctly-timed observations.`,
    };
  }

  // "Latest" for messaging/NOT_BREACHED purposes uses the full observation
  // set (imprecise daily snapshots are still valid CONTEXTUAL evidence of
  // "is this position currently near/at the threshold") -- only the
  // CONFIRMATION STREAK itself is restricted to precise, deduped readings.
  const latest = newestFirstAll[0]?.obs;
  const latestMidBreach = latest?.midValue != null && latest.midValue >= thresholdTotal;
  const latestMarketableBreach = latest?.marketableValue != null && latest.marketableValue >= thresholdTotal;

  if (!latestMidBreach && !latestMarketableBreach) {
    return {
      state: 'NOT_BREACHED', confirmedBy: null, streak, requiredConfirmations,
      explanation: 'Current pricing has not reached the stop threshold.',
    };
  }

  // Latest observation shows breach evidence, but confirmation requirements
  // aren't met -- either not enough PRECISE, distinctly-timed history
  // exists (an old date-only daily snapshot cannot substitute), or (via
  // isEffectiveBreach) the only evidence is a wide-market marketable spike
  // a reliable mid read doesn't corroborate. Never issue a hard exit off a
  // single/unconfirmed snapshot: downgrade instead.
  if (dedupedNewestFirst.length < requiredConfirmations) {
    return {
      state: 'VERIFY_STOP', confirmedBy: null, streak, requiredConfirmations,
      explanation: latestMarketableBreach && !latestMidBreach
        ? 'Marketable (ask/bid) buyback crossed the stop, but midpoint has not, and a confirmed intraday observation window is unavailable — verify before treating this as an emergency exit.'
        : 'Stop threshold reached without a confirmed intraday observation window — verify before treating this as an emergency exit.',
    };
  }

  return {
    state: 'PENDING_CONFIRMATION', confirmedBy: null, streak, requiredConfirmations,
    explanation: `Threshold reached on ${streak} of ${requiredConfirmations} required distinctly-timed observations — awaiting confirmation.`,
  };
}

// ── Secondary protection: minimum-age grace ────────────────────────────
// Optional, deliberately weak: only ever nudges an UNCONFIRMED state's
// messaging for a very recently opened position. Never suppresses
// CONFIRMED_BREACH (broker-confirmed or a genuinely sustained streak).
export function isWithinStopGracePeriod(
  entryDate: string | null,
  evaluatedAt: string,
  graceDays = 1
): boolean {
  if (!entryDate) return false;
  const entry = Date.parse(entryDate);
  const now = Date.parse(evaluatedAt);
  if (Number.isNaN(entry) || Number.isNaN(now)) return false;
  return now - entry < graceDays * 86_400_000;
}
