import type { PortfolioObjective, PortfolioObjectiveEvidence, PortfolioObjectiveReviewTrigger } from '@/lib/portfolio-intelligence';
import type { PrioritizedObjective } from './dashboard';

export type RecommendationConfidenceLabel = 'Very High' | 'High' | 'Moderate' | 'Low';

export interface RecommendationDriver {
  id: string;
  label: string;
  value?: string | number;
  explanation?: string;
  source: 'evidence' | 'priority';
}

export interface RecommendationExplanation {
  drivers: RecommendationDriver[];
  whyNow: string[];
  confidence: {
    score: number;
    label: RecommendationConfidenceLabel;
  };
}

const MAX_DECISION_DRIVERS = 4;
const MAX_WHY_NOW_ITEMS = 3;

const GENERIC_REASON_PATTERNS = [
  /^recommendation:/i,
  /^high confidence recommendation$/i,
  /^medium confidence recommendation$/i,
  /^low confidence recommendation$/i,
];

function confidenceLabel(score: number): RecommendationConfidenceLabel {
  if (score >= 90) return 'Very High';
  if (score >= 75) return 'High';
  if (score >= 55) return 'Moderate';
  return 'Low';
}

function evidenceDriver(evidence: PortfolioObjectiveEvidence): RecommendationDriver {
  return {
    id: `evidence:${evidence.id}`,
    label: evidence.label,
    value: evidence.value,
    explanation: evidence.explanation,
    source: 'evidence',
  };
}

function priorityDriver(reason: string): RecommendationDriver {
  return {
    id: `priority:${reason}`,
    label: reason,
    source: 'priority',
  };
}

function triggerText(trigger: PortfolioObjectiveReviewTrigger): string {
  return trigger.explanation || trigger.label;
}

function topDrivers(objective: PortfolioObjective, reasons: string[]): RecommendationDriver[] {
  const evidence = objective.supportingEvidence
    .filter((item) => item.tone !== 'positive' || objective.type === 'CLOSE_FOR_PROFIT')
    .map(evidenceDriver);

  const specificReasons = reasons
    .filter((reason) => !GENERIC_REASON_PATTERNS.some((pattern) => pattern.test(reason.trim())))
    .map(priorityDriver);

  const seen = new Set<string>();
  return [...evidence, ...specificReasons]
    .filter((driver) => {
      const key = `${driver.label}|${driver.value ?? ''}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_DECISION_DRIVERS);
}

export function buildRecommendationExplanation(item: PrioritizedObjective): RecommendationExplanation {
  return {
    drivers: topDrivers(item.objective, item.reasons),
    whyNow: item.objective.reviewTriggers.map(triggerText).filter(Boolean).slice(0, MAX_WHY_NOW_ITEMS),
    confidence: {
      score: item.objective.confidence,
      label: confidenceLabel(item.objective.confidence),
    },
  };
}
