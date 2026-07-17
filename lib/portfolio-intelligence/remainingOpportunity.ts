// lib/portfolio-intelligence/remainingOpportunity.ts
//
// PI-0008A: Remaining Opportunity Engine.
//
// Introduces two deterministic, existing-metrics-only measurements for an
// open position:
//   - Opportunity Captured (%): how much of the position's original credit
//     has already been realized as profit.
//   - Remaining Opportunity (%): how much of the position's economic upside
//     genuinely remains, discounted by the same risk/time signals the rest
//     of Portfolio Intelligence already computes.
//
// This is explicitly NOT part of the Decision Engine. It does not select a
// recommendation, does not feed selectManagementIntent(), and is not read by
// evaluatePositionObjective()'s trigger-detection branches. It is a parallel,
// independent, purely explanatory metric -- the same "reuse existing
// evidence, add no new calculations" posture as managementIntent.ts, applied
// to a different question ("how much upside is left?" instead of "what
// should I do?").
//
// Every factor below reuses a threshold or convention this codebase already
// established elsewhere, rather than inventing a new one:
//   - dteReviewThreshold (21) and materialLossPct (-100) come from
//     DEFAULT_POSITION_MANAGEMENT_POLICY (policies/defaults.ts).
//   - The 5% "comfortable buffer" reference matches health/score.ts's own
//     buffer-good band (buffer >= 5 -> positive factor there).
//   - The -25%-decline / negative-net-edge thresholds match
//     managementIntent.ts's REDUCE_RISK scoring exactly.
//   - Earnings-window logic reuses positionObjective.ts's own
//     daysUntil()/isUpcomingBeforeExpiration() helpers (exported for this
//     purpose) and earningsReviewWindowDays, rather than re-deriving date
//     math independently.
//
// No score weights, thresholds, or recommendation logic anywhere else in
// this codebase were changed to add this module.

import { DEFAULT_POSITION_MANAGEMENT_POLICY } from './policies';
import { daysUntil, isUpcomingBeforeExpiration } from './objectives/positionObjective';

// Mirrors lib/portfolio/positionLifecycle.ts's PositionLifecycleType exactly
// (duplicated as a string-literal union rather than imported, so this module
// has no dependency on the UI-adjacent lifecycle classifier package -- the
// caller passes the already-classified type through, same as it already does
// for Position Intelligence's `lifecycleType` prop today).
export type RemainingOpportunityLifecycle =
  | 'SPREAD'
  | 'CSP'
  | 'ASSIGNED_STOCK'
  | 'COVERED_CALL'
  | 'PMCC'
  | 'UNKNOWN';

export interface RemainingOpportunityInput {
  // Original Credit -- the basis Opportunity Captured is measured against.
  // Positions with no positive credit basis (e.g. long-stock-only, or data
  // simply unavailable) are not applicable; the calculator returns nulls
  // rather than fabricating a percentage with no denominator.
  creditReceived?: number | null;
  // Current P/L, this codebase's existing %-of-credit convention (-100 = 1x
  // credit loss, 50 = the existing profit-target convention, etc.).
  pnlPct?: number | null;
  // Days to expiration.
  dte?: number | null;
  // Strike buffer, %.
  buffer?: number | null;
  // 0-100, already computed by health/score.ts -- read as-is, never
  // re-derived or re-scored here.
  healthScore?: number | null;
  // Earnings proximity, reusing the same two existing date fields
  // positionObjective.ts's own earnings-risk branch already reads.
  earningsDate?: string | null;
  expDate?: string | null;
  // Net Edge, the same optional evidence PI-0006B already threads through
  // PositionObjectiveInput (see app/portfolio/page.tsx's netEdgePeak/
  // netEdgeLive).
  netEdgeDeclinePct?: number | null;
  netEdgeNegative?: boolean | null;
  // Position lifecycle -- the structural classification
  // classifyPositionLifecycle() already produces for Position Intelligence
  // today (SPREAD / CSP / COVERED_CALL / ASSIGNED_STOCK / PMCC / UNKNOWN).
  lifecycleType?: RemainingOpportunityLifecycle | null;
}

