// lib/portfolio/pendingOrderReplacementSafety.ts
//
// ES-0002: Pending-Order Replacement Safety.
//
// Closes ES-0001 Closeout Technical Debt TD-1 (see
// docs/reviews/ES-0001-Closeout-Report.md, Technical Debt Register): TD-1
// identified `app/portfolio/page.tsx`'s `replacePendingOrder` as a live,
// user-reachable order-submission path that cancels an existing pending
// complex order (`ttDelete`) and resubmits a plain order at a caller-supplied
// new price (`ttPost`) with NO tick validation, NO leg-identity check, and NO
// display-vs-payload cross-check -- entirely outside the `closeOrderSafety`/
// `closeOrderSubmission` boundary ES-0001 built for close/roll/stop-loss.
//
// This module is deliberately NOT a reuse of `closeOrderSafety.ts`'s
// `CanonicalCloseIdentity`/`ClosePlan` machinery. A pending order is an
// UNFILLED opening order -- it has no entry fill price, no realized-P/L
// economics, and no `avgOpenPrice` to build a credit/debit identity from.
// Forcing this workflow through `runLiveCloseOrderSafetyGate` would require
// fabricating quote evidence, an "entry price," and a price-effect-vs-P&L
// relationship that do not exist for a resting entry order -- exactly the
// kind of manufactured evidence the sprint instructions prohibit. Instead,
// this module validates the ACTUAL evidence this workflow really has: a
// broker-sourced `PendingOrder` (id, account, legs, original price/effect)
// and a user-entered new limit price. See
// docs/design/ES-0002-Pending-Order-Replacement-Safety.md for the full
// rationale.
//
// No quote/marketability evidence is required or fabricated here (see
// requirement 10 in the ticket): this module guarantees PAYLOAD IDENTITY and
// REQUESTED-PRICE INTEGRITY (the broker never receives a different price,
// price effect, or leg set than what was validated), not that the requested
// price is fair value or currently marketable. That is an explicit, disclosed
// non-goal, not an oversight.

// ---------------------------------------------------------------------------
// Evidence -- what this workflow actually has available
// ---------------------------------------------------------------------------

export type ReplacementPriceEffect = 'Credit' | 'Debit';

/** One leg of the existing broker-sourced pending order. `action` is
 *  preserved verbatim from the broker (e.g. 'Sell to Open', 'Buy to Open')
 *  -- this module never reinterprets or infers an action. */
export interface PendingOrderLegEvidence {
  symbol: string;
  action: string;
  quantity: number;
}

/** The broker-sourced evidence for the existing pending order, mapped from
 *  `app/portfolio/page.tsx`'s `PendingOrder` type. Deliberately does not
 *  import that type directly (kept framework/page-independent, matching
 *  `closeOrderSubmission.ts`'s `AmbiguityGuardInput` pattern) -- callers map
 *  their own `PendingOrder` into this shape. */
export interface PendingOrderEvidence {
  id: string;
  accountNumber: string;
  /** Underlying symbol -- diagnostics/messages only, never a safety input. */
  symbol: string;
  legs: PendingOrderLegEvidence[];
  /** The order's ORIGINAL broker price effect. Never inferred from a price's
   *  numeric sign -- must be the broker-sourced value, or this is blocked. */
  priceEffect: string | null;
  /** The order's ORIGINAL broker limit price, in option-price POINTS. Used
   *  only for restore planning -- a replacement's new price is supplied
   *  separately by the caller (the operator's typed value). */
  limitPrice: number | null;
  orderType: string | null;
  timeInForce: string | null;
}

// ---------------------------------------------------------------------------
// Immutable replacement plan
// ---------------------------------------------------------------------------

export interface ReplacementLegPayload {
  symbol: string;
  action: string;
  quantity: number;
}

export type PendingOrderReplacementIntent = 'REPLACEMENT' | 'RESTORE';

export interface PendingOrderReplacementPlan {
  pendingOrderId: string;
  accountNumber: string;
  /** What this plan is for -- preserved through to the gate so replacement
   *  and restore remain distinguishable in messages/logs even though they
   *  share the same builder and gate shape. */
  intent: PendingOrderReplacementIntent;
  orderType: string;
  timeInForce: string;
  priceEffect: ReplacementPriceEffect;
  /** Broker option-price POINTS -- for REPLACEMENT this is the operator's
   *  requested new price; for RESTORE this is always the original order's
   *  own price. NEVER dollars, NEVER contract-multiplied. */
  limitPricePoints: number;
  /** The exact legs, unchanged from the broker-sourced order -- this
   *  workflow never adds, removes, or re-quantities a leg. */
  legPayload: ReplacementLegPayload[];
}

