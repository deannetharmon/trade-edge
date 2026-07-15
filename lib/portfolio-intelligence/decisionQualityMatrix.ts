// lib/portfolio-intelligence/decisionQualityMatrix.ts
//
// PI-0008B: Decision Quality V1.
//
// This is the one centralized table of recommendation-weighting values for
// managementIntent.ts's scoreCandidates(). Before this ticket, every score
// adjustment in that file was an inline magic number (100, 70, 60, 40, 30,
// 20, 15, 10, 5, 90 -- scattered across a dozen `bump()` call sites with no
// single place to see, compare, or retune them together). This file is that
// single place. Nothing about *how* scoring works changes here (scoreCandidates
// still additively bumps named ManagementIntent buckets via the exact same
// `bump()` helper) -- only *where the numbers live* and, per this ticket's
// explicit brief, what several of them are.
//
// Per the Decision Engine Constitution (planning/DECISION_ENGINE_CONSTITUTION.md):
//   - II.4 "Power and transparency must grow together" -- centralizing these
//     weights in one named, documented table is what makes future tuning
//     inspectable rather than an archaeology exercise across bump() call sites.
//   - II.7 "Boundaries over cleverness" -- every weight below is a small,
//     named integer with a one-line reason. Nothing here is a new financial
//     model or a hidden formula; it is a documented dial on evidence this
//     codebase already computes.
//   - VI.4 "Ties are broken toward the more conservative, more specific, more
//     falsifiable option" -- see the "Reduce Risk vs. Cut Losses" note below,
//     which is exactly this principle applied to compounding evidence.
//
// PI-0008B's brief (verbatim): increase the influence of Net Edge
// deterioration, Opportunity Remaining, gamma risk as DTE decreases,
// technical trend, earnings proximity, and position lifecycle; reduce the
// influence of raw unrealized P/L and Health Score as a primary driver, so
// Health Score becomes supporting evidence rather than the dominant
// recommendation signal. No new market data, no new indicators -- every
// input below is a field managementIntent.ts's evidence contract already
// carries (dte, pnlPct, netEdgeDeclinePct, netEdgeNegative,
// technicalAlignment, earningsActionable, remainingOpportunityPct from
// PI-0008A) or a small, obvious derivation of one (proximity/gamma scaling
// from dte, which was already present as a raw field).

// ---------------------------------------------------------------------------
// Baselines -- unchanged. Structural (guarantee Hold/Roll are always
// candidates), not an "influence" dial this ticket touches.
// ---------------------------------------------------------------------------
export const HOLD_BASELINE = 10;
export const ROLL_BASELINE = 5;

// ---------------------------------------------------------------------------
// Take Profit -- unchanged. These are fixed-policy hits (target reached /
// unprotected profit above threshold), not "raw P/L as a primary driver" in
// the sense this ticket means (see MATERIAL_LOSS below for the parallel
// reasoning on the Cut Losses side).
// ---------------------------------------------------------------------------
export const PROFIT_TARGET_REACHED = 100;
export const UNPROTECTED_PROFIT = 40;

// ---------------------------------------------------------------------------
// Cut Losses -- hard policy breaches.
//
// MATERIAL_LOSS is deliberately left undiminished: it represents an actual
// loss-stop policy breach (pnlPct at or beyond the configured loss-stop),
// which the Decision Engine Constitution (IV.1, VIII.2) requires to
// outrank everything else, including an explicit assignment preference --
// this is a capital-preservation floor, not "raw P/L used as a primary
// signal" in the sense the brief asks to de-emphasize. Reducing it would
// break the existing, deliberate "hard-risk exception" behavior (see
// managementIntent.test.ts).
//
// WEAK_HEALTH_LOSS is reduced (was 70) -- this is the one bump in the whole
// matrix keyed directly on Health Score, and per the brief, Health Score
// should be supporting evidence, not a dominant driver. It still requires a
// real loss (pnlPct beyond weakHealthLossPct) AND a weak health score to
// fire at all -- lowering its weight means that combination now more often
// yields to (or narrows the margin against) an explicit assignment
// preference or another compounding signal, rather than automatically
// dominating on its own.
// ---------------------------------------------------------------------------
export const MATERIAL_LOSS = 100;
export const WEAK_HEALTH_LOSS = 55; // was 70

