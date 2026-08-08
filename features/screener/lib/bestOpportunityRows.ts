// features/screener/lib/bestOpportunityRows.ts
//
// SCREENER-UX-0001 — pure view-model builder for BestOpportunitiesShortlist.
// Joins the existing, unmodified OpportunityRecommendation[] (decision
// text/score, from the existing recommendation pipeline — never
// recalculated here) with the matching qualified ScreenResult (real
// candidate numbers: strikes, credit, POP, OTM, ROC, OI) by symbol+strategy,
// so the shortlist can show the "decision-critical summary" the ticket
// requires without inventing any new calculation. No qualification/scoring
// logic lives here — this only reads and formats fields that already exist
// on ScreenResult/SpreadCandidate.

import type { ScreenResult, SpreadCandidate } from '@/lib/scans/types';
import { isBestOpportunitiesEligible } from '@/lib/scans/cspQualification';
import type { OpportunityDisposition, OpportunityRecommendation } from '@/lib/opportunity-engine';

export interface BestOpportunityRow {
  candidateId: string;
  /** CSP-WORKFLOW-0001 — the identity to match this row back to the
   * ScreenResult it was built from. For CSP this is the ScreenResult's own
   * stable candidateId (never symbol+strategy, which collides across
   * multiple contracts on one symbol); for strategies not yet migrated to
   * multi-candidate results, this remains symbol+strategy exactly as
   * before. Kept distinct from `candidateId` above (the recommendation
   * pipeline's own AutopilotCandidate id) because the two id spaces are
   * not the same string for non-CSP strategies today. */
  resultKey: string;
  rank: number;
  symbol: string;
  strategy: string;
  expiration: string | null;
  dte: number | null;
  strikeSummary: string;
  creditDebitLabel: string;
  pop: number | null;
  otmPct: number | null;
  rocPct: number | null;
  relevantLegOi: number | null;
  opportunityScore: number | null;
  decisionConfidence: number;
  disposition: OpportunityDisposition;
  primaryReason: string;
  supportingFactors: string[];
  riskTradeoffs: string[];
  portfolioConflicts: string[];
  exposureDisclosures: string[];
  rejectionReasons: string[];
  missingInformationDisclosures: string[];
  whatWouldImprove: string[];
}

function computeOtmPct(result: ScreenResult): number | null {
  const c = result.bestCandidate;
  if (!c || result.price == null || result.price <= 0) return null;
  if (c.strategy === 'BPS' || c.strategy === 'CSP') return ((result.price - c.shortStrike) / result.price) * 100;
  if (c.strategy === 'BCS') return ((c.shortStrike - result.price) / result.price) * 100;
  if (c.strategy === 'IC' && c.shortCallStrike != null) {
    const putOtm = ((result.price - c.shortStrike) / result.price) * 100;
    const callOtm = ((c.shortCallStrike - result.price) / result.price) * 100;
    return Math.min(putOtm, callOtm);
  }
  return null;
}

function strikeSummary(c: SpreadCandidate | null): string {
  if (!c) return '—';
  if (c.strategy === 'CSP' || c.strategy === 'CC') return `${c.shortStrike}`;
  if (c.strategy === 'PMCC') {
    const longLeg = c.longStrike != null ? `${c.longStrike}L` : '—';
    return `${longLeg} / ${c.shortStrike}S`;
  }
  if (c.strategy === 'IC' && c.shortCallStrike != null && c.longCallStrike != null) {
    return `${c.shortStrike}/${c.longStrike} · ${c.shortCallStrike}/${c.longCallStrike}`;
  }
  return `${c.shortStrike}/${c.longStrike}`;
}

function creditDebitLabel(c: SpreadCandidate | null): string {
  if (!c) return '—';
  if (c.strategy === 'PMCC' && c.netDebit != null) return `$${c.netDebit.toFixed(2)} debit`;
  const amount = c.totalCredit ?? c.credit;
  return `$${amount.toFixed(2)} credit`;
}

function relevantLegOi(c: SpreadCandidate | null): number | null {
  if (!c) return null;
  if (c.strategy === 'IC') {
    if (c.shortOI == null && c.shortCallOI == null) return null;
    return Math.min(c.shortOI ?? Infinity, c.shortCallOI ?? Infinity);
  }
  return c.shortOI ?? null;
}