export type PendingOrderReplacementRuleId =
  | 'PENDING_ORDER_ID_MISSING'
  | 'ACCOUNT_NUMBER_MISSING'
  | 'REPLACEMENT_LEGS_MISSING'
  | 'REPLACEMENT_LEG_IDENTITY_MISMATCH'
  | 'REPLACEMENT_LEG_ACTION_MISMATCH'
  | 'REPLACEMENT_QUANTITY_INVALID'
  | 'REPLACEMENT_PAYLOAD_QUANTITY_MISMATCH'
  | 'REPLACEMENT_LIMIT_PRICE_INVALID'
  | 'REPLACEMENT_LIMIT_TICK_INVALID'
  | 'REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID'
  | 'REPLACEMENT_PAYLOAD_LIMIT_PRICE_MISMATCH'
  | 'REPLACEMENT_PRICE_EFFECT_INVALID'
  | 'REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID'
  | 'REPLACEMENT_PAYLOAD_PRICE_EFFECT_MISMATCH'
  | 'RESTORE_PRICE_UNAVAILABLE'
  | 'RESTORE_PLAN_INVALID';

export type PlanBuildFailure = { ok: false; ruleId: PendingOrderReplacementRuleId; message: string };
export type PlanBuildResult = { ok: true; plan: PendingOrderReplacementPlan } | PlanBuildFailure;

function isTickValid(pricePoints: number): boolean {
  // Same cent-denomination check as closeOrderSafety.ts's isTickValid,
  // duplicated rather than imported: this module is deliberately independent
  // of closeOrderSafety.ts's canonical-close-identity machinery (see module
  // doc header), and the tick rule is a broker-wide convention, not something
  // specific to close orders.
  return Math.abs(Math.round(pricePoints * 100) - pricePoints * 100) < 1e-6;
}

/**
 * Validates the broker-sourced evidence itself (identity, legs, price
 * effect) -- the checks that apply regardless of what price is being
 * requested. Shared by both the replacement and restore plan builders so
 * the two can never diverge on what counts as a structurally valid pending
 * order.
 */
function validateEvidence(evidence: PendingOrderEvidence): PlanBuildFailure | null {
  if (!evidence.id) {
    return { ok: false, ruleId: 'PENDING_ORDER_ID_MISSING', message: 'The pending order has no broker order id -- cannot safely target a replacement or restore submission.' };
  }
  if (!evidence.accountNumber) {
    return { ok: false, ruleId: 'ACCOUNT_NUMBER_MISSING', message: 'The pending order has no account number -- cannot safely target a replacement or restore submission.' };
  }
  if (!evidence.legs || evidence.legs.length === 0) {
    return { ok: false, ruleId: 'REPLACEMENT_LEGS_MISSING', message: `Pending order ${evidence.id} has no legs -- there is nothing to replace.` };
  }
  for (const leg of evidence.legs) {
    if (!leg.symbol || !leg.action) {
      return { ok: false, ruleId: 'REPLACEMENT_LEGS_MISSING', message: `Pending order ${evidence.id} has a leg missing a symbol or action.` };
    }
    if (!Number.isFinite(leg.quantity) || leg.quantity <= 0 || !Number.isInteger(leg.quantity)) {
      return { ok: false, ruleId: 'REPLACEMENT_QUANTITY_INVALID', message: `Leg ${leg.symbol} quantity ${leg.quantity} must be a positive integer.` };
    }
  }
  if (evidence.priceEffect !== 'Credit' && evidence.priceEffect !== 'Debit') {
    // Deliberately does NOT default to 'Credit' the way the pre-existing
    // `buildReplaceOrder`'s `?? 'Credit'` does -- that silent default is
    // exactly the kind of unsafe fallback this ticket exists to remove. A
    // pending order with an unknown original price effect is hard-blocked,
    // not guessed at.
    return { ok: false, ruleId: 'REPLACEMENT_PRICE_EFFECT_INVALID', message: `Pending order ${evidence.id}'s original price effect ('${evidence.priceEffect}') is missing or invalid -- refusing to guess Credit vs Debit.` };
  }
  return null;
}

