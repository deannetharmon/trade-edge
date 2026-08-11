// lib/portfolio-intelligence/policies/types.ts
//
// PI-0003: the codebase had two different concepts sharing the word
// "threshold" -- when an EXISTING position deserves attention (position
// management) versus whether ADDITIONAL portfolio risk should be accepted
// (portfolio risk). They happened to use different numeric values already
// (see PI-0002's documented -100%/-50% position-level vs -200% portfolio-
// level loss thresholds) without ever being named as distinct concepts.
// This file makes that separation explicit and typed.

// Position Management Policy: when does an EXISTING position deserve
// attention? These never execute trades -- they only decide whether/what
// kind of objective gets generated for a position that's already open.
export interface PositionManagementPolicy {
  // Matches this repo's established "50% profit target" convention.
  profitTargetPct: number;
  // Matches this repo's established "21-DTE time stop" convention.
  dteReviewThreshold: number;
  // Position-level loss-stop threshold, expressed as openPlPct (e.g. -100
  // means a loss equal to 1x credit received). Deliberately distinct from
  // PortfolioRiskPolicy.candidateMaterialLossPct -- see that field's comment.
  materialLossPct: number;
  // Secondary, less severe loss threshold that only triggers combined with
  // a weak health score (see weakHealthScoreThreshold).
  weakHealthLossPct: number;
  weakHealthScoreThreshold: number;
  // Health score below this triggers OBJ-WATCH-POSITION.
  watchHealthScoreThreshold: number;
  // Health score below this represents more severe concern than "watch".
  // Reserved for future use (no rule currently branches on this alone).
  actionHealthScoreThreshold: number;
  // PI-0004B: centralized earnings-actionability review window, replacing
  // the old "earnings before expiration always surfaces" behavior. Earnings
  // more than this many days out are real but not yet actionable (MONITOR);
  // once inside this window they promote to REVIEW_SOON and surface in
  // Today's Priorities. No trading-calendar utility exists anywhere in this
  // repo (confirmed by search), so this is expressed in calendar days, not
  // trading days -- centralized here specifically so it can be swapped to a
  // trading-day calculation later without touching rule implementations.
  earningsReviewWindowDays: number;
  // Maximum age of the oldest option-leg quote before a marketable value
  // becomes observational only. This affects recommendation authority,
  // never order execution. Calendar time is used because the broker quote
  // payload does not provide a market-session freshness abstraction.
  marketableQuoteMaxAgeMs: number;
  // Small tolerance for ordinary timestamp skew. Quotes farther in the
  // future are unknown rather than treated as proof of freshness.
  marketableQuoteFutureSkewToleranceMs: number;
}

// Portfolio Risk Policy: should ADDITIONAL portfolio risk be accepted right
// now? These are portfolio-level gates -- "can I do more", not "does this
// existing position need care". Distinct from PositionManagementPolicy even
// though both are "risk" in a loose sense.
export interface PortfolioRiskPolicy {
  maxBuyingPowerUtilizationPct: number;
  maxSymbolConcentrationPct: number;
  maxSectorConcentrationPct: number;
  defensiveDrawdownPct: number;
  idleCashThresholdPct: number;
  // Ceiling on a single new candidate's theoretical max loss, as % of net
  // liquidity. Named "candidate risk" per the PI-0003 brief. Not yet
  // enforced anywhere in lib/portfolio-intelligence -- candidate-level risk
  // gating already exists in lib/decision-engine and lib/autopilot/decision
  // (buildConcerns()' buying-power/single-ticker gates). Included here for
  // policy-centralization and documentation purposes; wiring it as an
  // actual portfolio-intelligence-level gate is deferred (see PI-0003 plan
  // doc "Later items").
  maxNewCandidateRiskPct: number;
  // Portfolio-level (batch evaluator) threatened-position severity
  // threshold, expressed as openPlPct. Matches the established "2x credit
  // loss stop" convention (-200 = a loss equal to 2x credit received).
  // Deliberately distinct from PositionManagementPolicy.materialLossPct
  // (-100 by default) -- the batch evaluator (lib/portfolio-intelligence's
  // portfolio-level rules) and the position-level card evaluator
  // (consolidated from TE-0006B in PI-0002) were built for different
  // callers with different severity conventions, and PI-0002 explicitly
  // decided not to silently unify them. This field makes that decision an
  // explicit, documented, typed value instead of a bare magic number.
  candidateMaterialLossPct: number;
}