// CSP-WORKFLOW-0001 core-correction (BLOCKER-04) — the join back to the
// originating ScreenResult now matches on OpportunityRecommendation.
// screenerCandidateId (propagated unchanged from ScreenResult.candidateId
// through screenResultsToAutopilotCandidates() -> OpportunityCandidate ->
// OpportunityRecommendation) against a Map keyed by that same canonical
// candidateId. This replaces the previous approach of parsing rec.candidateId
// (screen_${symbol}_${strategy}_${expiration}_${shortStrike}, an internal,
// separately-formatted id belonging to the AutopilotCandidate/adapter layer,
// not a contract identity contract this module should ever need to decode)
// to recover expiration/strike. CSP is the multi-candidate strategy -- more
// than one contract can exist on one symbol (e.g. the six-strike AMD
// fixture) -- so a CSP recommendation with no resolvable canonical
// candidateId is never attached to an arbitrary same-symbol contract; that
// row fails closed (dropped, with a console diagnostic) instead. Non-CSP
// strategies are not yet multi-candidate per ScreenResult (one bestCandidate
// per symbol), so a plain symbol+strategy match remains a safe, unchanged
// fallback for them alone.
export function buildBestOpportunityRows(
  qualifiedResults: ScreenResult[],
  recommendations: OpportunityRecommendation[],
): BestOpportunityRow[] {
  const byCandidateId = new Map<string, ScreenResult>();
  for (const r of qualifiedResults) {
    if (r.candidateId) byCandidateId.set(r.candidateId, r);
  }

  // CSP-WORKFLOW-0001 core-correction (BLOCKER-03) — cspScore.total is the
  // authoritative CSP primary score. The generic Decision Engine's
  // opportunityScoreTotal remains available (and is still used unchanged for
  // every non-CSP strategy) but must not silently stand in for the CSP score
  // in CSP-specific presentation. A CSP candidate whose score is
  // UNAVAILABLE (a required dimension is missing) remains visible elsewhere
  // in the app, but is excluded here from the score-based Best Opportunities
  // ranking -- there is no valid number to rank it by, and no explicit
  // deterministic fallback policy has been approved.
  const rows = recommendations
    .map(rec => {
    const isCspRec = rec.strategy === 'CSP';
    let result = rec.screenerCandidateId != null ? byCandidateId.get(rec.screenerCandidateId) : undefined;
    let candidateIdUnresolved = false;

    if (!result) {
      if (isCspRec) {
        candidateIdUnresolved = true;
        // eslint-disable-next-line no-console
        console.warn(
          `[bestOpportunityRows] BLOCKER-04: CSP recommendation for ${rec.symbol} has no resolvable ` +
          `canonical candidateId (screenerCandidateId=${rec.screenerCandidateId ?? 'null'}) -- failing ` +
          `closed for this row rather than guessing a same-symbol contract.`
        );
      } else {
        result = qualifiedResults.find(r => r.symbol === rec.symbol && r.strategy === rec.strategy);
      }
    }
    if (result?.strategy === 'CSP') {
      const csp = result.bestCandidate;
      const hasCanonicalQualification = csp?.cspMarketQualification != null
        || csp?.cspAccountEligibility != null || csp?.cspModeQualification != null;
      if (!result.qualified || (hasCanonicalQualification && (!csp?.cspMarketQualification || !csp.cspAccountEligibility
        || !isBestOpportunitiesEligible(csp.cspMarketQualification, csp.cspAccountEligibility, csp.cspModeQualification ?? 'NOT_APPLICABLE')))) {
        return null;
      }
    }
    const c = result?.bestCandidate ?? null;

    // BLOCKER-03 — for CSP rows only, prefer cspScore.total (rounded to a
    // whole number, never a long float) over the generic engine's score.
    // isCspUnscored marks rows to be dropped below, once outside the map,
    // rather than mutating the array while building it.
    const isCsp = c?.strategy === 'CSP';
    const cspScore = isCsp ? c?.cspScore : undefined;
    const isCspUnscored = isCsp && cspScore != null && cspScore.scoreStatus === 'UNAVAILABLE';
    const opportunityScore = isCsp && cspScore?.scoreStatus === 'AVAILABLE'
      ? Math.round(cspScore.total as number)
      : rec.opportunityScoreTotal;

    return {
      candidateId: rec.candidateId,
      resultKey: result?.candidateId ?? `${rec.symbol}-${rec.strategy}`,
      rank: rec.rank,
      symbol: rec.symbol,
      strategy: rec.strategy,
      expiration: c?.expiration ?? null,
      dte: c?.dte ?? null,
      strikeSummary: strikeSummary(c),
      creditDebitLabel: creditDebitLabel(c),
      pop: c?.pop ?? null,
      otmPct: result ? computeOtmPct(result) : null,
      rocPct: c?.roc ?? null,
      relevantLegOi: relevantLegOi(c),
      opportunityScore,
      decisionConfidence: rec.decisionConfidenceTotal,
      disposition: rec.disposition,
      primaryReason: rec.primaryReason,
      supportingFactors: rec.supportingFactors,
      riskTradeoffs: rec.riskTradeoffs,
      portfolioConflicts: rec.portfolioConflicts,
      exposureDisclosures: rec.exposureDisclosures,
      rejectionReasons: rec.rejectionReasons,
      missingInformationDisclosures: rec.missingInformationDisclosures,
      whatWouldImprove: rec.whatWouldImprove,
      __isCsp: isCsp,
      __isCspUnscored: isCspUnscored,
      __candidateIdUnresolved: candidateIdUnresolved,
    };
  })
    .filter((row): row is NonNullable<typeof row> => row != null && !row.__isCspUnscored && !row.__candidateIdUnresolved);

  // BLOCKER-03 — re-rank the CSP subset by cspScore.total (now the row's
  // `opportunityScore`), leaving every non-CSP row's relative order
  // untouched (Array.prototype.sort is a stable sort, and returning 0 for
  // any comparison that doesn't involve two CSP rows preserves the
  // upstream-assigned order for everything else).
  rows.sort((a, b) => {
    if (a.__isCsp && b.__isCsp) {
      return (b.opportunityScore ?? -Infinity) - (a.opportunityScore ?? -Infinity);
    }
    return 0;
  });
  rows.forEach((row, i) => { row.rank = i + 1; });

  return rows.map(({ __isCsp, __isCspUnscored, __candidateIdUnresolved, ...row }) => row);
}
