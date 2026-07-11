// lib/autopilot/engine/frameworkRunner.ts

import { runRecommendationEngine } from '../decision/recommendationEngine';
import type { AutopilotRunResult } from '../types';

export interface FrameworkRunOptions {
  source: 'manual' | 'cron';
}

// Sprint 2: the dry-run stub is retired. This now calls the real recommendation
// engine (candidate pipeline -> risk gates -> scoring -> ranking -> audit trail).
// No candidate source (screener/watchlist) is wired into the cron/manual run yet,
// so this currently always evaluates zero candidates -- but the path is real, not
// a stub, and starts emitting audit events as soon as a candidate source is added.
export async function runAutopilotFrameworkDryRun(
  userId: string,
  options: FrameworkRunOptions,
): Promise<AutopilotRunResult> {
  const result = await runRecommendationEngine(userId, {
    source: options.source === 'cron' ? 'engine' : 'manual',
    candidates: [],
  });

  const decisions = result.recommendations.map((recommendation) => ({
    id: recommendation.id,
    timestamp: recommendation.createdAt,
    strategy: recommendation.candidate.strategy,
    symbol: recommendation.candidate.symbol,
    action: recommendation.status === 'approved' ? ('no_action' as const) : ('suppress_entry' as const),
    opportunityScore: recommendation.opportunity.total,
    decisionConfidence: recommendation.confidence.total,
    reason: recommendation.reasons[0] ?? 'Sprint 2 recommendation evaluated.',
    rulesTriggered: [recommendation.status],
    rulesBlocked: recommendation.riskGates.filter((gate) => !gate.passed).map((gate) => gate.rule),
    configSnapshot: result.config,
    metadata: { recommendationId: recommendation.id, rank: recommendation.rank },
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
