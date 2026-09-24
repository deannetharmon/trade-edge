// lib/scans/cspQualification.ts
// CSP-WORKFLOW-0001 — explicit typed market-qualification, advisory-warning,
// and account-eligibility states, plus the relative liquidity classification
// policy approved to replace the flat $0.10 rule. See
// docs/reviews/FIND-CSP-Comprehensive-Code-Audit.md §23 for the audited
// state model this module implements, and the CSP-WORKFLOW-0001 ticket's
// "Liquidity policy" and "Required state separation" sections for the exact
// approved thresholds and state names.
//
// Deliberately pure and framework-free.

export type CspMarketQualification =
  | 'QUALIFIED'
  | 'QUALIFIED_WITH_LIQUIDITY_WARNING'
  | 'DISQUALIFIED_INVALID_QUOTE'
  | 'DISQUALIFIED_POOR_LIQUIDITY'
  | 'DISQUALIFIED_IVR'
  // CSP-IVR-0001 -- IV rank could not be determined, so the hard IVR cap cannot be verified. CSP is undefined-risk,
  // so an unverifiable cap fails closed. Kept distinct from DISQUALIFIED_IVR (the rank is known and above the cap):
  // "above the cap" and "could not be checked" are different claims and must stay separate through to the screen.
  | 'DISQUALIFIED_IVR_UNAVAILABLE'
  | 'DISQUALIFIED_EARNINGS'
  // CSP-WORKFLOW-RECONCILE-0002 — SQ-0001A foundation gate outcomes. Kept as
  // two distinct states (never collapsed into one another or into
  // DISQUALIFIED_IVR/EARNINGS) because an INELIGIBLE foundation thesis
  // (contradicted by evidence) and an INSUFFICIENT_EVIDENCE foundation
  // thesis (no evidence either way) are different claims and must stay
  // categorical all the way through to presentation.
  | 'DISQUALIFIED_FOUNDATION_INELIGIBLE'
  | 'DISQUALIFIED_FOUNDATION_INSUFFICIENT_EVIDENCE';

export type CspAccountEligibility =
  | 'ELIGIBLE'
  | 'INSUFFICIENT_CAPITAL'
  | 'CAPITAL_UNVERIFIED'
  | 'ACCOUNT_UNSELECTED'
  | 'STRATEGY_NOT_PERMITTED';

export type CspModeQualification = 'NOT_APPLICABLE' | 'PASSED' | 'FAILED';

export function isModeQualified(state: CspModeQualification): boolean {
  return state === 'NOT_APPLICABLE' || state === 'PASSED';
}

export function isOverallCspQualified(
  marketQualification: CspMarketQualification,
  modeQualification: CspModeQualification,
): boolean {
  return isMarketQualified(marketQualification) && isModeQualified(modeQualification);
}

export type CspLiquidityClass = 'STRONG' | 'BORDERLINE' | 'POOR';

export interface CspLiquidityThresholds {
  /** Dollar width at or below which liquidity is STRONG: max($0.10, 10% of midpoint). */
  strongLimitDollars: number;
  /** Dollar width at or below which liquidity is at worst BORDERLINE: max(strongLimit, 15% of midpoint). */
  poorLimitDollars: number;
}

export interface CspLiquidityClassification {
  liquidityClass: CspLiquidityClass;
  thresholds: CspLiquidityThresholds;
}

// Initial approved classification (CSP-WORKFLOW-0001):
//   strongLimit = max($0.10, 10% of midpoint)
//   width <= strongLimit                          -> STRONG
//   strongLimit < width <= 15% of midpoint         -> BORDERLINE
//   width > 15% of midpoint                        -> POOR
//
// Guard: when the midpoint is small enough that 15% of it is less than the
// dollar floor ($0.10 <= strongLimit always), the "borderline" band would
// otherwise be inverted (upper bound below lower bound). The poor threshold
// is therefore always taken as at least the strong threshold, so a
// candidate whose width sits between the two absolute-dollar figures is
// never misclassified as POOR merely because the underlying is cheap.
export function classifyCspLiquidity(widthDollars: number, midpoint: number): CspLiquidityClassification {
  const strongLimitDollars = Math.max(0.10, 0.10 * midpoint);
  const poorLimitDollars = Math.max(strongLimitDollars, 0.15 * midpoint);
  const liquidityClass: CspLiquidityClass =
    widthDollars <= strongLimitDollars ? 'STRONG'
    : widthDollars <= poorLimitDollars ? 'BORDERLINE'
    : 'POOR';
  return { liquidityClass, thresholds: { strongLimitDollars, poorLimitDollars } };
}

