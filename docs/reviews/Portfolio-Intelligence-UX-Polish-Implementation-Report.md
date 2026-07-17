# Portfolio Intelligence UX Polish — Implementation Report

Branch: `feature/portfolio-intelligence`
Commit: `2ee4b0e`

## Executive summary

Sprint scope was a readability/information-density refactor of the expanded Position Intelligence panel — no scoring, calculations, recommendation logic, or APIs changed. Six objectives, all addressed:

1. Responsive two-column layout for the expanded panel.
2. Empty/premature sections (Decision Review, Decision Scorecard) hidden until they get a real design pass.
3. Suggested Action elevated into a prominent card with confidence and key supporting metrics.
4. Duplicated wording between the rule engine and AI Analysis reduced via a prompt-level instruction.
5. Typography/spacing/visual hierarchy improved; dark theme preserved exactly.
6. Scoring/calculations/recommendation logic/APIs untouched.

## Files changed

Modified:
- `features/portfolio/intelligence/PositionIntelligencePanel.tsx` — added `SuggestedActionCard` (new, elevates `recommendation.label`, `suggestedAction`, `confidence`, `managementIntent.confidenceTier`, `urgency`, plus up to 3 supporting-evidence chips and the remaining-opportunity percentage, all values already computed elsewhere — nothing new calculated here); restructured the section body into a `grid grid-cols-1 lg:grid-cols-2` layout (left: Why, Current Concerns; right: Remaining Opportunity, What Would Change This Recommendation, Next Expected Lifecycle Event, Available Management Choices), stacking to one column below the `lg` breakpoint; added `URGENCY_ACCENT` color map (reuses the same four urgency tiers `PositionRecommendationBadge` already used); added `SHOW_DECISION_SCORECARD` / `SHOW_DECISION_REVIEW` module-level flags (both `false`) gating the two existing sections off at the render layer only.
- `features/portfolio/intelligence/__tests__/PositionIntelligencePanel.test.tsx` — added a "Suggested Action card" describe block (label/suggested-action/confidence/urgency, confidence-tier, evidence+opportunity metrics); scoped the existing "Why" evidence assertion with `within()` since "Earnings date" now also appears as a metric chip on the card (two nodes with identical text, previously only one); replaced the four Decision Scorecard expand/collapse tests with one regression test confirming it stays hidden even when `managementIntent` is present; added one new test confirming Decision Review stays hidden even when `onSaveDecisionReview` is provided.
- `app/portfolio/page.tsx` (`buildPositionPrompt`) — inserted a "RULE ENGINE'S EXISTING CALL" block ahead of the existing "EXPERT DECISION CHECKLIST," echoing the already-computed `pos.recommendation` (label, confidence, urgency, primary reason) and instructing the model not to restate it — instead to confirm or challenge it using the live market/greeks/trend/support data already in the prompt, or explain what specifically makes it appropriate right now. No other line in the prompt changed; the JSON response schema, the checklist itself, and the `analyzePosition()` call/API contract are all unchanged.

New:
- `docs/reviews/Portfolio-Intelligence-UX-Polish-Implementation-Report.md` — this report.

## Design decisions

**Suggested Action card content.** Every field on the card already existed on `recommendation` (from PI-0002/PI-0006B) or on the `whyEvidence` array the panel already derived — the card is a presentation change, not a new data source. "Key supporting metrics" was interpreted as the top 3 evidence items plus the remaining-opportunity percentage (when present), shown as compact chips rather than duplicating their full explanatory detail, which stays in the "Why" section below for anyone who wants it.

**Two-column split.** Left column groups narrative content (why this call, what's concerning about the position right now); right column groups reference/next-step content (upside remaining on the table, what would flip the call, what happens next in the lifecycle, the alternative moves available). This groups by *kind* of information rather than splitting arbitrarily, and keeps each column a sensible length on both wide and narrow viewports.

**Hiding Decision Scorecard and Decision Review.** Both are real, working features from earlier tickets (PI-0006B/PI-0007A and PI-0008C respectively) — not placeholders — but in the expanded panel most traders look at day-to-day they read as clutter: the scorecard is a diagnostic dump, and the review section is usually just an empty form waiting for a save that hasn't happened yet. Per the ticket's "remove or hide... until implemented" instruction, both were gated off with a boolean flag at the top of the file rather than deleted or commented out — the components, their tests (`DecisionReviewSection.test.tsx`, `DecisionHistoryView.test.tsx`), and all underlying logic/persistence are untouched and still pass. Re-enabling either is a one-line flip once it gets a layout that fits the new panel design, rather than a re-implementation.

**AI Analysis de-duplication.** `buildPositionPrompt()` previously built its analysis entirely from raw market/greeks/trend data with no awareness that a rule-engine recommendation already exists and is already visible to the trader (in the new Suggested Action card, and previously in the `PositionRecommendationBadge` on the collapsed row). This meant the AI's `summary`/`reasoning` could naturally land on similar phrasing to the rule engine's `primaryReason` purely because both look at the same underlying signals, even with no code path actually copying strings between them. The fix passes the rule engine's existing call into the prompt as context and adds an explicit instruction not to restate it — this is prompt copy, not a scoring/logic/API change, and the JSON contract `analyzePosition()` parses is byte-for-byte unchanged.

## Validation

- `tsc --noEmit`: clean, 0 errors.
- Targeted tests: `PositionIntelligencePanel.test.tsx` (17/17), plus `DecisionReviewSection.test.tsx` and `DecisionHistoryView.test.tsx` (22/22 combined) to confirm hiding the Decision Review section in this panel didn't regress its own standalone, already-existing test coverage. 39/39 total.
- `next build`: did not complete in this sandbox (hangs at the initial Next.js banner, near-zero CPU) — the same known, previously-documented sandbox/environment limitation seen on PI-0006A and the CSP terminology ticket, not a code issue given `tsc` is clean and all tests pass. Recommend treating the Vercel build on push as the authoritative check.

## Trade-offs disclosed

- Hiding Decision Scorecard removed the four tests in this file that exercised its expand/collapse/contribution-rendering behavior (accordion toggle, winner/margin display, per-candidate contributions). That behavior is currently only reachable by manually flipping `SHOW_DECISION_SCORECARD` to `true` locally — there's no automated coverage proving it still renders correctly while hidden. Recommend re-adding that coverage (or restoring it from git history) whenever the scorecard gets its design pass and is switched back on.
- No screenshots are included — this sandbox has no way to render the live Next.js app (the build hang above), so the layout hasn't been visually verified beyond code review and the passing component tests (which confirm DOM content and structure, not visual layout/spacing). Recommend a quick manual check on desktop and a narrow viewport once deployed, specifically: the two-column grid collapsing correctly below `lg`, and the Suggested Action card's urgency coloring across all four urgency tiers.

## Recommended follow-ups

- Confirm the Vercel build succeeds for `feature/portfolio-intelligence` with this commit, since the local build couldn't be validated in this sandbox.
- Visual QA per the trade-off above.
- Decide on a redesigned presentation for Decision Scorecard and Decision Review before re-enabling them, and restore their in-panel test coverage at that time.
