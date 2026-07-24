# MB-0001A — Morning Briefing Attention Feed

**Status:** DESIGN COMPLETE — ready for Dane implementation

**Owner:** Quinn (architecture and QA)

**Product objective:** Give the Dashboard one deterministic, explainable answer to: **What deserves the trader's attention today, and what can safely wait?**

## 1. Architectural Ruling

TradeEdge already has the core attention-ranking machinery:

- `PortfolioObjective.actionability` determines whether an item is `CRITICAL`, `ACTION_NEEDED`, `REVIEW_SOON`, or `MONITOR`.
- `calculatePriorityScore()` produces the canonical numeric score, tier, and reasons.
- `buildTodaysPrioritiesDashboard()` applies that score to existing objectives and sorts each actionable bucket.
- `buildRecommendationExplanation()` provides deterministic confidence, decision drivers, and “why now” details.
- `selectTopPriority()` selects the highest-scored item from the existing ranked output.

Therefore, MB-0001A must **not** create a second attention engine, scoring model, severity system, or independent rule set. That would split the source of truth and create contradictory Dashboard recommendations.

MB-0001A is a **read-only composition layer** over already-computed Today's Priorities output.

## 2. Scope

### In scope

Create a pure service that converts `TodaysPrioritiesDashboard` into one ordered, presentation-neutral attention feed.

The feed must:

- flatten the existing actionable buckets into one ordered list;
- preserve the existing `PriorityScore` ordering semantics;
- preserve the originating bucket and objective identity;
- attach the existing deterministic explanation;
- distinguish items requiring action from items that can safely wait;
- expose enough structured data for the Dashboard to render Immediate Attention, Watch, and Healthy summaries later.

### Out of scope

- New scoring logic.
- New market-data acquisition.
- Re-evaluating positions.
- News, macro events, ex-dividend data, or assignment-probability calculations.
- Recommendation persistence or background refresh.
- Dashboard UI changes.
- Broker actions or trade execution.
- Opportunity Engine recommendations; those remain a separate feed until MB-0001D.

## 3. Proposed Package

```text
lib/morning-briefing/
  attentionFeed.ts
  types.ts
  index.ts
  __tests__/
    attentionFeed.test.ts
```

The package may import from:

```text
lib/todaysPriorities
lib/portfolio-intelligence (types only, when necessary)
```

It must not import React, page components, TastyTrade clients, API routes, browser storage, or broker submission modules.

## 4. Public Contract

```ts
import type {
  PrioritizedObjective,
  TodaysPrioritiesDashboard,
} from '@/lib/todaysPriorities';

export type AttentionBand =
  | 'IMMEDIATE'
  | 'WATCH'
  | 'HEALTHY';

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

export function buildAttentionFeed(
  input: BuildAttentionFeedInput,
): AttentionFeed;
```

Exact field names may change during implementation only when required by existing exported types. Any semantic change requires Quinn review.

## 5. Mapping Rules

### IMMEDIATE

Map every item from:

- `dashboard.immediateAction`

No other source may be promoted to `IMMEDIATE` by this service. Severity originates upstream in `PortfolioObjective.actionability`.

### WATCH

Map actionable items from:

- `dashboard.reviewToday.earningsReviews`
- `dashboard.reviewToday.expiringPositions`
- `dashboard.reviewToday.mediumPriority`
- `dashboard.opportunities.rollOpportunities`
- `dashboard.opportunities.cspOpportunities`

These remain actionable or review-worthy but are not reclassified as critical.

### HEALTHY

Map entries from:

- `dashboard.monitor`

Healthy items have no `PriorityScore`, `PrioritizedObjective`, or recommendation explanation. The service must not fabricate these values.

### Excluded in MB-0001A

The following are not converted to `AttentionItem` in this sprint:

- `reviewToday.needsFollowUp` — this is a decision-review workflow item, not yet normalized to the same objective contract.
- `coveredCallOpportunities` — not backed by a scored `PortfolioObjective`.
- `screenerCandidatesAvailable` — a navigation/availability flag, not a ranked recommendation.

Each exclusion must be documented in code comments and tests so future work adds an explicit adapter instead of silently mixing incompatible models.

