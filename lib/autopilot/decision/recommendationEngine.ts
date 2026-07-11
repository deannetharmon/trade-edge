// lib/autopilot/decision/recommendationEngine.ts
//
// Sprint 2 reconciliation (DR-0002): candidate-level reasoning (action
// selection, rationale, confidence dimensions, evidence, concerns,
// alternatives, review triggers, expected outcome) is now owned entirely by
// lib/decision-engine's evaluateSingleCandidate(). This file's job is strictly
// orchestration: run the candidate pipeline, score each candidate, apply the
// narrow set of portfolio-discipline pre-gates that the shared engine doesn't
// yet model, hand valid candidates to the shared engine, then persist and
// audit the results. No action/concern/explanation logic is duplicated here.

import { buildPortfolioState } from './portfolioState';
import { runCandidatePipeline } from './candidatePipeline';
import { evaluateRiskGates } from './riskGateEngine';
import type { CandidateValidationIssue } from './candidatePipelineTypes';
import type {
  AutopilotCandidate,
  AutopilotConfig,
  AutopilotDecisionLogEntry,
  AutopilotGoal,
  ConfidenceInputLeg,
  DecisionConfidenceBreakdown,
  OpportunityScoreBreakdown,
  PaperAccount,
} from '../types';
import type { PortfolioStateSummary, RecommendationRunResult, RiskGateResult } from './types';
import {
  evaluateSingleCandidate,
  type DecisionAnalysis,
  type DecisionObjective,
  type SingleCandidateDecisionContext,
} from '@/lib/decision-engine';
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

// Portfolio-discipline rules from riskGateEngine that have no equivalent in
// lib/decision-engine's SingleCandidateDecisionContext yet:
//   - per_trade_max_loss: caps risk as a % of account equity per trade
//     (distinct from the shared engine's plain "is there enough buying
//     power" check -- this is a sizing-discipline rule, not a capital check)
//   - drawdown: portfolio-level circuit breaker
//   - correlation: candidate-level correlation-to-portfolio penalty
// single_ticker and sector_metadata are intentionally excluded here -- the
// shared engine's buildConcerns() already covers single-ticker concentration
// (and sector, once sector exposure is tracked), so re-blocking on them here
// would duplicate the shared engine's concern logic.
const PORTFOLIO_PRE_GATE_RULES = ['per_trade_max_loss', 'drawdown', 'correlation'];

