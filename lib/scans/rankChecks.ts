// lib/scans/rankChecks.ts
//
// QUAL-STATES-0001 phase 0: the per-candidate checks of the Ranked spread scan, built from the
// candidate itself and shared rules. Before this, the Ranked scan recomputed earnings with an
// old rule (no buffer), failed low open interest outright, and derived `qualified` from a
// strict runChecklist call that never had a candidate, so no Ranked row could be qualified.

import type { CheckResult, ScreenResult, SpreadCandidate } from './types';
import type { RulesType } from './constants';
import { formatDisplayDate, estimateNextEarningsDate } from './scan-utils';
import { daysUntilNy, earningsOnOrBeforeExpiration, EARNINGS_MIN_DAYS_AFTER_EXPIRY } from './earningsPrecheck';
import { assessOiLiquidity } from './oiLiquidity';

export interface RankEarningsResult {
  check: CheckResult;
  /** Text for failReasons when the check fails; always mentions "Earnings" so the follow-up scheduler recognizes it. */
  failReason: string | null;
}

/** Earnings against THIS candidate's own expiry, with the shared 10-day buffer (fail, as in every other scan). */
export function buildRankEarningsCheck(
  earningsDate: string | null | undefined,
  expiration: string,
  isEtfOrIndex: boolean,
  fallback: CheckResult,
): RankEarningsResult {
  if (isEtfOrIndex || !earningsDate) return { check: fallback, failReason: null };
  const ed = daysUntilNy(earningsDate);
  if (ed == null) return { check: fallback, failReason: null };
  if (ed < 0) {
    return {
      check: { status: 'pass', value: `${earningsDate} (past)`, reason: `Already reported · next est. ${formatDisplayDate(estimateNextEarningsDate(earningsDate))}` },
      failReason: null,
    };
  }
  const expiryDays = daysUntilNy(expiration);
  const gap = expiryDays == null ? null : ed - expiryDays;
  const blocked = earningsOnOrBeforeExpiration(earningsDate, expiration, undefined, EARNINGS_MIN_DAYS_AFTER_EXPIRY);
  if (blocked !== false) {
    const reason = gap != null && gap > 0
      ? `Earnings ${gap}d after expiry, inside the ${EARNINGS_MIN_DAYS_AFTER_EXPIRY}-day buffer`
      : "Earnings on or before this trade's expiry";
    return { check: { status: 'fail', value: `${ed}d (${earningsDate})`, reason }, failReason: `Earnings in ${ed}d: ${reason}` };
  }
  return { check: { status: 'pass', value: `${ed}d (${earningsDate})`, reason: `Earnings ${gap}d after expiry` }, failReason: null };
}

/** Low short-leg OI is a disclosed warning, never a fail (OI-LIQUIDITY-CHOICE-0001). Iron condors gate on the worse short leg. */
export function buildRankOiCheck(candidate: SpreadCandidate, oiMin: number): CheckResult {
  const isIc = candidate.strategy === 'IC';
  const shortLegOi = isIc ? Math.min(candidate.shortOI, candidate.shortCallOI ?? 0) : candidate.shortOI;
  const assessed = assessOiLiquidity({ shortOI: shortLegOi, longOI: candidate.longOI, oiMin });
  const value = isIc
    ? `P ${candidate.shortOI}/${candidate.longOI} · C ${candidate.shortCallOI ?? '—'}/${candidate.longCallOI ?? '—'}`
    : `${candidate.shortOI}/${candidate.longOI}`;
  return { ...assessed, value };
}

/** The final checks shown on a Ranked row. Credit, delta and POP are scored, not gated, in Ranked. */
export function buildRankChecks(
  base: ScreenResult['checks'],
  candidate: SpreadCandidate,
  rules: RulesType,
  earnings: CheckResult,
): ScreenResult['checks'] {
  return {
    ...base,
    earnings,
    credit: { status: 'pass', value: `$${candidate.credit.toFixed(2)}`, reason: `${(candidate.creditRatio * 100).toFixed(0)}% of width` },
    delta: { status: 'pass', value: candidate.shortDelta.toFixed(2), reason: 'Short leg delta' },
    pop: { status: 'pass', value: `${(candidate.pop ?? 0).toFixed(0)}%`, reason: 'No floor — ranked by score' },
    roc: { status: candidate.roc >= rules.ROC_MIN_SPREAD ? 'pass' : 'fail', value: `${candidate.roc.toFixed(0)}%`, reason: `Min ${rules.ROC_MIN_SPREAD}%` },
    oi: buildRankOiCheck(candidate, rules.OI_MIN),
  };
}

/** failReasons for a Ranked row: the strict run's reasons, minus its generic ones, plus this candidate's own earnings reason. */
export function buildRankFailReasons(strictReasons: string[], earningsFailReason: string | null): string[] {
  const kept = strictReasons.filter(r => !r.includes('qualifying strikes') && !r.includes('No 30-45 DTE') && !r.startsWith('Earnings in '));
  return earningsFailReason ? [...kept, earningsFailReason] : kept;
}