export interface CapitalInputs {
  /** The account-selection/capital-acquisition state — see classifyAccountEligibility. */
  requiredCash: number;
  /** min(broker-reported option buying power, broker-reported cash balance) for the SELECTED account, or null when unverified. */
  availableCspCapital: number | null;
  accountSelected: boolean;
  /** Set true only when broker/account evidence indicates the account cannot trade this strategy. Absent evidence must never produce this state. */
  strategyNotPermitted?: boolean;
}

// Account eligibility is evaluated independently of market qualification —
// a candidate can be a genuinely good, liquid, in-window put and still be
// INSUFFICIENT_CAPITAL or CAPITAL_UNVERIFIED. Missing capital data must
// never be treated as unlimited capital (no fail-open path exists here).
export function classifyAccountEligibility(inputs: CapitalInputs): CspAccountEligibility {
  if (!inputs.accountSelected) return 'ACCOUNT_UNSELECTED';
  if (inputs.strategyNotPermitted) return 'STRATEGY_NOT_PERMITTED';
  if (inputs.availableCspCapital == null || !Number.isFinite(inputs.availableCspCapital) || inputs.availableCspCapital < 0) {
    return 'CAPITAL_UNVERIFIED';
  }
  if (inputs.requiredCash > inputs.availableCspCapital) return 'INSUFFICIENT_CAPITAL';
  return 'ELIGIBLE';
}

export function isAccountActionable(eligibility: CspAccountEligibility): boolean {
  return eligibility === 'ELIGIBLE';
}

export function isMarketQualified(state: CspMarketQualification): boolean {
  return state === 'QUALIFIED' || state === 'QUALIFIED_WITH_LIQUIDITY_WARNING';
}

// Best Opportunities eligibility per CSP-WORKFLOW-0001: market-qualified
// (strong liquidity only, no warning), AND account-eligible, AND
// capital-verified. Borderline-liquidity candidates are explicitly excluded
// from Best Opportunities by default even though they remain visible
// elsewhere as QUALIFIED_WITH_LIQUIDITY_WARNING.
//
// CSP-BESTOPP-GATE-0001 (Ian) — delta-in-band is now a HARD requirement
// here, not advisory-only. A contract outside the preferred delta band used
// to still be eligible (surfaced only as warning text), which let a
// near-certain-assignment contract win the #1 Best Opportunities slot on
// score alone. It can still appear in the ordinary Qualified list with its
// warning; it just cannot be a "Best Opportunity."
//
// hasOpenInterest deliberately checks for LITERAL zero open interest, not
// "below the preferred OI_MIN." Those are different claims: OI below a
// round preference number (e.g. 245 of a 500 target) is a real, tradeable
// market the team has already approved as Best-Opportunities-eligible (see
// the AMD/NKE acceptance fixtures in app/screener/__tests__/
// CspCandidateDiscovery.test.tsx) — it stays advisory, unchanged. OI of
// exactly 0 means no market exists at all; a contract nobody can actually
// trade has no business being called a "top opportunity" regardless of
// score, so that case alone is gated here.
//
// Both new parameters default to `true` so every existing caller not yet
// passing them keeps its current behavior.
export function isBestOpportunitiesEligible(
  marketQualification: CspMarketQualification,
  accountEligibility: CspAccountEligibility,
  modeQualification: CspModeQualification = 'NOT_APPLICABLE',
  deltaTargetPassing = true,
  hasOpenInterest = true,
): boolean {
  return marketQualification === 'QUALIFIED'
    && isModeQualified(modeQualification)
    && accountEligibility === 'ELIGIBLE'
    && deltaTargetPassing
    && hasOpenInterest;
}
