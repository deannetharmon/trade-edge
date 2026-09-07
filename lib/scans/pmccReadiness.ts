import type { PmccPairResult } from './pmccTypes';
import type { EventRiskResult } from './eventRisk';

export type PmccReadinessStatus = 'PMCC_STRUCTURE_QUALIFIED' | 'LONG_QUALIFIED_SHORT_NOT_READY' | 'WAIT_MONITOR' | 'NOT_QUALIFIED';
export interface PmccReadinessGate { id: string; status: 'pass' | 'fail' | 'unavailable'; message: string; }
export interface PmccReadinessPolicy { version: string; earnings: 'block' | 'warn' | 'ignore'; }
export interface PmccReadinessResult { status: PmccReadinessStatus; gates: PmccReadinessGate[]; policyVersion: string; }

/** @deprecated Legacy compatibility evaluator retained for older isolated
 * tests. Production and UI code must consume pmccDecision.ts exclusively;
 * this module is not an eligibility authority. */
export function evaluatePmccReadiness(input: {
  pair: PmccPairResult | null;
  longContractQualified: boolean;
  earningsDate: string | null | undefined;
  eventRisk?: EventRiskResult | null;
  policy: PmccReadinessPolicy;
}): PmccReadinessResult {
  const gates: PmccReadinessGate[] = [];
  if (!input.longContractQualified) gates.push({ id: 'longQualification', status: 'fail', message: 'Long LEAPS contract is not currently qualified' });
  else gates.push({ id: 'longQualification', status: 'pass', message: 'Long LEAPS contract is qualified' });
  if (!input.pair) return { status: input.longContractQualified ? 'LONG_QUALIFIED_SHORT_NOT_READY' : 'NOT_QUALIFIED', gates: [...gates, { id: 'shortSelection', status: 'unavailable', message: 'No proposed short call is selected' }], policyVersion: input.policy.version };
  const { pair } = input;
  if (!pair.longLeg.quote.readyInput || !pair.shortLeg.quote.readyInput) {
    gates.push({ id: 'quotes', status: 'unavailable', message: 'Current two-sided quotes are required for both legs' });
  } else gates.push({ id: 'quotes', status: 'pass', message: 'Both-leg quotes are current and actionable' });
  if (!pair.qualified || pair.failureReasons.length) gates.push({ id: 'structure', status: 'fail', message: pair.primaryFailureReason?.message ?? 'The proposed structure does not meet current rules' });
  else gates.push({ id: 'structure', status: 'pass', message: 'Strike, expiry, debit, and liquidity rules pass' });
  const earningsBeforeShort = Boolean(input.earningsDate && input.earningsDate >= new Date().toISOString().slice(0, 10) && input.earningsDate <= pair.shortLeg.expiration);
  if (earningsBeforeShort && input.policy.earnings === 'block') gates.push({ id: 'earnings', status: 'fail', message: 'Earnings fall before short-call expiration' });
  else gates.push({ id: 'earnings', status: 'pass', message: earningsBeforeShort ? 'Earnings caution acknowledged by policy' : 'No earnings event before short expiration' });
  if (input.eventRisk?.status === 'NOT_QUALIFIED') gates.push({ id: 'eventRisk', status: 'fail', message: input.eventRisk.blockers.join(' · ') || 'Event risk blocks this structure' });
  else if (input.eventRisk?.status === 'WAIT_MONITOR') gates.push({ id: 'eventRisk', status: 'unavailable', message: input.eventRisk.blockers.join(' · ') || 'Event data requires review' });
  else if (input.eventRisk?.status === 'CLEAR') gates.push({ id: 'eventRisk', status: 'pass', message: 'Event-risk checks pass' });
  const unavailable = gates.some(gate => gate.status === 'unavailable');
  const failed = gates.some(gate => gate.status === 'fail');
  // Bug fix: previously checked `unavailable` before `failed`, so a
  // candidate that was BOTH structurally disqualified (pair.qualified
  // false, e.g. wrong strike/expiry/debit) AND had an unavailable quote
  // (delayed/stale/etc.) collapsed to WAIT_MONITOR ("Not ready") instead
  // of NOT_QUALIFIED ("Disqualified") -- inverting this module's own
  // documented design intent (PMCC-CARD-0001: "Disqualified... won't
  // clear without different strikes, [Not ready]... clears on its own
  // once the regular market session opens"). A structural failure is
  // permanent regardless of quote freshness and must take priority.
  // Confirmed against lib/scans/__tests__/pmccReadiness.test.ts's 3
  // existing cases: none exercise both conditions simultaneously, so this
  // reordering doesn't change any already-covered result, only the
  // previously-untested combined case.
  return { status: failed ? 'NOT_QUALIFIED' : unavailable ? 'WAIT_MONITOR' : 'PMCC_STRUCTURE_QUALIFIED', gates, policyVersion: input.policy.version };
}
