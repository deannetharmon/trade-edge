// lib/autopilot/decision/recommendationEngine.ts

import { buildPortfolioState } from './portfolioState';
import { runCandidatePipeline } from './candidatePipeline';
import {
  evaluateRiskGates,
  hasBlockingRiskGate,
  summarizeRiskGateReasons,
} from './riskGateEngine';
import type {
  AutopilotCandidate,
  AutopilotConfig,
  AutopilotDecisionLogEntry,
  ConfidenceInputLeg,
  DecisionConfidenceBreakdown,
  OpportunityScoreBreakdown,
} from '../types';
import type {
  AutopilotRecommendation,
  RecommendationRunResult,
  RecommendationStatus,
  RiskGateResult,
} from './types';
import { calculateDecisionConfidence, calculateOpportunityScore } from '../scoring';
import { getAutopilotConfig } from '../persistence/configStore';
import { getPaperAccount, savePaperAccount } from '../persistence/paperAccountStore';
import { appendDecisionLog } from '../persistence/decisionLogStore';
import { appendAuditEvent } from '../persistence/auditTrailStore';
import { createDecisionLogEntry } from '../models/decisionLog';
import { acquireAutopilotRunLock, releaseAutopilotRunLock } from '../scheduler/locking';

export interface RecommendationEngineOptions {
  source?: 'manual' | 'screener' | 'watchlist' | 'repeat_trades' | 'engine' | 'unknown';
  candidates?: AutopilotCandidate[];
}

function createRunId(): string {
  return `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function createAuditEventId(): string {
  return `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function emptyOpportunity(): OpportunityScoreBreakdown {
  return {
    total: 0,
    edgeScore: 0,
    goalAlignmentFactor: 0,
    riskContributionPenalty: 100,
    postureMultiplier: 1,
    notes: ['Candidate failed validation before opportunity scoring.'],
  };
}

function emptyConfidence(): DecisionConfidenceBreakdown {
  return {
    total: 0,
    liquidityScore: 0,
    latencyScore: 0,
    macroProximityScore: 0,
    volatilityStabilityScore: 0,
    notes: ['Candidate failed validation before confidence scoring.'],
  };
}

function buildConfidenceLegs(candidate: AutopilotCandidate): ConfidenceInputLeg[] {
  const now = new Date().toISOString();

  return candidate.legs.map((leg) => {
    const bid = Number.isFinite(leg.bid ?? NaN) ? Number(leg.bid) : undefined;
    const ask = Number.isFinite(leg.ask ?? NaN) ? Number(leg.ask) : undefined;
    const spread = bid !== undefined && ask !== undefined && ask >= bid ? ask - bid : 0.05;

    return {
      bidAskSpread: Math.max(0.01, spread),
      averageBidAskSpread20: Math.max(0.01, spread),
      quoteTimestamp: now,
    };
  });
}

function buildReasons(args: {
  status: RecommendationStatus;
  config: AutopilotConfig;
  opportunity: OpportunityScoreBreakdown;
  confidence: DecisionConfidenceBreakdown;
  riskGates: RiskGateResult[];
}): string[] {
  const reasons: string[] = [];

  if (args.status === 'approved') {
    reasons.push('Candidate cleared Sprint 2 recommendation gates. Paper execution remains disabled until Sprint 3.');
  }

  if (args.status === 'suppressed') {
    if (args.confidence.total < args.config.thresholds.decisionConfidenceMinimum) {
      reasons.push(
        `Decision confidence ${args.confidence.total.toFixed(0)} is below configured minimum ${args.config.thresholds.decisionConfidenceMinimum}.`,
      );
    }
    if (args.config.killSwitchEnabled) {
      reasons.push('Kill switch is enabled; recommendation is suppressed.');
    }
  }

  if (args.status === 'rejected') {
    reasons.push(...summarizeRiskGateReasons(args.riskGates));
  }

  reasons.push(...args.opportunity.notes);
  reasons.push(...args.confidence.notes);

  return Array.from(new Set(reasons));
}

function sortRecommendations(recommendations: AutopilotRecommendation[]): AutopilotRecommendation[] {
  const approved = recommendations
    .filter((recommendation) => recommendation.status === 'approved')
    .sort((a, b) => {
      const scoreDelta = b.opportunity.total - a.opportunity.total;
      if (scoreDelta !== 0) return scoreDelta;
      return b.confidence.total - a.confidence.total;
    })
    .map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));

  const suppressed = recommendations
    .filter((recommendation) => recommendation.status === 'suppressed')
    .sort((a, b) => b.opportunity.total - a.opportunity.total);

  const rejected = recommendations
    .filter((recommendation) => recommendation.status === 'rejected')
    .sort((a, b) => b.opportunity.total - a.opportunity.total);

  return [...approved, ...suppressed, ...rejected];
}

