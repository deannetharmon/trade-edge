# MB-0001A — Dane Implementation Prompt

You are **Dane, Lead Software Engineer for TradeEdge**. Implement **MB-0001A — Morning Briefing Attention Feed** exactly as specified by Quinn.

## Repository and branch

Repository:

```text
deannetharmon/trade-edge
```

Work only on:

```text
feature/mb-0001a-attention-feed
```

Before making any change, verify and report:

```bash
git status --short
git branch --show-current
git log --oneline -5
git rev-parse HEAD
git rev-parse origin/feature/mb-0001a-attention-feed
```

Stop immediately if:

- the current branch is not `feature/mb-0001a-attention-feed`;
- local and remote branch heads do not match;
- the working tree contains unrelated changes;
- the CES file below is missing or differs materially from the committed version.

## Authoritative CES

Read the entire file before coding:

```text
docs/design/MB-0001A-Attention-Feed.md
```

That document is the authoritative implementation contract. Do not implement from this handoff alone. This handoff supplements the CES; it does not replace it.

Also inspect the existing implementation points named by the CES, especially:

```text
lib/todaysPriorities/dashboard.ts
lib/todaysPriorities/explanation.ts
lib/todaysPriorities/index.ts
lib/priorityScore/**
lib/portfolio-intelligence/**
```

Confirm the actual exported types and canonical field names before writing code.

## Objective

Implement one pure, deterministic composition service:

```ts
buildAttentionFeed(input: BuildAttentionFeedInput): AttentionFeed
```

The service must convert the already-built `TodaysPrioritiesDashboard` output into a single presentation-neutral attention feed without introducing any new scoring, actionability, recommendation, or market-evaluation logic.

The product question is:

> What deserves the trader's attention today, and what can safely wait?

## Architectural constraints

The following existing mechanisms remain the only sources of truth:

- `PortfolioObjective.actionability`
- `calculatePriorityScore()`
- `buildTodaysPrioritiesDashboard()`
- `buildRecommendationExplanation()`
- `selectTopPriority()`

Do not create:

- a second ranking engine;
- a new severity model;
- new attention thresholds;
- new market rules;
- a new explanation vocabulary;
- an alternate top-priority selector;
- page-level or UI logic;
- persistence, fetching, timers, or broker behavior.

The new package is a read-only composition layer.

## Expected files

Create:

```text
lib/morning-briefing/attentionFeed.ts
lib/morning-briefing/types.ts
lib/morning-briefing/index.ts
lib/morning-briefing/__tests__/attentionFeed.test.ts
```

You may modify only when genuinely required for a clean public import:

```text
lib/todaysPriorities/index.ts
```

Do not modify any page, component, API route, broker client, evaluator, priority-score implementation, recommendation engine, or unrelated documentation.

If implementation appears to require a file outside this allowlist, stop and return the architectural conflict to Quinn rather than expanding scope.

## Required behavior

### Mapping

Map these sources to `IMMEDIATE`:

```text
dashboard.immediateAction
```

Map these sources to `WATCH`:

```text
dashboard.reviewToday.earningsReviews
dashboard.reviewToday.expiringPositions
dashboard.reviewToday.mediumPriority
dashboard.opportunities.rollOpportunities
dashboard.opportunities.cspOpportunities
```

Map these sources to `HEALTHY`:

```text
dashboard.monitor
```

Explicitly exclude:

```text
dashboard.reviewToday.needsFollowUp
dashboard.opportunities.coveredCallOpportunities
dashboard.opportunities.screenerCandidatesAvailable
```

Do not silently normalize excluded data. Add comments and tests explaining each exclusion.

### Deterministic global order

Build `orderedActionable` using:

1. Higher score first.
2. For equal score, source precedence:
   1. `IMMEDIATE_ACTION`
   2. `EARNINGS_REVIEW`
   3. `EXPIRING_POSITION`
   4. `MEDIUM_PRIORITY`
   5. `ROLL_OPPORTUNITY`
   6. `CSP_OPPORTUNITY`
3. For equal score and equal source, lexical `id` ascending.

Do not rely on insertion order or stable sort as the final tie-break contract.

Set:

```ts
topAttentionItem = orderedActionable[0] ?? null
```

