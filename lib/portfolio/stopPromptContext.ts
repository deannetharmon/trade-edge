// lib/portfolio/stopPromptContext.ts
//
// STOP-AI-CONTEXT-0001: pure helpers for the Set Stop dialog's AI suggestion.
// - existingStopPromptContext: tells the AI about an EXISTING stop and why
//   TradeEdge flagged it. Context only; the AI is told to judge on the
//   position's merits, not to chase the policy target.
// - stopProximityWarning: display-only nudge when a chosen stop sits so close
//   to the live spread value that it will likely trigger right away.

import type { StopAssessment, StopClassification } from './stopLossPolicy';

/** A stop within this fraction above the live value is flagged. */
export const STOP_NEAR_LIVE_FRACTION = 0.1;

const CLASSIFICATION_LINE: Partial<Record<StopClassification, string>> = {
  TOO_TIGHT: 'tighter than the standard policy target',
  TOO_LOOSE: 'looser than the standard policy target',
  ALIGNED: 'aligned with the standard policy target',
  UNKNOWN_PROVENANCE: 'a valid stop whose origin is not verified',
  INVALID: 'a candidate stop whose fields are malformed or unsafe',
};

/** Empty string when there is no working stop to describe (NO_STOP etc.). */
export function existingStopPromptContext(assessment: StopAssessment | null | undefined): string {
  if (!assessment) return '';
  const line = CLASSIFICATION_LINE[assessment.classification];
  if (!line) return '';
  const { actualTrigger, expectedTrigger } = assessment.derivedAssessment;
  const parts = [`Existing working stop: ${actualTrigger != null ? `$${actualTrigger.toFixed(2)}` : 'price unavailable'} — ${line}.`];
  if (expectedTrigger != null) parts.push(`Standard policy target (2x original credit by default): $${expectedTrigger.toFixed(2)}.`);
  parts.push('This is reference context only, not a limit. Recommend whatever stop is best for this position\'s current risk; tightening or loosening must be justified by the position, not by the label.');
  return parts.join(' ');
}

/** Display-only warning, or null. Percent is above the live spread value. */
export function stopProximityWarning(stopPrice: number, liveValue: number | null | undefined): string | null {
  if (liveValue == null || !Number.isFinite(liveValue) || liveValue <= 0) return null;
  if (!Number.isFinite(stopPrice) || stopPrice <= liveValue) return null;
  const abovePct = ((stopPrice - liveValue) / liveValue) * 100;
  if (abovePct > STOP_NEAR_LIVE_FRACTION * 100) return null;
  return `This stop is only ${abovePct.toFixed(abovePct < 1 ? 1 : 0)}% above the live price — it will likely trigger right away. Consider closing instead.`;
}
