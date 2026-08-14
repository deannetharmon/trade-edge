// lib/portfolio/closeOrderSafety.ts
//
// ES-0001: Live Close-Order Identity and Break-Even Safety.
//
// ROUND 1 (REJECTED): grouped raw broker legs by (symbol, expiration,
// quantity) and treated "every leg in a group shares one quantity" as
// sufficient proof of position identity; disclosed same-quantity ambiguity
// in the confirmation modal instead of hard-blocking it.
//
// ROUND 1 CORRECTIVE (REJECTED): replaced quantity-only grouping with
// deterministic ECONOMIC-STRUCTURE ANALYSIS (kept, see below) and an
// all-block safety gate (kept, see below), but introduced a CRITICAL 100x
// price-unit defect: `entryPricePerUnit` was computed as
// `|netPerShare| * contractMultiplier` (i.e. DOLLARS per contract, e.g. 60
// for a $0.60 credit) and then fed straight back into `closePricePerUnit`
// (which every consumer -- including `buildCloseOrder`'s actual broker
// `price` field -- treats as broker option-price POINTS, e.g. 0.60).
// Anything built from that value (Snap to Break Even's proposed limit,
// every default Take-Profit/GTC/Cut-Losses price in app/portfolio/page.tsx)
// would have submitted a broker limit price 100x too large. This module
// fixes that by making the points/dollars distinction explicit in every
// field name and only ever multiplying by `contractMultiplier` exactly once
// per points-to-dollars conversion. It also fixes a previously-undiscovered
// defect where entry economics were floored to $0 with `Math.max(0, net)`
// instead of being reported as a signed Credit/Debit.
//
// This module also adds: a typed `PricingIntent` (CUSTOM/MARKETABLE/
// BREAK_EVEN/PROFIT_TARGET/STOP_LOSS/ROLL) preserved end-to-end so a
// Snap-to-Break-Even submission can be validated against its own declared
// intent, not a disconnected theoretical self-check; a discriminated
// `LiveCloseOrderSafetyInput` where quote evidence, the actual broker order,
// and the displayed P/L are REQUIRED (not optional) fields, so an `undefined`
// or omitted value cannot silently skip validation the way the round-1
// `SafetyGateInput`'s optional fields could; and marketable-price deviation
// checking derived from required quote evidence (Debit close -> ask side,
// Credit close -> bid side) rather than an optional caller-supplied value.
//
// Everything a live close/roll/stop-loss action needs -- the canonical
// identity, the immutable submission plan, and the safety gate -- lives here
// so the confirmation UI and the broker payload are built from the exact
// same object and can never independently drift from each other.

// ---------------------------------------------------------------------------
// Base types
// ---------------------------------------------------------------------------

export type OptionType = 'P' | 'C';
export type LegDirection = 'Short' | 'Long';
export type PriceEffect = 'Credit' | 'Debit';

/** What the operator is actually trying to do with a given close-price
 *  submission. Preserved end-to-end from the UI action that triggered it
 *  through the immutable plan and into the safety gate, so intent-specific
 *  validation (e.g. BREAK_EVEN's "this must net to ~$0") checks the ACTUAL
 *  plan being submitted rather than a disconnected theoretical plan. */
export type PricingIntent = 'CUSTOM' | 'MARKETABLE' | 'BREAK_EVEN' | 'PROFIT_TARGET' | 'STOP_LOSS' | 'ROLL';

/** One already-netted per-OCC-symbol broker leg, as returned by
 *  `/accounts/{account}/positions` (one row per unique option symbol). */
export interface RawEconomicLeg {
  symbol: string;
  optionType: OptionType;
  strikePrice: number;
  direction: LegDirection;
  /** Always an unsigned magnitude -- sign/side is carried by `direction`. */
  quantity: number;
  /** Per-share option price at entry, in broker option-price POINTS (e.g.
   *  0.60), TastyTrade convention -- NOT dollars. */
  avgOpenPrice: number | null;
  createdAt?: string | null;
}

// ---------------------------------------------------------------------------
// Deterministic economic-structure analysis
// ---------------------------------------------------------------------------

export type StructureType = 'NAKED' | 'VERTICAL' | 'IRON_CONDOR';

export interface EconomicStructure {
  structureType: StructureType;
  /** The single quantity shared by every leg in this structure. */
  quantity: number;
  legs: RawEconomicLeg[];
}

export interface AmbiguousBucket {
  optionType: OptionType;
  quantity: number;
  shorts: RawEconomicLeg[];
  longs: RawEconomicLeg[];
}