function validatePrice(pointsPerUnit: number): PlanBuildFailure | null {
  if (!Number.isFinite(pointsPerUnit) || pointsPerUnit <= 0) {
    return { ok: false, ruleId: 'REPLACEMENT_LIMIT_PRICE_INVALID', message: `Limit price ${pointsPerUnit} must be a positive, finite number of points.` };
  }
  if (!isTickValid(pointsPerUnit)) {
    return { ok: false, ruleId: 'REPLACEMENT_LIMIT_TICK_INVALID', message: `Limit price ${pointsPerUnit} is not a valid cent-denominated points price.` };
  }
  return null;
}

/**
 * Builds the immutable REPLACEMENT plan: the existing pending order's exact
 * legs, unchanged, at the operator's requested new limit price. This is the
 * one deterministic, pre-cancel-safe validation step -- it does no network
 * I/O and has no side effects, so it is safe to run BEFORE `ttDelete`
 * cancels the existing order (see the submission module's ordering
 * requirement: known-invalid inputs must be rejected before cancellation).
 */
export function buildPendingOrderReplacementPlan(
  evidence: PendingOrderEvidence,
  requestedLimitPricePoints: number
): PlanBuildResult {
  const evidenceFailure = validateEvidence(evidence);
  if (evidenceFailure) return evidenceFailure;

  const priceFailure = validatePrice(requestedLimitPricePoints);
  if (priceFailure) return priceFailure;

  return {
    ok: true,
    plan: {
      pendingOrderId: evidence.id,
      accountNumber: evidence.accountNumber,
      intent: 'REPLACEMENT',
      orderType: evidence.orderType || 'Limit',
      timeInForce: evidence.timeInForce || 'GTC',
      priceEffect: evidence.priceEffect as ReplacementPriceEffect,
      limitPricePoints: requestedLimitPricePoints,
      legPayload: evidence.legs.map(l => ({ symbol: l.symbol, action: l.action, quantity: l.quantity })),
    },
  };
}

/**
 * Builds the immutable RESTORE plan: the existing pending order's exact
 * legs, unchanged, at the order's OWN original limit price -- never the
 * new/failed replacement price, and never a silently-substituted value.
 * Blocks with `RESTORE_PRICE_UNAVAILABLE` if the original price is missing
 * or invalid (the one condition unique to restore: there is no operator
 * input to fall back on), and `RESTORE_PLAN_INVALID` if the evidence itself
 * is otherwise unusable. Reuses `buildPendingOrderReplacementPlan` internally
 * so replacement and restore can never validate against different rules.
 */
export function buildPendingOrderRestorePlan(evidence: PendingOrderEvidence): PlanBuildResult {
  if (evidence.limitPrice == null || !Number.isFinite(evidence.limitPrice) || evidence.limitPrice <= 0) {
    return {
      ok: false,
      ruleId: 'RESTORE_PRICE_UNAVAILABLE',
      message: `Pending order ${evidence.id || '(unknown)'}'s original limit price is missing or invalid -- cannot safely restore it. Do not submit an invented price; report this operational state and require manual broker-side action.`,
    };
  }
  const result = buildPendingOrderReplacementPlan(evidence, evidence.limitPrice);
  if (!result.ok) {
    return {
      ok: false,
      ruleId: 'RESTORE_PLAN_INVALID',
      message: `Restore plan could not be built for pending order ${evidence.id || '(unknown)'}: ${result.message}`,
    };
  }
  return { ok: true, plan: { ...result.plan, intent: 'RESTORE' } };
}

// ---------------------------------------------------------------------------
// Safety gate -- actual-payload cross-check
// ---------------------------------------------------------------------------

export interface SafetyCheckIssue {
  ruleId: PendingOrderReplacementRuleId;
  /** Every rule in this gate is a hard block -- there is no warn-only path,
   *  matching ES-0001's all-block design for the same class of live-order
   *  safety decision. */
  severity: 'block';
  message: string;
}

export interface PendingOrderReplacementSafetyCheckResult {
  ok: boolean;
  issues: SafetyCheckIssue[];
  plan?: PendingOrderReplacementPlan;
}

