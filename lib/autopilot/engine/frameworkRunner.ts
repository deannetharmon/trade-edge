// lib/autopilot/engine/frameworkRunner.ts

import { runRecommendationEngine } from '../decision/recommendationEngine';
import type { AutopilotRunResult } from '../types';

export interface FrameworkRunOptions {
  source: 'manual' | 'cron';
}

// Sprint 2 + decision-engine reconciliation (DR-0002): calls the real
// recommendation engine, which now delegates candidate-level reasoning to
// lib/decision-engine's evaluateSingleCandidate(). No candidate source
// (screener/watchlist) is wired into the cron/manual run yet, so this
// currently always evaluates zero candidates -- but the path is real, not a
// stub, and starts emitting audit events as soon as a candidate source is
// added.
export async function runAutopilotFrameworkDryRun(
  userId: string,
  options: FrameworkRunOptions,
): Promise<AutopilotRunResult> {
  const result = await runRecommendationEngine(userId, {
    source: options.source === 'cron' ? 'engine' : 'manual',
    candidates: [],
  });

  const decisions = result.recommendations.map((analysis) => ({
    id: analysis.id,
    timestamp: analysis.createdAt,
    strategy: analysis.recommendation.strategy,
    symbol: analysis.subject.symbol,
    action: analysis.recommendation.status === 'recommended' ? ('no_action' as const) : ('suppress_entry' as const),
    opportunityScore: analysis.opportunityScore?.total,
    decisionConfidence: analysis.confidence.overall,
    reason: analysis.rationale,
    rulesTriggered: [analysis.recommendation.status],
    rulesBlocked: analysis.metadata.rulesBlocked,
    configSnapshot: result.config,
    metadata: { decisionAnalysisId: analysis.id, action: analysis.recommendation.action },
  }));

  return {
    runId: result.runId,
    timestamp: result.timestamp,
    userId: result.userId,
    scannedCandidates: result.candidatesScanned,
    openedPositions: 0, // paper execution remains disabled until Sprint 3
    suppressedCandidates: result.suppressedCount,
    decisions,
    account: result.account,
  };
}