function createRunId(): string {
  return `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function createAuditEventId(): string {
  return `audit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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

function objectiveForGoal(goal: AutopilotGoal): DecisionObjective {
  switch (goal) {
    case 'conserve':
      return 'protect_capital';
    case 'income':
      return 'generate_income';
    case 'acquire':
      return 'acquire_shares';
    case 'maximize':
      return 'deploy_idle_cash';
  }
}

function mapSourceToDecisionSource(
  source: RecommendationEngineOptions['source'],
): DecisionAnalysis['metadata']['source'] {
  switch (source) {
    case 'manual':
      return 'manual';
    case 'screener':
      return 'screener';
    case 'repeat_trades':
      return 'repeat_trades';
    case 'watchlist':
    case 'engine':
    case 'unknown':
    default:
      return 'autopilot';
  }
}

function buildDecisionContext(args: {
  candidate: AutopilotCandidate;
  config: AutopilotConfig;
  account: PaperAccount;
  portfolioState: PortfolioStateSummary;
  confidence: DecisionConfidenceBreakdown;
  opportunity: OpportunityScoreBreakdown;
  source: RecommendationEngineOptions['source'];
}): SingleCandidateDecisionContext {
  const { candidate, config, account, portfolioState, confidence, opportunity, source } = args;
  const goal = config.perStrategyGoal[candidate.strategy];
  const availableBuyingPower =
    account.liveBuyingPowerSnapshot ?? Math.max(0, account.currentBalance - portfolioState.openRisk);

  return {
    candidate,
    objective: objectiveForGoal(goal),
    source: mapSourceToDecisionSource(source),
    portfolio: {
      netLiquidity: account.currentBalance,
      availableBuyingPower,
      existingSymbolExposure: portfolioState.tickerExposure[candidate.symbol] ?? 0,
      // Sector-level exposure isn't tracked at the Autopilot layer yet
      // (portfolioState.ts only computes ticker/strategy exposure), so this
      // stays undefined -- the shared engine's sector-concentration concern
      // naturally no-ops when it's not finite. Not a regression: the
      // pre-reconciliation riskGateEngine never computed sector exposure
      // either, only a "sector metadata present" warning.
      sectorExposurePct: undefined,
      maxSingleTickerPct: config.thresholds.singleTickerMaxPct,
      maxSectorPct: config.thresholds.sectorMaxPct,
    },
    market: {
      // No market/earnings/macro data source is wired into the Autopilot
      // layer yet. These defaults preserve pre-reconciliation behavior
      // (riskGateEngine never gated on earnings/macro/volatility either)
      // rather than silently introducing new blocking behavior with
      // fabricated inputs. Flagged as a known gap, not a hidden assumption.
      bias: 'neutral',
      earningsWithinExpiration: false,
      macroRiskElevated: false,
      volatilityStable: true,
    },
    preferences: {
      willingToOwn: goal === 'acquire',
      preferDefinedRisk: config.portfolioRiskPosture === 'conserve',
      minimumConfidence: config.thresholds.decisionConfidenceMinimum,
    },
    confidenceInput: { framework: confidence },
    opportunityScore: opportunity,
  };
}

function buildValidationFailureAnalysis(args: {
  candidate: AutopilotCandidate;
  pipelineId: string;
  validationIssues: CandidateValidationIssue[];
  timestamp: string;
  source: RecommendationEngineOptions['source'];
}): DecisionAnalysis {
  const { candidate, pipelineId, validationIssues, timestamp, source } = args;

  return {
    id: `rec_${pipelineId}`,
    createdAt: timestamp,
    version: 'decision-analysis-v1',
    subject: {
      type: 'candidate',
      id: candidate.id || pipelineId,
      symbol: candidate.symbol,
      strategy: candidate.strategy,
      label: `${candidate.symbol || 'unknown'} ${candidate.strategy || ''} candidate`.trim(),
    },
    objective: 'avoid_low_quality_trade',
    recommendation: {
      action: 'AVOID',
      summary: 'Candidate failed pipeline validation and cannot be evaluated.',
      status: 'not_recommended',
    },
    confidence: { overall: 0, market: 0, portfolio: 0, execution: 0, income: 0, risk: 0 },
    priority: 'low',
    rationale: 'One or more required candidate fields failed validation before scoring.',
    supportingEvidence: [],
    concerns: validationIssues.map((issue) => ({
      id: `validation-${issue.field}`,
      label: `Invalid field: ${issue.field}`,
      severity: 'critical' as const,
      explanation: issue.message,
    })),
    alternatives: [],
    reviewTriggers: [],
    expectedOutcome: { intent: 'avoid_low_quality_trade' },
    candidate,
    metadata: {
      source: mapSourceToDecisionSource(source),
      executionAllowed: false,
      paperExecutionAllowed: false,
      rulesEvaluated: ['candidate_pipeline_validation'],
      rulesBlocked: validationIssues.map((issue) => `validation_${issue.field}`),
    },
  };
}

function buildPortfolioPreGateBlockedAnalysis(args: {
  candidate: AutopilotCandidate;
  pipelineId: string;
  blockingGates: RiskGateResult[];
  timestamp: string;
  source: RecommendationEngineOptions['source'];
}): DecisionAnalysis {
  const { candidate, pipelineId, blockingGates, timestamp, source } = args;

  return {
    id: `rec_${pipelineId}`,
    createdAt: timestamp,
    version: 'decision-analysis-v1',
    subject: {
      type: 'candidate',
      id: candidate.id,
      symbol: candidate.symbol,
      strategy: candidate.strategy,
      label: `${candidate.symbol} ${candidate.strategy} candidate`,
    },
    objective: 'protect_capital',
    recommendation: {
      action: 'AVOID',
      summary: `Portfolio-level risk limits block the proposed ${candidate.strategy} on ${candidate.symbol}.`,
      status: 'not_recommended',
    },
    confidence: { overall: 0, market: 0, portfolio: 0, execution: 0, income: 0, risk: 0 },
    priority: 'high',
    rationale:
      'One or more portfolio-level risk limits (drawdown circuit breaker, per-trade sizing, or correlation) block this trade regardless of candidate quality.',
    supportingEvidence: [],
    concerns: blockingGates.map((gate) => ({
      id: gate.rule,
      label: gate.rule.replace(/_/g, ' '),
      severity: 'critical' as const,
      explanation: gate.message,
    })),
    alternatives: [],
    reviewTriggers: [],
    expectedOutcome: { intent: 'protect_capital' },
    candidate,
    metadata: {
      source: mapSourceToDecisionSource(source),
      executionAllowed: false,
      paperExecutionAllowed: false,
      rulesEvaluated: ['portfolio_pre_gate', ...blockingGates.map((gate) => gate.rule)],
      rulesBlocked: blockingGates.map((gate) => gate.rule),
    },
  };
}

const STATUS_RANK: Record<DecisionAnalysis['recommendation']['status'], number> = {
  recommended: 0,
  conditional: 1,
  not_recommended: 2,
};

function rankDecisionAnalyses(analyses: DecisionAnalysis[]): DecisionAnalysis[] {
  return [...analyses].sort((a, b) => {
    const statusDelta = STATUS_RANK[a.recommendation.status] - STATUS_RANK[b.recommendation.status];
    if (statusDelta !== 0) return statusDelta;

    const opportunityDelta = (b.opportunityScore?.total ?? 0) - (a.opportunityScore?.total ?? 0);
    if (opportunityDelta !== 0) return opportunityDelta;

    return b.confidence.overall - a.confidence.overall;
  });
}

function createRecommendationLog(args: {
  config: AutopilotConfig;
  analysis: DecisionAnalysis;
  pipelineId?: string;
}): AutopilotDecisionLogEntry {
  const { config, analysis, pipelineId } = args;

  return createDecisionLogEntry({
    config,
    action: analysis.recommendation.status === 'recommended' ? 'no_action' : 'suppress_entry',
    strategy: analysis.recommendation.strategy ?? analysis.candidate?.strategy,
    symbol: analysis.subject.symbol,
    opportunityScore: analysis.opportunityScore?.total,
    decisionConfidence: analysis.confidence.overall,
    reason: analysis.rationale,
    rulesTriggered: ['decision_engine_v1', analysis.recommendation.status, ...analysis.metadata.rulesEvaluated],
    rulesBlocked: [
      ...analysis.metadata.rulesBlocked,
      ...(analysis.recommendation.status === 'recommended' ? ['paper_execution_disabled_until_sprint_3'] : []),
    ],
    metadata: {
      decisionAnalysisId: analysis.id,
      pipelineId,
      recommendation: analysis.recommendation,
      confidence: analysis.confidence,
      opportunityScore: analysis.opportunityScore,
      concerns: analysis.concerns,
      alternatives: analysis.alternatives,
      reviewTriggers: analysis.reviewTriggers,
      expectedOutcome: analysis.expectedOutcome,
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

    const analyses: DecisionAnalysis[] = [];
    const pipelineIdByAnalysisId = new Map<string, string>();

    for (const invalid of pipeline.rejected) {
      const analysis = buildValidationFailureAnalysis({
        candidate: invalid.normalized,
        pipelineId: invalid.metadata.pipelineId,
        validationIssues: invalid.validationIssues,
        timestamp,
        source: options.source,
      });
      pipelineIdByAnalysisId.set(analysis.id, invalid.metadata.pipelineId);
      analyses.push(analysis);
    }

    for (const item of pipeline.accepted) {
      const candidate = item.normalized;
      const opportunity = calculateOpportunityScore(candidate, config, account);
      const confidence = calculateDecisionConfidence({
        legs: buildConfidenceLegs(candidate),
        now: new Date(),
      });

      // Portfolio-discipline pre-gates that the shared decision engine
      // doesn't yet model (see PORTFOLIO_PRE_GATE_RULES above). If any of
      // these block, we short-circuit before invoking the shared engine --
      // there's no candidate-level reasoning that can override a
      // portfolio-level circuit breaker or sizing-discipline rule.
      const riskGates = evaluateRiskGates(candidate, config, portfolioState);
      const blockingPreGates = riskGates.filter(
        (gate) => !gate.passed && PORTFOLIO_PRE_GATE_RULES.includes(gate.rule),
      );

      let analysis: DecisionAnalysis;
      if (blockingPreGates.length) {
        analysis = buildPortfolioPreGateBlockedAnalysis({
          candidate,
          pipelineId: item.metadata.pipelineId,
          blockingGates: blockingPreGates,
          timestamp,
          source: options.source,
        });
      } else {
        const context = buildDecisionContext({
          candidate,
          config,
          account,
          portfolioState,
          confidence,
          opportunity,
          source: options.source,
        });
        analysis = evaluateSingleCandidate(context);
      }

      pipelineIdByAnalysisId.set(analysis.id, item.metadata.pipelineId);
      analyses.push(analysis);
    }

    const ranked = rankDecisionAnalyses(analyses);
    const logs = ranked.map((analysis) =>
      createRecommendationLog({ config, analysis, pipelineId: pipelineIdByAnalysisId.get(analysis.id) }),
    );

    if (logs.length) {
      await Promise.all(logs.map((entry) => appendDecisionLog(userId, entry)));
    }

    // Audit trail -- one recommendation_generated event per candidate that
    // produced a DecisionAnalysis (validation failures, portfolio pre-gate
    // blocks, and shared-engine evaluations all count; they're all real
    // outcomes of a real run, not silently dropped).
    if (ranked.length) {
      await Promise.all(
        ranked.map((analysis) =>
          appendAuditEvent(userId, {
            id: createAuditEventId(),
            eventType: 'recommendation_generated',
            positionId: undefined,
            orderId: undefined,
            payload: {
              decisionAnalysisId: analysis.id,
              pipelineId: pipelineIdByAnalysisId.get(analysis.id),
              symbol: analysis.subject.symbol,
              strategy: analysis.recommendation.strategy,
              action: analysis.recommendation.action,
              status: analysis.recommendation.status,
              opportunityScore: analysis.opportunityScore?.total,
              decisionConfidence: analysis.confidence.overall,
              source: analysis.metadata.source,
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
      approvedCount: ranked.filter((item) => item.recommendation.status === 'recommended').length,
      rejectedCount: ranked.filter((item) => item.recommendation.status === 'not_recommended').length,
      suppressedCount: ranked.filter((item) => item.recommendation.status === 'conditional').length,
      recommendations: ranked,
    };
  } finally {
    await releaseAutopilotRunLock(userId, lock.lockId);
  }
}
