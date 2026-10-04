// lib/discovery/qv/policy.ts

// LEAPS-QV-0001 Gate 3 -- the QV-v1.0 underlying-strategy POLICY, in one place.
//
// Every threshold, band edge, count and metric id the QV-v1.0 classifiers use is defined here and nowhere else.
// The classifiers import this object; routes, UI and provider adapters never carry a copy (a test enforces that the
// classifier files contain no numeric literals). The policy belongs to strategy QV-v1.0: changing any value is an
// investment-logic change and therefore an intentional new strategy version (Section 7). A test pins the
// fingerprint of this object so a silent edit fails loudly.
//
// Provenance of the values:
//   SPEC        -- stated by name in Section 45 (the authoritative Gate 3 specification).
//   ASSUMPTION  -- Section 45 uses a qualitative term ("materially", "unusually", "approaching") without a number or
//                  rule. The value below is the narrowest deterministic reading, recorded in QV_V1_0_ASSUMPTIONS and
//                  listed in the Gate 3 completion report for Ian's ratification. Nothing here is a hidden proxy.

import { QV_V1_0_VERSION } from '../qvIdentity';
import { deepFreeze } from '../util';

export const QV_POLICY_VERSION = QV_V1_0_VERSION;

export const QV_V1_0_POLICY = deepFreeze({
  version: QV_POLICY_VERSION,

  // ---- 45.3 Quality -------------------------------------------------------------------------------------------
  quality: {
    // SPEC: revenue durability, 5Y revenue CAGR (percent)
    revenueCagrStrongMinPct: 5,
    revenueCagrAcceptableMinPct: 0,
    // SPEC: operating_margin_ttm > 0 is required for the ordinary profitable-company universe
    operatingMarginRequiredAbovePct: 0,
    // SPEC: ROIC-v1 evidence bands (percent)
    roicStrongMinPct: 15,
    roicAcceptableMinPct: 10,
    // SPEC: Net Debt / EBITDA bands (multiple)
    leverageStrongMax: 1,
    leverageAcceptableMax: 2,
    leverageElevatedMax: 3,
    // ASSUMPTION A3: annual points examined to tell persistent / deteriorating / isolated negative FCF apart
    fcfHistoryYears: 3,
    // ASSUMPTION A3: this many negative points among those years (with TTM negative) is persistent, not isolated
    fcfPersistentNegativePoints: 2,
    // ASSUMPTION A4: material Quality weaknesses (revenue WEAK, ROIC WEAK, FCF persistent / deteriorating,
    // leverage HIGH) that fail Quality on their own. HIGH leverage plus any ONE other weakness fails (SPEC).
    materialWeaknessFailCount: 2,
    leverageHighWithOtherWeaknessFailCount: 1,
  },

  // ---- 45.4 Valuation dislocation -----------------------------------------------------------------------------
  valuation: {
    // SPEC: STRONG when 5Y P/E percentile <= 20 OR discount to 5Y median >= 20%
    percentileStrongMax: 20,
    discountStrongMinPct: 20,
    // SPEC: MODERATE when percentile in (20, 35] OR discount in [10%, 20%)
    percentileModerateMax: 35,
    discountModerateMinPct: 10,
  },

  // ---- 45.5-45.7 Fundamental trajectory ------------------------------------------------------------------------
  fundamentals: {
    // SPEC: "at least three evaluable fundamental dimensions should normally exist for confident classification"
    minEvaluableDimensions: 3,
    // SPEC: growth-adjusted valuation: MIXED = one important dimension deteriorates, DETERIORATING = at least two
    growthAdjustedMixedDimensions: 1,
    growthAdjustedDeterioratingMinDimensions: 2,
    // SPEC: hard thesis break = at least three major dimensions materially deteriorate concurrently
    thesisBreakMinDimensions: 3,
    // SPEC: momentum DETERIORATING = multiple independent dimensions continue worsening (multiple = at least two)
    momentumDeterioratingMinDimensions: 2,
    // ASSUMPTION A2: operating margin must move by more than this many percentage points YEAR OVER YEAR to count as
    // deteriorating or improving (a smaller move is STABLE). Revenue / EPS use direction against their own 5Y trend.
    marginMaterialChangePp: 1,
  },

  // ---- 45.8 Technical state -----------------------------------------------------------------------------------
  technical: {
    // ASSUMPTION A5: weekly RSI at or below this level is "unusually depressed" (the conventional oversold line)
    weeklyRsiDepressedMax: 30,
    // ASSUMPTION A5: DECLINING needs at least this many INDEPENDENT bearish indicator families (Section 45.8 "multiple trend
    // indicators"). Families: RSI momentum, SMA50 relationship, SMA200 trend, relative strength. Two RSI-derived readings
    // (slope, 4-week change) are one family, not two confirmations.
    decliningMinBearishFamilies: 2,
  },

  // ---- 45.9 Risk ----------------------------------------------------------------------------------------------
  risk: {
    // ASSUMPTION A6: ordinary earnings proximity is flagged (never disqualifying) when the report is this close
    earningsApproachingMaxDays: 14,
  },

  // ---- Normalized metric ids the QV-v1.0 classifiers read (Section 6 rule: normalized metrics only) -----------------
  inputs: {
    quality: {
      operatingMargin: 'operating_margin_ttm_pct',
      revenueCagr: 'revenue_cagr_5y_pct',
      fcf: 'fcf_ttm',
      // GATE 3 DATA LIMITATION: the SEC adapter exposes per-year FCF only as a side output (annualSeries), not as a
      // normalized metric. This id is the contract a future normalizer must satisfy (value: annual FCF numbers, oldest
      // first, consecutive fiscal years). Until it exists it is UNAVAILABLE and negative-FCF companies are
      // INSUFFICIENT_DATA rather than guessed at. Reported in the Gate 3 completion report.
      fcfHistory: 'fcf_annual_history_5y',
      roic: 'roic_v1_pct',
      leverage: 'net_debt_to_ebitda',
    },
    valuation: {
      pe: 'pe_ttm',
      percentile5y: 'pe_ttm_percentile_5y',
      percentile3y: 'pe_ttm_percentile_3y',
      discount5y: 'pe_ttm_discount_to_median_5y_pct',
      discount3y: 'pe_ttm_discount_to_median_3y_pct',
    },
    fundamentals: {
      revenueGrowth: 'revenue_growth_yoy_ttm_pct',
      revenueTrend: 'revenue_cagr_5y_pct',
      epsGrowth: 'eps_growth_yoy_ttm_pct',
      epsTrend: 'eps_cagr_5y_pct',
      marginChange: 'operating_margin_change_yoy_pp',
      fcf: 'fcf_ttm',
      fcfHistory: 'fcf_annual_history_5y',
    },
    technical: {
      weeklyRsi: 'rsi_weekly_14',
      weeklyRsiChange: 'rsi_weekly_change_4w',
      price: 'price_last_close',
      sma50: 'sma_50',
      sma200: 'sma_200',
      sma200Trend: 'sma_200_change_20d_pct',
      relativeStrength: 'relative_return_126d_vs_benchmark_pct',
      // GATE 3 DATA LIMITATION (review correction 1): Section 45.8 needs DIRECTION evidence the normalized catalog does not
      // produce today. These are the contract ids a future normalizer must satisfy; until then they are UNAVAILABLE and the
      // affected classification fails closed (no proxy is substituted for any of them).
      //   weeklyRsiSlope        weekly RSI now minus 1 week ago (distinct from the 4-week change above)
      //   sma50GapChange        change over 4 weeks in the price-vs-SMA50 gap, percentage points (positive = improving)
      //   relativeStrengthChange change over 4 weeks in the 126d relative return vs SPY, percentage points (negative = worsening)
      weeklyRsiSlope: 'rsi_weekly_slope_1w',
      sma50GapChange: 'price_vs_sma50_gap_change_4w_pp',
      relativeStrengthChange: 'relative_return_126d_change_4w_pp',
      // supporting evidence only: carried on the state reason, never required, never decisive
      monthlyRsi: 'rsi_monthly_14',
      distanceFrom52wHigh: 'distance_from_52w_high_pct',
    },
    risk: {
      daysToEarnings: 'days_to_next_earnings',
      eventFlags: 'corporate_event_flags',
    },
    // Section 15: optional. Reported explicitly UNAVAILABLE when absent; never neutral; never blocks.
    analystRevisions: ['analyst_eps_revision_90d_pct', 'analyst_revenue_revision_90d_pct', 'analyst_revision_breadth_90d'],
  },
});

