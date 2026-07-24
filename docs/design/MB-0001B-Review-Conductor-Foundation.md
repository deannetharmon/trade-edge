# MB-0001B — Review Experience Foundation

**Status:** Foundation implemented, pending Quinn/Paul review. Page refactor and UI concepts explicitly deferred to a follow-up sprint (see Scope below).

**Owner:** Dane (Lead Engineer), building directly from Dean's (sponsor's) MB-0001B implementation prompt — no separate Quinn-authored CES existed for this ticket at assignment time; this document serves that role, self-authored and submitted for the same architecture review every prior ticket this session has gone through.

**Mission (verbatim from the assignment):** "What deserves my attention right now?" — every design and implementation decision in this document supports that one objective.

## 1. Why This Document Exists Before Any Page Changed

The assignment as written asks for four architecture layers, a full page narrative redesign, and three UI concepts with mockups, in one pass. Before writing code, investigation found that at least four systems already shipped this session (or earlier) answer some version of the assignment's mission question:

- **PI-0012A — Portfolio Review** (`lib/portfolioReview`): composes health, top risks, concentration/capital/income concerns; has its own `selectTopRisks()`, a top-N ranker over Today's Priorities' actionable buckets.
- **PI-0013 — Daily Briefing** (`lib/dailyBriefing`): a deterministic priorities/snapshot/opportunities/risks summary.
- **MB-0001A — Morning Briefing Attention Feed** (`lib/morning-briefing`), merged last sprint: flattens the same buckets into `IMMEDIATE`/`WATCH`/`HEALTHY`, deduplicates, globally orders, and resolves a single canonical `topAttentionItem` — functionally the assignment's mission statement, already built and tested.
- **TC-0001 — Trade Command Center** (`app/dashboard/page.tsx`): already composes Daily Briefing, Today's Priorities, Portfolio Health, and Best Opportunity into one landing page.

Implementing the assignment's "Review Conductor" as its own independent ordering/prioritization/deduplication engine, as literally described, would create a fifth parallel ranking system in a codebase whose one consistently enforced architectural rule (invoked explicitly in OE-0002A's, OE-0002B's, and MB-0001A's own reviews) is: never duplicate scoring, one source of truth per decision.

This was raised with Dean before writing code. Three decisions came back, and this document — and the code it describes — follows them exactly:

1. **The Review Conductor composes existing outputs; it introduces no new ranking logic.** Trader Commitments and the Revalidation Engine are the only genuinely new domains, because nothing today models forward-looking active trader intent for future revalidation (`lib/decision-review` is retrospective outcome-tracking, not a commitment ledger).
2. **This pass is foundation-only.** Trader Commitment domain model, Revalidation Engine interface + initial rule scaffolding, and Review Conductor foundation, with tests and architecture notes. The full page narrative refactor and the three UI concepts (with mockups) are deferred to a follow-up sprint once this foundation is reviewed.
3. **"Review" is understood as TC-0001's `/dashboard` evolving into this narrative**, not a second, parallel route — informing the eventual integration point, though no page file is touched in this pass.

## 2. Architectural Layering (as delivered this pass)

```
Decision Engines (unchanged)
  lib/decision-engine, lib/portfolio-intelligence
       │
       ▼
Existing composition layers (unchanged, reused verbatim)
  lib/todaysPriorities        -- bucketed, scored PrioritizedObjective[]
  lib/portfolioReview         -- PortfolioReviewSnapshot (health, top risks, composition)
  lib/morning-briefing        -- AttentionFeed (deduplicated, globally ordered, topAttentionItem)
  lib/opportunity-engine /
  lib/recommendations         -- ranked OpportunityRecommendation[]
       │
       ▼
Trader Commitments (NEW)          Revalidation Engine (NEW)
  lib/trader-commitments             lib/revalidation
  active trading intent              given a commitment + already-computed
  the trader has already                context, decide: changed or silent
  decided on                            │
       │                                │
       └───────────────┬────────────────┘
                        ▼
              Review Conductor (NEW)
              lib/review-conductor
              composes all of the above into one
              ReviewNarrative -- ordering (fixed
              narrative sections), deduplication
              (commitment changes vs. attention
              items), interruption policy (silence
              is a feature), no new scoring
                        │
                        ▼
         Presentation components (NOT in this pass)
         deferred to the follow-up page-refactor sprint
```

Every arrow into the Review Conductor is a type import of an already-computed output — the Conductor calls no evaluator, no ranker, and no scorer itself.

## 3. Trader Commitments (`lib/trader-commitments`)