export type StructureAnalysisResult =
  | { status: 'RESOLVED'; structures: EconomicStructure[] }
  | { status: 'AMBIGUOUS'; ambiguousBuckets: AmbiguousBucket[] }
  | { status: 'UNSUPPORTED'; unsupportedLegs: RawEconomicLeg[] };

/**
 * Resolves one (optionType, quantity) bucket's shorts/longs into structures,
 * or flags it ambiguous. The only case that is EVER structurally ambiguous
 * is when both a short and a long exist and it is not the trivial 1-short/
 * 1-long pairing -- any time there is more than one short, more than one
 * long, or both are >=1 with more than one of either, there is more than one
 * way to pair them into verticals, and no quantity/strike/type evidence
 * available at this layer can tell them apart. When one side is completely
 * empty, there is nothing to pair against, so every leg on the populated
 * side is unambiguously its own NAKED structure.
 */
function resolveBucket(
  quantity: number,
  shorts: RawEconomicLeg[],
  longs: RawEconomicLeg[]
): EconomicStructure[] | 'AMBIGUOUS' {
  if (shorts.length === 0 && longs.length === 0) return [];
  if (shorts.length === 0) return longs.map(l => ({ structureType: 'NAKED', quantity, legs: [l] }));
  if (longs.length === 0) return shorts.map(l => ({ structureType: 'NAKED', quantity, legs: [l] }));
  if (shorts.length === 1 && longs.length === 1) {
    return [{ structureType: 'VERTICAL', quantity, legs: [shorts[0], longs[0]] }];
  }
  // Both sides populated and not the trivial 1-1 case: multiple valid
  // short<->long pairings exist. Genuinely ambiguous -- do not guess, and
  // never use strike adjacency as a tiebreaker.
  return 'AMBIGUOUS';
}

/**
 * Analyzes the raw legs of ONE underlying+expiration bucket (already grouped
 * by symbol+expiration upstream) into deterministic economic structures. See
 * `resolveBucket` for the pairing rule. Same-quantity put-VERTICAL and
 * call-VERTICAL structures are merged into a single IRON_CONDOR structure
 * post-resolution (an iron condor is not a separate partition choice from
 * "two verticals" -- it is the same four legs).
 */
export function analyzePositionStructure(legs: RawEconomicLeg[]): StructureAnalysisResult {
  const validLegs = legs.filter(l => Math.abs(Number(l.quantity) || 0) > 0);
  const unsupportedLegs = legs.filter(l => !(Math.abs(Number(l.quantity) || 0) > 0));
  if (unsupportedLegs.length > 0) {
    return { status: 'UNSUPPORTED', unsupportedLegs };
  }

  const byBucket = new Map<string, RawEconomicLeg[]>();
  for (const leg of validLegs) {
    const q = Math.abs(Number(leg.quantity) || 0);
    const k = `${leg.optionType}::${q}`;
    if (!byBucket.has(k)) byBucket.set(k, []);
    byBucket.get(k)!.push(leg);
  }

  const structures: EconomicStructure[] = [];
  const ambiguousBuckets: AmbiguousBucket[] = [];

  for (const [k, bucketLegs] of Array.from(byBucket.entries())) {
    const sepIdx = k.indexOf('::');
    const optionType = k.slice(0, sepIdx) as OptionType;
    const quantity = Number(k.slice(sepIdx + 2));
    const shorts = bucketLegs.filter(l => l.direction === 'Short');
    const longs = bucketLegs.filter(l => l.direction === 'Long');
    const resolved = resolveBucket(quantity, shorts, longs);
    if (resolved === 'AMBIGUOUS') {
      ambiguousBuckets.push({ optionType, quantity, shorts, longs });
    } else {
      structures.push(...resolved);
    }
  }

  if (ambiguousBuckets.length > 0) {
    return { status: 'AMBIGUOUS', ambiguousBuckets };
  }

  const merged: EconomicStructure[] = [];
  const used = new Set<number>();
  for (let i = 0; i < structures.length; i++) {
    if (used.has(i)) continue;
    const s = structures[i];
    if (s.structureType === 'VERTICAL') {
      const sIsPut = s.legs[0].optionType === 'P';
      const j = structures.findIndex((t, idx) =>
        idx > i && !used.has(idx) && t.structureType === 'VERTICAL' &&
        t.quantity === s.quantity && (t.legs[0].optionType === 'P') !== sIsPut
      );
      if (j !== -1) {
        merged.push({ structureType: 'IRON_CONDOR', quantity: s.quantity, legs: [...s.legs, ...structures[j].legs] });
        used.add(i);
        used.add(j);
        continue;
      }
    }
    merged.push(s);
    used.add(i);
  }

  return { status: 'RESOLVED', structures: merged };
}

