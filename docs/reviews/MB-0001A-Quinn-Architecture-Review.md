# MB-0001A — Quinn Architecture & QA Review

**Reviewed commit:** `a0b4f60`

**Decision:** REJECTED — corrective round required before merge.

## 1. What passed

- Scope discipline is strong: no UI, page, broker, API, evaluator, or scoring implementation changes.
- The new package is pure and page-agnostic.
- Existing Priority Score, actionability, and recommendation explanation logic are reused rather than duplicated.
- Deterministic score/source/id ordering is implemented as specified.
- The permitted `lib/todaysPriorities/index.ts` re-export is acceptable.
- Targeted validation and TypeScript results are acceptable, subject to a complete repository regression run before merge.

## 2. Blocking finding A — duplicate logical attention items

`buildTodaysPrioritiesDashboard()` intentionally allows the same `PortfolioObjective` to appear in more than one presentation bucket. MB-0001A then flattens those overlapping buckets directly, producing duplicate `AttentionItem` records with the same objective ID.

That behavior is not acceptable for a unified attention feed. The feed is intended to answer what deserves attention, not enumerate every dashboard taxonomy membership. A trader must not see the same decision twice or have counts inflated because one objective belongs to two source buckets.

### Required correction

- Produce at most one actionable `AttentionItem` per `PortfolioObjective.id`.
- Select the retained source deterministically using the existing MB-0001A source precedence:
  1. `IMMEDIATE_ACTION`
  2. `EARNINGS_REVIEW`
  3. `EXPIRING_POSITION`
  4. `MEDIUM_PRIORITY`
  5. `ROLL_OPPORTUNITY`
  6. `CSP_OPPORTUNITY`
- The retained band's semantics follow the retained source (`IMMEDIATE_ACTION` => `IMMEDIATE`; all others => `WATCH`).
- Preserve objective identity, score, tier, reasons, and explanation unchanged.
- Counts must reflect unique attention decisions, not bucket memberships.
- Add explicit tests for an objective appearing in two and three source buckets.

## 3. Blocking finding B — top-item parity is not guaranteed

The implementation report acknowledges that `topAttentionItem` and the existing `selectTopPriority()` can select different objectives when different source buckets tie at the highest score. The CES acceptance criterion requires parity, not parity only when scores happen to differ.

A theoretical deterministic counterexample is enough to fail this contract. Two public selectors cannot return contradictory answers to the same question.

### Required correction

Use one canonical top-selection rule. For MB-0001A, the least invasive correction is:

- Keep `orderedActionable` sorted by the MB-0001A comparator.
- Derive `topAttentionItem` from the objective selected by the existing `selectTopPriority(dashboard)`.
- Resolve that selected objective into the deduplicated actionable feed by objective ID.
- Return `null` only when `selectTopPriority()` returns `null`.
- Add tie-case parity tests covering each cross-bucket precedence conflict currently identified in the implementation report.

Do not modify `selectTopPriority()` or existing Today's Priorities behavior in this sprint.

## 4. Required validation

After correction:

- Run all MB-0001A tests.
- Run all existing tests under `lib/todaysPriorities`, `lib/priorityScore`, `lib/portfolio-intelligence`, `lib/dailyBriefing`, and `lib/command-center`.
- Run `npx tsc --noEmit`.
- Run `git diff --check`.
- Attempt the full repository suite and report the exact outcome without overstating incomplete runs.

## 5. Files permitted in corrective round

Expected:

- `lib/morning-briefing/attentionFeed.ts`
- `lib/morning-briefing/__tests__/attentionFeed.test.ts`
- `docs/reviews/MB-0001A-Implementation-Report.md`

Change `types.ts`, package exports, or existing Today's Priorities files only if technically necessary; any such change must be explained.

## 6. Return package

Return:

- starting and ending commit SHAs;
- files changed;
- exact duplicate-resolution algorithm;
- exact top-parity algorithm;
- new and total targeted test counts;
- TypeScript and diff-check results;
- full-suite result or precise limitation;
- any CES deviation;
- push confirmation.

Do not merge to `main` or delete the feature branch.