function createRecommendationLog(args: {
  config: AutopilotConfig;
  recommendation: AutopilotRecommendation;
}): AutopilotDecisionLogEntry {
  const blockedRules = args.recommendation.riskGates
    .filter((gate) => !gate.passed)
    .map((gate) => gate.rule);

  return createDecisionLogEntry({
    config: args.config,
    action: args.recommendation.status === 'approved' ? 'no_action' : 'suppress_entry',
    strategy: args.recommendation.candidate.strategy,
    symbol: args.recommendation.candidate.symbol,
    opportunityScore: args.recommendation.opportunity.total,
    decisionConfidence: args.recommendation.confidence.total,
    reason: args.recommendation.reasons[0] ?? 'Sprint 2 recommendation evaluated.',
    rulesTriggered: [
      'sprint_2_recommendation_engine',
      args.recommendation.status,
      ...args.recommendation.riskGates.filter((gate) => gate.passed).map((gate) => gate.rule),
    ],
    rulesBlocked: [
      ...blockedRules,
      ...(args.recommendation.status === 'approved' ? ['paper_execution_disabled_until_sprint_3'] : []),
    ],
    metadata: {
      recommendationId: args.recommendation.id,
      rank: args.recommendation.rank,
      reasons: args.recommendation.reasons,
      riskGates: args.recommendation.riskGates,
      opportunity: args.recommendation.opportunity,
      confidence: args.recommendation.confidence,
    },
  });
}

export async function runRecommendationEngine(
  userId: string,
  options: RecommendationEngineOptions = {},
): Promise<RecommendationRunResult> {
  const lock = await acquireAutopilotRunLock(userId);
  const timestamp = new Date().toISOString();

  if (!lock.acquired) {
    throw new Error('Autopilot recommendation engine is already running.');
  }

  try {
    const config = await getAutopilotConfig(userId);
    let account = await getPaperAccount(userId);
    const portfolioState = buildPortfolioState(userId, account);
    const candidates = options.candidates ?? [];
    const pipeline = runCandidatePipeline({
      candidates,
      portfolio: portfolioState,
      source: options.source ?? 'manual',
    });

    const recommendations: AutopilotRecommendation[] = [];

    for (const invalid of pipeline.rejected) {
      const riskGates: RiskGateResult[] = invalid.validationIssues.map((issue) => ({
        passed: false,
        rule: `validation_${issue.field}`,
        message: issue.message,
        severity: 'block',
      }));
      const opportunity = emptyOpportunity();
      const confidence = emptyConfidence();
      recommendations.push({
        id: `rec_${invalid.metadata.pipelineId}`,
        candidate: invalid.normalized,
        status: 'rejected',
        rank: null,
        opportunity,
        confidence,
        riskGates,
        reasons: [
          ...invalid.validationIssues.map((issue) => `${issue.field}: ${issue.message}`),
          ...opportunity.notes,
          ...confidence.notes,
        ],
        createdAt: timestamp,
      });
    }

    for (const item of pipeline.accepted) {
      const candidate = item.normalized;
      const opportunity = calculateOpportunityScore(candidate, config, account);
      const confidence = calculateDecisionConfidence({
        legs: buildConfidenceLegs(candidate),
        now: new Date(),
      });
      const riskGates = evaluateRiskGates(candidate, config, portfolioState);
      const blocked = hasBlockingRiskGate(riskGates);
      const lowConfidence = confidence.total < config.thresholds.decisionConfidenceMinimum;

      let status: RecommendationStatus = 'approved';
      if (blocked) status = 'rejected';
      else if (lowConfidence || config.killSwitchEnabled) status = 'suppressed';

      const reasons = buildReasons({ status, config, opportunity, confidence, riskGates });

      recommendations.push({
        id: `rec_${item.metadata.pipelineId}`,
        candidate,
        status,
        rank: null,
        opportunity,
        confidence,
        riskGates,
        reasons,
        createdAt: timestamp,
      });
    }

    const ranked = sortRecommendations(recommendations);
    const logs = ranked.map((recommendation) => createRecommendationLog({ config, recommendation }));

    if (logs.length) {
      await Promise.all(logs.map((entry) => appendDecisionLog(userId, entry)));
    }

    // Audit trail — one recommendation_generated event per candidate that made it
    // through the pipeline and was scored (approved/suppressed/rejected all count;
    // pipeline-level validation rejects are not scored candidates and are skipped
    // here since they never became a real recommendation).
    if (ranked.length) {
      await Promise.all(
        ranked.map((recommendation) =>
          appendAuditEvent(userId, {
            id: createAuditEventId(),
            eventType: 'recommendation_generated',
            positionId: undefined,
            orderId: undefined,
            payload: {
              recommendationId: recommendation.id,
              symbol: recommendation.candidate.symbol,
              strategy: recommendation.candidate.strategy,
              status: recommendation.status,
              rank: recommendation.rank,
              opportunityScore: recommendation.opportunity.total,
              decisionConfidence: recommendation.confidence.total,
              source: options.source ?? 'manual',
            },
            createdAt: timestamp,
          }),
        ),
      );
    }

    account.lastRunAt = timestamp;
    account = await savePaperAccount(account);

    return {
      runId: lock.lockId || createRunId(),
      timestamp,
      userId,
      mode: 'paper',
      liveTradingEnabled: false,
      config,
      portfolioState,
      account,
      candidatesScanned: candidates.length,
      approvedCount: ranked.filter((item) => item.status === 'approved').length,
      rejectedCount: ranked.filter((item) => item.status === 'rejected').length,
      suppressedCount: ranked.filter((item) => item.status === 'suppressed').length,
      recommendations: ranked,
    };
  } finally {
    await releaseAutopilotRunLock(userId, lock.lockId);
  }
}