/** Display/strategy label matching the existing app's naming convention. */
export function strategyLabelForStructure(structure: EconomicStructure): string {
  if (structure.structureType === 'IRON_CONDOR') return 'IC';
  if (structure.structureType === 'NAKED') return structure.legs[0].optionType === 'P' ? 'PUT' : 'CALL';
  return structure.legs[0].optionType === 'P' ? 'BPS' : 'BCS';
}

// ---------------------------------------------------------------------------
// Canonical close-order identity (entry economics)
// ---------------------------------------------------------------------------

export interface CanonicalCloseIdentity {
  key: string;
  underlying: string;
  expiration: string;
  structureType: StructureType;
  strategyLabel: string;
  /** The canonical, proven-unambiguous quantity for this structure. */
  quantity: number;
  /** Always 100 for equity/index options in this app. */
  contractMultiplier: number;
  legs: RawEconomicLeg[];
  entryPriceEffect: PriceEffect;
  /** Broker option-price POINTS per contract (e.g. 0.60) -- the exact
   *  magnitude a break-even close would submit as the broker's `price`
   *  field. This is NEVER dollars; multiply by `contractMultiplier` and
   *  quantity to get a dollar cash flow. */
  entryPricePointsPerUnit: number;
  /** Signed DOLLARS for the WHOLE position: positive = net credit received,
   *  negative = net debit paid. Never floored to zero -- see module doc. */
  entryTotalCashFlowDollars: number;
}

export type IdentityBuildFailure = { ok: false; ruleId: SafetyRuleId; message: string };
export type IdentityBuildResult = { ok: true; identity: CanonicalCloseIdentity } | IdentityBuildFailure;

/**
 * Builds the canonical close-order identity for one already-resolved,
 * unambiguous structure. Computes TRUE signed entry economics in POINTS
 * (fixing both the pre-existing `Math.max(0, net)` debit-flooring defect AND
 * the round-1-corrective 100x points/dollars conflation) and BLOCKS -- does
 * not floor to zero or substitute an estimate -- when entry economics are
 * missing, non-finite, or net to exactly zero.
 */
export function buildCanonicalCloseIdentity(
  structure: EconomicStructure,
  key: string,
  underlying: string,
  expiration: string,
  contractMultiplier = 100
): IdentityBuildResult {
  if (!(structure.quantity > 0)) {
    return { ok: false, ruleId: 'REQUESTED_QTY_INVALID', message: `Structure quantity ${structure.quantity} is not valid.` };
  }
  if (structure.legs.length === 0) {
    return { ok: false, ruleId: 'AMBIGUOUS_POSITION_STRUCTURE', message: 'Structure has no legs.' };
  }
  if (!(contractMultiplier > 0) || !Number.isFinite(contractMultiplier)) {
    return { ok: false, ruleId: 'CONTRACT_MULTIPLIER_INVALID', message: `Contract multiplier ${contractMultiplier} is not valid.` };
  }
  for (const leg of structure.legs) {
    if (leg.avgOpenPrice == null || !Number.isFinite(leg.avgOpenPrice)) {
      return { ok: false, ruleId: 'ENTRY_ECONOMICS_UNAVAILABLE', message: `Leg ${leg.symbol} is missing a valid entry price.` };
    }
  }

  // Signed net entry price, in POINTS (broker option-price units, e.g.
  // 0.60) -- NOT dollars. A short leg's premium is collected (+), a long
  // leg's premium is paid (-).
  const netPointsPerShare = structure.legs.reduce(
    (sum, l) => sum + (l.direction === 'Short' ? l.avgOpenPrice! : -l.avgOpenPrice!),
    0
  );
  if (netPointsPerShare === 0 || !Number.isFinite(netPointsPerShare)) {
    return {
      ok: false,
      ruleId: 'ENTRY_PRICE_EFFECT_INVALID',
      message: 'Entry economics net to exactly zero (or are non-finite) -- cannot determine credit or debit. Not substituting a floored $0.',
    };
  }

  // Points -> dollars: multiply by contractMultiplier exactly once, then by
  // quantity for the whole-position total.
  const entryPricePointsPerUnit = Math.abs(netPointsPerShare);
  const entryPriceEffect: PriceEffect = netPointsPerShare > 0 ? 'Credit' : 'Debit';
  const entryTotalCashFlowDollars = netPointsPerShare * contractMultiplier * structure.quantity;

  return {
    ok: true,
    identity: {
      key,
      underlying,
      expiration,
      structureType: structure.structureType,
      strategyLabel: strategyLabelForStructure(structure),
      quantity: structure.quantity,
      contractMultiplier,
      legs: structure.legs,
      entryPriceEffect,
      entryPricePointsPerUnit,
      entryTotalCashFlowDollars,
    },
  };
}

