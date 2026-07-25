# WA-0003 — Today's Priorities Finite Queue: Implementation Specification (CES)

**Status:** CES / design-only. No application code changed. Approved by Dean, subject to the corrective ruling on the deep-link contract incorporated below (frozen product ruling 6 requires Mission Control to open the exact corresponding item within Today's Priorities, not bypass it). §23 resolved per that ruling; `'positions'` remains the confirmed default landing tab.
**Repository:** `deannetharmon/trade-edge`, inspected against `main` @ `d3b836be8f66179387c8e29a9be9b7fae0ff9344`.
**Author:** Dane (Lead Engineer)
**Authority:** `docs/design/WA-0001-Workspace-Content-Ownership-Audit.md` and `docs/design/WA-0002-Positions-Legacy-Mission-Control-CES.md` (as corrected) are authoritative. This CES cites and extends their rulings; it does not reinterpret them.

## 1. Executive Conclusion

Three different, already-existing surfaces currently answer overlapping slices of "what does the trader need to act on": the legacy Priority List (`features/portfolio/components/TodaysPriorities.tsx` + `TodaysPrioritiesWorkflow.tsx`, the only surface with Mark Complete/Reopen), the Portfolio page's `today` tab (`features/portfolio/dashboard/TodaysPrioritiesDashboard.tsx`, a read-only, four-section bucketed view with no completion controls), and Mission Control's Attention Required section (`components/mission-control/AttentionRequiredSection.tsx`, driven by `lib/morning-briefing/buildAttentionFeed()`, also read-only). Each already reuses the same underlying canonical engines (`PortfolioObjective`, `calculatePriorityScore`, `buildRecommendationExplanation`) — nothing in this sprint touches any of them.

The central finding, evidenced below, is that none of the three existing collections is quite the complete, deduplicated, globally-ordered, completion-aware "finite open queue" the frozen product rulings require. `buildAttentionFeed()`'s `orderedActionable` is the closest — already deduplicated, already globally ordered by Priority Score, already the exact array `selectTopPriority()`-parity is guaranteed against — but it deliberately excludes two item kinds the rulings require in-queue: covered-call opportunities (not `PortfolioObjective`-backed) and decision-review follow-ups (a different type entirely, for already-closed positions). The smallest safe fix is a new, thin, additive composition function — `buildTodaysPrioritiesQueue()` — that calls the existing `buildAttentionFeed()` unchanged and appends these two already-computed, already-typed collections as two new, honestly-non-completable queue-item kinds. No canonical engine changes; no new scoring; no new eligibility intelligence invented anywhere.

The completion workflow (`features/portfolio/priorities/priorityWorkflowState.ts`) already operates on a stable `ruleId::subjectType::subjectKey` identity, not on any UI's presentation order — so Today's Priorities can read and write the exact same `localStorage` state Priority List already uses, with zero schema change, simply by continuing to call `partitionPriorities()` unchanged against the union of `PortfolioObjective`s the new queue surfaces. Healthy-position monitoring (the dashboard's existing `Monitor` bucket) is relocated, unchanged in meaning, from the `today` tab onto Positions, reusing its existing row renderer rather than a redesign. Mission Control's Attention Required section shrinks to a lead item, an open count, a compact summary, and a deep link — all four already either directly available or one small, additive view-model field away from available.

The one genuine gap requiring new (not invented-intelligence, purely mechanical) work is deep linking: no query-parameter, hash, or highlight mechanism into a specific position, opportunity, or review exists anywhere in this codebase today. Per ruling 6, that gap requires **two distinct link levels**, not one: Mission Control's lead-item link must open the exact queue item **within Today's Priorities** (never bypass it and jump straight to Positions or Decision History), using a stable, namespaced queue-item key that is agnostic to item kind; the focused priority card, once landed on, then separately exposes its own applicable action destination (`pos.key` for position-linked items, `reviewId` for decision-review follow-ups, an unfocused Positions landing for portfolio-level items with no position identity). §13 specifies both levels' contracts in full.

**Recommendation: GO.** §23's landing-tab question is resolved in this revision (default remains `'positions'`, per the final ruling) and is no longer open.

## 2. Current-State Evidence

Verified directly against `main` @ `d3b836be8f66179387c8e29a9be9b7fae0ff9344`:

- `lib/todaysPriorities/dashboard.ts` — `buildTodaysPrioritiesDashboard()` produces `TodaysPrioritiesDashboard { immediateAction, reviewToday: {mediumPriority, earningsReviews, expiringPositions, needsFollowUp}, monitor, opportunities: {rollOpportunities, coveredCallOpportunities, cspOpportunities, screenerCandidatesAvailable} }`, every field already scored (via `calculatePriorityScore`) except `monitor` (deliberately unscored — "requires no action") and `coveredCallOpportunities`/`needsFollowUp`/`screenerCandidatesAvailable` (not `PortfolioObjective`-backed). `selectTopPriority(dashboard)` picks the max-score head across the six scored buckets (excludes monitor, CC, needsFollowUp, screener flag) — the existing, sole canonical "what's most urgent" selector.
- `lib/morning-briefing/attentionFeed.ts` — `buildAttentionFeed()` flattens exactly six scored buckets (`immediateAction`, `reviewToday.{earningsReviews,expiringPositions,mediumPriority}`, `opportunities.{rollOpportunities,cspOpportunities}`) into a deduplicated (`dedupedById`, keyed by `objective.id`, first-occurrence-wins in `SOURCE_PRECEDENCE` order), globally-ordered (`compareActionable`: score desc, then source precedence, then lexical id) `orderedActionable: AttentionItem[]`, plus `topAttentionItem` resolved by looking up `selectTopPriority()`'s own answer inside the deduped map (guaranteed parity, never independently re-derived). Its own module doc explicitly, deliberately excludes `coveredCallOpportunities` ("not backed by a scored PortfolioObjective") and `needsFollowUp`/`screenerCandidatesAvailable` for the same reason.
- `components/mission-control/AttentionRequiredSection.tsx` — renders `narrative.attention.items` (an `AttentionItem[]`) as a flat card list; no Mark Complete/Reopen control anywhere in this component or anywhere under `components/mission-control/`.
- `lib/review-conductor/conductReview.ts` — `narrative.attention.items` is `input.attentionFeed.orderedActionable` **filtered** to drop items whose `subjectId` a Trader-Commitment revalidation change already covered this cycle (MB-0001B's "don't narrate the same decision twice" rule); `narrative.leadItem` is either a commitment change or `attentionFeed.topAttentionItem`, unchanged. `narrative.counts.attention = attentionItems.length` — **this count can be smaller than `attentionFeed.counts.actionable`** whenever a commitment-change dedup removes items. Since no Trader Commitment persistence is wired to `/dashboard` yet (`revalidationResults: []`, per `buildMissionControlViewModel.ts`'s own comment), this filter is a no-op in production today, but it is real, existing behavior this CES must not silently break parity with.
- `lib/mission-control/buildMissionControlViewModel.ts` — calls `buildAttentionFeed()` then `conductReview()` in sequence, already inside the one function that assembles `/dashboard`'s view model; a natural, minimal-risk insertion point for one new additive field.
- `components/mission-control/SummaryStrip.tsx` — already renders a lead-item headline and an attention count as plain text; renders no link of any kind today.
- `features/portfolio/priorities/priorityWorkflowState.ts` — `PRIORITY_WORKFLOW_STORAGE_KEY = 'hunter-priorities-workflow-state'`; `getPriorityWorkflowKey(objective) = \`${ruleId}::${subject.type}::${subjectKey}\`` (never `objective.id`, which regenerates every run); `computeObjectiveFingerprint()` = `[priority, urgency, actionability, summary, evidence-values].join('::')` (deliberately excludes `createdAt`/`id`, so a mere refresh never auto-reopens); `isCompletable()` excludes only `type === 'WAIT'`; `partitionPriorities(objectives, workflowState)` is pure, never re-sorts its input, auto-reopens on fingerprint mismatch, and returns `{open, completed, reconciledState, reconciliationChanged}`. This function's identity/fingerprint scheme operates on the objective's own stable fields, not on which UI or bucket presented it — the same objective produces the same key/fingerprint regardless of which surface's array it appears in.
- `features/portfolio/components/TodaysPrioritiesWorkflow.tsx` — the only component that reads/writes this state (`loadPriorityWorkflowState`/`savePriorityWorkflowState`, both plain `localStorage`), auto-reconciles on every fresh `objectives` array via `partitionPriorities`, and renders Open/Completed by calling `TodaysPriorities` (`features/portfolio/components/TodaysPriorities.tsx`) twice with `renderAction` slots for Mark Complete/Reopen.
- `features/portfolio/components/TodaysPriorities.tsx` — renders whatever `PortfolioObjective[]` it is given, in the exact order given (its own doc: "ordering is rendered exactly as received (Portfolio Intelligence owns ordering)"), with a special single-WAIT-item empty-like state. Its `objectives` prop, as wired in `app/portfolio/page.tsx`'s `priorities` tab, is `canonicalPriorities?.objectives ?? null` — the **canonical Portfolio Intelligence prioritization order** (`lib/portfolio-intelligence/prioritizePortfolioObjectives.ts`), which is **not** the same ordering as Priority Score (`calculatePriorityScore`, used by the `today` tab and by `buildAttentionFeed`). This is the ordering discrepancy Scope Item 2 requires documenting (resolved in §6).
- `features/portfolio/dashboard/TodaysPrioritiesDashboard.tsx` — renders all four dashboard sections (Immediate Action, Review Today [earnings/expiring/medium/needsFollowUp], Monitor [collapsed after 6 rows], Opportunities [roll/CSP/CC/screener-flag]) in fixed section order, each objective-backed bucket pre-sorted by Priority Score internally; no completion controls anywhere in this file.
- `app/portfolio/page.tsx` — confirmed (WA-0002 investigation, still true) zero `useSearchParams`/`location.hash`/query-param usage anywhere; `activeTab` is plain in-memory `useState`; `PositionCard`'s `expanded` state is local, uncontrolled `useState(false)`, addressed by nothing external. `pos.key` is the identifier already used everywhere in this file (`onToggle(key)`, `checked: Set<string>`, etc.).
- `lib/portfolio-data/acquisition.ts:632` — `key = \`${symbol}::${expiration-date}\`` — the exact identifier every rendered `PositionCard` corresponds to 1:1. `lib/portfolio-intelligence/dashboardComposition.ts:189` builds `coveredCallOpportunities` with `key: p.key` — the identical key space. `lib/portfolio-intelligence/objectives/positionObjective.ts`'s position-sourced objectives set `subject.id` to this same position key (confirmed via `positionContextFor()`'s lookup in `dashboard.ts`). One identifier space, already used everywhere; no new identifier is introduced by this CES.
- `lib/decision-review/decisionReview.ts` — `reviewsNeedingFollowUp()` returns reviews with `outcomeStatus === 'PENDING'` **and** `!hasPositionId(openPositionIds, review.positionId)` — i.e., exactly the reviews whose position is **already closed**. There is therefore no live `PositionCard` to deep-link a `needsFollowUp` item to; its correct destination is the existing Decision History surface (`history` tab, `features/portfolio/decisionReview/DecisionHistoryView.tsx`), not Positions.
- Test inventory confirmed present and passing at this baseline (from WA-0002's own full-repository regression run): `lib/todaysPriorities/__tests__/dashboard.test.ts` (22), `lib/todaysPriorities/__tests__/explanation.test.ts` (4), `lib/morning-briefing/__tests__/attentionFeed.test.ts` (19), `lib/mission-control/__tests__/buildMissionControlViewModel.test.ts` (9), `lib/review-conductor/__tests__/conductReview.test.ts` (11), `features/portfolio/priorities/__tests__/priorityWorkflowState.test.tsx` (24), `features/portfolio/components/__tests__/TodaysPriorities.test.tsx` (20), `features/portfolio/components/__tests__/TodaysPrioritiesWorkflow.test.tsx` (15), `components/mission-control/__tests__/MissionControl.test.tsx`.

## 3. Canonical Data-Flow Map

```
PortfolioObjective[] (lib/portfolio-intelligence, unchanged)
         |
         v
buildTodaysPrioritiesDashboard()  (lib/todaysPriorities, unchanged)
  -> TodaysPrioritiesDashboard { immediateAction, reviewToday{...}, monitor, opportunities{...} }
         |                                  |                    |
         v                                  v                    v
buildAttentionFeed()            (Monitor bucket, relocated  (CC + needsFollowUp,
(lib/morning-briefing,           to Positions per §10)       newly surfaced per §4)
 UNCHANGED)                                 |                    |
  -> AttentionFeed { orderedActionable,     |                    |
     topAttentionItem, counts, ... }        |                    |
         |                                  |                    |
         +------------------+---------------+--------------------+
                            v
            buildTodaysPrioritiesQueue()   <-- NEW, additive, WA-0003
              (lib/todays-priorities-queue)
              calls buildAttentionFeed() unchanged; appends CC
              opportunities and needsFollowUp as non-completable
              queue items; applies NO new scoring.
         |
         v
   TodaysPrioritiesQueue { orderedItems, leadItem, counts }
         |
    +----+---------------------------------+
    v                                       v
partitionPriorities()                buildMissionControlViewModel()
(features/portfolio/priorities,       (lib/mission-control, gains one
 UNCHANGED -- same localStorage       additive field derived from the
 key, same fingerprint scheme)        same queue + same workflowState)
    |                                       |
    v                                       v
Today's Priorities page              Mission Control's reduced
(open/completed sections,            Attention Required summary
 Mark Complete/Reopen)               (lead item, count, deep link)
```

Priority List (`features/portfolio/components/TodaysPriorities.tsx` + `TodaysPrioritiesWorkflow.tsx`) continues to read `canonicalPriorities.objectives` directly and call `partitionPriorities()` against the same `workflowState`, entirely unchanged, per §12.

**Two-stage deep-link resolution (corrective ruling, §13 for full contract):** every `TodaysPrioritiesQueueItem` above carries a `stableKey` (namespaced by kind — `attention::…`, `cc::…`, `review::…`), derived once, in the same place the queue itself is built, from data already flowing through this map — never recomputed independently by Mission Control or by Today's Priorities. Mission Control's lead-item link (§11) targets `?tab=todays-priorities&priority=<stableKey>`, which resolves **inside** Today's Priorities to the exact queue item (expand/highlight/scroll), never directly to Positions or Decision History. Only from that focused card does the existing, unchanged position/review destination link (`focus=<pos.key>` / `reviewId=<id>`) become available, as a second, separate hop the trader takes deliberately.

## 4. Exact Queue Membership Rules

No new eligibility intelligence is introduced. Every inclusion/exclusion below is a direct read of an existing typed field already produced by an existing canonical function.

| Item/category | Current producer | Current surface | Open-queue eligibility | Completable | Final WA-0003 surface | Rationale |
|---|---|---|---|---|---|---|
| Immediate Action objectives | `buildTodaysPrioritiesDashboard()` — `actionability === 'CRITICAL'` | `today` tab, Priority List, Mission Control (via AttentionFeed) | INCLUDE | Yes (`isCompletable`, excludes `WAIT`, which never has CRITICAL actionability) | Today's Priorities | Ruling 1, explicit inclusion |
| Review Today: earnings/expiring/medium objectives | `buildTodaysPrioritiesDashboard()` — `actionability` in `{ACTION_NEEDED, REVIEW_SOON}`, split by `reviewTriggers` | `today` tab, Priority List, Mission Control (via AttentionFeed) | INCLUDE | Yes | Today's Priorities | Ruling 1, explicit inclusion |
| Review Today: `needsFollowUp` (closed-position decision reviews) | `reviewsNeedingFollowUp()` (`lib/decision-review`) | `today` tab only | INCLUDE (new to AttentionFeed-derived queue; already shown on `today` tab) | No — no `PortfolioObjective` exists to key/fingerprint; resolves via its own existing outcome-recording workflow (Decision Review), not Mark Complete | Today's Priorities (deep-links to Decision History, §13) | Ruling 1 "Review Today items"; genuinely requires a decision today (record an outcome), but has no canonical objective identity to attach the existing completion mechanism to — extending that mechanism would be new intelligence, so it is shown, non-completable, self-resolving |
| Roll opportunities | `buildTodaysPrioritiesDashboard()` — `managementIntent.intent === 'ROLL_POSITION'` | `today` tab, Priority List, Mission Control (via AttentionFeed) | INCLUDE | Yes | Today's Priorities | Ruling 1, explicit inclusion |
| CSP opportunities | `buildTodaysPrioritiesDashboard()` — `type === 'DEPLOY_IDLE_CASH'` | `today` tab, Priority List, Mission Control (via AttentionFeed) | INCLUDE | Yes | Today's Priorities | Ruling 1, explicit inclusion |
| Covered-call opportunities | `dashboardComposition.ts` — `classifyPositionLifecycle(pos).type === 'ASSIGNED_STOCK'` | `today` tab only | INCLUDE (new to AttentionFeed-derived queue; already shown on `today` tab) | No — not `PortfolioObjective`-backed; no existing completion identity to reuse | Today's Priorities (deep-links to the position, §13) | Ruling 1, explicit inclusion; not completable because no canonical fingerprint/identity mechanism exists for it today, and inventing one would be new eligibility/completion intelligence |
| Other actionability-tagged objectives (portfolio-level: `REDUCE_CONCENTRATION`, `PRESERVE_BUYING_POWER`, `REVIEW_PENDING_ORDER`) whose actionability is `ACTION_NEEDED`/`REVIEW_SOON`/`CRITICAL` | `evaluatePortfolioObjectives()` (unchanged), surfaced via the same three dashboard buckets above | `today` tab, Priority List, Mission Control | INCLUDE (already covered by the three buckets above — no separate category) | Yes | Today's Priorities | Ruling 1 "Other existing portfolio objectives only when the current canonical classification requires a decision" — already true by construction, since these objectives already surface only when actionability demands it |
| Healthy/Monitor positions | `buildTodaysPrioritiesDashboard()` — `objective == null \|\| actionability === 'MONITOR'` | `today` tab (Monitor section) | EXCLUDE | No (never shown with a completion control) | Positions (§10) | Ruling 2, explicit exclusion |
| `WAIT`-type objectives | `evaluatePortfolioObjectives()` (unchanged); never reaches the `surfaced` filter with non-MONITOR actionability in practice, and `isCompletable()` is a second, independent, already-existing backstop | Priority List (as a single "nothing to do" state) | EXCLUDE | No (`isCompletable` returns false unconditionally for `type === 'WAIT'`) | N/A — never enters Today's Priorities' queue | Ruling 1, explicit exclusion; ruling 3, explicit "WAIT remains non-completable" |
| General portfolio context (Portfolio Health, Composition, Capital & Income) | `buildPortfolioReview()` (unchanged) | Mission Control, Positions (`PositionCompositionCard`, WA-0002) | EXCLUDE | N/A | Unchanged (Mission Control / Positions, per WA-0001/WA-0002) | Ruling 1, explicit exclusion — not a task |
| Briefing/"what changed" content | `buildDailyBriefing()`, `computeWhatChanged()` (unchanged) | Briefing, WA-0002 transitional content on Positions | EXCLUDE | N/A | Unchanged | Ruling 1, explicit exclusion |
| Screener-discovered new-trade candidates | `lib/opportunity-engine` (unchanged) | `/screener`, `/dashboard`'s New Opportunities section | EXCLUDE | N/A | Unchanged (Opportunities workspace, WA-0001) | Ruling 1, explicit exclusion — a fundamentally different concept (new trade vs. existing-position action), per WA-0001's already-frozen distinction |
| Completed items (any completable kind above) | `partitionPriorities()` (unchanged) | Priority List's "Completed Priorities" section | EXCLUDE from open count; INCLUDE in Completed section | Reopenable | Today's Priorities' Completed section (§9) | Ruling 1, explicit exclusion from the *open* queue; ruling 5, must remain recoverable |

## 5. Open and Completed State Definitions

**Open queue** = `buildTodaysPrioritiesQueue()`'s ordered item list, filtered to exclude any item whose underlying `PortfolioObjective` (only `kind: 'attention'` items have one) has a matching, fingerprint-current entry in `workflowState` (i.e., is completed and not auto-reopened). `covered_call_opportunity` and `needs_follow_up` items are always open (never completable) unless the underlying dashboard computation itself stops producing them (self-resolving — e.g., the covered call is written elsewhere and `classifyPositionLifecycle` no longer returns `ASSIGNED_STOCK`, or the decision review's outcome is recorded and `reviewsNeedingFollowUp` no longer returns it).

**Completed set** = exactly `partitionPriorities(objectivesFromQueue, workflowState).completed`, where `objectivesFromQueue` is the underlying `PortfolioObjective[]` extracted from the queue's `kind: 'attention'` items (i.e., every completable item currently in the queue). This is `partitionPriorities()` called unmodified; only its *input array* is newly sourced from the queue instead of directly from `canonicalPriorities.objectives`.

**Open count** = open queue's length (all kinds). **Completed count** = completed set's length (attention-kind only, since nothing else is ever completed).

## 6. Ordering and Lead-Item Policy

Three existing orderings were found:

1. **Canonical Portfolio Intelligence order** (`prioritizePortfolioObjectives.ts`) — used today only by the legacy Priority List, via `canonicalPriorities.objectives`.
2. **Priority Score order** (`calculatePriorityScore`, via `buildTodaysPrioritiesDashboard`'s `rank()`) — used today by the `today` tab, sorted independently within each of its four fixed sections (not globally interleaved).
3. **Global Priority-Score order with cross-bucket dedup** (`buildAttentionFeed`'s `compareActionable` + `dedupedById`) — used today only by Mission Control's Attention Required section, and the only one of the three that already guarantees parity with `selectTopPriority()`.

**Ruling: Today's Priorities and Mission Control both use ordering #3, extended (`buildTodaysPrioritiesQueue()`'s output, §7).** This is not a new ranking — it is the same Priority Score every other surface already computes, with the same existing tie-break rule (`SOURCE_PRECEDENCE`, then lexical id) `buildAttentionFeed()` already uses, chosen because it is the only existing implementation that already satisfies ruling 6's "Mission Control's lead item matches the first item from the canonical open queue" by construction (both derive from the same underlying ordered array). The two new, non-completable item kinds (covered-call opportunities, `needsFollowUp`) have no Priority Score at all (never computed for them, and this CES does not compute one) — they are appended after every scored item, in their own existing, stable input order (covered-call opportunities in `dashboardComposition.ts`'s existing array order; `needsFollowUp` in `reviewsNeedingFollowUp()`'s existing array order). Ties among scored items are resolved exactly as `compareActionable()` already resolves them (score, then source precedence, then id) — no new tie-break rule.

Today's Priorities' own **presentation** may keep its existing, trader-familiar bucketed sections (Immediate Action / Review Today / Opportunities — see §14's component plan) rather than flattening into one undifferentiated list; each section's internal order is already Priority-Score order today and does not need to change. The *global* order (ordering #3) is the one used for: the canonical open/lead-item computation, Mission Control parity, and deep-link "first item" semantics — it does not require restructuring Today's Priorities' visual grouping.

**Completed items retain their prior relative ordering**: `partitionPriorities()`'s existing completed-sort (`newest-completed-first`, by `completedAt`) is reused unchanged; this is independent of open-queue ordering and already exists.

**Lead item = the open queue's first item** (`orderedItems[0]` after completion-filtering). If the previously-completed head item's `entry` still exists (fingerprint unchanged), it is excluded and the next-highest item becomes lead. If an item is completed and later auto-reopens (fingerprint changed materially), it re-enters the open queue at its natural score position and may become lead again if its score is highest.

**Discrepancy disclosed, not resolved by inventing new logic:** the legacy Priority List's own on-screen ordering (canonical Portfolio Intelligence order, #1 above) is **not** changed to match #3. This is an intentional, disclosed divergence in *visual presentation order only* — Priority List is temporary (§12) and is not being redesigned; ruling 7 forbids completion-state divergence, not ordering divergence, and ordering is not part of the shared canonical-state contract (identity/fingerprint/eligibility are). The two surfaces can legitimately display the same open item set in a different order while sharing one completion state exactly.

## 7. Mark Complete/Reopen Migration Design

**New module (additive only):** `lib/todays-priorities-queue/` — `types.ts`, `buildTodaysPrioritiesQueue.ts`, `index.ts`.

```ts
// lib/todays-priorities-queue/types.ts
export type TodaysPrioritiesQueueItemKind = 'attention' | 'covered_call_opportunity' | 'needs_follow_up';

export interface TodaysPrioritiesQueueItem {
  kind: TodaysPrioritiesQueueItemKind;
  id: string;                 // AttentionItem.id, CC opportunity's key, or DecisionReview.id
  stableKey: string;          // NEW, corrective ruling — namespaced, deterministic, kind-agnostic
                               // identifier for deep-link focus. See getStableQueueKey() below.
                               // Never display text, list position, or symbol-only.
  subjectId: string | null;   // position key, when applicable
  headline: string;
  detail: string;             // recommendedAction / rationale-equivalent, unchanged text
  completable: boolean;       // true only for kind === 'attention' with isCompletable(objective)
  // Exactly one of the following three is populated, matching `kind`:
  attentionItem?: AttentionItem;                    // unchanged MB-0001A shape
  coveredCallOpportunity?: CoveredCallOpportunityInput; // unchanged PI-0010A shape
  decisionReview?: DecisionReview;                  // unchanged PI-0008D shape
}

// Stable, namespaced queue-item key — corrective ruling requirement.
// Namespacing (the `attention::` / `cc::` / `review::` prefix) is what prevents
// collisions across kinds even when the underlying identifiers could otherwise
// coincide (e.g. a covered-call opportunity's position key and an attention
// item's subjectKey are drawn from the same position-key space).
export function getStableQueueKey(item: TodaysPrioritiesQueueItem): string {
  switch (item.kind) {
    case 'attention':
      // Canonical workflow identity — the same key priorityWorkflowState.ts
      // already uses for completion, never a regenerated objective.id.
      return `attention::${getPriorityWorkflowKey(item.attentionItem!.objective!)}`;
    case 'covered_call_opportunity':
      // Namespaced on the existing position key (dashboardComposition.ts's
      // `key: p.key`), not a freshly minted identifier.
      return `cc::${item.coveredCallOpportunity!.key}`;
    case 'needs_follow_up':
      // Namespaced on the existing DecisionReview.id.
      return `review::${item.decisionReview!.id}`;
  }
}

export interface TodaysPrioritiesQueue {
  generatedAt: string;
  orderedItems: TodaysPrioritiesQueueItem[]; // scored items (via buildAttentionFeed order) first, then CC opportunities, then needsFollowUp, each group in existing stable order
  leadItem: TodaysPrioritiesQueueItem | null; // orderedItems[0], or null if empty
  counts: { total: number };
}
```

`buildTodaysPrioritiesQueue({ dashboard, generatedAt })` calls `buildAttentionFeed({ dashboard, generatedAt })` **unmodified** for the scored portion, wraps each of its `orderedActionable` entries as `kind: 'attention'` (completable per `isCompletable(item.objective!)` — always true here since `buildAttentionFeed` never surfaces `WAIT`), then appends `dashboard.opportunities.coveredCallOpportunities.map(...)` as `kind: 'covered_call_opportunity'` (`completable: false`) and `dashboard.reviewToday.needsFollowUp.map(...)` as `kind: 'needs_follow_up'` (`completable: false`). No sorting is invented for the appended groups — their existing array order is preserved as-is. Every item's `stableKey` is populated at construction time via `getStableQueueKey()` (above) — computed once, here, and carried unchanged through Mission Control's summary and Today's Priorities' rendering; neither consumer re-derives it independently.

**Completion partitioning (reuses `partitionPriorities()` unmodified):**

```ts
const objectivesFromQueue = queue.orderedItems
  .filter(i => i.kind === 'attention')
  .map(i => i.attentionItem!.objective!);
const { open, completed, reconciledState, reconciliationChanged } =
  partitionPriorities(objectivesFromQueue, workflowState);
const openIds = new Set(open.map(o => o.id));
// Note: `open`/`completed` here are PortfolioObjective[] with FRESH ids per
// run (ids regenerate every computation) -- do not key by `.id` across runs.
// Use the same key partitionPriorities itself uses internally instead:
const openKeys = new Set(open.map(getPriorityWorkflowKey));
const openItems = queue.orderedItems.filter(i =>
  i.kind !== 'attention' || openKeys.has(getPriorityWorkflowKey(i.attentionItem!.objective!))
);
const completedAttentionItems = queue.orderedItems.filter(i =>
  i.kind === 'attention' && !openKeys.has(getPriorityWorkflowKey(i.attentionItem!.objective!))
);
```

(The exact call-site key comparison above is illustrative of the required logic, not a mandated literal implementation — the implementer may thread the already-computed `open`/`completed` `PortfolioObjective[]` arrays through instead of recomputing key sets, as long as the comparison uses `getPriorityWorkflowKey`, never `objective.id`, consistent with why `priorityWorkflowState.ts` was built this way originally.)

**Today's Priorities workflow component (`features/portfolio/priorities` or a new sibling under it — implementer's naming choice, no behavior difference) reuses, unchanged:** `loadPriorityWorkflowState`, `savePriorityWorkflowState`, `markComplete`, `reopenPriority`, `isCompletable`, `getPriorityWorkflowKey`, `computeObjectiveFingerprint`, `partitionPriorities`. It calls `markComplete`/`reopenPriority` only for `kind: 'attention'` items (the Mark Complete button is never rendered for `covered_call_opportunity`/`needs_follow_up` items, exactly as it is never rendered for `WAIT` today via `isCompletable`).

**No parallel state model.** There is exactly one `PriorityWorkflowState` shape, one storage key, one set of mutation functions, used by both Today's Priorities and Priority List. Neither surface writes a second key or a second schema.

## 8. Fingerprint and Automatic-Reopening Preservation

Unchanged, by construction: `computeObjectiveFingerprint()` and `getPriorityWorkflowKey()` are pure functions of the `PortfolioObjective` itself (`ruleId`, `subject`, `priority`, `urgency`, `actionability`, `summary`, `supportingEvidence` values) — they have no dependency on which bucket, dashboard, or UI presented the objective. The same objective reaching Today's Priorities via the new queue, or Priority List via `canonicalPriorities.objectives`, produces byte-identical keys and fingerprints. Presentation restructuring (new component tree, new grouping, new queue wrapper) cannot change a fingerprint, since fingerprints never read anything about presentation.

| State/event | Current behavior | WA-0003 behavior | Canonical source | Persistence effect | Required test |
|---|---|---|---|---|---|
| Mark Complete (attention item) | Only available in Priority List | Available in both Priority List and Today's Priorities | `markComplete()` (unchanged) | Writes `hunter-priorities-workflow-state` | New: Today's Priorities Mark Complete persists and matches Priority List's read |
| Reopen (attention item) | Only available in Priority List | Available in both | `reopenPriority()` (unchanged) | Writes same key | New: Reopen from Today's Priorities returns item to Priority List's open list too |
| Refresh | State reloaded from `localStorage` on mount | Unchanged | `loadPriorityWorkflowState()` (unchanged) | Read-only | Existing coverage extended to Today's Priorities' mount |
| Fingerprint materially changes post-completion | Auto-reopens on next `partitionPriorities()` call, persists only if `reconciliationChanged` | Unchanged; now also observable from Today's Priorities | `partitionPriorities()` (unchanged) | Conditional write | Existing coverage; new test confirms Today's Priorities' queue reflects the reopened item |
| Non-material (presentation-only) change | Does not reopen (fingerprint excludes presentation fields) | Unchanged | `computeObjectiveFingerprint()` (unchanged) | None | New: confirms the queue-wrapper itself introduces no fingerprint-affecting field |
| WAIT objective encountered | Never completable (`isCompletable` false); never enters Priority List's actionable flow meaningfully (single-item empty-like state) | Never enters the queue at all (§4) | `isCompletable()` (unchanged) | None | Existing coverage; new test confirms WAIT cannot reach `buildTodaysPrioritiesQueue()`'s output |
| Covered-call opportunity present | Shown, no action | Shown in queue, no Mark Complete control, self-resolves when lifecycle reclassifies | New queue wrapper only | None (no `PriorityWorkflowState` entry ever created) | New: confirms no Mark Complete control renders; confirms disappearance when input no longer includes it |
| `needsFollowUp` review present | Shown on `today` tab, no action | Shown in queue, no Mark Complete control, resolves via existing Decision Review outcome workflow | New queue wrapper only | None | New: confirms no Mark Complete control renders; confirms disappearance once outcome recorded (existing `reviewsNeedingFollowUp` behavior) |

## 9. Completed-Section Behavior

- **Default collapsed state:** collapsed by default, mirroring the existing "Show all" pattern already used by the dashboard's Monitor section (`TodaysPrioritiesDashboard.tsx`'s `monitorExpanded` state) — reused as the interaction pattern, not the component itself.
- **Completed-item count:** `completedAttentionItems.length` (§7), shown next to the section header, exactly like every existing `SectionHeader`'s `count` prop pattern already in `TodaysPrioritiesDashboard.tsx`.
- **Empty state:** when zero completed items exist, the Completed section either renders nothing (matching `TodaysPrioritiesWorkflow.tsx`'s existing `completed.length > 0 &&` guard) or a minimal "Nothing completed yet." label — implementer's choice; either matches existing precedent.
- **Reopen placement:** identical to today's Priority List — a `Reopen` button on each completed card, calling `handleReopen`.
- **Collapse state persistence:** not persisted (resets to collapsed on navigation/refresh) — this is a pure UI convenience state, not workflow state, and the CES does not require it to survive navigation (only the completion state itself must survive, per ruling 5, which it does via `localStorage`).
- **Rationale visible on completed items:** identical fields to open items — `PriorityCard`'s existing expand/collapse reveals `objective.rationale`, `supportingEvidence`, `concerns`, `reviewTriggers`, and the four impact dimensions, unchanged, for both open and completed cards (this is `TodaysPriorities.tsx`'s existing, unmodified rendering — completed items are still full `PortfolioObjective` cards, just filtered into a different section).
- **Destination link:** completed items carry the same deep-link contract as open items (§13) — completion does not remove or alter the item's identity/destination.
- **Automatically reopened items:** return to the Open section on the very next render after `reconciliationChanged` is detected (existing `TodaysPrioritiesWorkflow.tsx` effect behavior, unchanged), which also removes them from Completed.
- **Open/completed counts:** open count = queue length minus completed-attention-items length (§5); this excludes completed items from the open count by construction, satisfying the explicit requirement.
- **No trade-execution history or audit log** is created — the Completed section shows exactly the same `PortfolioObjective` data Priority List already shows for a completed item; nothing about trade execution, broker state, or an audit trail is introduced.

## 10. Healthy-Monitoring Relocation

**Current location:** `features/portfolio/dashboard/TodaysPrioritiesDashboard.tsx`'s "Monitor" section (`MonitorRow`, showing symbol/strategy/DTE/health-score, collapsed after 6 with a "Show all" toggle) — the `today` tab only. Not duplicated anywhere else; not shown on Positions today (WA-0002 confirmed Positions' own position cards show full detail per-position, but there is no dedicated "these are the healthy ones" grouping/summary on Positions).

**Relocation plan:** extract `MonitorRow` (and its collapse-after-6 interaction) out of `TodaysPrioritiesDashboard.tsx` into a new, small, standalone component — `features/portfolio/positions/HealthyMonitoringSection.tsx` — taking the exact same `TodaysPrioritiesMonitorEntry[]` input, unchanged. Mount it on the Positions tab, above the position list (alongside WA-0002's `PositionCompositionCard`, order at the implementer's discretion since both are informational, not task-oriented). The `today` tab's own Monitor section is removed entirely (Today's Priorities becomes action-only, per ruling 1's explicit exclusion).

**Requirements satisfied:**
- Healthy positions remain visible (via this new section, and — independently — via their own always-rendered position cards further down Positions, which WA-0002 already left untouched).
- Clearly monitoring information, not a task: no Mark Complete control, no inclusion in any open/queue count, `aria-label="Healthy Position Monitoring"` (or similar), visually distinct from the action queue (which no longer exists on this page at all — Positions has never had one).
- Health/objective computation is completely unchanged — this section reads the same `TodaysPrioritiesMonitorEntry` fields (`healthScore`, `dte`, etc.) already computed by `buildTodaysPrioritiesDashboard()`, unmodified.
- Smallest safe relocation: one component extracted verbatim, one new mount point, one deletion of the old mount point — no other Positions content is touched, and this does not revisit WA-0002's position-card boundaries.

## 11. Mission Control Summary Reduction

**Current:** `AttentionRequiredSection.tsx` renders the *entire* `narrative.attention.items` list as full cards (headline, recommended action, confidence, why-now) — a second, complete working list, not a summary.

**New:** `AttentionRequiredSection.tsx` (or a renamed replacement, e.g. `AttentionSummarySection.tsx` — cosmetic naming choice) renders exactly:
1. **Lead open item** — headline text (reuses `SummaryStrip.tsx`'s existing `leadItemHeadline()`-style logic, now sourced from the new queue's `leadItem`, not `narrative.leadItem`, per the ruling-6 parity requirement below).
2. **Open-attention count** — a single number.
3. **Compact condition summary** — one line, e.g. "`{count} items need your attention today.`" (reusing `SummaryStrip.tsx`'s existing `attentionSummary()` phrasing pattern).
4. **Contextual deep link** — one link/button targeting **Today's Priorities, not the item's downstream destination** (corrective ruling): `?tab=todays-priorities&priority=<encoded leadItem.stableKey>`, labeled e.g. "Open in Today's Priorities." This link never points at `?tab=positions&focus=…` or `?tab=history&reviewId=…` directly — Mission Control's lead-item identity, open count, and link target all come from the same partitioned queue (below), so the link target and the count it accompanies cannot drift apart, and the item's actual position/review destination is reached only as a second, separate hop from inside Today's Priorities (§13).

**Removed:** the full per-item card list; any implied Mark Complete/Reopen surface (none existed, so nothing to remove there, but this confirms none is added).

**Parity requirement (ruling 6) — disclosed design decision, not a product ambiguity:** `narrative.attention.items`/`narrative.counts.attention` (from `conductReview()`) are **not** used as the count/lead-item source for this reduced summary, because that collection is deliberately filtered to exclude items a Trader-Commitment "Since Your Last Review" change already covered this cycle (§2) — using it here would let Mission Control's count silently diverge from Today's Priorities' true open count whenever that filter is non-empty (currently always empty in production, since no commitment persistence exists yet, but this CES must not build in a latent drift). Instead, `buildMissionControlViewModel()` gains one new, additive step: build `buildTodaysPrioritiesQueue()` from the same `dashboard` it already has, partition it against the same `workflowState` Today's Priorities uses (threaded in as a new, optional input — read from `localStorage` by `app/dashboard/page.tsx` itself, exactly mirroring `TodaysPrioritiesWorkflow.tsx`'s existing pattern; `buildMissionControlViewModel()` itself stays pure, taking `workflowState` as plain data), and expose the result as a new field, e.g. `MissionControlViewModel.todaysPriorities: { leadItem, openCount, deepLink }`. `conductReview()`, `ReviewNarrative`, and every existing field on it are **completely unchanged** — this is a second, parallel, additive summary computed alongside the existing narrative, not a modification to it. "Since Your Last Review" keeps its own existing semantics for its own section; the new Attention summary now genuinely cannot drift from Today's Priorities, because both are built from the identical queue and the identical workflow state.

**Defined behaviors:**
- **No open items exist:** lead item text reads "Nothing needs your attention right now." (reusing `AttentionRequiredSection.tsx`'s existing empty-state copy); count reads 0; no deep link rendered.
- **All eligible items completed:** identical to "no open items exist" — completion removes items from the open queue exactly as it does for Today's Priorities, since both read the same partitioned result.
- **Former lead item completed:** the next-highest-scored open item becomes lead on the next render (pure recomputation, no special-cased "was this the lead" state needed).
- **An item automatically reopens:** re-enters the open queue at its natural score position (§6); may become lead again if it is now the highest-scored open item.
- **Mission Control ↔ Today's Priorities count relationship:** identical by construction (§5's open-count definition, computed once via the shared queue+partition logic, consumed by both).

## 12. Priority List Temporary Coexistence

Priority List (`features/portfolio/components/TodaysPriorities.tsx`, `TodaysPrioritiesWorkflow.tsx`, the `priorities` tab) is **not modified** beyond what already follows from §7-8: it continues to call `partitionPriorities(canonicalPriorities.objectives, workflowState)` against the identical storage key, identity scheme, and fingerprint scheme Today's Priorities now also uses. No divergent completion state, no conflicting open counts (the two surfaces' open item *sets* can differ slightly in *membership*, since Priority List's source array — `canonicalPriorities.objectives` — is not identical to the new queue's source, e.g. Priority List has never shown CC opportunities or `needsFollowUp` at all; but any item present on *both* surfaces shares one completion record, one fingerprint, one eligibility rule, by construction, since both call the same functions against the same state). No two sources of truth for completion: `priorityWorkflowState.ts` remains the only one, read/written by both.

Navigation may promote Today's Priorities as the primary entry point (e.g., default sub-tab ordering, or copy emphasizing it), but this CES does not require removing or hiding the `priorities` tab, its label, or its content. Its `TodaysPriorities`/`TodaysPrioritiesWorkflow` components are not redesigned. Final retirement remains WA-0006, contingent on the Briefing (WA-0004) and Opportunities (WA-0005) migrations WA-0001 already sequenced ahead of it.

| Current content/component | Current location | WA-0003 disposition | Final owner | Timing | Rationale |
|---|---|---|---|---|---|
| `TodaysPriorities.tsx` / `TodaysPrioritiesWorkflow.tsx` / `priorityWorkflowState.ts` | `priorities` tab | RETAIN, unchanged | Today's Priorities (shared) / Priority List (temporary) | WA-0003 (retained); retired WA-0006 | Ruling 7: temporary regression safety net, shared canonical state |
| `today` tab's Immediate Action / Review Today / Opportunities sections | `today` tab | MOVE (become the new Today's Priorities workspace's primary content, extended with Mark Complete/Reopen and the unified queue) | Today's Priorities | WA-0003 | Ruling 1: this is the finite action queue's natural home already |
| `today` tab's Monitor section | `today` tab | MOVE (relocate to Positions, §10) | Positions | WA-0003 | Ruling 2 |
| Mission Control's full Attention Required list | `/dashboard` | REDUCE (lead item + count + summary + deep link only) | Mission Control (summary) / Today's Priorities (full experience) | WA-0003 | Ruling 6 |
| `today` tab itself (as a distinct sub-tab from the new Today's Priorities) | `/portfolio` sub-tab bar | RETIRE the separate `today` tab identity — its content becomes Today's Priorities' content directly (one workspace, not two overlapping tabs) | Today's Priorities | WA-0003 | Avoids two sub-tabs both claiming to be "today's priorities"; not a new redesign, a consolidation the frozen architecture already implies (one workspace, one job) |

## 13. Deep-Link Contract (corrective ruling: two distinct link levels)

**No existing mechanism exists** (confirmed, §2) — this is new, minimal, mechanical infrastructure, not new domain intelligence. Per frozen product ruling 6, Mission Control's contextual link must open the exact corresponding item **within Today's Priorities** — it must never bypass Today's Priorities and jump straight to Positions or Decision History. This requires two distinct, separately-specified link levels.

### 13.1 Level 1 — Mission Control → Today's Priorities

**URL contract:**

```
/portfolio?tab=todays-priorities&priority=<url-encoded stableKey>
```

This parameter (`priority`) is **distinct from, and never conflated with,** the level-2 parameters (`focus`, `reviewId`) below — it identifies a *queue item*, not a *position* or a *review*, and the two are resolved at different times by different code paths.

**Identifier:** the item's `stableKey` (§7, `getStableQueueKey()`), computed once at queue-build time and carried unchanged through both Mission Control and Today's Priorities. By construction this satisfies every item kind:

- Attention item: `attention::${getPriorityWorkflowKey(objective)}` — the canonical workflow identity already used for completion state, never a regenerated `objective.id`.
- Covered-call opportunity: `cc::${opportunity.key}` — namespaced on the existing position key.
- Decision-review follow-up: `review::${review.id}` — namespaced on the existing review id.

The `attention::` / `cc::` / `review::` namespace prefix is mandatory and prevents collisions across kinds (e.g. a covered-call opportunity's position key living in the same string space as an attention item's `subjectKey`). No display text, list position, symbol-only value, or DOM assumption is ever used as this identifier.

**Target behavior:** on mount of the `todays-priorities` tab (and on `priority` param change), the Today's Priorities workspace component looks up the queue item by exact `stableKey` match against the current `buildTodaysPrioritiesQueue()` output, then expands its card, applies a visible highlight treatment, and scrolls it into view (`scrollIntoView({ block: 'center' })`) — reusing whatever expand/collapse state the queue item's renderer (`PriorityCard` / `CoveredCallOpportunityRow` / `NeedsFollowUpRow`) already has, no new expand mechanism invented. This works uniformly for all three kinds — attention items, covered-call opportunities, and decision-review follow-ups — since resolution is by `stableKey`, not by kind-specific logic.

**Fail-safe behavior:** if no current queue item matches `priority=<key>` (the item completed, self-resolved, or the underlying data no longer produces it), render a small, dismissible inline notice ("This priority is no longer open.") and fall through to Today's Priorities' normal, unfocused rendering — never a blank page, thrown error, or silent no-op.

**Refresh behavior:** the `priority` param persists across a full page reload (URL-carried, not client memory); the same `stableKey` re-resolves identically, or hits the fail-safe above if the item has since resolved.

**Back-button behavior:** standard browser history — navigating back returns to whatever preceded the link (typically `/dashboard`); no custom history manipulation.

### 13.2 Level 2 — Today's Priorities → action destination

Once a priority card is focused (via level 1, or by the trader simply browsing to it), it retains its own, already-specified applicable destination — unchanged from the single-level design this replaces, just no longer reachable directly from Mission Control:

- **Position-linked item** (attention items with a position `subjectId`; covered-call opportunities) → `?tab=positions&focus=<url-encoded pos.key>`. Resolution is by exact `pos.key` match only — never symbol-only matching, since multiple positions can share a symbol at different expirations and `pos.key` already disambiguates that (§2).
- **Decision-review follow-up** → `?tab=history&reviewId=<DecisionReview.id>`.
- **Portfolio-level item** with no `subjectId` (`REDUCE_CONCENTRATION`, `PRESERVE_BUYING_POWER`, `DEPLOY_IDLE_CASH`/CSP-opportunity — genuinely not tied to one existing position) → `?tab=positions` with no `focus` param — the most specific honest destination currently available; landing on the general Positions view is correct here since no more specific one exists (ruling 8's "insufficient" language applies to items that *do* have a position identity and are shortchanged to a generic page, not to items with no position identity at all).
- **Missing destination** (target position/review closed or no longer resolvable) → the same fail-safe notice pattern as level 1, scoped to Positions/History instead of Today's Priorities.

**Target behavior:** identical mechanics to the pre-correction single-level design — `app/portfolio/page.tsx` resolves `focus`/`reviewId` by exact key match, scrolls into view, expands the target (`PositionCard`'s existing `expanded` state) or highlights the target (`DecisionHistoryView.tsx`'s matching `DecisionReview` entry). No new expand/highlight mechanism beyond what already exists for these two destinations.

**Refresh / back-button / mobile behavior:** identical to level 1 — URL-carried, standard browser history, viewport-independent (WA-0002 already confirmed one shared tab-bar component for all viewports).

**Missing-target fallback:** identical pattern to level 1, scoped to the level-2 destination.

**Tests required (both levels):** exact `stableKey` match opens the correct queue item regardless of kind; exact `pos.key` match at level 2; two positions sharing a symbol resolve to distinct level-2 targets; two priorities for the same position (e.g. an attention item and a covered-call opportunity on the same `pos.key`) resolve to distinct level-1 targets via their distinct namespaced `stableKey`s and are never confused; refresh preserves both level-1 and level-2 focus; back navigation from Today's Priorities returns to Mission Control normally, and from Positions/History returns to Today's Priorities normally; a level-1 target that has since completed or self-resolved renders the fail-safe notice, not a crash, and does not attempt level-2 navigation; a level-2 target that is missing renders its own fail-safe notice; `needsFollowUp` level-2 link lands on History, not Positions; portfolio-level item's level-2 link lands on unfocused Positions; Mission Control never navigates directly to `?tab=positions&focus=…` or `?tab=history&reviewId=…` for any item kind.

## 14. Navigation and Persisted-State Handling

- **New `activeTab` value:** the `today` tab identity is retired (§12); `'positions' | 'briefing' | 'priorities' | 'history' | 'balances'` gains a new value, `'todays-priorities'`, replacing `'today'` in the type union and tab array (same mechanical pattern WA-0002 already used to remove `'mission-control'`).
- **Default tab:** `/portfolio` continues to default to `'positions'` during WA-0003 — resolved, not open (§23's final ruling; superseded from "flagged for Dean/Paul" to decided). Deep links may explicitly select any of `'todays-priorities'`, `'positions'`, or `'history'` via the `tab` query parameter, independent of the default. The general landing-default question is reconsidered only after WA-0004 and WA-0005 establish the complete 5-workspace experience — not reopened by this CES.
- **`priority` query-param resolution (new, corrective ruling, §13.1):** on mount of the `todays-priorities` tab, `app/portfolio/page.tsx` (or the new Today's Priorities workspace component it mounts) reads `priority` from the URL, resolves it against the current `buildTodaysPrioritiesQueue()` output by exact `stableKey` match, and expands/highlights/scrolls to the match, or renders the fail-safe notice on no match (§13.1). This is a new, small, additive effect — analogous in shape to the existing `focus`/`reviewId` handling on Positions/History, but keyed on `stableKey`, not `pos.key` or `reviewId`.
- **`focus`/`reviewId` query-param resolution (§13.2):** unchanged in mechanics from the pre-correction design — still resolves on Positions/History by exact `pos.key`/`reviewId` match — but is now reached only as a second hop from within Today's Priorities (a card's own destination link), never linked to directly by Mission Control.
- **No persisted tab-selection state exists today** (confirmed, WA-0002); this CES adds none beyond the `tab`/`priority`/`focus`/`reviewId` query parameters themselves, which are transient (present only while following a specific link) and safely absent otherwise.
- **Portfolio Mode:** unaffected — the fail-closed gate (`portfolioMode.status === 'ready' && mode === 'LIVE'`) sits above all tab content, including the new deep-link resolution, which only runs after that gate already passed (identical to every other piece of tab content today).
- **Background Task visibility:** unaffected — no file this CES touches is anywhere near `RankedScanTaskMirror`/`ScreenerJobStatus`/background-task state.
- **WA-0002 transitional Briefing content:** unaffected — `DailyBriefingCard`'s `variant="transitional"` mount on Positions is untouched by this CES; the new `HealthyMonitoringSection` (§10) and deep-link focus behavior are additive alongside it, not a replacement.

## 15. Exact Component Plan

- **New:** `lib/todays-priorities-queue/types.ts`, `buildTodaysPrioritiesQueue.ts`, `index.ts` (§7) — includes `getStableQueueKey()` (§7, corrective ruling), the single place every consumer's `stableKey` is derived.
- **New:** `features/portfolio/positions/HealthyMonitoringSection.tsx` (§10, extracted from `TodaysPrioritiesDashboard.tsx`'s `MonitorRow` + collapse logic).
- **New (or repurposed):** a Today's Priorities workspace component — either a new `features/portfolio/todaysPriorities/TodaysPrioritiesQueueView.tsx` composing the existing bucketed section layout (Immediate Action / Review Today / Opportunities, minus Monitor) with the new queue + Mark Complete/Reopen wired in, or an evolution of the existing `TodaysPrioritiesWorkflow.tsx` retargeted at the new queue instead of raw `PortfolioObjective[]`. Either approach reuses `TodaysPriorities.tsx`'s existing `PriorityCard` rendering for `kind: 'attention'` items, and adds two small new row renderers (reusing `CoveredCallOpportunityRow`/`NeedsFollowUpRow`, extracted from `TodaysPrioritiesDashboard.tsx` rather than rewritten) for the two new kinds. **New (corrective ruling):** this component also owns `priority` query-param resolution (§13.1/§14) — matching by `stableKey` against the current queue, expanding/highlighting/scrolling to the match, and rendering the level-1 fail-safe notice on no match — and renders each focused card's existing level-2 destination link (§13.2) rather than Mission Control linking to that destination directly.
- **Changed:** `lib/mission-control/types.ts`/`buildMissionControlViewModel.ts` — one new additive field (§11), whose `deepLink` is now `?tab=todays-priorities&priority=<stableKey>` (never a level-2 URL).
- **Changed:** `components/mission-control/AttentionRequiredSection.tsx` (or its renamed replacement) — reduced to lead item/count/summary/deep-link (§11); its one link always targets Today's Priorities, never Positions or Decision History directly (corrective ruling).
- **Changed:** `app/dashboard/page.tsx` — reads `loadPriorityWorkflowState()` on mount (new, small `useEffect`, mirroring `TodaysPrioritiesWorkflow.tsx`'s existing pattern) and threads it into `buildMissionControlViewModel()`.
- **Changed:** `app/portfolio/page.tsx` — retire the `today` tab identity/import in favor of the new Today's Priorities component; mount `HealthyMonitoringSection` on Positions; add `focus`/`reviewId` query-param resolution scoped to Positions/History (§13.2), reached only as a second hop from Today's Priorities.
- **Changed:** `features/portfolio/dashboard/TodaysPrioritiesDashboard.tsx` — Monitor section removed (extracted, not duplicated); this file may be retained for its remaining sections if reused directly by the new workspace component, or retired if fully superseded — implementer's call, contingent on §16/§17's deletion criteria being met at implementation time.
- **Unchanged:** every canonical engine (`lib/portfolio-intelligence`, `lib/priorityScore`, `lib/todaysPriorities/dashboard.ts`, `lib/decision-review`, `lib/morning-briefing/attentionFeed.ts`, `lib/review-conductor/conductReview.ts`), `PositionIntelligencePanel`, `PositionCard`'s core rendering, `PositionCompositionCard`, `PositionRiskBadges`, `DailyBriefingCard`.

## 16. Exact File-Impact Analysis

| File | Expected change | Reason | Risk | Validation |
|---|---|---|---|---|
| `lib/todays-priorities-queue/*` (new) | New files | Houses the one new, additive composition function (§7) | Low — additive, no existing consumer to break | New unit tests |
| `features/portfolio/positions/HealthyMonitoringSection.tsx` (new) | New file, extracted from `TodaysPrioritiesDashboard.tsx` | Relocates healthy monitoring to Positions (§10) | Low — verbatim extraction of already-tested rendering | New unit tests seeded from any existing Monitor-section assertions |
| `features/portfolio/dashboard/TodaysPrioritiesDashboard.tsx` | Remove Monitor section; possibly retire the whole file if its remaining sections are absorbed into a new component | Consolidating `today` tab into Today's Priorities (§12, §15) | Medium — this file's remaining sections' presentation logic must not be lost, only relocated | Re-run/port its existing tests (if any exist — none were found under `features/portfolio/dashboard/__tests__/`; confirm at implementation time) against the new location |
| `app/portfolio/page.tsx` | Retire `today` tab entry/type-union value/import; mount new Today's Priorities component under a new `'todays-priorities'` tab key; mount `HealthyMonitoringSection` on Positions; add `focus`/`reviewId` query-param resolution and fallback notice, now reached only as a level-2 hop from Today's Priorities (§13.2), never linked to directly by Mission Control | Core consolidation + level-2 deep-link infrastructure | Medium — large file; localized changes, but the query-param effect must not interfere with existing `activeTab`/`showIntelligence`/`expanded` state | New tests for query-param resolution, fallback, and default-tab non-regression (extending WA-0002's own `PortfolioPage.test.tsx` pattern); confirms `'positions'` remains the default |
| New Today's Priorities workspace component(s) — `priority` param handling | Add `stableKey`-based `priority` query-param resolution (§13.1), expand/highlight/scroll on match, fail-safe notice on no match | Level-1 deep-link infrastructure — corrective ruling | Medium — must not confuse `priority` (queue-item focus) with `focus`/`reviewId` (level-2, destination focus); must disambiguate same-position items across kinds via namespaced `stableKey` | New tests: exact `stableKey` match per kind; two priorities on the same position resolve to distinct targets; refresh preserves focus; missing target renders fail-safe, not crash |
| `features/portfolio/priorities/priorityWorkflowState.ts` | **No change** | Already correctly identity/fingerprint-scoped; reused as-is (§7-8) | None | Existing 24 tests must still pass unmodified |
| `features/portfolio/components/TodaysPriorities.tsx` / `TodaysPrioritiesWorkflow.tsx` | **No change** | Priority List retained temporarily, unmodified (§12) | None | Existing 20 + 15 tests must still pass unmodified |
| New Today's Priorities workspace component(s) | New file(s) | The finite action queue's new home (§15) | Medium — new composition of existing renderers; must not reintroduce duplicate items across sections (dedup already guaranteed by `buildAttentionFeed`) | New tests: queue membership, ordering, Mark Complete/Reopen, shared-state parity with Priority List |
| `lib/mission-control/types.ts` | Add one field to `MissionControlViewModel` | Additive summary data (§11) | Low — additive, existing fields untouched | Existing 9 tests unaffected; new tests for the added field |
| `lib/mission-control/buildMissionControlViewModel.ts` | Add one additional input (`workflowState`) and one computation step | Same | Low-Medium — must not change any existing return field's value | Existing tests re-run to confirm byte-identical existing-field output; new tests for the new field |
| `components/mission-control/AttentionRequiredSection.tsx` | Reduce to lead item/count/summary/deep link | Ruling 6 | Medium — removes a currently-rendered full list; must not break `MissionControl.tsx`'s existing narrative-order test | Update `MissionControl.test.tsx` assertions for the new, smaller section content |
| `app/dashboard/page.tsx` | Add a small `useEffect` reading `loadPriorityWorkflowState()`; thread it into `buildMissionControlViewModel()` | Ruling 6 parity requirement (§11) | Low — read-only, additive, mirrors existing precedent exactly | New test or extension of existing dashboard-page coverage, if any exists (confirm at implementation time) |
| `lib/review-conductor/conductReview.ts`, `lib/morning-briefing/attentionFeed.ts`, `lib/todaysPriorities/dashboard.ts`, every objective/health/recommendation engine | **No change** | Canonical logic explicitly out of scope | None | Existing full suites re-run unchanged |

## 17. Deletion and Extraction Criteria

Applying the same four-criteria test WA-0002 established (zero remaining consumers; no orphaned test; no domain computation lost; capability either fully duplicated elsewhere or has a named future owner):

- **`TodaysPrioritiesDashboard.tsx`'s Monitor section:** extraction, not deletion of capability — `HealthyMonitoringSection.tsx` is its new, sole consumer-facing form. No domain dependency lost (reads the same `TodaysPrioritiesMonitorEntry[]`).
- **`TodaysPrioritiesDashboard.tsx`'s remaining three sections:** if fully absorbed into the new Today's Priorities workspace component with equivalent-or-better presentation (Mark Complete/Reopen added), the original file's remaining rendering may be retired — but only once implementation-time inspection confirms (a) no other consumer imports it (currently: `app/portfolio/page.tsx`'s `today` tab is its only consumer) and (b) every field it rendered is still rendered somewhere in the new component. If any test file exists for it, migrate relevant assertions first, exactly as WA-0002 required for `PortfolioReviewCard`.
- **`components/mission-control/AttentionRequiredSection.tsx`:** not deleted — reduced in place (its existing sole consumer, `MissionControl.tsx`, keeps importing it; only its internal rendering shrinks).
- **Nothing under `lib/` is deleted or extracted** — every canonical engine file is unchanged.
- **Priority List files:** explicitly not deletion candidates this sprint (ruling 7).

## 18. Implementation Sequence

1. Add `lib/todays-priorities-queue/` (new, additive, independently testable) — including `getStableQueueKey()` (§7, corrective ruling) — and its tests; test the namespaced-key scheme (no cross-kind collisions) before anything else depends on it.
2. Extract `HealthyMonitoringSection.tsx` from `TodaysPrioritiesDashboard.tsx`'s Monitor section; add its tests; mount it on Positions (additive — does not yet remove anything from the `today` tab).
3. Build the new Today's Priorities workspace component(s), wiring the new queue + reused `priorityWorkflowState.ts` functions + reused `PriorityCard`/`CoveredCallOpportunityRow`/`NeedsFollowUpRow` renderers; add its tests. Mount it under a new `'todays-priorities'` tab key, alongside (not yet replacing) the existing `today` tab.
4. Add the `priority` query-param resolution (level 1, §13.1) — `stableKey` match, expand/highlight/scroll, fail-safe notice — to the new Today's Priorities workspace component; add its tests, including same-position/different-kind disambiguation.
5. Add the `focus`/`reviewId` query-param resolution and fallback notice (level 2, §13.2) to `app/portfolio/page.tsx`, reachable only from a focused Today's Priorities card; add its tests.
6. Remove the `today` tab's Monitor section (now redundant with step 2) and, once the new workspace component in steps 3-5 is confirmed equivalent-or-better, retire the `today` tab entry/type-union value/import entirely.
7. Add the `workflowState`-threading and one new field to `lib/mission-control`, with `deepLink` built as `?tab=todays-priorities&priority=<leadItem.stableKey>` (never a level-2 URL); add its tests.
8. Reduce `AttentionRequiredSection.tsx` to lead item/count/summary/level-1 deep link only; update `MissionControl.test.tsx`, including an assertion that its link never targets `?tab=positions` or `?tab=history` directly.
9. Full targeted test run (`lib/todays-priorities-queue`, `lib/mission-control`, `lib/todaysPriorities`, `lib/morning-briefing`, `lib/review-conductor`, `features/portfolio/**`, `components/mission-control`) plus `tsc --noEmit` and `git diff --check` (implementation-time, not this CES).

Rationale: additive infrastructure first (steps 1-5, all independently verifiable, zero regression risk), consolidation/removal last (steps 6-8, only after their replacements are proven).

## 19. Acceptance Criteria

- Today's Priorities is the primary finite action queue; the `today` tab identity no longer exists as a separate surface from it.
- Immediate Action and Review Today items (including `needsFollowUp`) appear in the open queue exactly when canonically eligible, per §4's matrix.
- Roll, CSP, and covered-call opportunities appear in the open queue without any Screener-discovered candidate ever appearing there.
- `WAIT`-only objectives never appear in the open queue.
- Healthy-position monitoring never appears in the open queue, and is permanently, clearly visible on Positions instead.
- Completed items are excluded from the open count.
- Mark Complete and Reopen, wherever offered, call the existing `markComplete()`/`reopenPriority()` functions unmodified.
- Completion state recorded before this sprint survives this sprint's deployment, and survives refresh and navigation after it.
- `WAIT` objectives remain structurally incapable of being marked complete.
- A material fingerprint change automatically reopens a completed objective, on both Today's Priorities and Priority List, from the one shared state.
- Completed items remain available, with full rationale and destination, in a collapsed section.
- Today's Priorities and Priority List cannot diverge in completion state for any item both surfaces can display (same key, same fingerprint, same `localStorage` record).
- Mission Control shows only the approved summary (lead item, open count, compact summary, deep link) — no full duplicate work queue, no Mark Complete/Reopen control.
- Mission Control's open count and Today's Priorities' open count are computed from the identical queue+partition logic and cannot drift.
- Mission Control's lead item equals the canonical open queue's first item.
- **Mission Control's lead-item link opens the exact corresponding item within Today's Priorities** (`?tab=todays-priorities&priority=<stableKey>`) — never navigates directly to Positions or Decision History, for any item kind (attention, covered-call opportunity, or decision-review follow-up).
- **The queue-item target is identified by a deterministic, namespaced `stableKey`** (`attention::…` / `cc::…` / `review::…`), never by display text, list position, symbol-only matching, or DOM assumptions.
- **Multiple priorities for the same position cannot be confused** — each carries its own distinct, namespaced `stableKey` and resolves to its own distinct level-1 target.
- **The focused priority card is visibly expanded or highlighted** within Today's Priorities once opened via the level-1 link, and is scrolled into view.
- **Refresh preserves queue-item focus** — the `priority` param round-trips through a full page reload and re-resolves the same item (or hits the fail-safe if it has since resolved).
- **Back navigation from Today's Priorities returns to Mission Control normally**, using standard browser history, with no custom manipulation.
- **Completing or self-resolving the targeted item produces a safe "no longer open" state** — never a crash, blank page, or silent no-op — when its `priority` link is followed afterward.
- **The focused priority's downstream destination still opens the exact position or review** — every position-linked queue item's level-2 link opens the exact corresponding position (by `pos.key`), not merely `/portfolio` in general; `needsFollowUp` items link to Decision History instead, since their position is already closed; portfolio-level items with no `subjectId` land on unfocused Positions as the most specific honest destination available.
- **Mission Control's lead-item identity, open count, and level-1 link target all derive from the same partitioned queue** — none is independently recomputed or sourced from `narrative.attention`/`narrative.counts.attention`.
- A missing level-1 or level-2 deep-link target (item resolved, or closed/nonexistent position or review) fails safely with a visible notice, never a crash or blank page.
- Recommended Action / rationale and Supporting Evidence remain visible for every queue item that has them, unchanged from today's existing rendering.
- Priority List remains fully functional, unmodified in behavior, and is not retired.
- `/dashboard` retains every other accepted MB-0002 Mission Control behavior (Portfolio Status, Since Your Last Review, New Opportunities, Review Complete) unchanged.
- WA-0002's transitional Briefing content on Positions is unchanged.
- Background task visibility and Portfolio Mode gating are unaffected.
- `/portfolio` continues to default to the `'positions'` tab (§23, final ruling); deep links may explicitly select `'todays-priorities'`, `'positions'`, or `'history'` via the `tab` parameter.
- No file under `lib/portfolio-intelligence`, `lib/priorityScore`, `lib/todaysPriorities/dashboard.ts`, `lib/decision-review`, `lib/morning-briefing/attentionFeed.ts`, or `lib/review-conductor/conductReview.ts` has any executable line changed.

## 20. Test Plan

- **Queue membership** (`lib/todays-priorities-queue`, new): Immediate Action included; Review Today (including `needsFollowUp`) included; roll/CSP/covered-call opportunities included; `WAIT` excluded; healthy/Monitor excluded; screener candidates never included; a completed item's exclusion is verified one layer up (partitioning test, not the queue builder itself, which is completion-agnostic by design).
- **Completion workflow** (new component tests + existing `priorityWorkflowState.test.tsx` re-run unmodified): Mark Complete persists; refresh persistence; navigation persistence; Reopen; `WAIT` cannot be completed (already covered, re-confirmed reachable from the new surface); material fingerprint change auto-reopens; non-material presentation-only change does not reopen; Today's Priorities and Priority List share state (a new cross-surface test: complete via one, assert open/completed membership via the other, same `localStorage`).
- **Completed section:** collapsed by default; correct count; empty state; Reopen returns the item to the open queue; rationale/evidence/destination preserved on completed cards.
- **Mission Control summary:** lead item matches queue head; open count matches Today's Priorities' open count; no-open-items state; lead item changes after completion; a reopened item re-enters the summary and can become lead; deep link is a level-1 (`?tab=todays-priorities&priority=<stableKey>`) link targeting the exact same item Today's Priorities would show as lead, never a level-2 URL; lead-item identity, open count, and link target are all asserted to derive from the identical queue+partition call, not from `narrative.attention`/`narrative.counts.attention`.
- **Healthy monitoring:** healthy position remains visible on Positions; not shown as an open task anywhere; no completion control rendered for it; health score/DTE values unchanged from the pre-migration `TodaysPrioritiesMonitorEntry` fields.
- **Stable queue keys** (`lib/todays-priorities-queue`, new): `getStableQueueKey()` produces `attention::`/`cc::`/`review::`-namespaced output for each kind; an attention item and a covered-call opportunity on the same underlying position produce distinct keys (namespace prevents collision); the attention-kind key is byte-identical to `getPriorityWorkflowKey(objective)` under the `attention::` prefix, never a regenerated `objective.id`; key stability is verified across two computation runs with unchanged underlying data.
- **Level-1 deep linking (Mission Control → Today's Priorities, §13.1):** exact `stableKey` match opens the correct item for each of the three kinds; two priorities for the same position (e.g. an attention item and a covered-call opportunity sharing a `pos.key`) resolve to two distinct, unambiguous targets; the focused card is visibly expanded/highlighted and scrolled into view; refresh preserves the `priority` param and re-resolves the same target; back navigation from Today's Priorities returns to Mission Control via standard history; a target that has completed or self-resolved renders the "no longer open" fail-safe notice, not a crash, and does not fall through to a level-2 navigation; Mission Control's link is asserted to never contain `tab=positions` or `tab=history` for any item kind.
- **Level-2 deep linking (Today's Priorities → destination, §13.2):** exact `pos.key` match; two positions sharing a symbol (different expirations) resolve to distinct targets; refresh preserves the target; back navigation from Positions/History returns to Today's Priorities (standard browser behavior, not separately re-implemented); missing/stale target renders the fallback notice, not a crash; `needsFollowUp` link resolves to Decision History, not Positions; portfolio-level (no-`subjectId`) item link lands on unfocused Positions; the level-2 link is reachable only from a focused Today's Priorities card, never rendered on Mission Control.
- **Default-tab non-regression (§23, final ruling):** `/portfolio` with no query params defaults to `'positions'`; explicit `?tab=todays-priorities`, `?tab=positions`, and `?tab=history` each select the corresponding tab.
- **Regression:** Priority List's existing 20+15+24 tests pass unmodified; WA-0002's Positions behavior (composition card, risk badges, transitional Briefing content) unaffected — re-run `features/portfolio/positions/**` and `features/portfolio/dailyBriefing/**` unmodified; background job visibility and Portfolio Mode tests unaffected — re-run `components/portfolio-mode/**` and any background-task tests unmodified; `MissionControl.test.tsx` updated for the new, smaller Attention section but its narrative-order assertions for every other section remain green.

## 21. Regression Risks and Mitigations

- **Risk: Mission Control's count silently drifts from Today's Priorities' count** if implementation reuses `narrative.counts.attention` instead of the new shared-queue-based field. Mitigated by §11's explicit disclosed design decision and by an acceptance criterion and a dedicated parity test.
- **Risk: a second completion-state model gets invented** by mistake when wiring Mark Complete into the new queue view. Mitigated by §7's explicit reuse of `partitionPriorities()`/`markComplete()`/`reopenPriority()` unmodified, and by an explicit acceptance criterion and cross-surface test.
- **Risk: `needsFollowUp`/covered-call items are accidentally made completable**, inventing a new eligibility/completion rule not backed by any canonical identity. Mitigated by `completable: false` being a structural property of the queue item's `kind`, not a runtime check that could be bypassed, and by dedicated tests confirming no Mark Complete control renders for either kind.
- **Risk: deep-link symbol-only matching accidentally ships instead of `pos.key` matching**, silently mistargeting when multiple positions share a symbol. Mitigated by an explicit acceptance criterion and test using two same-symbol, different-expiration positions.
- **Risk: Mission Control's link bypasses Today's Priorities and navigates directly to Positions or Decision History**, violating ruling 6. Mitigated by specifying the level-1 contract as the only link Mission Control is permitted to render (§11, §13.1), by an explicit acceptance criterion, and by a dedicated `MissionControl.test.tsx` assertion that the rendered link never contains `tab=positions` or `tab=history`.
- **Risk: the level-1 `priority` param is implemented as, or confused with, the level-2 `focus`/`reviewId` params**, collapsing the two-stage contract back into one stage or causing one param to silently override the other. Mitigated by naming them distinctly, resolving them in different components (Today's Priorities workspace component vs. `app/portfolio/page.tsx`'s Positions/History rendering), and by an explicit acceptance criterion plus tests asserting each param is only ever read by its own resolver.
- **Risk: the namespaced `stableKey` scheme collides across item kinds** (e.g. a covered-call opportunity and an attention item sharing an underlying position key resolve to the same level-1 target). Mitigated by the mandatory `attention::`/`cc::`/`review::` prefix (§7) and a dedicated test constructing exactly this same-position, cross-kind scenario.
- **Risk: `stableKey` is derived independently, and inconsistently, by Mission Control and by Today's Priorities** (e.g. each recomputing its own version from raw fields), reintroducing the same drift risk ruling 6 exists to prevent. Mitigated by `getStableQueueKey()` being the single derivation point, computed once at queue-build time and carried as a field on `TodaysPrioritiesQueueItem` (§7) rather than recomputed by either consumer.
- **Risk: retiring the `today` tab drops a section's content instead of relocating it.** Mitigated by §17's deletion criteria (migrate/verify before retiring) and by requiring the Monitor-section extraction (step 2) to land and be verified before the `today` tab entry itself is removed (step 5).
- **Risk: `buildMissionControlViewModel()`'s new `workflowState` input changes an existing return field's value.** Mitigated by requiring existing tests to be re-run and confirmed byte-identical on existing fields before any new field's test is added.
- **Risk: WA-0002's transitional content or position-card boundaries get disturbed** while adding `HealthyMonitoringSection`/deep-link focus logic to `app/portfolio/page.tsx`. Mitigated by scoping those changes to named, additive insertion points (new mount, new effect) rather than restructuring existing JSX, and by re-running WA-0002's own test suite unmodified as a regression gate.

## 22. Deferred Work and Downstream Obligations

- **WA-0004 (Briefing):** unaffected by this CES; WA-0002's transitional content removal remains WA-0004's own obligation, unchanged.
- **WA-0005 (Opportunities/Screener):** unaffected; Screener-discovered candidates remain explicitly outside this queue.
- **WA-0006 (Priority List retirement):** this CES's §12 coexistence design is exactly what WA-0006 will need to finally remove — recorded here so it is not rediscovered from scratch.
- **`needsFollowUp` and covered-call opportunities have no completion identity today.** If a future sprint wants them to be explicitly dismissible/completable (rather than only self-resolving), that requires new identity/fingerprint design — explicitly not invented here, flagged for whoever picks it up.
- **`TodaysPrioritiesDashboard.tsx`'s ultimate fate** (fully retired vs. partially retained) is an implementation-time call gated on the deletion criteria in §17, not decided definitively here.

## 23. Final Landing-Tab Ruling (resolved)

Previously an open product question; resolved by Dean's corrective ruling and no longer open:

- `/portfolio` continues to default to `'positions'` during WA-0003.
- Deep links may explicitly select `'todays-priorities'`, `'positions'`, or `'history'` via the `tab` query parameter, independent of the default.
- The general landing-tab default is reconsidered only after WA-0004 and WA-0005 establish the complete 5-workspace experience — not revisited by this CES or by WA-0003 implementation.

No open decisions remain — every design choice in this CES, including this one, is resolved with cited evidence and stated rationale.

## 24. Stop/Go Recommendation

**GO.** Every inclusion/exclusion rule in the queue-membership matrix traces to an existing typed field on an existing canonical output — nothing new is classified, scored, or ranked. The completion workflow is reused verbatim, with its identity/fingerprint scheme already proven (by its own design intent, confirmed by inspection) to be presentation-independent, so migrating which UI calls it carries minimal risk. The mechanical capability required — deep linking — now has a concrete, evidence-based, two-level contract: a namespaced `stableKey` (§7) routes Mission Control into the exact queue item within Today's Priorities (§13.1, ruling 6), and the existing `pos.key`/`reviewId` identifiers, already used everywhere else in this codebase for exactly this purpose, route from the focused card to its action destination (§13.2). The one disclosed design decision with real teeth (Mission Control's count/lead-item source, §11) is resolved with clear, cited rationale rather than left ambiguous. §23's landing-tab question is resolved (`'positions'` remains default) and no longer open. Approved by Dean subject to the corrective ruling incorporated in this revision; recommend proceeding to implementation once Paul/Quinn/Chuck confirm no objection to this specification.