// ---------------------------------------------------------------------------
// Tight / ITM strike buffer. REDUCE_RISK weight unchanged; the Cut Losses
// "nudge" (a secondary, smaller contribution reflecting that a tight buffer
// also elevates loss risk, not just de-risking urgency) is increased so that
// several compounding de-risking signals can out-vote a single Reduce Risk
// driver when the evidence is genuinely severe -- see "Reduce Risk vs. Cut
// Losses" below.
// ---------------------------------------------------------------------------
export const TIGHT_BUFFER_REDUCE_RISK = 60;
export const TIGHT_BUFFER_CUT_LOSSES_NUDGE = 35; // was 20

// ---------------------------------------------------------------------------
// Net Edge deterioration -- increased influence per the brief.
// ---------------------------------------------------------------------------
export const NET_EDGE_DECLINE_REDUCE_RISK = 50; // was 40
export const NET_EDGE_NEGATIVE_REDUCE_RISK = 42; // was 30
export const NET_EDGE_NEGATIVE_CUT_LOSSES_NUDGE = 21; // was 15

// ---------------------------------------------------------------------------
// Technical trend -- increased influence, applied specifically to the
// risk-detection direction (trend running against the position). The
// confirming direction (trend aligned -> Hold) is deliberately left
// unchanged: amplifying a "things are fine" signal doesn't serve this
// ticket's actual goal (agreement with an experienced PM on cases that need
// attention), and it previously sat at an exact score tie with the
// unprotected-profit Take Profit signal (40 vs. 10 baseline + 30) -- any
// increase there flips that tie for a reason unrelated to the position's own
// risk evidence (a profitable position with no working exit order should
// still resolve to protecting the gain, not to holding un-hedged, regardless
// of trend). See the Constitution's VI.6 ("a trader should be able to
// predict the general shape of what the Engine will say") -- inflating the
// confirming-trend weight would make that specific, unrelated case less
// predictable, not more decision-quality.
// ---------------------------------------------------------------------------
export const TECHNICAL_AGAINST_CUT_LOSSES = 38; // was 30
export const TECHNICAL_AGAINST_REDUCE_RISK = 26; // was 20
export const TECHNICAL_ALIGNED_HOLD = 30; // unchanged, see note above

// ---------------------------------------------------------------------------
// Gamma / DTE risk -- new. Reuses the existing `dte` evidence field (already
// present on every context) and the existing 21-day management-window
// convention (DEFAULT_POSITION_MANAGEMENT_POLICY.dteReviewThreshold) --
// duplicated here as a literal rather than imported, preserving
// managementIntent.ts's existing design boundary that this module reacts to
// evidence but does not import policy thresholds itself (see its module doc).
// Scales continuously from 0 at the 21-day window's edge to its max at
// expiration (dte <= 0) -- as DTE decreases, gamma risk increases, so more
// weight goes to de-risking. The Cut Losses side gets a smaller max
// (roughly half), consistent with every other de-risking signal in this
// table: Reduce Risk is the primary bucket for "something needs de-risking,"
// Cut Losses gets a secondary nudge reflecting that the same evidence also
// elevates loss risk.
//
// The max is deliberately kept below HOLD_BASELINE's effective reach for
// DTE comfortably above the existing "critical expiration" convention
// (dte <= 7, already used elsewhere in this codebase, e.g.
// positionObjective.ts's criticalExpiration) -- gamma risk alone should not
// override Hold Position for a position with no other adverse evidence at
// all until DTE is genuinely low. At GAMMA_DTE_REDUCE_RISK_MAX = 15, the
// gamma-only Reduce Risk contribution crosses HOLD_BASELINE (10) right
// around that same ~7-day mark, rather than at an arbitrary or much earlier
// point in the 21-day window.
// ---------------------------------------------------------------------------
export const GAMMA_DTE_WINDOW_DAYS = 21;
export const GAMMA_DTE_REDUCE_RISK_MAX = 15;
export const GAMMA_DTE_CUT_LOSSES_MAX = 8;

