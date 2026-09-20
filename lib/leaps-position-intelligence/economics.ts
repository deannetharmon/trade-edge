import type { CandidateEconomics, LongCallFacts, ShortCallCandidate } from './types';

export function calculateCandidateEconomics(longCall: LongCallFacts, candidate: ShortCallCandidate, underlyingPrice: number, thesisTargetHigh: number): CandidateEconomics | null {
  if (candidate.bid == null || !Number.isFinite(candidate.bid) || !Number.isFinite(underlyingPrice) || !Number.isFinite(thesisTargetHigh) || thesisTargetHigh <= underlyingPrice) return null;
  const longExpirationBreakeven = longCall.entryDebitPerShare != null && Number.isFinite(longCall.entryDebitPerShare) ? longCall.strike + longCall.entryDebitPerShare : null;
  const executableCreditPerShare = candidate.bid;
  const upsideParticipationPct = Math.max(0, Math.min(100, ((candidate.strike - underlyingPrice) / (thesisTargetHigh - underlyingPrice)) * 100));
  return {
    executableCreditPerShare,
    totalCredit: executableCreditPerShare * 100 * longCall.quantity,
    creditAsPctOfLeapsCapital: longCall.entryDebitPerShare != null && longCall.entryDebitPerShare > 0 && longCall.quantity > 0
      ? (executableCreditPerShare * 100 * longCall.quantity) / (longCall.entryDebitPerShare * 100 * longCall.quantity) * 100
      : null,
    netDeltaAfterShort: longCall.delta != null && Number.isFinite(longCall.delta) && Number.isFinite(candidate.delta)
      ? longCall.delta - candidate.delta
      : null,
    longExpirationBreakeven,
    upsideParticipationPct,
    belowOriginalExpirationBreakeven: longExpirationBreakeven != null && candidate.strike < longExpirationBreakeven,
  };
}
