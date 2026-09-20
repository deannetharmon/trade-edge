import type { LeapsPositionIntelligenceResult, ShortCallCandidate } from './types';

export interface IncomeCallHandoff {
  canonicalAccountId: string;
  positionKey: string;
  longOccSymbol: string;
  longQuantity: number;
  candidateOccSymbol: string;
  candidateQuoteSnapshotId: string | null;
  candidateQuoteAsOf: string | null;
  candidateBid: number | null;
  candidateAsk: number | null;
  candidateOpenInterest: number;
  candidateSpreadPct: number | null;
  candidateStrike: number;
  candidateDte: number;
  candidateDelta: number;
  policyVersion: 'LEAPS-PI-1.1';
  evaluatedAt: string;
}

export type HandoffValidation =
  | { ok: true }
  | { ok: false; reason: 'not-reviewable' | 'identity-changed' | 'candidate-changed' | 'policy-changed' | 'stale-evaluation' };

/**
 * Review handoff is identity-bound. A changed candidate never silently keeps
 * the old approval; the caller must route the trader back to reconfirmation.
 */
export function validateIncomeCallHandoff(
  handoff: IncomeCallHandoff,
  current: { canonicalAccountId: string; positionKey: string; longOccSymbol: string; longQuantity: number },
  evaluation: LeapsPositionIntelligenceResult,
  asOf: string,
  maxAgeMs = 2 * 60 * 1000,
): HandoffValidation {
  if (evaluation.state !== 'review-income-call' || !evaluation.candidate) return { ok: false, reason: 'not-reviewable' };
  if (handoff.canonicalAccountId !== current.canonicalAccountId || handoff.positionKey !== current.positionKey || handoff.longOccSymbol !== current.longOccSymbol || handoff.longQuantity !== current.longQuantity) return { ok: false, reason: 'identity-changed' };
  if (handoff.candidateOccSymbol !== evaluation.candidate.occSymbol || handoff.candidateQuoteSnapshotId !== evaluation.candidate.quoteSnapshotId || handoff.candidateQuoteAsOf !== evaluation.candidate.quoteAsOf || handoff.candidateBid !== evaluation.candidate.bid || handoff.candidateAsk !== evaluation.candidate.ask || handoff.candidateOpenInterest !== evaluation.candidate.openInterest || handoff.candidateSpreadPct !== evaluation.candidate.spreadPct || handoff.candidateStrike !== evaluation.candidate.strike || handoff.candidateDte !== evaluation.candidate.dte || handoff.candidateDelta !== evaluation.candidate.delta) return { ok: false, reason: 'candidate-changed' };
  if (handoff.policyVersion !== evaluation.policyVersion) return { ok: false, reason: 'policy-changed' };
  const age = Date.parse(asOf) - Date.parse(handoff.evaluatedAt);
  if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return { ok: false, reason: 'stale-evaluation' };
  return { ok: true };
}

export function handoffForCandidate(identity: Pick<IncomeCallHandoff, 'canonicalAccountId' | 'positionKey' | 'longOccSymbol' | 'longQuantity' | 'evaluatedAt'>, candidate: ShortCallCandidate): IncomeCallHandoff {
  return { ...identity, candidateOccSymbol: candidate.occSymbol, candidateQuoteSnapshotId: candidate.quoteSnapshotId, candidateQuoteAsOf: candidate.quoteAsOf, candidateBid: candidate.bid, candidateAsk: candidate.ask, candidateOpenInterest: candidate.openInterest, candidateSpreadPct: candidate.spreadPct, candidateStrike: candidate.strike, candidateDte: candidate.dte, candidateDelta: candidate.delta, policyVersion: 'LEAPS-PI-1.1' };
}