/** The exact broker order payload about to be submitted -- required, not
 *  optional, so a caller cannot omit it and silently bypass the cross-check.
 *  Callers must derive this from the SAME object literally passed to
 *  `ttPost`, not a separately reconstructed approximation of it.
 *
 *  CORRECTIVE ROUND: `limitPricePoints`/`priceEffect` are the RAW payload
 *  values, not pre-validated ones. A caller-side adapter must NOT default a
 *  missing/malformed price to `0`/`NaN`-masking-safe or a missing price
 *  effect to `'Credit'`/`'Debit'` before handing it to this gate -- doing so
 *  previously let a malformed payload (e.g. a missing price effect on a
 *  Debit plan, silently defaulted to `'Debit'`) pass validation undetected.
 *  This gate validates both fields explicitly (`REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID`,
 *  `REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID`) before ever comparing them to
 *  the plan, so `priceEffect` is deliberately typed as an unvalidated raw
 *  value rather than the narrower `ReplacementPriceEffect` union. */
export interface ActualReplacementOrderEvidence {
  legs: ReplacementLegPayload[];
  /** Raw broker-payload limit price, in points. May be `NaN`/`Infinity`/
   *  non-positive/sub-penny if the payload is malformed -- never assumed
   *  valid; see the gate's explicit validation. */
  limitPricePoints: number;
  /** Raw broker-payload price effect. May be `null`/`undefined`/any string
   *  if the payload is malformed -- never assumed to already be `'Credit'`
   *  or `'Debit'`; see the gate's explicit validation. */
  priceEffect: string | null | undefined;
}

export interface PendingOrderReplacementSafetyInput {
  evidence: PendingOrderEvidence;
  requestedLimitPricePoints: number;
  actualOrder: ActualReplacementOrderEvidence;
}

export interface PendingOrderRestoreSafetyInput {
  evidence: PendingOrderEvidence;
  actualOrder: ActualReplacementOrderEvidence;
}

/**
 * Order-independent, deterministic leg cross-check: matches each plan leg to
 * an actual leg by symbol (broker leg ordering is not guaranteed), then
 * checks action and quantity. Every plan leg must be matched exactly once;
 * any unmatched actual leg is an extra leg. Missing, duplicated, and extra
 * legs are all distinct failure shapes but are reported under the same
 * `REPLACEMENT_LEG_IDENTITY_MISMATCH` rule (leg-set shape mismatch), while a
 * matched-by-symbol leg with a different action or quantity gets its own,
 * more specific rule.
 */
function crossCheckLegs(
  planLegs: ReplacementLegPayload[],
  actualLegs: ReplacementLegPayload[],
  push: (ruleId: PendingOrderReplacementRuleId, message: string) => void
): void {
  if (planLegs.length !== actualLegs.length) {
    push('REPLACEMENT_LEG_IDENTITY_MISMATCH', `Broker payload has ${actualLegs.length} leg(s); the validated plan has ${planLegs.length}. No missing, duplicated, or additional legs are allowed.`);
    return;
  }

  const consumed = new Set<number>();
  for (const planLeg of planLegs) {
    const idx = actualLegs.findIndex((al, i) => !consumed.has(i) && al.symbol === planLeg.symbol);
    if (idx === -1) {
      push('REPLACEMENT_LEG_IDENTITY_MISMATCH', `Broker payload is missing (or has an extra/duplicated leg for) symbol ${planLeg.symbol}.`);
      continue;
    }
    consumed.add(idx);
    const actualLeg = actualLegs[idx];
    if (actualLeg.action !== planLeg.action) {
      push('REPLACEMENT_LEG_ACTION_MISMATCH', `Leg ${planLeg.symbol} broker action '${actualLeg.action}' does not match the plan's '${planLeg.action}'.`);
    }
    if (actualLeg.quantity !== planLeg.quantity) {
      push('REPLACEMENT_PAYLOAD_QUANTITY_MISMATCH', `Leg ${planLeg.symbol} broker quantity ${actualLeg.quantity} does not match the plan's ${planLeg.quantity}.`);
    }
  }
}

