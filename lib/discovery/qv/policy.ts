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
    // ASSUMPTION A5: DECLINING needs the falling weekly RSI plus at least this many OTHER bearish trend indicators
    decliningMinOtherBearish: 1,
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

export interface QvAssumption {
  readonly id: string;
  readonly area: string;
  readonly specGap: string;
  readonly reading: string;
}

export const QV_V1_0_ASSUMPTIONS: readonly QvAssumption[] = deepFreeze([
  {
    id: 'A1',
    area: 'Revenue / EPS trajectory ("materially deteriorating")',
    specGap: 'Section 45.5-45.7 names the dimensions but gives no materiality figure.',
    reading:
      'Growth is DETERIORATING when current TTM growth is negative and below the 5Y trend (or the trend is unavailable); IMPROVING when growth is non-negative and above the 5Y trend; otherwise STABLE. No invented percentage.',
  },
  {
    id: 'A2',
    area: 'Operating-margin trajectory',
    specGap: 'No materiality figure for margin change.',
    reading: 'Year-over-year change beyond +/- policy.fundamentals.marginMaterialChangePp percentage points; inside the band is STABLE.',
  },
  {
    id: 'A3',
    area: 'Free-cash-flow pattern (persistent / deteriorating / isolated)',
    specGap: 'Section 45.3 names the three patterns without defining them.',
    reading:
      'Over the last policy.quality.fcfHistoryYears annual points plus TTM: PERSISTENT = TTM and the latest year both negative, or two or more of the points negative; DETERIORATING = TTM negative after a strictly falling run; ISOLATED = a single negative period otherwise. FCF history is a data limitation (see inputs.quality.fcfHistory).',
  },
  {
    id: 'A4',
    area: 'Quality PASS composition',
    specGap: 'Section 45.3 fixes only the operating-margin requirement and the HIGH-leverage-plus-weakness rule.',
    reading:
      'Quality FAILS on non-positive operating margin; on HIGH leverage plus one other material weakness (SPEC); or on two or more material weaknesses (revenue WEAK, ROIC WEAK, FCF persistent/deteriorating, leverage HIGH). Quality needs all five aspects evaluable (durability, profitability, cash generation, balance sheet, capital efficiency).',
  },
  {
    id: 'A5',
    area: 'Technical-state confluence',
    specGap: 'Section 45.8 lists indicators and qualitative state descriptions without levels, and some "improving" conditions need change series TradeEdge does not store.',
    reading:
      'RECOVERING = weekly RSI rising AND price above SMA50 AND (SMA200 not falling OR relative strength vs SPY non-negative). STABILIZING = weekly RSI change non-negative, not RECOVERING. Otherwise (RSI still falling): OVERSOLD when weekly RSI is at or below the depressed line and no other bearish indicator confirms; DECLINING in every other case. "Relationship to SMA50 improving" and "relative strength improving" are read from the current relationship and level because no change series exists.',
  },
  {
    id: 'A6',
    area: 'Risk',
    specGap: 'Section 45.9 gives no proximity window and no event schema.',
    reading:
      'Earnings within policy.risk.earningsApproachingMaxDays days is flagged RISK_EARNINGS_APPROACHING (never disqualifying). A VALID, non-empty corporate_event_flags list is treated as reliable binary/corporate-event evidence and blocks UNDERLYING ACTIONABLE / SETUP; unavailable event data stays explicitly unavailable.',
  },
  {
    id: 'A7',
    area: 'Leverage trajectory',
    specGap: 'Section 45.6 lists leverage as a fundamental dimension; TradeEdge has no prior-period leverage metric.',
    reading: 'The leverage dimension is NOT_EVALUABLE (never neutral). The level is judged under Quality only. With revenue, EPS and margin evaluable, three dimensions remain.',
  },
  {
    id: 'A8',
    area: 'WATCH versus DISCOVERED',
    specGap: 'Section 45.10 gives WATCH examples, not a rule.',
    reading:
      'WATCH when Quality passes and the fundamental thesis is intact (not broken, growth-adjusted not DETERIORATING, momentum not DETERIORATING) but another SETUP requirement is unmet. Anything weaker is DISCOVERED. INVALIDATED applies only to a candidate previously in WATCH, SETUP or ACTIONABLE (Section 45.6 "previously active").',
  },
]);
