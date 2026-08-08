// lib/opportunity-engine/evaluateOpportunityCandidate.ts
//
// OE-0001: evaluates one already-scored OpportunityCandidate against a
// point-in-time view of the shared capital pool and any known conflicting
// exposure. Every score/confidence number is read from
// candidate.decisionAnalysis, never recalculated. This function decides
// only: which of the four approved dispositions applies, and (if
// RECOMMENDED) how much of the capital pool it consumes.
//
// rankOpportunityCandidates() is the only intended caller in production --
// it establishes the sort order and running capital pool this function's
// `capitalRemainingBeforeThisCandidate`/`hasConflictingExposure` arguments
// depend on. This function is exported and independently testable because
// the sprint's public contract requires it, and because testing the
// per-candidate decision in isolation (without needing a full batch) is
// valuable on its own.

import type { DecisionConcern, DecisionEvidence } from '@/lib/decision-engine';
import { OE_RULE_IDS } from './ruleIds';
import type { OpportunityCandidate, OpportunityContext, OpportunityDisposition, OpportunityRecommendation } from './types';

export interface EvaluateOpportunityCandidateArgs {
  candidate: OpportunityCandidate;
  context: OpportunityContext;
  // Capital still available in the shared pool immediately before this
  // candidate is considered, i.e. context.availableCapital minus whatever
  // higher-ranked candidates ahead of this one in the batch have already
  // consumed. Pass context.availableCapital itself when evaluating a
  // candidate standalone (no batch sequencing).
  capitalRemainingBeforeThisCandidate: number;
  // Human-readable descriptions of every known DISPOSITION-CHANGING
  // conflict for this candidate: an exact symbol+strategy+expiration
  // duplicate against an existing open position, or against an earlier
  // candidate in the same batch. Empty when none apply. Deliberately does
  // NOT include ordinary nonzero ticker/sector exposure -- see
  // `exposureDisclosures` below. See rankOpportunityCandidates.ts's
  // detectDispositionConflicts() for how this is determined in production.
  conflictDescriptions: string[];
  // Informational-only exposure facts (known existing nonzero ticker
  // exposure, known existing nonzero sector exposure) that are disclosed to
  // the trader but never affect `disposition`, `rank`, or capital
  // sequencing. A genuine concentration breach against the account's own
  // configured limits already reaches this candidate through
  // `candidate.decisionAnalysis.recommendation.status` (the Decision
  // Engine's own `single-ticker-concentration` / `sector-concentration`
  // concerns push status to `conditional` or worse upstream) -- this
  // module never adds a second, independent "exposure > 0 is a problem"
  // threshold of its own. See rankOpportunityCandidates.ts's
  // buildExposureDisclosures().
  exposureDisclosures: { descriptions: string[]; ruleIds: string[] };
}

export interface EvaluateOpportunityCandidateResult {
  recommendation: Omit<OpportunityRecommendation, 'rank'>;
  // Capital this candidate consumes from the running pool. Always 0 unless
  // disposition === 'RECOMMENDED' -- only accepted candidates reserve
  // capital for the candidates ranked after them.
  capitalConsumed: number;
}

function evidenceLabel(evidence: DecisionEvidence): string {
  const value = evidence.value !== undefined ? ` (${evidence.value})` : '';
  return `${evidence.label}${value}`;
}

function concernLabel(concern: DecisionConcern): string {
  return `${concern.label}: ${concern.explanation}`;
}

function buildSupportingFactors(evidence: DecisionEvidence[]): string[] {
  return evidence
    .filter((item) => item.tone === 'positive' || item.tone === 'neutral')
    .map(evidenceLabel);
}

function buildRiskTradeoffs(concerns: DecisionConcern[]): string[] {
  return concerns
    .filter((concern) => concern.severity === 'low' || concern.severity === 'medium')
    .map(concernLabel);
}

function buildMissingInformationDisclosures(candidate: OpportunityCandidate): { disclosures: string[]; ruleIds: string[] } {
  const disclosures: string[] = [];
  const ruleIds: string[] = [];

  if (candidate.sector === undefined) {
    disclosures.push('Sector is unknown for this candidate -- sector concentration cannot be fully verified.');
    ruleIds.push(OE_RULE_IDS.missingSectorDisclosure);
  }

  if (candidate.earningsRisk === undefined) {
    disclosures.push('Earnings timing relative to expiration is unknown for this candidate.');
    ruleIds.push(OE_RULE_IDS.missingEarningsDisclosure);
  }

  return { disclosures, ruleIds };
}