// ---------------------------------------------------------------------------
// Remaining Opportunity -- new. Reuses PI-0008A's calculateRemainingOpportunity()
// output (remainingOpportunityPct), which was, until this ticket, a purely
// explanatory, parallel metric with zero influence on any recommendation.
// This is the most direct instance of the brief's "use metrics that already
// exist" instruction: no new calculation is introduced here, only a
// consumer for one that already existed.
//
// Low remaining opportunity means little genuine upside is left, discounted
// for risk/time -- for an already-profitable position that supports Take
// Profit (bank what's left); for a flat-or-losing position it supports
// Reduce Risk (little recoverable upside justifies less exposure, not
// necessarily a forced exit -- Cut Losses still requires its own harder
// evidence per the hard-risk-exception design elsewhere in this file).
// High remaining opportunity means substantial upside genuinely remains --
// supports Hold Position (don't act prematurely on a position with real
// opportunity left).
// ---------------------------------------------------------------------------
export const REMAINING_OPPORTUNITY_LOW_THRESHOLD_PCT = 20;
export const REMAINING_OPPORTUNITY_LOW_TAKE_PROFIT_MAX = 30;
export const REMAINING_OPPORTUNITY_LOW_REDUCE_RISK_MAX = 22;
export const REMAINING_OPPORTUNITY_HIGH_THRESHOLD_PCT = 70;
export const REMAINING_OPPORTUNITY_HIGH_HOLD_MAX = 20;

// ---------------------------------------------------------------------------
// Earnings proximity -- increased influence. Previously a fixed 0-point bump
// that only attached an explanatory reason to whichever intent already led
// ("earnings raises the stakes on whichever intent the evidence above
// already supports" -- see managementIntent.ts's doc comment, unchanged
// design). It now adds real, scaled weight to that same leader: closer
// proximity to the earnings date (within the existing review window) yields
// more weight, so earnings genuinely tips close contests rather than only
// narrating them. EARNINGS_PROXIMITY_FALLBACK is used when a caller has
// confirmed earnings are actionable but hasn't computed a precise proximity
// fraction (e.g. evaluatePortfolioObjectives.ts's boolean-only
// earningsWithinExpiration) -- a fixed, moderate assumption rather than
// either a zero (losing all influence) or the max (assuming the worst
// without evidence).
// ---------------------------------------------------------------------------
export const EARNINGS_PROXIMITY_MAX = 24;
export const EARNINGS_PROXIMITY_FALLBACK_FRACTION = 0.5;

// ---------------------------------------------------------------------------
// Roll / order / idle-cash / assignment -- unchanged. Each of these already
// fires from an unambiguous, binary confirmation (an explicit roll flag, a
// working order already confirmed stale, idle cash already confirmed
// deployable, an explicit stated assignment preference) rather than a
// graduated signal -- not in scope for this ticket's reweighting.
// ---------------------------------------------------------------------------
export const ROLL_FLAGGED = 100;
export const ORDER_NEEDS_REPLACEMENT = 100;
export const IDLE_CASH_DEPLOYABLE = 100;
export const ASSIGNMENT_PREFERRED = 90;

