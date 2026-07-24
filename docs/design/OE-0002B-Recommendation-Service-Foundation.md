# OE-0002B — Recommendation Service Foundation & Dashboard Integration

**Status:** Implemented, pending review (Quinn/Paul)
**Ticket:** CES-0001 (Revised)
**Owner:** Quinn (Chief Architect)
**Implementation:** Dean (Lead Engineer)
**Supersedes:** the original OE-0002B ("Dashboard Opportunity Integration") CES, which was stopped before implementation — see "Why this was revised" below.

## Business Objective

The Dashboard's Best Opportunity card (TC-0001/OE-0001) has been mounted since TC-0001 but has always rendered against a hardcoded empty `DecisionAnalysis[]`, because no real feed reached `/dashboard`. OE-0002A activated the real feed on `/screener` only. This sprint gives the Dashboard the same real feed, so a user who runs a scan on the Screener sees that scan's best opportunity reflected on the Dashboard.

## Why This Was Revised

The original OE-0002B CES asked for the Dashboard to consume "the real Opportunity Engine feed, reusing the existing pipeline." Investigation found no acquisition mechanism could satisfy that without violating an existing constraint:

- Reading the Screener's own IndexedDB scan cache from `/dashboard` would manufacture new cross-page state, which `buildOpportunityRecommendations.ts`'s and `BestOpportunityCard.tsx`'s own doc comments explicitly disclaim ("no acquisition mechanism... never with a new fetch, persistence, or cross-page state manufactured just to populate it").
- Reading `GET /api/autopilot/decisions` (the decision log) would require reconstructing a `DecisionAnalysis` from a denormalized log entry missing fields the type requires — a fabrication, which the codebase's "never fabricate" convention forbids.

Per instruction, this was reported rather than worked around. Quinn's response was to establish a new, explicit architectural boundary — the Recommendation Service — rather than have the Dashboard reach into the Screener's internals or vice versa.

## Architectural Principles

1. **Decision Engine** evaluates candidates. Unchanged.
2. **Opportunity Engine** compares/ranks candidates. Unchanged.
3. **Recommendation Service** (new) acquires/holds the current `DecisionAnalysis[]`. It does not evaluate, rank, filter, or interpret — it stores and announces.
4. **Producers** (today: only the Screener) call `publishRecommendations()` the moment they have a real, already-evaluated set. A producer never reads its own publication back through the service; it already has the data.
5. **Consumers** (today: only the Dashboard) read via `getCurrentRecommendations()`/`useCurrentRecommendations()` and are completely unaware of who published, how, or from where.
6. The Screener is a producer of recommendations, not their owner. Ownership of "what is the current set" belongs to the service, not to any one page.

## Architecture

```
Screener page                Recommendation Service              Dashboard page
──────────────                ─────────────────────              ──────────────
runs a scan
  → POST /api/autopilot/
    recommendations
  → real DecisionAnalysis[]
  → renders its own panel
    (via opportunityRecomm-
    endationsFromApiResponse,
    OE-0002A, unchanged)
  → publishRecommendations(
      analyses, generatedAt)  ───────▶  in-memory module state
                                        (analyses, generatedAt)
                                        Set<listener> pub-sub
                                                                  useCurrentRecommendations()
                                                                    ◀───────────────────────
                                                                  → buildOpportunityRecommendations(
                                                                      analyses, { availableCapital: 0,
                                                                      generatedAt })
                                                                    (OE-0001 adapter+ranker, unchanged)
                                                                  → BestOpportunityCard renders
```

`lib/recommendations/RecommendationService.ts` is a module-level singleton mirroring the existing `lib/screener/screenerJobStore.ts` pattern (`useSyncExternalStore` + `Set<listener>` + `notify()`), with one deliberate difference: no persistence. No `localStorage`, no `IndexedDB`, no cross-tab `storage` event sync. State lives only as long as the current tab's JS runtime — it survives client-side navigation between `/screener` and `/dashboard` (the real workflow this sprint targets) but not a hard reload. Persistence was explicitly out of scope; see Future Work.

## Scope

**In scope:**
- New `lib/recommendations/RecommendationService.ts` (acquisition boundary).
- `app/screener/page.tsx`: call `publishRecommendations()`/`clearRecommendations()` alongside its existing OE-0002A effect, as a side effect of the pipeline it already runs.
- `app/dashboard/page.tsx`: replace the hardcoded empty `DecisionAnalysis[]` with `useCurrentRecommendations()`, feeding the same unmodified `buildOpportunityRecommendations()` call TC-0001 always made.
- Doc-comment updates in `components/command-center/BestOpportunityCard.tsx` and `lib/command-center/buildOpportunityRecommendations.ts` to reflect the new acquisition boundary (no logic changes).

**Explicitly out of scope (unchanged from the original CES):**
- Any persistence (localStorage/IndexedDB/database) for the Recommendation Service.
- A scheduler or background scanner as a producer.
- Expanding PortfolioMode gating logic.
- Any change to Decision Engine or Opportunity Engine scoring/ranking/evaluation logic.
- Any change to the decision log/audit trail.
- AI-driven recommendation generation.

## Acceptable Initial Behavior

