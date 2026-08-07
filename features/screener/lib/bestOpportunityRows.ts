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
import type { OpportunityDisposition, OpportunityRecommendation } from '@/lib/opportunity-engine';

export interface BestOpportunityRow {
  candidateId: string;
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

export function buildBestOpportunityRows(
  qualifiedResults: ScreenResult[],
  recommendations: OpportunityRecommendation[],
): BestOpportunityRow[] {
  const bySymbolStrategy = new Map<string, ScreenResult>();
  for (const r of qualifiedResults) bySymbolStrategy.set(`${r.symbol}-${r.strategy}`, r);

  return recommendations.map(rec => {
    const result = bySymbolStrategy.get(`${rec.symbol}-${rec.strategy}`);
    const c = result?.bestCandidate ?? null;
    return {
      candidateId: rec.candidateId,
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
      opportunityScore: rec.opportunityScoreTotal,
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
    };
  });
}
