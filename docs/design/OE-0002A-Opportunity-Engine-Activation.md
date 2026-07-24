# OE-0002A — Opportunity Engine Activation

**Status:** Implemented on `feature/oe-0002a-opportunity-engine-activation`, awaiting Quinn's technical review and Paul's product sign-off. Not committed to `main`.
**Base:** `main` @ `6f46936` (post DT-0001 merge).
**Implements:** the deferred item disclosed in `docs/design/OE-0001-Opportunity-Engine-Foundation.md` §7 and `docs/roadmap/ROADMAP.md` line 165 — activating the OE-0001 foundation against a real candidate feed. Follows the read-only architecture discovery already completed and returned this session (repository verification, OE-0001 architecture inventory, UI integration state, data-source inventory, DT-0001 reuse assessment, portfolio-mode safety assessment, test coverage, and a recommended smallest slice).

## 1. Architecture

This sprint activates, and does not modify, three already-approved production layers:

- **`lib/opportunity-engine/`** (OE-0001) — normalization, evaluation, and ranking. Untouched.
- **`lib/command-center/buildOpportunityRecommendations.ts`** (TC-0001) — the existing thin wrapper that calls OE-0001's adapter (`decisionAnalysesToOpportunityCandidates`) then its ranker (`rankOpportunityCandidates`). Untouched.
- **`components/opportunity-engine/BestOpportunitiesPanel.tsx`** (OE-0001) — the existing, pure, tested presentational component. Untouched.

One new, small, pure module is added to complete the chain from the Screener's real scan output to that existing wrapper:

- **`lib/command-center/screenerOpportunityRecommendations.ts`** (new) — `opportunityRecommendationsFromApiResponse(body, now?)`. Takes the already-parsed JSON body from `POST /api/autopilot/recommendations` (an existing, unmodified route — zero production callers before this sprint), extracts `body.result.recommendations` (a real `DecisionAnalysis[]`, or absent), and calls `buildOpportunityRecommendations()` unchanged with a portfolio-neutral `OpportunityContext`. It does no fetching and no ranking of its own — pure translation, extracted into its own file specifically so it is unit-testable without mounting the ~6,500-line Screener page or mocking TastyTrade auth end-to-end (the same reason `buildOpportunityRecommendations.ts` itself was extracted for TC-0001).

`app/screener/page.tsx` is the only page-level file touched. It gained:

- Three new pieces of component state (`opportunityRecommendations`, `opportunityGeneratedAt`, `opportunityState`/`opportunityError`) — plain `useState`, no store, no context, no persistence.
- One `useEffect` keyed on the page's existing `results` state (`ScreenResult[]`), which already changes exactly when `runScreen`/`runPMCCScan`/`runCspScan` complete a real scan (or the page's existing cache-restore effect loads a previous real scan). When `results` is empty, it resets to an honest idle/empty state without calling anything. When non-empty, it `POST`s the current `results` to the existing recommendations route, then calls the new pure translation function above.
- One new JSX block rendering the existing `BestOpportunitiesPanel`, gated on `results.length > 0`, placed directly beneath the existing `SmartSuggestionsPanel` in the results header area.

## 2. Data Flow

```
User runs a scan (runScreen / runPMCCScan / runCspScan — all existing, unmodified)
  → setResults(ScreenResult[])                              [existing state, unmodified]
  → new useEffect fires on `results` change
      → POST /api/autopilot/recommendations                  [existing route, 0 callers before this sprint]
          → screenResultsToAutopilotCandidates()              [existing, unmodified]
          → runRecommendationEngine()                         [existing, unmodified]
          → { result: { recommendations: DecisionAnalysis[] } }
      → opportunityRecommendationsFromApiResponse(body)        [new, pure, this sprint]
          → buildOpportunityRecommendations(analyses, ctx)     [existing, unmodified]
              → decisionAnalysesToOpportunityCandidates()      [OE-0001 adapter, unmodified]
              → rankOpportunityCandidates()                    [OE-0001 ranker, unmodified]
  → setOpportunityRecommendations(OpportunityRecommendation[])
  → <BestOpportunitiesPanel recommendations={...} th={th} />   [OE-0001 component, unmodified]
```

`OpportunityContext` is supplied as `{ availableCapital: 0, generatedAt }` — deliberately portfolio-neutral (see §5).