// ---------------------------------------------------------------------------
// "Reduce Risk vs. Cut Losses" -- a note on why several weights above pair a
// larger Reduce Risk contribution with a smaller Cut Losses "nudge" from the
// same evidence, rather than only one or the other:
//
// A single de-risking signal (a tight buffer, a declined net edge, an
// against-position trend) on its own should support Reduce Risk, not an
// outright exit -- that is the existing, deliberate distinction this
// codebase already draws (see managementIntent.ts's module doc, requirement
// #6). But an experienced portfolio manager reviewing a position where
// *several* severe signals compound -- a real loss-policy breach, a
// tight/ITM buffer, a negative net edge, and an adverse trend, all at once
// -- would call that Cut Losses, not merely "reduce risk a bit." Giving each
// de-risking signal a smaller Cut Losses nudge alongside its larger Reduce
// Risk contribution is what lets that compounding case correctly outscore
// Reduce Risk's single larger contribution, without ever letting a *single*
// signal alone win Cut Losses on its own (each individual nudge here is
// smaller than MATERIAL_LOSS, WEAK_HEALTH_LOSS, or TECHNICAL_AGAINST_CUT_LOSSES
// on its own). This is this ticket's central refinement, made possible by
// centralizing the weights where their relationships can be seen and reasoned
// about together.
export const DECISION_QUALITY_WEIGHTS = {
  holdBaseline: HOLD_BASELINE,
  rollBaseline: ROLL_BASELINE,
  profitTargetReached: PROFIT_TARGET_REACHED,
  unprotectedProfit: UNPROTECTED_PROFIT,
  materialLoss: MATERIAL_LOSS,
  weakHealthLoss: WEAK_HEALTH_LOSS,
  tightBufferReduceRisk: TIGHT_BUFFER_REDUCE_RISK,
  tightBufferCutLossesNudge: TIGHT_BUFFER_CUT_LOSSES_NUDGE,
  netEdgeDeclineReduceRisk: NET_EDGE_DECLINE_REDUCE_RISK,
  netEdgeNegativeReduceRisk: NET_EDGE_NEGATIVE_REDUCE_RISK,
  netEdgeNegativeCutLossesNudge: NET_EDGE_NEGATIVE_CUT_LOSSES_NUDGE,
  technicalAgainstCutLosses: TECHNICAL_AGAINST_CUT_LOSSES,
  technicalAgainstReduceRisk: TECHNICAL_AGAINST_REDUCE_RISK,
  technicalAlignedHold: TECHNICAL_ALIGNED_HOLD,
  gammaDteWindowDays: GAMMA_DTE_WINDOW_DAYS,
  gammaDteReduceRiskMax: GAMMA_DTE_REDUCE_RISK_MAX,
  gammaDteCutLossesMax: GAMMA_DTE_CUT_LOSSES_MAX,
  remainingOpportunityLowThresholdPct: REMAINING_OPPORTUNITY_LOW_THRESHOLD_PCT,
  remainingOpportunityLowTakeProfitMax: REMAINING_OPPORTUNITY_LOW_TAKE_PROFIT_MAX,
  remainingOpportunityLowReduceRiskMax: REMAINING_OPPORTUNITY_LOW_REDUCE_RISK_MAX,
  remainingOpportunityHighThresholdPct: REMAINING_OPPORTUNITY_HIGH_THRESHOLD_PCT,
  remainingOpportunityHighHoldMax: REMAINING_OPPORTUNITY_HIGH_HOLD_MAX,
  earningsProximityMax: EARNINGS_PROXIMITY_MAX,
  earningsProximityFallbackFraction: EARNINGS_PROXIMITY_FALLBACK_FRACTION,
  rollFlagged: ROLL_FLAGGED,
  orderNeedsReplacement: ORDER_NEEDS_REPLACEMENT,
  idleCashDeployable: IDLE_CASH_DEPLOYABLE,
  assignmentPreferred: ASSIGNMENT_PREFERRED,
} as const;

export type DecisionQualityWeights = typeof DECISION_QUALITY_WEIGHTS;

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// Shared scaling helper -- every graduated (non-fixed) weight in this table
// is computed the same way: a 0..1 fraction of "how much of this signal's
// range applies" times a named max. Centralizing the arithmetic here (not
// just the constants above) means the scaling behavior itself -- not only
// the numbers -- lives in one place.
export function scaleWeight(fraction: number, max: number): number {
  return Math.round(clampUnit(fraction) * max);
}

// Gamma/DTE risk fraction: 0 at (or beyond) the management window's edge,
// 1 at or past expiration. Shared by both the Reduce Risk and Cut Losses
// gamma contributions so they scale from the same single fraction.
export function gammaDteFraction(dte: number): number {
  return clampUnit((GAMMA_DTE_WINDOW_DAYS - dte) / GAMMA_DTE_WINDOW_DAYS);
}