function formatCurrency(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

export function evaluateOpportunityCandidate(
  args: EvaluateOpportunityCandidateArgs,
): EvaluateOpportunityCandidateResult {
  const { candidate, capitalRemainingBeforeThisCandidate, conflictDescriptions, exposureDisclosures } = args;
  // hasConflictingExposure now means ONLY an exact symbol+strategy+expiration
  // duplicate -- ordinary nonzero ticker/sector exposure is carried
  // separately in `exposureDisclosures` and never reaches this flag. See
  // rankOpportunityCandidates.ts's detectDispositionConflicts() vs.
  // buildExposureDisclosures().
  const hasConflictingExposure = conflictDescriptions.length > 0;
  const analysis = candidate.decisionAnalysis;
  const concerns = analysis.concerns ?? [];
  const criticalConcerns = concerns.filter((c) => c.severity === 'critical');
  const supportingFactors = buildSupportingFactors(analysis.supportingEvidence ?? []);
  const riskTradeoffs = buildRiskTradeoffs(concerns);
  const { disclosures: missingInformationDisclosures, ruleIds: missingInfoRuleIds } =
    buildMissingInformationDisclosures(candidate);

  const portfolioConflicts: string[] = [];
  // Informational only -- appended to ruleIds unconditionally, before any
  // disposition branch runs, so it can never be mistaken for a
  // disposition-changing signal. Never gates a branch below.
  const ruleIds: string[] = [...missingInfoRuleIds, ...exposureDisclosures.ruleIds];
  const whatWouldImprove: string[] = [];
  let disposition: OpportunityDisposition;
  let rejectionReasons: string[] = [];
  let capitalConsumed = 0;

  if (hasConflictingExposure) {
    portfolioConflicts.push(...conflictDescriptions);
  }

  if (analysis.recommendation.status === 'not_recommended') {
    // Hard rejection from the existing Decision Engine is final. This
    // module never overrides it, never re-scores it, and never promotes it
    // -- see docs/design/OE-0001-Opportunity-Engine-Foundation.md section 5.
    disposition = 'REJECTED';
    ruleIds.push(OE_RULE_IDS.hardRejectedByDecisionEngine, ...analysis.metadata.rulesBlocked);
    rejectionReasons = criticalConcerns.length
      ? criticalConcerns.map(concernLabel)
      : [analysis.rationale];
    whatWouldImprove.push(
      ...(criticalConcerns.length
        ? criticalConcerns.map((c) => `Resolve: ${c.label.toLowerCase()}.`)
        : ['The blocking condition described in the rationale would need to change.']),
    );
  } else if (analysis.recommendation.status === 'conditional') {
    disposition = 'WATCH';
    ruleIds.push(OE_RULE_IDS.conditionalByDecisionEngine);
    whatWouldImprove.push(
      `Decision confidence or market conditions improving would let this clear the Decision Engine's own bar (currently ${analysis.confidence.overall.toFixed(0)}).`,
    );
  } else if (candidate.capitalRequired > args.context.availableCapital) {
    // Cannot be RECOMMENDED even standalone -- exceeds the entire pool, not
    // just what's left after higher-ranked picks.
    disposition = 'WATCH';
    ruleIds.push(OE_RULE_IDS.insufficientTotalCapital);
    portfolioConflicts.push(
      `Requires ${formatCurrency(candidate.capitalRequired)}, more than the ${formatCurrency(args.context.availableCapital)} currently available.`,
    );
    whatWouldImprove.push(
      `${formatCurrency(candidate.capitalRequired - args.context.availableCapital)} more available capital would make this affordable.`,
    );
  } else if (hasConflictingExposure) {
    // A real, non-fabricated conflict conservatively caps this below
    // RECOMMENDED even though the Decision Engine itself found no blocking
    // concern -- see rule 5.1.3.
    disposition = 'ACCEPTABLE_ALTERNATIVE';
    ruleIds.push(OE_RULE_IDS.duplicateExposureDetected);
    whatWouldImprove.push('Resolving or accepting the disclosed exposure conflict would allow this to rank higher.');
  } else if (candidate.capitalRequired > capitalRemainingBeforeThisCandidate) {
    // Fits on its own, but higher-ranked candidates in this same batch have
    // already claimed the capital it would need.
    disposition = 'ACCEPTABLE_ALTERNATIVE';
    ruleIds.push(OE_RULE_IDS.capitalConsumedByHigherRanked);
    portfolioConflicts.push(
      `Fits within total available capital, but ${formatCurrency(capitalRemainingBeforeThisCandidate)} remains after higher-ranked picks -- ${formatCurrency(candidate.capitalRequired - capitalRemainingBeforeThisCandidate)} short.`,
    );
    whatWouldImprove.push('Additional capital, or not taking a higher-ranked pick first, would allow this to be recommended.');
  } else {
    disposition = 'RECOMMENDED';
    ruleIds.push(OE_RULE_IDS.recommendedTopPick);
    capitalConsumed = candidate.capitalRequired;
  }

  const primaryReason = disposition === 'REJECTED' && rejectionReasons.length
    ? rejectionReasons[0]
    : analysis.rationale;

  return {
    recommendation: {
      candidateId: candidate.id,
      // CSP-WORKFLOW-0001 core-correction (BLOCKER-04) — the canonical
      // ScreenResult.candidateId, passed through unchanged; null (never
      // guessed) when the candidate had none.
      screenerCandidateId: candidate.screenerCandidateId ?? null,
      source: candidate.source,
      symbol: candidate.symbol,
      strategy: candidate.strategy,
      disposition,
      opportunityScoreTotal: analysis.opportunityScore?.total ?? null,
      decisionConfidenceTotal: analysis.confidence.overall,
      primaryReason,
      supportingFactors,
      riskTradeoffs,
      portfolioConflicts,
      exposureDisclosures: exposureDisclosures.descriptions,
      rejectionReasons,
      missingInformationDisclosures,
      whatWouldImprove,
      decisionAnalysisId: analysis.id,
      ruleIds,
    },
    capitalConsumed,
  };
}
