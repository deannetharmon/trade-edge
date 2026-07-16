// lib/priorityScore/priorityScore.ts
//
// PI-0010B: Intelligent Prioritization -- a deterministic Priority Score
// answering "if I only have limited time today, what should I work on
// first?". This is purely an ORDERING/DISPLAY layer on top of objectives
// Position Intelligence and the Decision Engine already produced -- it
// reads already-computed fields (confidence, managementIntent, dte,
// healthScore, netEdgeDeclinePct, remainingOpportunityPct, reviewTriggers,
// capital-at-risk, pending Decision Review status) and combines them with a
// centralized weighted average (see config.ts). It does not re-evaluate,
// re-rank, or override what type of objective something is, what
// managementIntent was selected, or its actionability/priority/urgency --
// those all stay exactly as Position Intelligence / the Decision Engine
// computed them. No network calls, no new APIs, no AI: this is arithmetic
// over numbers/enums the objective and its position already carry.

import type { ManagementIntent, ObjectiveImpact, PortfolioObjectiveReviewTrigger } from '@/lib/portfolio-intelligence';
import { MANAGEMENT_INTENT_LABEL } from '@/lib/portfolio-intelligence';
// gammaDteFraction is PI-0008B's already-computed gamma/DTE risk curve
// (21-day window) -- reused verbatim rather than inventing a new DTE
// proxy for "gamma risk accelerating". Imported directly from its module
// (not re-exported by lib/portfolio-intelligence's barrel) so nothing about
// that package's public surface needs to change for this ticket.
import { gammaDteFraction } from '@/lib/portfolio-intelligence/decisionQualityMatrix';
import { DEFAULT_PRIORITY_SCORE_CONFIG, type PriorityScoreConfig } from './config';

export type PriorityTier = 'Critical' | 'High' | 'Medium' | 'Low';

// The slice of a PortfolioObjective this module actually reads. Accepting
// the full PortfolioObjective (rather than a narrowed copy) keeps callers
// simple -- lib/todaysPriorities already has the real objective in hand --
// while this type alias documents exactly which fields drive the score.
export interface PriorityScoreObjectiveInput {
  confidence: number;
  managementIntent?: { intent: ManagementIntent } | null;
  reviewTriggers: PortfolioObjectiveReviewTrigger[];
  capitalImpact: ObjectiveImpact;
}

// Per-position context the objective itself doesn't carry. All of these are
// values the caller (app/portfolio/page.tsx via lib/todaysPriorities) has
// already computed elsewhere for other purposes -- see each field's caller-
// side doc comment in lib/todaysPriorities/dashboard.ts. `null` (the whole
// object, not just individual fields) means "no single position backs this
// objective" (e.g. a portfolio-level DEPLOY_IDLE_CASH objective) -- every
// position-derived factor falls back to its configured neutral default in
// that case rather than being fabricated.
export interface PriorityScorePositionContext {
  dte: number | null;
  healthScore: number | null;
  netEdgeDeclinePct: number | null;
  netEdgeNegative: boolean;
  remainingOpportunityPct: number | null;
  capitalAtRisk: number | null;
  hasPendingDecisionReview: boolean;
}

export interface PriorityScoreInput {
  objective: PriorityScoreObjectiveInput;
  position: PriorityScorePositionContext | null;
}

export interface PriorityScoreResult {
  score: number; // 0-100, rounded
  tier: PriorityTier;
  reasons: string[];
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function managementIntentReasonLabel(intent: ManagementIntent | null): string {
  return intent ? `Recommendation: ${MANAGEMENT_INTENT_LABEL[intent]}` : 'No management intent computed yet';
}

interface ScoredFactor {
  id: string;
  label: string;
  value: number; // normalized 0-1
  weight: number;
}

export function calculatePriorityScore(
  input: PriorityScoreInput,
  config: PriorityScoreConfig = DEFAULT_PRIORITY_SCORE_CONFIG,
): PriorityScoreResult {
  const { objective, position } = input;

  const confidenceFactor = clamp01(objective.confidence / 100);

  const intent = objective.managementIntent?.intent ?? null;
  const managementIntentFactor = intent
    ? (config.managementIntentUrgency[intent] ?? config.defaultManagementIntentUrgency)
    : config.defaultManagementIntentUrgency;

  const gammaDteFactor = position?.dte != null ? gammaDteFraction(position.dte) : 0;

  const netEdgeFactor = position?.netEdgeNegative
    ? 1
    : clamp01((position?.netEdgeDeclinePct ?? 0) / config.netEdgeDeclineReferencePct);

  const healthFactor =
    position && position.healthScore != null
      ? clamp01((100 - position.healthScore) / 100)
      : config.missingPositionHealthFactor;

  const remainingOpportunityFactor =
    position && position.remainingOpportunityPct != null
      ? clamp01((100 - position.remainingOpportunityPct) / 100)
      : config.missingRemainingOpportunityFactor;

  const earningsFactor = objective.reviewTriggers.some((t) => t.triggerType === 'earnings') ? 1 : 0;

  const capitalUsd = position?.capitalAtRisk ?? objective.capitalImpact.estimatedDollarValue ?? 0;
  const capitalAtRiskFactor = clamp01(capitalUsd / config.capitalAtRiskReferenceUsd);

  const decisionReviewFactor = position?.hasPendingDecisionReview ? 1 : 0;

  const factors: ScoredFactor[] = [
    { id: 'confidence', label: 'High confidence recommendation', value: confidenceFactor, weight: config.factorWeights.confidence },
    { id: 'managementIntent', label: managementIntentReasonLabel(intent), value: managementIntentFactor, weight: config.factorWeights.managementIntent },
    { id: 'gammaDte', label: 'Gamma risk accelerating', value: gammaDteFactor, weight: config.factorWeights.gammaDte },
    { id: 'netEdge', label: 'Net Edge deteriorating rapidly', value: netEdgeFactor, weight: config.factorWeights.netEdgeDeterioration },
    { id: 'health', label: 'Position health declining', value: healthFactor, weight: config.factorWeights.positionHealth },
    { id: 'remainingOpportunity', label: 'Limited remaining opportunity left to capture', value: remainingOpportunityFactor, weight: config.factorWeights.remainingOpportunity },
    { id: 'earnings', label: 'Earnings approaching', value: earningsFactor, weight: config.factorWeights.earningsProximity },
    { id: 'capitalAtRisk', label: 'Significant capital at risk', value: capitalAtRiskFactor, weight: config.factorWeights.capitalAtRisk },
    { id: 'decisionReview', label: 'Decision Review follow-up required', value: decisionReviewFactor, weight: config.factorWeights.decisionReviewFollowUp },
  ];

  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const weightedSum = factors.reduce((sum, f) => sum + f.value * f.weight, 0);
  const score = totalWeight > 0 ? Math.round(clamp01(weightedSum / totalWeight) * 100) : 0;

  const tier: PriorityTier =
    score >= config.tierThresholds.critical ? 'Critical' :
    score >= config.tierThresholds.high ? 'High' :
    score >= config.tierThresholds.medium ? 'Medium' :
    'Low';

  const reasons = factors
    .filter((f) => f.value >= config.reasonInclusionThreshold)
    .sort((a, b) => b.value * b.weight - a.value * a.weight)
    .slice(0, config.maxReasons)
    .map((f) => f.label);

  return { score, tier, reasons };
}