export interface RemainingOpportunityResult {
  // Null when there is no credit basis to measure against -- "not
  // applicable," never a fabricated 0.
  opportunityCapturedPct: number | null;
  remainingOpportunityPct: number | null;
  // Concise, existing-data-only explanation for whatever discounted
  // remainingOpportunityPct below its theoretical (100 - captured) ceiling.
  // Mirrors managementIntent.ts's `reasons` convention -- capped at 4.
  reasons: string[];
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampUnit(value: number): number {
  return clamp(value, 0, 1);
}

// The one canonical calculator (ticket implement #3). Pure and deterministic:
// same input always produces the same captured/remaining percentages.
export function calculateRemainingOpportunity(
  input: RemainingOpportunityInput,
  now: Date = new Date(),
): RemainingOpportunityResult {
  if (!(input.creditReceived != null && input.creditReceived > 0)) {
    return {
      opportunityCapturedPct: null,
      remainingOpportunityPct: null,
      reasons: ['No credit basis is available to measure remaining opportunity.'],
    };
  }

  // An assigned position has already converted -- the original option-based
  // opportunity is fully resolved, not "still open with upside." This reuses
  // classifyPositionLifecycle()'s own ASSIGNED_STOCK classification rather
  // than inventing a new signal.
  if (input.lifecycleType === 'ASSIGNED_STOCK') {
    return {
      opportunityCapturedPct: 100,
      remainingOpportunityPct: 0,
      reasons: ['Position has been assigned; the original option-based opportunity is fully resolved.'],
    };
  }

  const reasons: string[] = [];
  const pnlPct = input.pnlPct ?? null;

  // Opportunity Captured (%): how much of the original credit has already
  // been realized. Clamped to [0, 100] -- an active loss has captured 0%
  // (not a negative percentage), and captured can never exceed the full
  // credit received.
  const capturedPct = clamp(pnlPct ?? 0, 0, 100);
  const theoreticalRemainingPct = 100 - capturedPct;

  // Time factor: the existing 21-DTE management-window convention. Full
  // (1.0) once comfortably outside the window; shrinks linearly toward 0 as
  // expiration approaches, since less time remains to realize whatever
  // upside is theoretically left.
  const dte = input.dte ?? null;
  const timeFactor = dte != null
    ? clampUnit(dte / DEFAULT_POSITION_MANAGEMENT_POLICY.dteReviewThreshold)
    : 1;
  if (dte != null && timeFactor < 1) {
    reasons.push(`Only ${dte} DTE remain, inside the ${DEFAULT_POSITION_MANAGEMENT_POLICY.dteReviewThreshold}-day management window.`);
  }

  // Health factor: the existing 0-100 health score, used as-is -- no
  // re-scoring, no new health logic.
  const healthScore = input.healthScore ?? null;
  const healthFactor = healthScore != null ? clampUnit(healthScore / 100) : 1;
  if (healthScore != null && healthFactor < 1) {
    reasons.push(`Health score is ${healthScore}, tempering confidence in capturing remaining opportunity.`);
  }

  // Buffer factor: reuses health/score.ts's own "5% = comfortable" strike
  // buffer convention (see its 'buffer-good' band) as the point of full
  // confidence; below that, confidence shrinks linearly toward 0 at an
  // at-the-money buffer.
  const BUFFER_COMFORT_PCT = 5;
  const buffer = input.buffer ?? null;
  const bufferFactor = buffer != null ? clampUnit(buffer / BUFFER_COMFORT_PCT) : 1;
  if (buffer != null && bufferFactor < 1) {
    reasons.push(`Strike buffer of ${buffer.toFixed(1)}% is below the ${BUFFER_COMFORT_PCT}% comfortable threshold.`);
  }

  // Loss-drag factor: reuses the existing "1x credit" material-loss
  // convention (DEFAULT_POSITION_MANAGEMENT_POLICY.materialLossPct, -100) as
  // the point at which an active loss has consumed all remaining
  // opportunity. Only applies when pnlPct is negative -- a winning position
  // gets no loss drag.
  let lossDragFactor = 1;
  if (pnlPct != null && pnlPct < 0) {
    lossDragFactor = clampUnit(1 + pnlPct / Math.abs(DEFAULT_POSITION_MANAGEMENT_POLICY.materialLossPct));
    if (lossDragFactor < 1) {
      reasons.push(`Position is at ${pnlPct.toFixed(0)}% of credit, reducing remaining opportunity.`);
    }
  }

  // Net edge haircut: reuses managementIntent.ts's exact -25%-decline /
  // negative-net-edge thresholds -- no new thresholds introduced.
  let netEdgeFactor = 1;
  if (input.netEdgeNegative) {
    netEdgeFactor = 0.85;
    reasons.push('Net edge is negative, reducing remaining opportunity.');
  } else if (input.netEdgeDeclinePct != null && input.netEdgeDeclinePct <= -25) {
    netEdgeFactor = 0.9;
    reasons.push(`Net edge has declined ${Math.abs(input.netEdgeDeclinePct).toFixed(0)}% from its peak, reducing remaining opportunity.`);
  }

  // Earnings haircut: reuses the existing earnings-review-window convention
  // (daysUntil/isUpcomingBeforeExpiration, already exported from
  // positionObjective.ts, and earningsReviewWindowDays) rather than
  // re-deriving earnings-proximity logic.
  const earningsUpcoming = isUpcomingBeforeExpiration(input.earningsDate, input.expDate, now);
  const daysUntilEarnings = daysUntil(input.earningsDate, now);
  const earningsActionable = earningsUpcoming
    && daysUntilEarnings != null
    && daysUntilEarnings <= DEFAULT_POSITION_MANAGEMENT_POLICY.earningsReviewWindowDays;
  const earningsFactor = earningsActionable ? 0.85 : 1;
  if (earningsActionable) {
    reasons.push('Earnings fall before expiration, inside the review window, adding event risk to remaining opportunity.');
  }

  // All factors combine multiplicatively -- each is an independent
  // "confidence that the theoretical remainder is genuinely capturable"
  // discount, so they compound rather than average. This matters most for
  // the cases this ticket names explicitly: a losing position with weak
  // health should show materially less remaining opportunity than either
  // factor alone would suggest, and a position deep inside the DTE window
  // should show little remaining opportunity regardless of paper P/L.
  const riskAdjustment = timeFactor * healthFactor * bufferFactor * lossDragFactor * netEdgeFactor * earningsFactor;
  const remainingOpportunityPct = Math.round(clamp(theoreticalRemainingPct * riskAdjustment, 0, 100));

  return {
    opportunityCapturedPct: Math.round(capturedPct),
    remainingOpportunityPct,
    reasons: reasons.slice(0, 4),
  };
}
