export type EventRiskStatus = 'CLEAR' | 'WAIT_MONITOR' | 'NOT_QUALIFIED';
export interface EventRiskPolicy { version: 'event-risk-v1'; quoteMaxAgeSeconds: number; eventMaxAgeMinutes: number; }
export interface EventRiskInput {
  now: string; shortExpiration: string; longExpiration: string;
  quoteAgeSeconds: number | null; tradingHalted: boolean | null;
  eventCheckedAt: string | null; earningsDate: string | null; exDividendDate: string | null;
  splitOrSymbolChangeDate: string | null; shortIsItmOrNearItm: boolean;
  standardContract: boolean | null; occAcknowledgedAt: string | null;
}
export interface EventRiskResult { status: EventRiskStatus; blockers: string[]; cautions: string[]; policyVersion: string; }

const date = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
const isBeforeOrOn = (event: string | null, expiration: string) => event != null && event <= expiration;

export function evaluateEventRisk(input: EventRiskInput, policy: EventRiskPolicy): EventRiskResult {
  const blockers: string[] = []; const cautions: string[] = [];
  const now = new Date(input.now);
  const checked = input.eventCheckedAt ? new Date(input.eventCheckedAt) : null;
  if (!Number.isFinite(now.getTime()) || !checked || !Number.isFinite(checked.getTime()) || now.getTime() - checked.getTime() > policy.eventMaxAgeMinutes * 60_000) blockers.push('Event data is unavailable or stale');
  if (input.quoteAgeSeconds == null || input.quoteAgeSeconds > policy.quoteMaxAgeSeconds) blockers.push('Executable quote is unavailable or stale');
  if (input.tradingHalted !== false) blockers.push('Trading status is unavailable or halted');
  if (input.standardContract === false) blockers.push('This is an adjusted or non-standard contract');
  if (input.standardContract == null && !input.occAcknowledgedAt) blockers.push('OCC contract review acknowledgment required');
  if (input.standardContract == null && input.occAcknowledgedAt) cautions.push('OCC contract review acknowledged manually');
  if (isBeforeOrOn(date(input.earningsDate), input.shortExpiration)) blockers.push('Earnings fall on or before short-call expiration');
  if (isBeforeOrOn(date(input.exDividendDate), input.shortExpiration)) {
    (input.shortIsItmOrNearItm ? blockers : cautions).push(input.shortIsItmOrNearItm ? 'Ex-dividend assignment risk blocks this structure' : 'Ex-dividend date falls before short-call expiration');
  }
  if (isBeforeOrOn(date(input.splitOrSymbolChangeDate), input.longExpiration)) blockers.push('Split or symbol-change review is required');
  if (blockers.some(x => /halted|Earnings|assignment risk/.test(x))) return { status: 'NOT_QUALIFIED', blockers, cautions, policyVersion: policy.version };
  return { status: blockers.length ? 'WAIT_MONITOR' : 'CLEAR', blockers, cautions, policyVersion: policy.version };
}
