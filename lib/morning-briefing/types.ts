// lib/morning-briefing/types.ts
//
// MB-0001A: public contract for the Attention Feed, exactly as specified in
// docs/design/MB-0001A-Attention-Feed.md section 4. This file defines shape
// only -- no logic. See attentionFeed.ts for the composition that produces
// these types from an existing, unmodified TodaysPrioritiesDashboard.

import type { PrioritizedObjective, TodaysPrioritiesDashboard } from '@/lib/todaysPriorities';

export type AttentionBand = 'IMMEDIATE' | 'WATCH' | 'HEALTHY';

// One entry per existing Today's Priorities source this sprint maps. MONITOR
// is included in the union (every HEALTHY item carries it) even though it
// never participates in orderedActionable's source-precedence tie-break --
// see attentionFeed.ts's SOURCE_PRECEDENCE for why.
export type AttentionSource =
  | 'IMMEDIATE_ACTION'
  | 'EARNINGS_REVIEW'
  | 'EXPIRING_POSITION'
  | 'MEDIUM_PRIORITY'
  | 'ROLL_OPPORTUNITY'
  | 'CSP_OPPORTUNITY'
  | 'MONITOR';

export interface AttentionExplanation {
  confidenceLabel: string;
  confidenceScore: number;
  decisionDrivers: string[];
  whyNow: string[];
}

export interface AttentionItem {
  id: string;
  subjectId: string | null;
  symbol: string | null;
  strategy: string | null;
  band: AttentionBand;
  source: AttentionSource;
  score: number | null;
  tier: string | null;
  headline: string;
  recommendedAction: string;
  reasons: string[];
  explanation: AttentionExplanation | null;
  objective: PrioritizedObjective['objective'] | null;
}

export interface AttentionFeed {
  generatedAt: string;
  immediate: AttentionItem[];
  watch: AttentionItem[];
  healthy: AttentionItem[];
  orderedActionable: AttentionItem[];
  topAttentionItem: AttentionItem | null;
  counts: {
    immediate: number;
    watch: number;
    healthy: number;
    actionable: number;
  };
}

export interface BuildAttentionFeedInput {
  dashboard: TodaysPrioritiesDashboard;
  generatedAt: string;
}