export type QvPolicy = typeof QV_V1_0_POLICY;

// ---------------------------------------------------------------------------------------------------------------------
// Assumptions: every place Section 45 is qualitative. Surfaced to Ian; none is a silent proxy.
// ---------------------------------------------------------------------------------------------------------------------

/** DIRECT = the reading follows Section 45 text; POLICY = Section 45 is silent or qualitative and an investment decision is embedded; DATA = a limitation of today's normalized evidence. */
export type AssumptionBasis = 'DIRECT' | 'POLICY' | 'DATA';

export interface QvAssumption {
  readonly id: string;
  readonly area: string;
  readonly specGap: string;
  readonly reading: string;
  readonly basis: AssumptionBasis;
  /** What part is a direct reading and what part needs an investment-policy decision. */
  readonly policyQuestion: string;
  /** RATIFIED only where an actual Ian/Paul ruling is recorded in the ticket (Gate 3 review round 4); this code never ratifies anything itself. */
  readonly ratification: 'RATIFIED' | 'NOT_REVIEWED';
  /** Where the ruling is recorded (null when NOT_REVIEWED). */
  readonly ratificationRecord: string | null;
}

const RATIFIED_ROUND_4 = 'LEAPS-QV-0001 Gate 3 review round 4 (Ian/Paul rulings, ticket ledger)';