/** Break-even close price/effect: the exact mirror of the entry economics,
 *  in POINTS (the exact broker-submittable magnitude). A credit entry
 *  breaks even at a debit close of the same points magnitude, and vice
 *  versa -- this is what makes realized P/L come out to ~$0. */
export function computeBreakEvenClose(identity: CanonicalCloseIdentity): { pricePointsPerUnit: number; priceEffect: PriceEffect } {
  return {
    pricePointsPerUnit: Math.max(identity.entryPricePointsPerUnit, 0.01),
    priceEffect: identity.entryPriceEffect === 'Credit' ? 'Debit' : 'Credit',
  };
}

// ---------------------------------------------------------------------------
// Quote evidence
// ---------------------------------------------------------------------------

/** Net spread quote, in broker option-price POINTS (e.g. 0.60), matching
 *  `fetchCloseQuote`'s convention in app/portfolio/page.tsx: `netAsk` = the
 *  MARKETABLE ("fills fast") price (short legs @ ask, long legs @ bid);
 *  `netBid` = the PATIENT ("best price, may not fill") price (short legs @
 *  bid, long legs @ ask). Both can independently be either a net credit or
 *  net debit magnitude depending on market conditions -- the sign is not
 *  fixed by which side of the quote you're looking at. */
export interface QuoteEvidence {
  netBid: number | null;
  netAsk: number | null;
  netMid: number | null;
  /** Milliseconds since epoch when this quote was fetched, or null if unknown. */
  fetchedAtMs: number | null;
}

// ---------------------------------------------------------------------------
// Immutable submission plan
// ---------------------------------------------------------------------------

export interface OrderLegPayload {
  symbol: string;
  quantity: number;
  direction: LegDirection;
}

export interface ClosePlan {
  identity: CanonicalCloseIdentity;
  requestedQuantity: number;
  closeableQuantity: number;
  /** The exact legs, at the exact scaled quantities, the broker payload must
   *  contain. Every currently-supported structure has a 1:1 leg ratio, so
   *  each leg's payload quantity equals `requestedQuantity`. */
  legPayload: OrderLegPayload[];
  /** What the operator is trying to do -- preserved from the UI action that
   *  produced this plan, and used by the gate to apply intent-specific
   *  validation (e.g. BREAK_EVEN must net to ~$0) against THIS plan. */
  pricingIntent: PricingIntent;
  requestedClosePriceEffect: PriceEffect;
  /** Broker option-price POINTS per contract (e.g. 0.30) -- this IS the
   *  exact number to submit as the broker's `price` field. NEVER dollars. */
  closePricePointsPerUnit: number;
  /** Signed DOLLARS for the REQUESTED quantity: positive = you receive
   *  money closing, negative = you pay money closing. */
  closeTotalCashFlowDollars: number;
  /** Prorated entry cash flow (dollars, for requestedQuantity) +
   *  closeTotalCashFlowDollars. */
  expectedRealizedPnlDollars: number;
}

export type PlanBuildFailure = { ok: false; ruleId: SafetyRuleId; message: string };
export type PlanBuildResult = { ok: true; plan: ClosePlan } | PlanBuildFailure;

function isTickValid(pricePoints: number): boolean {
  // Simplified cent-denomination check -- this codebase has no verified
  // record of TastyTrade's full price-tiered tick schedule, so this checks
  // only that the price is an exact whole number of cents (never sub-penny),
  // which is the one tick rule `buildCloseOrder`'s existing `.toFixed(2)`
  // convention already assumes everywhere else in the app.
  return Math.abs(Math.round(pricePoints * 100) - pricePoints * 100) < 1e-6;
}

/**
 * Builds the one immutable plan the confirmation UI renders and the broker
 * payload is derived from. Validates quantity, price, and tick; does NOT
 * validate quote evidence or cross-check against an actual order body --
 * that is `runLiveCloseOrderSafetyGate`'s job, which calls this internally.
 */
