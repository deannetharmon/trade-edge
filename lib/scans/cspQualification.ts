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
  | 'DISQUALIFIED_EARNINGS';

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
export function isBestOpportunitiesEligible(
  marketQualification: CspMarketQualification,
  accountEligibility: CspAccountEligibility,
  modeQualification: CspModeQualification = 'NOT_APPLICABLE',
): boolean {
  return marketQualification === 'QUALIFIED'
    && isModeQualified(modeQualification)
    && accountEligibility === 'ELIGIBLE';
}
