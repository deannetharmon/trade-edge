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
  brokerOrderId: string | null;
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

export function buildOriginalCreditDefaultPolicy(
  creditPerContract: number,
  opts: {
    source?: StopSource;
    createdAt?: string | null;
    brokerOrderId?: string | null;
    multiple?: number;
  } = {}
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
  };
}

export function buildCurrentValueAnchoredPolicy(
  currentValuePerContract: number,
  multiple: number,
  opts: { source?: StopSource; createdAt?: string | null; brokerOrderId?: string | null } = {}
): StopLossPolicy {
  return {
    triggerPrice: parseFloat((currentValuePerContract * multiple).toFixed(2)),
    anchorBasis: 'CURRENT_SPREAD_VALUE',
    anchorValue: currentValuePerContract,
    multiple,
    source: opts.source ?? 'AI_SUGGESTION',
    createdAt: opts.createdAt ?? null,
    brokerOrderId: opts.brokerOrderId ?? null,
  };
}

export function buildManualAbsolutePolicy(
  triggerPrice: number,
  opts: { createdAt?: string | null; brokerOrderId?: string | null } = {}
): StopLossPolicy {
  return {
    triggerPrice: parseFloat(triggerPrice.toFixed(2)),
    anchorBasis: 'MANUAL_ABSOLUTE',
    anchorValue: null,
    multiple: null,
    source: 'MANUAL',
    createdAt: opts.createdAt ?? null,
    brokerOrderId: opts.brokerOrderId ?? null,
  };
}

// An order that exists at the broker but carries no TradeEdge-recorded
// policy (never created by TradeEdge, or the recorded policy's
// brokerOrderId no longer matches the live order -- e.g. it was replaced
// outside the app). Basis is UNKNOWN; the caller must not invent one.
export function buildUnknownProvenancePolicy(
  triggerPrice: number,
  brokerOrderId: string | null = null
): StopLossPolicy {
  return {
    triggerPrice: parseFloat(triggerPrice.toFixed(2)),
    anchorBasis: 'UNKNOWN',
    anchorValue: null,
    multiple: null,
    source: 'UNKNOWN',
    createdAt: null,
    brokerOrderId,
  };
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

// ── Breach confirmation ─────────────────────────────────────────────────

export type QuoteQuality = 'RELIABLE' | 'DEGRADED' | 'UNKNOWN';
export type BrokerStopStatus = 'TRIGGERED' | 'WORKING' | 'UNKNOWN';

export interface BreachObservation {
  at: string; // ISO timestamp, used only for ordering
  // Total buyback value across the whole position (not per-contract), same
  // scale as Position.currentValue / Position.closeValue.
  midValue: number | null;
  marketableValue: number | null;
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
}

const DEFAULT_REQUIRED_CONFIRMATIONS = 2;
const DEFAULT_HYSTERESIS_PCT = 0.02;

// Replaces `stopLossBreachedMid || stopLossBreachedMarketable`. A single
// noisy snapshot (midpoint OR a wide-market marketable estimate) can never
// alone produce CONFIRMED_BREACH. Only an authoritative broker fill/trigger,
// or a sustained streak of `requiredConfirmations` consecutive observations
// at/above threshold (with hysteresis so a brief retreat resets the
// streak), counts as confirmed. Anything short of that downgrades to
// VERIFY_STOP/PENDING_CONFIRMATION so the caller can map it to MANAGE
// instead of CUT_LOSSES.
export function evaluateStopBreach(input: EvaluateStopBreachInput): StopBreachEvaluation {
  const {
    policy,
    quantity,
    observations,
    brokerStopStatus = 'UNKNOWN',
    quoteQuality = 'UNKNOWN',
    requiredConfirmations = DEFAULT_REQUIRED_CONFIRMATIONS,
    hysteresisPct = DEFAULT_HYSTERESIS_PCT,
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

  const newestFirst = [...observations].sort((a, b) => b.at.localeCompare(a.at));

  const isEffectiveBreach = (obs: BreachObservation): boolean => {
    const midBreach = obs.midValue != null && obs.midValue >= thresholdTotal;
    const marketableBreach = obs.marketableValue != null && obs.marketableValue >= thresholdTotal;
    // Wide/unreliable quotes: a marketable-only breach (worst-case ask/bid
    // pricing on a wide market) must not, by itself, be more aggressive
    // than a reliable mid-based read. Only count mid-breach toward the
    // confirmation streak when quote quality isn't RELIABLE.
    return quoteQuality === 'RELIABLE' ? (midBreach || marketableBreach) : midBreach;
  };

  let streak = 0;
  for (const obs of newestFirst) {
    if (isEffectiveBreach(obs)) { streak++; continue; }
    const referenceValue = obs.midValue ?? obs.marketableValue;
    const retreated = referenceValue != null && referenceValue <= hysteresisFloor;
    if (retreated) break; // hysteresis: fully retreated below the band, stop the streak here
    // else: within the hysteresis band -- treat as neutral noise, keep scanning further back
  }

  if (streak >= requiredConfirmations) {
    return {
      state: 'CONFIRMED_BREACH', confirmedBy: 'OBSERVATION_STREAK', streak, requiredConfirmations,
      explanation: `Threshold confirmed across ${streak} consecutive observations.`,
    };
  }

  const latest = newestFirst[0];
  const latestMidBreach = latest?.midValue != null && latest.midValue >= thresholdTotal;
  const latestMarketableBreach = latest?.marketableValue != null && latest.marketableValue >= thresholdTotal;

  if (!latestMidBreach && !latestMarketableBreach) {
    return {
      state: 'NOT_BREACHED', confirmedBy: null, streak, requiredConfirmations,
      explanation: 'Current pricing has not reached the stop threshold.',
    };
  }

  // Latest observation shows breach evidence, but confirmation requirements
  // aren't met -- either not enough history exists, or (via isEffectiveBreach)
  // the only evidence is a wide-market marketable spike a reliable mid read
  // doesn't corroborate. Never issue a hard exit off a single/unconfirmed
  // snapshot: downgrade instead.
  if (observations.length < requiredConfirmations) {
    return {
      state: 'VERIFY_STOP', confirmedBy: null, streak, requiredConfirmations,
      explanation: latestMarketableBreach && !latestMidBreach
        ? 'Marketable (ask/bid) buyback crossed the stop, but midpoint has not, and confirmation history is unavailable — verify before treating this as an emergency exit.'
        : 'Stop threshold reached on a single observation with no confirmation history — verify before treating this as an emergency exit.',
    };
  }

  return {
    state: 'PENDING_CONFIRMATION', confirmedBy: null, streak, requiredConfirmations,
    explanation: `Threshold reached on ${streak} of ${requiredConfirmations} required consecutive observations — awaiting confirmation.`,
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