export function buildClosePlan(
  identity: CanonicalCloseIdentity,
  requestedQuantity: number,
  closeableQuantity: number,
  closePricePointsPerUnit: number,
  requestedClosePriceEffect: PriceEffect,
  pricingIntent: PricingIntent = 'CUSTOM'
): PlanBuildResult {
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0 || !Number.isInteger(requestedQuantity)) {
    return { ok: false, ruleId: 'REQUESTED_QTY_INVALID', message: `Requested quantity ${requestedQuantity} must be a positive integer.` };
  }
  if (requestedQuantity > closeableQuantity) {
    return { ok: false, ruleId: 'REQUESTED_QTY_EXCEEDS_POSITION', message: `Requested quantity ${requestedQuantity} exceeds closeable quantity ${closeableQuantity}.` };
  }
  if (!Number.isFinite(closePricePointsPerUnit) || closePricePointsPerUnit <= 0) {
    return { ok: false, ruleId: 'LIMIT_PRICE_INVALID', message: `Close price ${closePricePointsPerUnit} must be a positive, finite number of points.` };
  }
  if (!isTickValid(closePricePointsPerUnit)) {
    return { ok: false, ruleId: 'LIMIT_TICK_INVALID', message: `Close price ${closePricePointsPerUnit} is not a valid cent-denominated points price.` };
  }
  if (requestedClosePriceEffect !== 'Credit' && requestedClosePriceEffect !== 'Debit') {
    // Defensive: TypeScript's PriceEffect union prevents this at compile
    // time, but a dynamically-constructed caller (or a JS consumer) could
    // still pass an invalid value -- never assume, always validate.
    return { ok: false, ruleId: 'CLOSE_PRICE_EFFECT_INVALID', message: `Close price effect '${requestedClosePriceEffect}' must be 'Credit' or 'Debit'.` };
  }

  // Every currently-supported structure (NAKED / VERTICAL / IRON_CONDOR) has
  // a canonical leg ratio of 1:1 -- each leg's payload quantity is exactly
  // the requested spread quantity.
  const legPayload: OrderLegPayload[] = identity.legs.map(l => ({
    symbol: l.symbol,
    quantity: requestedQuantity,
    direction: l.direction,
  }));

  // Points -> dollars: multiply by contractMultiplier exactly once, then by
  // requestedQuantity. Never re-apply contractMultiplier to a value that has
  // already been converted to dollars (the round-1-corrective defect).
  const closeCashFlowPerUnitPoints = requestedClosePriceEffect === 'Credit' ? closePricePointsPerUnit : -closePricePointsPerUnit;
  const closeTotalCashFlowDollars = closeCashFlowPerUnitPoints * requestedQuantity * identity.contractMultiplier;

  const entryCashFlowPerUnitPoints = identity.entryPriceEffect === 'Credit' ? identity.entryPricePointsPerUnit : -identity.entryPricePointsPerUnit;
  const entryCashFlowForRequestedDollars = entryCashFlowPerUnitPoints * requestedQuantity * identity.contractMultiplier;

  const expectedRealizedPnlDollars = entryCashFlowForRequestedDollars + closeTotalCashFlowDollars;

  return {
    ok: true,
    plan: {
      identity,
      requestedQuantity,
      closeableQuantity,
      legPayload,
      pricingIntent,
      requestedClosePriceEffect,
      closePricePointsPerUnit,
      closeTotalCashFlowDollars,
      expectedRealizedPnlDollars,
    },
  };
}

/** Convenience: builds the break-even plan for the full closeable quantity,
 *  tagged with `pricingIntent: 'BREAK_EVEN'`. */
export function buildBreakEvenPlan(identity: CanonicalCloseIdentity, closeableQuantity = identity.quantity): PlanBuildResult {
  const be = computeBreakEvenClose(identity);
  return buildClosePlan(identity, closeableQuantity, closeableQuantity, be.pricePointsPerUnit, be.priceEffect, 'BREAK_EVEN');
}

// ---------------------------------------------------------------------------
// Safety validation gate
// ---------------------------------------------------------------------------

export type SafetyRuleId =
  | 'AMBIGUOUS_POSITION_STRUCTURE'
  | 'ENTRY_ECONOMICS_UNAVAILABLE'
  | 'ENTRY_PRICE_EFFECT_INVALID'
  | 'CLOSE_PRICE_EFFECT_INVALID'
  | 'CONTRACT_MULTIPLIER_INVALID'
  | 'LEG_IDENTITY_MISMATCH'
  | 'LEG_RATIO_MISMATCH'
  | 'REQUESTED_QTY_INVALID'
  | 'REQUESTED_QTY_EXCEEDS_POSITION'
  | 'PAYLOAD_QUANTITY_MISMATCH'
  | 'PAYLOAD_LIMIT_PRICE_MISMATCH'
  | 'PAYLOAD_PRICE_EFFECT_MISMATCH'
  | 'LIMIT_PRICE_INVALID'
  | 'LIMIT_TICK_INVALID'
  | 'QUOTE_MISSING'
  | 'QUOTE_INVALID'
  | 'QUOTE_CROSSED'
  | 'QUOTE_STALE_UNCONFIRMED'
  | 'BREAK_EVEN_PNL_MISMATCH'
  | 'DISPLAY_PAYLOAD_ECONOMICS_MISMATCH'
  | 'MATERIAL_PNL_DEVIATION'
  | 'ENTRY_DEBIT_POSITIONS_UNSUPPORTED_LIVE';