## 3. Files Changed

| File | Change |
|---|---|
| `app/screener/page.tsx` | New imports, three new `useState` declarations, one new `useEffect`, one new JSX block. No existing logic altered. |
| `lib/command-center/screenerOpportunityRecommendations.ts` | New file — pure translation function. |
| `lib/command-center/__tests__/screenerOpportunityRecommendations.test.ts` | New file — 5 tests for the new translation function. |

## 4. Files Intentionally Untouched

- `lib/opportunity-engine/**` — ranking, evaluation, adapters, types, rule IDs. Zero diffs.
- `lib/decision-engine/**` — zero diffs.
- `lib/todaysPriorities/**` (including DT-0001's `explanation.ts`) — zero diffs.
- `lib/autopilot/decision/**` — `runRecommendationEngine`/`screenResultsToAutopilotCandidates` are invoked via the existing API route exactly as already built; zero diffs to any file in this directory.
- `app/api/autopilot/recommendations/route.ts` — invoked, not modified.
- `components/opportunity-engine/BestOpportunitiesPanel.tsx` — mounted, not modified.
- `lib/command-center/buildOpportunityRecommendations.ts` and `lib/command-center/types.ts` — called, not modified.
- No `sessionStorage`, `localStorage`, `IndexedDB`, global store, event bus, or cross-page persistence was added. Recommendations live only in this page's component state and are recomputed fresh from `results` each time it changes.

## 5. Portfolio Mode — Deliberately Neutral This Sprint

`OpportunityContext.availableCapital` is hardcoded to `0`, and no exposure fields (`existingTickerExposure`, `existingStrategyExposure`, `existingOpenPositionKeys`, `existingSectorExposure`) are supplied. This is intentional, not an oversight: `/screener` is not currently PortfolioMode-gated (a pre-existing, separately-tracked PT-0002B gap, unrelated to this sprint), so introducing live capital or exposure data here would extend live-account-derived data onto an ungated surface. Per this sprint's explicit scope, that is out of bounds. One direct, observable consequence: against `availableCapital: 0`, no candidate with nonzero required capital can reach `RECOMMENDED` disposition (see `evaluateOpportunityCandidate`'s existing, unmodified insufficient-capital branch) — candidates will generally surface as `WATCH` with an honest "more capital needed" disclosure rather than `RECOMMENDED`. This is the existing ranker behaving correctly against an honestly-neutral context, not a defect.

## 6. Acceptance Criteria

- A real Screener scan produces a real `ScreenResult[]`, which produces a real `DecisionAnalysis[]` via the existing, unmodified recommendation engine.
- The existing, unmodified OE-0001 adapter and ranker receive that real data and produce a real, ranked `OpportunityRecommendation[]`.
- The existing, unmodified `BestOpportunitiesPanel` renders those recommendations directly on `/screener`.
- No fabricated, mock, or fixture data reaches production code paths.
- Zero diffs in `lib/opportunity-engine/`, `lib/decision-engine/`, `lib/todaysPriorities/`, `lib/autopilot/decision/`, or DT-0001's files.
- No new persistence layer, store, or cross-page synchronization mechanism.
- `OpportunityContext` carries no live capital or exposure data.
- All 58 pre-existing Opportunity Engine / Command Center tests pass unchanged; new wiring tests pass; `tsc --noEmit` and `git diff --check` are clean.

## 7. Future Work (OE-0002B and beyond — not scoped or started here)

- Wiring real, portfolio-mode-gated capital/exposure data into `OpportunityContext`, once `/screener`'s own PortfolioMode gating question (tracked separately against PT-0002B) is resolved.
- Deciding whether `/dashboard`'s `BestOpportunityCard` should also read from this same real feed (it currently still passes a hardcoded empty `DecisionAnalysis[]`, unchanged by this sprint), and if so, how the feed would reach that already-LIVE-gated surface without introducing new persistence.
- A DT-0001-style explanation layer for Opportunity Engine recommendations (assessed as not directly reusable without a new adapter — see this session's OE-0002A architecture discovery report, §5).
- Any UI/UX refinement to how `BestOpportunitiesPanel` sits within the Screener page (this sprint mounted it, deliberately, exactly as the component already exists).