A Dashboard visit before any Screener scan has run in that browser session shows the Best Opportunity card's existing empty state ("No ranked opportunity feed is available.") — an honest empty state, not a fabricated one, identical in spirit to `/screener`'s own pre-scan state. This is expected and correct, not a bug: it accurately discloses that no real recommendation set exists yet, exactly as the "never fabricate" convention requires.

## Files Changed

- `lib/recommendations/RecommendationService.ts` — new file. Exports `RecommendationSet`, `getCurrentRecommendations()`, `publishRecommendations()`, `clearRecommendations()`, `subscribeToRecommendations()`, `useCurrentRecommendations()`.
- `lib/recommendations/index.ts` — new file (Quinn review correction). Public module interface: re-exports the above from the implementation module. Consumers/producers import from `@/lib/recommendations`, never from `@/lib/recommendations/RecommendationService` directly.
- `lib/recommendations/__tests__/RecommendationService.test.ts` — new file, 7 tests covering the empty default, publish/overwrite/clear semantics, subscriber notification, and unsubscribe.
- `app/screener/page.tsx` — added imports (now from `@/lib/recommendations`); existing OE-0002A effect now also calls `publishRecommendations(rawAnalyses, generatedAt)` on a successful scan and `clearRecommendations()` when results are cleared. No new effect, no new pipeline.
- `app/dashboard/page.tsx` — module doc comment updated; replaced the hardcoded `const analyses: DecisionAnalysis[] = []` with `useCurrentRecommendations()` (imported from `@/lib/recommendations`); `buildOpportunityRecommendations()` call itself unchanged.
- `components/command-center/BestOpportunityCard.tsx` — doc comment only.
- `lib/command-center/buildOpportunityRecommendations.ts` — doc comment only.

## Testing

- `lib/recommendations/__tests__/RecommendationService.test.ts` (new, 7 tests): empty default; publish stores caller's data verbatim; default `generatedAt` when omitted; clear restores empty state; subscriber notified on publish and clear; unsubscribe stops notification; a second publish overwrites (not merges with) the first.
- Full relevant suite run: `lib/recommendations`, `lib/command-center`, `lib/opportunity-engine` — 7 files, 69 tests, all passing. No existing test was modified.

## Validation

- `npx tsc --noEmit` — clean, no errors.
- `npx vitest run lib/recommendations lib/command-center lib/opportunity-engine` — 69/69 passing.
- `git diff --check` — clean, no whitespace errors.

## Architectural Notes for Quinn

- **Decision:** the service exposes `analyses: DecisionAnalysis[]` (the raw, unranked Decision Engine output), not `OpportunityRecommendation[]` (the ranked Opportunity Engine output). This keeps the service one layer below ranking, so each consumer supplies its own `OpportunityContext` (e.g. `availableCapital`) rather than the service baking in one consumer's context for all. The Dashboard still calls `buildOpportunityRecommendations()` itself, same as before this sprint.
- **Why raw `DecisionAnalysis[]` and not ranked `OpportunityRecommendation[]`:** the Recommendation Service intentionally stores raw `DecisionAnalysis[]` rather than ranked `OpportunityRecommendation[]` because ranking depends on consumer-specific `OpportunityContext` (available capital, exposure, allocation policy, etc.), which can differ from one consumer to the next and can change independently of the underlying candidate set. The service's responsibility ends at acquiring and exposing evaluated candidates; each consumer remains responsible for applying its own contextual ranking through the existing, unmodified Opportunity Engine wrapper (`buildOpportunityRecommendations()`). Storing pre-ranked output instead would have coupled the service to one consumer's context and required re-publishing (or re-deriving) a new ranked set for every distinct context, defeating the point of a single shared acquisition boundary.
- **Public interface (Quinn review correction):** consumers and producers import from `@/lib/recommendations` (the new `lib/recommendations/index.ts` barrel), not from `@/lib/recommendations/RecommendationService` directly. This decouples callers from the concrete implementation module so it may evolve later without changing consumer imports. The module's own test suite still imports the implementation file directly, which is standard practice for unit-testing a module's own internals rather than its public re-export.
- **Assumption:** "current set" means "most recent publish, replacing any prior one" — not an accumulating history. A second scan fully replaces the first rather than merging. This matches how both `/screener` and `/dashboard` already treat "the current scan."
- **Known limitation carried forward, not introduced by this sprint:** the Dashboard call site still passes `availableCapital: 0` (same hardcoded value TC-0001 shipped with). This sprint's scope was acquisition, not capital-context wiring — flagged in Quinn's technical-review Q&A earlier this sprint cycle and still open.
- **No issues encountered during implementation** that required stopping — the revised architecture resolved the constraint that stopped the original attempt.

## Future Work (not in this sprint)

- Persistence for the Recommendation Service (survive a hard reload) if that becomes a real user need.
- Additional producers (Background Scanner, Scheduled Scanner, Autopilot, an AI Recommendation Engine) — the design's stated intent is that any of these could call `publishRecommendations()` with zero Dashboard changes required.
- Wiring a real `availableCapital` into the Dashboard's `OpportunityContext` instead of the current hardcoded `0`.