## 6. Ordering Rules

`orderedActionable` is produced using this deterministic order:

1. Higher `score` first.
2. On equal score, source precedence:
   - `IMMEDIATE_ACTION`
   - `EARNINGS_REVIEW`
   - `EXPIRING_POSITION`
   - `MEDIUM_PRIORITY`
   - `ROLL_OPPORTUNITY`
   - `CSP_OPPORTUNITY`
3. On equal score and source, lexical `id` ascending.

The service must not depend on incidental array insertion order for tie resolution.

`topAttentionItem` is `orderedActionable[0] ?? null`.

The existing `selectTopPriority()` remains valid and untouched. Dane must add a parity test proving that, for objective-backed actionable items, `topAttentionItem` identifies the same objective as `selectTopPriority()`.

## 7. Explanation Rules

For each `PrioritizedObjective`, call the existing `buildRecommendationExplanation()` function.

The Attention Feed must reuse, not reinterpret:

- objective confidence;
- priority reasons;
- review triggers;
- evidence;
- management intent;
- existing “why now” language.

`recommendedAction` and `headline` should be derived from canonical objective fields already displayed by Today's Priorities. Dane must not invent a second recommendation vocabulary in this package.

When required data is absent, return an honest empty array, `null`, or existing fallback text. Never infer market facts.

## 8. Determinism and Safety

For identical input objects and `generatedAt`, `buildAttentionFeed()` must return deeply equal output.

The module must:

- perform no network requests;
- read no current clock internally;
- mutate no inputs;
- persist no state;
- submit no orders;
- contain no environment-specific logic;
- throw only for structurally invalid programmer input, not ordinary missing optional data.

## 9. Required Tests

At minimum:

1. Empty Dashboard returns empty arrays, zero counts, and `topAttentionItem: null`.
2. CRITICAL objective maps only to `IMMEDIATE`.
3. Earnings, DTE, medium-priority, roll, and CSP objectives map to `WATCH` with correct source.
4. Monitor positions map to `HEALTHY` without fabricated score or explanation.
5. Higher score sorts first across different source buckets.
6. Equal-score source precedence is deterministic.
7. Equal-score/equal-source lexical ID tie-break is deterministic.
8. Existing explanation output is attached unchanged in meaning.
9. `topAttentionItem` is parity-consistent with `selectTopPriority()` for the same Dashboard.
10. Decision-review follow-ups, covered-call opportunities, and screener availability are explicitly excluded.
11. Input objects are not mutated.
12. Repeated calls with identical input produce deeply equal output.

Dane must also run all existing tests under:

```text
lib/todaysPriorities/**
lib/priorityScore/**
lib/portfolio-intelligence/**
lib/dailyBriefing/**
lib/command-center/**
```

## 10. Files Dane May Change

Expected:

```text
lib/morning-briefing/attentionFeed.ts
lib/morning-briefing/types.ts
lib/morning-briefing/index.ts
lib/morning-briefing/__tests__/attentionFeed.test.ts
```

Permitted only when required for a clean public import:

```text
lib/todaysPriorities/index.ts
```

No page, component, API route, broker client, portfolio evaluator, priority-score implementation, or recommendation service file should change in MB-0001A.

## 11. Acceptance Criteria

MB-0001A is accepted when:

- one pure `buildAttentionFeed()` entry point exists;
- no duplicate scoring or actionability logic is introduced;
- all actionable objective-backed items are flattened and globally ordered deterministically;
- each actionable item carries the existing explanation contract;
- monitor items are honestly represented without fabricated intelligence;
- top-item parity with existing Today's Priorities selection is proven by test;
- excluded incompatible sources remain explicitly excluded;
- targeted and repository regression tests pass;
- `tsc --noEmit` is clean;
- `git diff --check` is clean;
- Quinn's code and QA review approves the implementation.

## 12. Implementation Handoff

**Next owner: Dane.**

Implement this CES on branch:

```text
feature/mb-0001a-attention-feed
```

Suggested commit:

```text
feat(morning-briefing): add deterministic attention feed
```

After implementation, Dane returns the diff, test results, TypeScript result, and any deviations from this contract to Quinn for architecture and QA review.