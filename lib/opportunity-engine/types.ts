// lib/opportunity-engine/types.ts
//
// OE-0001: Opportunity Engine Foundation. See
// docs/design/OE-0001-Opportunity-Engine-Foundation.md for the full
// architecture rationale.
//
// This module is a composition and comparison layer over the existing,
// canonical Decision Engine (lib/decision-engine's DecisionAnalysis, per
// DR-0002 and planning/DECISION_ENGINE_CONSTITUTION.md). It does not
// recompute Opportunity Score, Decision Confidence, or Net Edge -- every
// OpportunityCandidate carries an already-computed DecisionAnalysis, and
// every number this module reports (score, confidence) is read directly
// from that analysis, never recalculated.
//
// What this module adds that no existing engine does: comparing MULTIPLE
// already-evaluated candidates against each other and against a shared,
// finite pool of available capital and existing exposure -- "if I take
// candidate A's capital, is there still room for candidate B" is a
// cross-candidate question no single-candidate evaluation answers.

import type { AutopilotStrategy } from '@/lib/autopilot/types';
import type { DecisionAnalysis } from '@/lib/decision-engine';

// Where a candidate originated. Mirrors lib/autopilot/decision/
// candidatePipelineTypes.ts's CandidateSource and DecisionAnalysis's
// metadata.source vocabulary -- deliberately not a new taxonomy.
export type OpportunityCandidateSource =
  | 'screener'
  | 'hunter'
  | 'repeat_trades'
  | 'watchlist'
  | 'manual';

// The four dispositions this sprint approves. See
// docs/design/OE-0001-Opportunity-Engine-Foundation.md section 5 for the
// exact promotion/demotion rules that produce each one.
export type OpportunityDisposition =
  | 'RECOMMENDED'
  | 'ACCEPTABLE_ALTERNATIVE'
  | 'WATCH'
  | 'REJECTED';

// Normalized comparison input. Deliberately narrow -- this is NOT a copy of
// the full Screener/Hunter/Repeat-Trade result model. Every numeric
// judgment (score, confidence, concerns) lives inside `decisionAnalysis`,
// already computed by the existing Decision Engine; this shape exists only
// to let rankOpportunityCandidates() compare candidates from different
// sources on the same footing.
export interface OpportunityCandidate {
  // Stable identity -- reused from the underlying AutopilotCandidate/
  // DecisionAnalysis subject id, never regenerated here. Two calls with the
  // same candidate must produce the same id (required for "stable candidate
  // IDs produce stable results").
  id: string;
  source: OpportunityCandidateSource;
  symbol: string;
  strategy: AutopilotStrategy;
  expiration?: string;
  dte?: number;

  // Capital the candidate would consume if accepted. Reused directly from
  // the Decision Engine's own expectedOutcome.capitalRequired /
  // candidate.theoreticalMaxLoss -- never recomputed here.
  capitalRequired: number;

  // The existing Decision Engine's complete evaluation of this candidate.
  // This is the "existing Decision Engine evaluation" the architecture
  // rules require every OpportunityCandidate to carry -- every score,
  // confidence figure, concern, and rejection reason this module surfaces
  // is read from here.
  decisionAnalysis: DecisionAnalysis;

  // Known-when-available evidence used for conservative, non-fabricating
  // disclosures. Left undefined (never defaulted to a favorable guess) when
  // the source candidate didn't supply it.
  sector?: string;
  earningsRisk?: boolean;
  wheelSuitable?: boolean;

  // Opaque, source-owned data a UI can use for navigation back to the
  // originating source (e.g. a screener result key). Never inspected by
  // the ranking logic itself.
  navigationMetadata?: Record<string, unknown>;
}

// Portfolio-level facts the comparison layer needs that a single-candidate
// DecisionAnalysis doesn't capture on its own: how much of a shared,
// finite capital pool is available across this whole batch, and what
// exposure already exists (from real positions, not from other candidates
// in this same batch -- cross-batch exposure is detected separately, see
// detectDuplicateExposure in rankOpportunityCandidates.ts).
export interface OpportunityContext {
  // Total capital available for new candidates in this ranking pass.
  availableCapital: number;
  netLiquidity?: number;

  // Existing (pre-batch) exposure, keyed by symbol / strategy -- mirrors
  // PortfolioStateSummary's tickerExposure/strategyExposure shape
  // (lib/autopilot/decision/types.ts) so callers can pass that through
  // directly rather than re-deriving it.
  existingTickerExposure?: Record<string, number>;
  existingStrategyExposure?: Partial<Record<AutopilotStrategy, number>>;
  existingSectorExposure?: Record<string, number>;

  // Open symbol+strategy+expiration keys already held, for duplicate/
  // conflicting-exposure detection. Format: `${symbol}::${strategy}::${expiration ?? 'na'}`.
  // Optional -- when absent, duplicate-exposure detection only operates
  // within the supplied candidate batch itself (see rankOpportunityCandidates.ts).
  existingOpenPositionKeys?: string[];

  portfolioRiskPosture?: 'conserve' | 'steady' | 'maximize';
  generatedAt: string;
}

// One ranked result. Every field here is either passed through from the
// existing DecisionAnalysis or is this module's own comparison-layer
// disclosure (capital sequencing, duplicate exposure) -- never a
// recomputed score.
export interface OpportunityRecommendation {
  candidateId: string;
  source: OpportunityCandidateSource;
  symbol: string;
  strategy: AutopilotStrategy;

  rank: number;
  disposition: OpportunityDisposition;

  // Passed through verbatim from decisionAnalysis -- never recalculated.
  opportunityScoreTotal: number | null;
  decisionConfidenceTotal: number;

  primaryReason: string;
  supportingFactors: string[];
  riskTradeoffs: string[];

  // Disposition-changing conflicts only: an exact symbol+strategy+expiration
  // duplicate against an existing open position or an earlier candidate in
  // this same batch. These are the only exposure-related facts this module
  // uses to demote a candidate below RECOMMENDED. A genuine, canonical
  // concentration breach (single-ticker or sector) already affects
  // `disposition` upstream -- it pushes the Decision Engine's own
  // `recommendation.status` to `conditional` or worse (see
  // lib/decision-engine's `single-ticker-concentration` /
  // `sector-concentration` concerns), which rule 5.1.2 already maps to
  // WATCH. This module never adds a second, independent concentration
  // threshold of its own.
  portfolioConflicts: string[];

  // Informational only -- ordinary nonzero existing ticker or sector
  // exposure, disclosed for the trader's awareness. Never affects
  // `disposition`, `rank`, or capital sequencing. Exposure being greater
  // than zero is not, by itself, evidence of a problem; only the Decision
  // Engine's own configured concentration limits (reflected in
  // `portfolioConflicts` via `disposition`, see above) determine that.
  exposureDisclosures: string[];

  rejectionReasons: string[];
  missingInformationDisclosures: string[];
  whatWouldImprove: string[];

  // Traceability back to the existing Decision Engine result this
  // recommendation was built from.
  decisionAnalysisId: string;
  ruleIds: string[];
}