Domain model for active trading intent: `HOLD_UNTIL_DTE`, `MONITOR`, `LET_THETA_WORK`, `WAIT_FOR_EARNINGS`, `GTC_WORKING` — a discriminated union (`TraderCommitment`), each extending a common base (`id`, `createdAt`, `subject`, `status: 'active'`, `note`). `subject` mirrors `PortfolioObjectiveSubject`'s shape without importing that module, matching the existing "lean, page-agnostic input shape" convention `lib/todaysPriorities`/`lib/portfolioReview` already use.

Per the assignment's explicit exclusions:

- **No long-term AI memory.** The store models exactly one status (`active`); a commitment that's no longer relevant is removed, not archived.
- **No conversation history.** Nothing here records a dialogue, a session, or a sequence of past reviews — only the current active set.
- Persistence itself (Redis, localStorage, an API route) is out of scope for this foundation — `lib/trader-commitments/store.ts` is a pure, persistence-agnostic module (create, upsert, remove, query, and a defensive `parseTraderCommitmentStore()`), mirroring `lib/decision-review`'s own split between pure logic (`decisionReview.ts`) and wherever a future caller actually persists the store value.

## 4. Revalidation Engine (`lib/revalidation`)

One entry point, `revalidateCommitment(commitment, context, rules?) → RevalidationResult`. Given a commitment and an already-computed `RevalidationContext` (a `PortfolioObjective | null` and already-computed position facts, never fetched by this engine), a registered rule returns either `null` (silence) or a `RevalidationChange` (`whatChanged` / `whyItMatters` / `whyNow`).

**Rule coverage is deliberately incomplete, and disclosed rather than faked:**