export interface SafetyCheckIssue {
  ruleId: SafetyRuleId;
  /** Every rule in this gate is a hard block. There is no warn-only path for
   *  a structural or economics defect. The only "soft" condition (a
   *  stale-but-otherwise-valid quote) is handled by requiring an explicit
   *  confirmation flag rather than by downgrading it to a non-blocking
   *  warning. */
  severity: 'block';
  message: string;
}

export interface SafetyCheckResult {
  ok: boolean;
  issues: SafetyCheckIssue[];
  /** Populated only when `ok` is true -- the one plan the UI and the broker
   *  payload must both be built from. */
  plan?: ClosePlan;
}

/** The actual broker order about to be submitted -- REQUIRED (not optional)
 *  on a live gate input, so it can never be silently omitted. Every field a
 *  live cross-check needs lives here, in the same points/effect units as
 *  the plan it is checked against. */
export interface ActualBrokerOrderEvidence {
  legs: OrderLegPayload[];
  /** Broker option-price POINTS per contract -- must equal the plan's
   *  `closePricePointsPerUnit` exactly (within float tolerance). */
  limitPricePointsPerUnit: number;
  priceEffect: PriceEffect;
  orderType?: string;
  timeInForce?: string;
}

/**
 * The discriminated input for a LIVE close/roll/stop-loss submission. Quote
 * evidence, the actual broker order, and the displayed P/L are all REQUIRED
 * keys (not `?:` optional) specifically so a caller cannot omit them and
 * silently bypass validation the way round-1-corrective's optional
 * `actualOrderLegs`/`displayedExpectedPnl`/`liveClosePricePerUnit` could.
 * `quote` may still be explicitly `null` (meaning "no quote could be
 * fetched") -- that is a deliberate, validated value, not an omission.
 *
 * Non-live/preview calculations (e.g. a batch-modal row's advisory display
 * before final submission) should use `buildClosePlan` directly rather than
 * this type -- do not loosen these fields to make a preview path convenient;
 * add a separate preview function instead.
 */
export interface LiveCloseOrderSafetyInput {
  identity: CanonicalCloseIdentity;
  requestedQuantity: number;
  closeableQuantity: number;
  pricingIntent: PricingIntent;
  requestedClosePriceEffect: PriceEffect;
  /** Broker option-price POINTS per contract -- NEVER dollars. */
  closePricePointsPerUnit: number;
  quote: QuoteEvidence | null;
  /** Required whenever `quote` is present and its age exceeds
   *  `maxQuoteAgeMs` -- true only if the user has explicitly confirmed they
   *  want to proceed on stale evidence. */
  staleQuoteConfirmed?: boolean;
  maxQuoteAgeMs?: number;
  nowMs?: number;
  actualOrder: ActualBrokerOrderEvidence;
  displayedExpectedPnlDollars: number;
  /** Tolerance for P/L cross-checks, in dollars. Defaults to 1 cent. */
  pnlToleranceDollars?: number;
  /** Defaults to 0.30 (30%). */
  materialDeviationThresholdPct?: number;
}

const DEFAULT_MAX_QUOTE_AGE_MS = 5 * 60 * 1000;
const DEFAULT_PNL_TOLERANCE = 0.01;
const DEFAULT_MATERIAL_DEVIATION_THRESHOLD = 0.30;
const DEFAULT_TICK_TOLERANCE_POINTS = 0.01;

/** Derives the applicable marketable close price (points) from required
 *  quote evidence and the requested close price effect, matching
 *  `fetchCloseQuote`'s documented convention in app/portfolio/page.tsx: a
 *  Debit close is marketable at the ask side (`netAsk`, "fills fast" -- pay
 *  more to guarantee the fill); a Credit close is marketable at the bid side
 *  (`netBid` -- receive less to guarantee the fill). Returns null when the
 *  applicable side is missing (the quote-validation step below independently
 *  blocks that case). */
function deriveMarketablePricePoints(quote: QuoteEvidence, effect: PriceEffect): number | null {
  const side = effect === 'Debit' ? quote.netAsk : quote.netBid;
  return side != null && Number.isFinite(side) ? Math.abs(side) : null;
}

/**
 * The single entry point that must run before ANY live close/roll/stop-loss
 * order is submitted. Builds the immutable plan and validates every
 * structural, economics, quantity, price, quote, and actual-broker-payload
 * invariant. Every failure is a hard block -- there is no warning-only path.
 * `quote`/`actualOrder`/`displayedExpectedPnlDollars` are required fields on
 * `LiveCloseOrderSafetyInput`, so this function never has to guess whether a
 * missing value means "not checked" versus "intentionally absent" -- `quote`
 * is the only one of the three allowed to be explicitly `null`, and that is
 * treated as QUOTE_MISSING, never silently skipped.
 */
