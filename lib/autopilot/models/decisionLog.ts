// lib/autopilot/models/decisionLog.ts

import type { AutopilotConfig, AutopilotDecisionAction, AutopilotDecisionLogEntry, AutopilotStrategy } from '../types';

function randomId(): string {
  return `ap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createDecisionLogEntry(args: {
  config: AutopilotConfig;
  action: AutopilotDecisionAction;
  reason: string;
  strategy?: AutopilotStrategy;
  symbol?: string;
  opportunityScore?: number;
  decisionConfidence?: number;
  rulesTriggered?: string[];
  rulesBlocked?: string[];
  metadata?: Record<string, unknown>;
}): AutopilotDecisionLogEntry {
  return {
    id: randomId(),
    timestamp: new Date().toISOString(),
    strategy: args.strategy,
    symbol: args.symbol,
    action: args.action,
    opportunityScore: args.opportunityScore,
    decisionConfidence: args.decisionConfidence,
    reason: args.reason,
    rulesTriggered: args.rulesTriggered ?? [],
    rulesBlocked: args.rulesBlocked ?? [],
    configSnapshot: args.config,
    metadata: args.metadata,
  };
}