Add a parity test showing that, for the same objective-backed dashboard input, `topAttentionItem` identifies the same objective as `selectTopPriority()`.

### Explanations

For every `PrioritizedObjective`, call and adapt the existing:

```ts
buildRecommendationExplanation()
```

Preserve its meaning. Do not recalculate confidence, rewrite triggers, or infer missing market facts.

Derive `headline` and `recommendedAction` only from canonical objective fields already used by Today's Priorities. Before choosing fields, inspect the existing UI and exported objective type. Do not invent a parallel recommendation vocabulary.

For monitor entries, do not fabricate score, tier, objective, recommendation explanation, or confidence. Use `null` or honest empty values exactly as the CES requires.

### Determinism and purity

For identical input and identical `generatedAt`, output must be deeply equal.

The implementation must:

- perform no network request;
- read no clock internally;
- mutate no input;
- persist no state;
- use no browser API;
- use no React dependency;
- use no environment-dependent logic;
- submit no order;
- tolerate normal missing optional fields without throwing.

## Required tests

Implement every test required in the CES, including at minimum:

1. Empty dashboard.
2. Critical objective to `IMMEDIATE` only.
3. Correct `WATCH` source mapping for earnings, expiration, medium priority, roll, and CSP.
4. Monitor entries to `HEALTHY` without fabricated intelligence.
5. Cross-bucket higher-score ordering.
6. Equal-score source precedence.
7. Equal-score/equal-source lexical-ID tie-break.
8. Existing explanation semantics preserved.
9. Top-attention parity with `selectTopPriority()`.
10. Explicit exclusions.
11. Input immutability.
12. Repeat-call deep equality.

Prefer focused fixtures that use the repository's real types. Avoid broad `as any` casts. A narrow test builder is acceptable when it preserves the canonical type structure.

## Validation

Run the new test file and all existing suites under:

```text
lib/todaysPriorities/**
lib/priorityScore/**
lib/portfolio-intelligence/**
lib/dailyBriefing/**
lib/command-center/**
```

Then run the full repository test suite, TypeScript, and diff validation using the repository's actual scripts. At minimum, report the exact commands and results for:

```bash
npm test -- --run
npx tsc --noEmit
git diff --check
```

If the repository uses a different canonical test command, use that command and explain why.

Do not claim the production build passed unless it actually ran successfully. If the known local build limitation applies, document the exact failure and distinguish it from a code failure.

## Documentation and implementation report

Create:

```text
docs/reviews/MB-0001A-Implementation-Report.md
```

The report must include:

- verified starting branch and commit;
- architecture discovery findings;
- files changed;
- behavior implemented;
- explicit scope exclusions;
- tests added;
- exact validation commands and results;
- any deviations from the CES;
- any unresolved risks or follow-ups;
- final commit SHA.

Do not modify `planning/SPRINT_STATUS.md`, `docs/roadmap/ROADMAP.md`, or `docs/HANDOFF.md` during this implementation unless Quinn explicitly issues a corrective instruction. Sprint-governance updates occur after technical acceptance.

## Git workflow

After implementation and validation:

```bash
git status --short
git diff --check
git add \
  lib/morning-briefing/attentionFeed.ts \
  lib/morning-briefing/types.ts \
  lib/morning-briefing/index.ts \
  lib/morning-briefing/__tests__/attentionFeed.test.ts \
  docs/reviews/MB-0001A-Implementation-Report.md
```

Add `lib/todaysPriorities/index.ts` only if it was legitimately required and changed.

Commit with:

```bash
git commit -m "feat(morning-briefing): add deterministic attention feed"
git push origin feature/mb-0001a-attention-feed
```

Do not merge to `main`. Do not delete the branch. Quinn must review architecture, quality, tests, and CES compliance first.

## Completion response to Quinn

Return one concise implementation package containing:

1. Starting branch and SHA verification.
2. Final commit SHA.
3. Files changed.
4. Implementation summary.
5. Test and validation results with exact counts.
6. Any CES deviations.
7. Any architectural concerns.
8. Confirmation that the branch was pushed and not merged.

If you encounter ambiguity that materially changes semantics, stop and ask Quinn. Do not guess.