export const QV_V1_0_ASSUMPTIONS: readonly QvAssumption[] = deepFreeze([
  {
    id: 'A1',
    area: 'Revenue / EPS trajectory ("materially deteriorating")',
    specGap: 'Section 45.5-45.7 names the dimensions but gives no materiality figure or reference.',
    reading:
      'RATIFIED. Current negative growth is DETERIORATING regardless of the 5Y trend (-2 against -5 is DETERIORATING, not STABLE; also when the trend is unavailable). Non-negative growth above the trend is IMPROVING, otherwise STABLE. Positive growth below trend is NOT automatically DETERIORATING; the slowdown is reported separately as FUNDAMENTAL_GROWTH_SLOWDOWN_CONTEXT with no invented threshold. Non-negative growth with no trend reference is NOT_EVALUABLE: missing evidence never establishes stability.',
    basis: 'POLICY',
    policyQuestion: 'None open: negative current growth is DETERIORATING; slowdown context is reported separately.',
    ratification: 'RATIFIED',
    ratificationRecord: RATIFIED_ROUND_4,
  },
  {
    id: 'A2',
    area: 'Operating-margin trajectory',
    specGap: 'No materiality figure for margin change.',
    reading: 'RATIFIED. Change < -1 pp is DETERIORATING; -1 pp through +1 pp inclusive is STABLE; change > +1 pp is IMPROVING (policy.fundamentals.marginMaterialChangePp = 1).',
    basis: 'POLICY',
    policyQuestion: 'None open: 1 pp ratified.',
    ratification: 'RATIFIED',
    ratificationRecord: RATIFIED_ROUND_4,
  },
  {
    id: 'A3',
    area: 'Free-cash-flow pattern (persistent / deteriorating / isolated)',
    specGap: 'Section 45.3 names the three patterns without defining them.',
    reading:
      'RATIFIED. Level (from TTM) is POSITIVE / BREAKEVEN / NEGATIVE; zero is BREAKEVEN, never negative. Historical trajectory uses ANNUAL non-overlapping fiscal-year observations only (last policy.quality.fcfHistoryYears); TTM overlaps the latest fiscal year and is never counted as another annual observation. PERSISTENT negative = NEGATIVE level and negative FCF in at least two non-overlapping annual periods of the three-year window. NEGATIVE level with strictly falling annual history = DETERIORATING; otherwise isolated/temporary. NEGATIVE level without annual history is NOT_EVALUABLE (fail closed). Annual FCF history is a data limitation (inputs.quality.fcfHistory) until Gate 2c.',
    basis: 'POLICY',
    policyQuestion: 'None open for QV-v1.0. Data dependency: annual FCF history (Gate 2c, authorized, not implemented).',
    ratification: 'RATIFIED',
    ratificationRecord: RATIFIED_ROUND_4,
  },
  {
    id: 'A4',
    area: 'Quality PASS composition',
    specGap: 'Section 45.3 fixes only the operating-margin requirement and the HIGH-leverage-plus-weakness rule.',
    reading:
      'RATIFIED. Quality FAILS on non-positive operating margin, on HIGH leverage plus another material weakness, and on two or more material weaknesses (revenue WEAK, ROIC WEAK, FCF persistent/deteriorating, leverage HIGH). One weak ROIC or revenue dimension alone does not fail. Quality PASS requires all five aspects evaluable.',
    basis: 'POLICY',
    policyQuestion: 'None open.',
    ratification: 'RATIFIED',
    ratificationRecord: RATIFIED_ROUND_4,
  },
  {
    id: 'A5',
    area: 'Technical-state confluence',
    specGap: 'Section 45.8 states the confluence requirements; "no longer accelerating", "unusually depressed" and "multiple" have no numeric definition.',
    reading:
      'RATIFIED. STABILIZING = weekly RSI slope not negative AND 4-week RSI change non-negative AND relative strength no longer deteriorating (4-week relative-strength change >= 0; Option A, no second-difference/acceleration metric in QV-v1.0). RECOVERING needs relative-strength change > 0. RECOVERING = weekly RSI slope positive AND 4-week change positive AND price-vs-SMA50 gap improving AND relative-strength change positive (SPEC list). Levels are never read as directions. The slope, SMA50-gap change and relative-strength change are not produced by the normalizer today: they are UNAVAILABLE and the affected state fails closed. DECLINING needs at least two distinct bearish feature groups (RSI momentum, SMA50 relationship, SMA200 trend, relative strength; distinct measurements, not statistically independent). OVERSOLD = weekly RSI at or below the depressed line AND at least one non-RSI bearish group, stabilization not established, DECLINING not established; RSI alone never produces OVERSOLD. The four investment states are DECLINING / OVERSOLD / STABILIZING / RECOVERING; NOT_ESTABLISHED is an evaluation result for evidence that establishes none of them (evaluable, requirement unmet, WATCH), not a fifth investment state. Price convention: split-adjusted, dividend-unadjusted price returns for both stock and SPY (an explicit QV-v1.0 price-return convention, not a claim that dividends are immaterial). Unavailable direction evidence with nothing independently established is NOT_EVALUABLE.',
    basis: 'POLICY',
    policyQuestion:
      'DIRECT: the STABILIZING/RECOVERING indicator lists. POLICY (ratified): relative strength no longer deteriorating (>= 0); the OVERSOLD line (weekly RSI <= 30) with non-RSI confirmation; two distinct bearish groups make DECLINING. Open engineering/data: the lookback definitions of the three direction metrics (Gate 2c, authorized, not implemented).',
    ratification: 'RATIFIED',
    ratificationRecord: RATIFIED_ROUND_4,
  },
  {
    id: 'A6',
    area: 'Risk',
    specGap: 'Section 45.9 gives no proximity window and no event schema.',
    reading:
      'RATIFIED. Earnings within policy.risk.earningsApproachingMaxDays (14) days is informational (RISK_EARNINGS_APPROACHING), never disqualifying. A VALID, non-empty corporate_event_flags list is reliable material-event evidence and blocks SETUP / UNDERLYING ACTIONABLE. UNKNOWN event coverage stays explicitly UNKNOWN (risk gate NOT_EVALUABLE), is never VERIFIED_EMPTY, and does NOT cap the candidate at WATCH in QV-v1.0. The typed event schema is documented for later implementation; no event provider in Gate 3.',
    basis: 'POLICY',
    policyQuestion: 'None open for QV-v1.0. Later: typed event schema and provider (not Gate 3).',
    ratification: 'RATIFIED',
    ratificationRecord: RATIFIED_ROUND_4,
  },
  {
    id: 'A7',
    area: 'Leverage trajectory',
    specGap: 'Section 45.6 lists leverage as a fundamental dimension; TradeEdge has no prior-period leverage metric.',
    reading: 'RATIFIED as a data limitation: the leverage dimension is NOT_EVALUABLE until historical leverage exists; no proxy (never neutral). The level is judged under Quality only. With revenue, EPS and margin evaluable, three dimensions remain.',
    basis: 'DATA',
    policyQuestion: 'None until a prior-period leverage metric exists; then, what change is material.',
    ratification: 'RATIFIED',
    ratificationRecord: RATIFIED_ROUND_4,
  },
  {
    id: 'A8',
    area: 'WATCH versus DISCOVERED',
    specGap: 'Section 45.10 gives WATCH examples, not a rule.',
    reading:
      'RATIFIED. WATCH when Quality passes and the fundamental thesis is intact (not broken, growth-adjusted not DETERIORATING, momentum not DETERIORATING) but another SETUP requirement is unmet. DISCOVERED when Quality fails or the underlying evidence is materially weaker and no prior qualifying thesis exists. INVALIDATED applies only to a candidate previously in WATCH, SETUP or ACTIONABLE (Section 45.6 "previously active").',
    basis: 'POLICY',
    policyQuestion: 'None open.',
    ratification: 'RATIFIED',
    ratificationRecord: RATIFIED_ROUND_4,
  },
]);