| Kind | Rule | Signal used |
|---|---|---|
| `HOLD_UNTIL_DTE` | Real | `context.position.dte` reaching/passing `commitment.targetDte` — already-computed DTE, same field `TodaysPrioritiesPositionInput` carries. |
| `WAIT_FOR_EARNINGS` | Real | `objective.reviewTriggers` carrying an `'earnings'` trigger — the same existing signal `lib/todaysPriorities/dashboard.ts`'s `hasTrigger()` already uses. |
| `MONITOR` | Real, conditional (see corrective-round addendum below) | `commitment.reviewAfter` compared against `context.now`. `null` means indefinite acknowledgment (silent forever, by trader choice); a set date fires once reached. |
| `LET_THETA_WORK` | **Not registered** | Would need a theta-decay/time-value-captured signal this codebase does not compute anywhere today (Remaining Opportunity is the closest candidate; wiring it in was not in this pass's scope). |
| `GTC_WORKING` | **Not registered** | Would need live broker order-status data — new market-data acquisition, explicitly out of scope. |

### Corrective-round addendum: MONITOR re-review condition

The original foundation pass made `MONITOR` always-silent, reasoning that "a Monitor commitment has no target condition by definition." That conflated two different trader intents into one always-silent behavior: a trader who has genuinely decided "no re-review needed, ever" and a trader who wants to be reminded to look again after some period. Only the first of those should ever be permanently silent.

The fix adds an explicit field rather than a new commitment kind, keeping the existing `MONITOR` kind and its call sites intact: `MonitorCommitment.reviewAfter: string | null` (`lib/trader-commitments/types.ts`).

- `reviewAfter: null` — **indefinite acknowledgment**. The trader explicitly chose not to set a re-review date. `monitorRule` stays silent forever for this commitment, same as before. This remains the default when a caller doesn't supply `reviewAfter` (`createTraderCommitment`'s `MONITOR` branch defaults it to `null`, matching this codebase's "absent input becomes an honest default, never a fabricated value" convention) — so no existing caller's behavior changes unless it opts in.
- `reviewAfter: <ISO date>` — **active monitoring with an explicit re-review condition**. `monitorRule` (`lib/revalidation/rules.ts`) compares `context.now` against `reviewAfter` and fires a `RevalidationChange` once `now` reaches or passes it, using the same "silent until the condition is met, then fires" contract `holdUntilDteRule` already established for `HOLD_UNTIL_DTE`.

`isValidCommitment` in `lib/trader-commitments/store.ts` was extended to validate `reviewAfter` (`null` or `string`) for `MONITOR` entries during store parsing, so a corrupted or malformed `reviewAfter` degrades that one entry to "dropped," not a crash — consistent with every other field in this store.

No other commitment kind, no ranking, no persistence, no page integration, and no existing application behavior changed in this round.

`RevalidationRuleRegistry` is `Partial<Record<TraderCommitmentKind, RevalidationRule>>` precisely so an unregistered kind is a typed, visible fact (absent key), not a placeholder function pretending to check something.

## 5. Review Conductor (`lib/review-conductor`)

One entry point, `conductReview(input) → ReviewNarrative`. `ConductReviewInput` is four already-computed values: `portfolioReview` (PI-0012A), `attentionFeed` (MB-0001A), `opportunities` (OE-0001/OE-0002B), `revalidationResults` (this sprint's own engine, called by the caller — the Conductor does not invoke it itself).

Its four required responsibilities, and exactly how each is satisfied without new ranking logic:

- **Ordering:** the seven narrative sections are assembled in the fixed order the assignment specifies. Within each section, an existing producer's own order is passed through unchanged (`attentionFeed.orderedActionable`'s score/precedence/id sort; `opportunities`' own rank).
- **Prioritization:** delegated entirely to the already-computed inputs — the Conductor reads `.score`, `.rank`, `.topAttentionItem` but never computes a new one.
- **Deduplication:** an Attention item is removed from `attention.items` when its `subjectId` matches a commitment whose revalidation reported a change this cycle — the same decision is never narrated twice under two different headings. Portfolio-level items (`subjectId: null`) are never deduped, since they cannot be matched to one commitment subject.
- **Interruption policy ("silence is a feature"):** `shouldInterrupt` is `true` only when `sinceLastReview.changes` or `attention.items` is non-empty. New opportunities never trigger interruption on their own — worth surfacing, not worth demanding attention for. When `shouldInterrupt` is `false`, `complete.message` carries the assignment's own example completion text verbatim.
- **Narrative flow / lead item:** `leadItem` answers "the one thing deserves your attention" — a commitment change always outranks a plain attention item (the trader explicitly asked to be told about a broken commitment), falling back to the existing `topAttentionItem` (never independently re-derived), falling back to `null` when there is genuinely nothing.

### Mapping the assignment's seven narrative sections onto `ReviewNarrative`

| Narrative section | `ReviewNarrative` field | Source |
|---|---|---|
| Portfolio Status | `portfolioStatus.review` | PI-0012A `PortfolioReviewSnapshot`, verbatim |
| Since Your Last Review | `sinceLastReview.changes` | This sprint's Revalidation Engine, filtered to `changed: true` |
| Attention Required | `attention.items` | MB-0001A `AttentionFeed.orderedActionable`, deduplicated |
| Recommended Actions | *(same `attention.items`)* | Each `AttentionItem.recommendedAction` is already populated by MB-0001A — a second array would duplicate data, not add information |
| Supporting Evidence | *(same `attention.items`)* | Each `AttentionItem.explanation` (drivers/whyNow/confidence) is already populated by MB-0001A |
| New Opportunities | `newOpportunities.items` | OE-0001/OE-0002B ranked `OpportunityRecommendation[]`, verbatim |
| Review Complete | `complete` | Derived from `shouldInterrupt` |

Attention Required, Recommended Actions, and Supporting Evidence are three narrative *beats* over one already-complete data item, not three separate queries — presenting one list across three reading moments is a presentation-layer concern, explicitly deferred to the follow-up page-refactor sprint.

## 6. Scope

**In scope, delivered this pass:**

- `lib/trader-commitments/{types,store,index}.ts` + tests
- `lib/revalidation/{types,rules,revalidateCommitment,index}.ts` + tests
- `lib/review-conductor/{types,conductReview,index}.ts` + tests
- This document and the implementation report

**Explicitly out of scope this pass (deferred, not abandoned):**

- Refactoring `/dashboard` (or any page) around the `ReviewNarrative` structure.
- The three Review UI concepts with mockups/screenshots and a recommendation.
- Persistence for Trader Commitments (Redis/localStorage/API route).
- `LET_THETA_WORK` and `GTC_WORKING` revalidation rules (pending a theta/remaining-opportunity signal and an order-status feed, respectively).
- Any change to Decision Engine, Opportunity Engine, Portfolio Intelligence, Today's Priorities, Portfolio Review, or Morning Briefing.

## 7. Determinism and Safety

Every function in all three new packages is pure: no fetch, no clock read except via an explicit, overridable `now`/`generatedAt` parameter, no mutation of inputs, no persistence, no React/browser dependency. Covered directly by the "does not mutate its inputs" / "repeated calls produce deeply equal output" tests in each package's test suite, matching the same determinism contract MB-0001A established.

## 8. Known Limitations

- `LET_THETA_WORK` and `GTC_WORKING` commitments can be created but will never produce a revalidation change until a rule is written for them — an honest, disclosed gap, not a silent failure.
- The Review Conductor's lead-item policy (commitment change > top attention item) is untested against a genuine cross-domain score comparison, because none exists: revalidation changes and attention items are not on a shared numeric scale, by design (creating one would be new scoring logic, out of scope). If a future sprint needs to rank a commitment change against an attention item numerically, that is a material semantic decision requiring its own review, not something this foundation should guess at.
- No page consumes any of this yet. The three new packages are fully tested but functionally dormant until the follow-up sprint wires them into `/dashboard`.