function runGate(
  planResult: PlanBuildResult,
  actualOrder: ActualReplacementOrderEvidence
): PendingOrderReplacementSafetyCheckResult {
  if (!planResult.ok) {
    return { ok: false, issues: [{ ruleId: planResult.ruleId, severity: 'block', message: planResult.message }] };
  }
  const plan = planResult.plan;
  const issues: SafetyCheckIssue[] = [];
  const push = (ruleId: PendingOrderReplacementRuleId, message: string) => issues.push({ ruleId, severity: 'block', message });

  crossCheckLegs(plan.legPayload, actualOrder.legs, push);

  // CORRECTIVE ROUND: validate the actual payload's limit price is itself
  // usable BEFORE comparing it to the plan. `parseFloat` on a missing or
  // malformed payload field can produce `NaN`, and a naive
  // `Math.abs(NaN - plan) > tolerance` comparison evaluates to `false` --
  // silently passing a malformed payload instead of blocking it. Finite,
  // positive, and cent-denominated are all checked explicitly first, and a
  // failure here is reported as its own distinct rule
  // (`REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID`), not folded into the
  // mismatch check, so an operator sees "the payload price itself is
  // malformed" rather than a misleading "doesn't match" message.
  const actualPrice = actualOrder.limitPricePoints;
  if (!Number.isFinite(actualPrice) || actualPrice <= 0 || !isTickValid(actualPrice)) {
    push('REPLACEMENT_PAYLOAD_LIMIT_PRICE_INVALID', `Broker payload limit price ${actualPrice} is missing, non-finite, non-positive, or not a valid cent-denominated points price.`);
  } else {
    // Integer-cent equality, not a 0.01-point float tolerance -- a
    // tolerance of `> 0.01` does NOT flag a payload that differs from the
    // plan by EXACTLY one cent (`0.01 > 0.01` is false), which would let a
    // full one-cent price drift pass silently. Comparing rounded integer
    // cents closes that boundary case entirely and is immune to float
    // representation error (e.g. `0.3 * 100` not being exactly `30`).
    const actualCents = Math.round(actualPrice * 100);
    const planCents = Math.round(plan.limitPricePoints * 100);
    if (actualCents !== planCents) {
      push('REPLACEMENT_PAYLOAD_LIMIT_PRICE_MISMATCH', `Broker payload limit price ${actualPrice} points (${actualCents}¢) does not match the validated plan's ${plan.limitPricePoints} points (${planCents}¢).`);
    }
  }

  // CORRECTIVE ROUND: the actual payload's price effect must be explicitly
  // 'Credit' or 'Debit' -- never assumed. A caller-side adapter defaulting a
  // missing price effect to (say) 'Debit' would previously let a malformed
  // payload silently match a Debit plan's `priceEffect` via plain equality.
  // Validating the raw value first, and reporting an invalid value under
  // its own distinct rule, closes that gap regardless of what any adapter
  // does upstream.
  if (actualOrder.priceEffect !== 'Credit' && actualOrder.priceEffect !== 'Debit') {
    push('REPLACEMENT_PAYLOAD_PRICE_EFFECT_INVALID', `Broker payload price effect '${actualOrder.priceEffect}' is missing or is not exactly 'Credit' or 'Debit'.`);
  } else if (actualOrder.priceEffect !== plan.priceEffect) {
    push('REPLACEMENT_PAYLOAD_PRICE_EFFECT_MISMATCH', `Broker payload price effect '${actualOrder.priceEffect}' does not match the validated plan's '${plan.priceEffect}'.`);
  }

  if (issues.length > 0) return { ok: false, issues, plan };
  return { ok: true, issues: [], plan };
}

/**
 * The single entry point that must run before ANY live pending-order
 * REPLACEMENT submission. Builds the immutable plan from the broker-sourced
 * evidence and the operator's requested price, then hard cross-checks the
 * actual broker payload against it. Every failure is a hard block.
 */
export function runPendingOrderReplacementSafetyGate(input: PendingOrderReplacementSafetyInput): PendingOrderReplacementSafetyCheckResult {
  const planResult = buildPendingOrderReplacementPlan(input.evidence, input.requestedLimitPricePoints);
  return runGate(planResult, input.actualOrder);
}

/**
 * The single entry point that must run before ANY live pending-order RESTORE
 * submission (the automatic recovery attempted when a replacement fails
 * after the original order was already cancelled). Reuses the same gate
 * shape as replacement -- restoration is not a lesser-validated path.
 */
export function runPendingOrderRestoreSafetyGate(input: PendingOrderRestoreSafetyInput): PendingOrderReplacementSafetyCheckResult {
  const planResult = buildPendingOrderRestorePlan(input.evidence);
  return runGate(planResult, input.actualOrder);
}