export function runLiveCloseOrderSafetyGate(input: LiveCloseOrderSafetyInput): SafetyCheckResult {
  const issues: SafetyCheckIssue[] = [];
  const push = (ruleId: SafetyRuleId, message: string) => issues.push({ ruleId, severity: 'block', message });

  // Debit-opened positions: the pure identity/plan/break-even math below
  // correctly supports both directions (see the corrective-round-2 test
  // suite), but app/portfolio/page.tsx's surrounding default-price/GTC/stop
  // computations are not yet wired to derive a Credit close for a
  // debit-opened position -- they assume credit-at-entry throughout. Rather
  // than claim support that does not actually exist in the production path,
  // this is hard-blocked here until that wiring is done.
  if (input.identity.entryPriceEffect === 'Debit') {
    push('ENTRY_DEBIT_POSITIONS_UNSUPPORTED_LIVE', 'This position was opened for a net debit. Live close/roll/stop-loss submission for debit-opened positions is not yet supported by this UI (the surrounding default-price computations assume a credit entry) -- close this position manually at the broker.');
    return { ok: false, issues };
  }

  // Quote evidence -- `== null` deliberately catches BOTH `null` (explicit
  // "no quote available") and `undefined` (a caller bypassing the required
  // type, e.g. via `as any`), so an omitted/undefined quote can never
  // silently skip validation.
  let marketablePricePoints: number | null = null;
  if (input.quote == null) {
    push('QUOTE_MISSING', 'No quote is available to calculate marketable close economics.');
  } else {
    const { netBid, netAsk, fetchedAtMs } = input.quote;
    if (netBid == null || netAsk == null) {
      push('QUOTE_MISSING', 'Quote is missing a bid or ask needed to calculate marketable close economics.');
    } else if (!Number.isFinite(netBid) || !Number.isFinite(netAsk) || netBid < 0 || netAsk < 0) {
      push('QUOTE_INVALID', `Quote bid/ask (${netBid}, ${netAsk}) is not a valid non-negative finite value.`);
    } else if (netBid > netAsk) {
      push('QUOTE_CROSSED', `Quote is crossed: bid ${netBid} > ask ${netAsk}.`);
    } else {
      const maxAge = input.maxQuoteAgeMs ?? DEFAULT_MAX_QUOTE_AGE_MS;
      const now = input.nowMs ?? Date.now();
      const age = fetchedAtMs != null ? now - fetchedAtMs : null;
      if (age != null && age > maxAge && !input.staleQuoteConfirmed) {
        push('QUOTE_STALE_UNCONFIRMED', `Quote is ${Math.round(age / 1000)}s old (limit ${Math.round(maxAge / 1000)}s) and has not been explicitly confirmed by the user.`);
      } else {
        marketablePricePoints = deriveMarketablePricePoints(input.quote, input.requestedClosePriceEffect);
      }
    }
  }

  const planResult = buildClosePlan(
    input.identity,
    input.requestedQuantity,
    input.closeableQuantity,
    input.closePricePointsPerUnit,
    input.requestedClosePriceEffect,
    input.pricingIntent
  );
  if (!planResult.ok) {
    push(planResult.ruleId, planResult.message);
    return { ok: false, issues };
  }
  const plan = planResult.plan;

  // Break-even validation: when the operator's DECLARED intent is
  // BREAK_EVEN, validate the ACTUAL plan being submitted -- its close price
  // must equal the identity's computed break-even points (within tick
  // tolerance) and its expected P/L must be ~$0. This checks the real
  // submission, not a disconnected theoretical plan built purely as a
  // self-test.
  if (input.pricingIntent === 'BREAK_EVEN') {
    const be = computeBreakEvenClose(input.identity);
    const priceMatches = Math.abs(plan.closePricePointsPerUnit - be.pricePointsPerUnit) <= DEFAULT_TICK_TOLERANCE_POINTS;
    const effectMatches = plan.requestedClosePriceEffect === be.priceEffect;
    const pnlTolerance = input.pnlToleranceDollars ?? DEFAULT_PNL_TOLERANCE;
    const pnlNearZero = Math.abs(plan.expectedRealizedPnlDollars) <= pnlTolerance;
    if (!priceMatches || !effectMatches || !pnlNearZero) {
      push('BREAK_EVEN_PNL_MISMATCH', `Declared intent is BREAK_EVEN but the actual plan (close ${plan.closePricePointsPerUnit} ${plan.requestedClosePriceEffect}, expected P/L $${plan.expectedRealizedPnlDollars.toFixed(4)}) does not match the computed break-even (${be.pricePointsPerUnit} ${be.priceEffect}, ~$0).`);
    }
  }

  // Actual-broker-order cross-checks -- required field, always checked.
  {
    const expected = plan.legPayload;
    const actual = input.actualOrder.legs;
    if (expected.length !== actual.length || !expected.every(el => actual.some(al => al.symbol === el.symbol && al.direction === el.direction))) {
      push('LEG_IDENTITY_MISMATCH', 'The broker payload legs do not match the plan\'s exact OCC symbols/directions.');
    } else {
      for (const el of expected) {
        const al = actual.find(a => a.symbol === el.symbol && a.direction === el.direction);
        if (!al) continue;
        if (al.quantity !== el.quantity) {
          push('PAYLOAD_QUANTITY_MISMATCH', `Leg ${el.symbol} payload quantity ${al.quantity} does not match the plan's ${el.quantity}.`);
        }
      }
      if (actual.some(al => al.quantity !== input.requestedQuantity)) {
        push('LEG_RATIO_MISMATCH', 'One or more broker-payload legs do not scale 1:1 with the requested spread quantity.');
      }
    }

    if (Math.abs(input.actualOrder.limitPricePointsPerUnit - plan.closePricePointsPerUnit) > DEFAULT_TICK_TOLERANCE_POINTS) {
      push('PAYLOAD_LIMIT_PRICE_MISMATCH', `Broker payload limit price ${input.actualOrder.limitPricePointsPerUnit} points does not match the plan's ${plan.closePricePointsPerUnit} points.`);
    }
    if (input.actualOrder.priceEffect !== plan.requestedClosePriceEffect) {
      push('PAYLOAD_PRICE_EFFECT_MISMATCH', `Broker payload price effect '${input.actualOrder.priceEffect}' does not match the plan's '${plan.requestedClosePriceEffect}'.`);
    }
  }

  // Displayed P/L cross-check -- required field, always checked.
  {
    const tolerance = input.pnlToleranceDollars ?? DEFAULT_PNL_TOLERANCE;
    if (Math.abs(input.displayedExpectedPnlDollars - plan.expectedRealizedPnlDollars) > tolerance) {
      push('DISPLAY_PAYLOAD_ECONOMICS_MISMATCH', `Displayed P/L ($${input.displayedExpectedPnlDollars}) does not match the plan's computed P/L ($${plan.expectedRealizedPnlDollars.toFixed(2)}).`);
    }
  }

  // Marketable price-drift check -- ALWAYS runs for a live plan (no longer
  // gated behind an optional caller-supplied value), derived from the same
  // required quote evidence validated above.
  if (marketablePricePoints != null && marketablePricePoints > 0) {
    const threshold = input.materialDeviationThresholdPct ?? DEFAULT_MATERIAL_DEVIATION_THRESHOLD;
    const pctFromMarketable = Math.abs(plan.closePricePointsPerUnit - marketablePricePoints) / marketablePricePoints;
    if (pctFromMarketable > threshold) {
      push('MATERIAL_PNL_DEVIATION', `Plan close price ${plan.closePricePointsPerUnit} points deviates ${(pctFromMarketable * 100).toFixed(0)}% from the marketable price ${marketablePricePoints.toFixed(2)} points (limit ${(threshold * 100).toFixed(0)}%).`);
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, issues: [], plan };
}

/**
 * Convenience wrapper for the "structure is ambiguous / unsupported" case,
 * which happens BEFORE a `CanonicalCloseIdentity` can even be built (there is
 * no single structure to build one from). Every consumer must check this
 * before attempting `buildCanonicalCloseIdentity`.
 */
export function structureAnalysisToBlockingIssue(result: StructureAnalysisResult): SafetyCheckIssue | null {
  if (result.status === 'AMBIGUOUS') {
    const detail = result.ambiguousBuckets
      .map(b => `${b.optionType} qty=${b.quantity}: ${b.shorts.length} short / ${b.longs.length} long leg(s)`)
      .join('; ');
    return {
      ruleId: 'AMBIGUOUS_POSITION_STRUCTURE',
      severity: 'block',
      message: `Cannot determine a single defensible position structure -- more than one valid pairing exists (${detail}). Close/Roll/Take Profit/Cut Losses/Snap to Break Even/Stop Loss are disabled for this group until resolved manually.`,
    };
  }
  if (result.status === 'UNSUPPORTED') {
    return {
      ruleId: 'AMBIGUOUS_POSITION_STRUCTURE',
      severity: 'block',
      message: `${result.unsupportedLegs.length} leg(s) have an invalid or zero quantity and cannot be assigned to any supported structure.`,
    };
  }
  return null;
}
