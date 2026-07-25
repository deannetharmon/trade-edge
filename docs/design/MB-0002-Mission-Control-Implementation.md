# MB-0002 — Mission Control Review Experience: Phase 2 Implementation

**Status:** Implemented on `feature/mb-0002-review-experience`, pending Quinn/Paul/Chuck/Dean review.

**Owner:** Dane (Lead Engineer)

**Selected concept:** Concept B — Mission Control, per `docs/design/MB-0002-Review-Concepts.md` and the team's unanimous Phase 1 selection.

---

## 1. Summary

`/dashboard` now renders Mission Control instead of TC-0001's Trade Command Center. The page composes the same already-loaded portfolio data TC-0001 always used (`PortfolioDataProvider`'s `DashboardComposition`, the Recommendation Service's ranked `OpportunityRecommendation[]`), but instead of building a `CommandCenterViewModel`, it now calls `lib/mission-control`'s `buildMissionControlViewModel()`, which internally calls `lib/morning-briefing`'s `buildAttentionFeed()` and `lib/review-conductor`'s `conductReview()` — both unchanged from MB-0001A/MB-0001B — to produce a real `ReviewNarrative`. `components/mission-control/MissionControl.tsx` renders that narrative directly. No file under `lib/decision-engine`, `lib/opportunity-engine`, `lib/portfolioReview`, `lib/morning-briefing`, `lib/trader-commitments`, or `lib/revalidation` was modified; `lib/review-conductor`'s `ReviewNarrative` contract is unchanged.

## 2. Architecture

```
DashboardComposition (unchanged: lib/portfolio-intelligence/dashboardComposition)
  .portfolioReview  -----------------------------------------\
  .todaysPrioritiesDashboard --> buildAttentionFeed() ---------+--> conductReview() --> ReviewNarrative
Recommendation Service --> buildOpportunityRecommendations() -/         |
(unchanged: lib/recommendations, lib/opportunity-engine)                |  (lib/mission-control/
                                                                          buildMissionControlViewModel,
                                                                          new this sprint -- sequencing
                                                                          + state classification only)
                                                                          |
                                                                          v
                                                              components/mission-control/MissionControl
                                                              (pure presentation, new this sprint)
```

`lib/mission-control` is the same kind of thin, page-specific wiring layer `lib/command-center/buildCommandCenterViewModel.ts` already was for TC-0001 — it does not decide anything; it sequences already-computed calls and classifies the result into a `state` (`loading` / `unavailable` / `error` / `loaded`) so the UI never has to guess. This satisfies Quinn's MB-0002 acceptance criteria by construction: `buildMissionControlViewModel.ts` contains zero ranking, scoring, or business logic, and every value inside the resulting `narrative` is a direct, unmodified pass-through from `conductReview()`.

## 3. Deliberate Deviations from the Phase 1 Mockup (disclosed, per the CES's request for rationale)

**Single column throughout, not the sketched two-column grid.** Phase 1's Concept B mockup placed "Since Your Last Review" and "New Opportunities" side by side in a 2-column grid. Phase 2's CES adds a stricter, explicit constraint not present in Phase 1: "The narrative order remains ... Do not rearrange this order" and "Narrative order must remain intact across all layouts." A side-by-side grid risks a reading-order ambiguity between two narrative steps with different priority, and would require deliberate `tabIndex` engineering to keep keyboard/screen-reader order matching visual order (a risk Phase 1 explicitly flagged as this concept's key weakness). Implementing all seven sections as a single, strictly-ordered column removes this risk entirely: DOM order, visual order, and reading order are identical, on every breakpoint, by construction — no CSS `order` property, no per-breakpoint component swap. Mission Control's identity still comes through via the Summary Strip (below) and the calm, uncluttered per-section treatment, not from column count.

**No collapsible/accordion modules.** Phase 1 floated collapsing empty modules on mobile. Phase 2's CES describes "progressive disclosure" as "the top viewport provides confidence, scrolling reveals supporting information" — a description satisfied entirely by the Summary Strip plus a normal scroll, with no additional interaction state needed. Dropping the accordion idea removes an entire class of local UI state, keyboard-accessibility surface (`aria-expanded`, focus management on toggle), and re-render risk, in direct service of "no unnecessary rerenders" and "favor clarity over cleverness."

**A four-line Summary Strip, not a single-line banner.** The CES's First Viewport Requirements list four distinct things the trader must see without scrolling (Portfolio Health, Lead Item, Since Last Review, Attention Summary). `components/mission-control/SummaryStrip.tsx` renders exactly these four as one calm, fixed-feeling strip at the top of the page, each line a direct read or simple template of an already-computed `ReviewNarrative` field (health status/score, `leadItem`, `counts`, `complete.message`) — never a new fact, never independently computed.

**Review Complete renders an honest, non-fabricated message even when the Review is not complete.** `ReviewNarrative.complete.message` is an empty string by design when `shouldInterrupt` is true (see `lib/review-conductor/conductReview.ts`). Rendering nothing there would leave the trader without the closure Chuck's acceptance criteria specifically ask for on a day when action *is* needed. `ReviewCompleteBand.tsx` instead renders a template built only from `narrative.counts` (e.g., "You've reached the end of this Review. 2 items above still need your attention.") — reformatting already-known counts, not inventing a new fact or business decision. This band is styled distinctly from every other section (no `border`/`card` treatment, centered, its own iconography) specifically so it reads as "permanent Review chrome," per the CES, rather than another card in the stack.

**Background Tasks retained, but relocated outside the Review narrative.** TC-0001's Background Task card is not part of `ReviewNarrative` and answers a different question ("is a scan still running?") than Review does. Removing it was considered and rejected: no other page in the application currently surfaces the global Task Manager's state (`TaskStatusBar`/`TaskDrawer`/`TaskNotifications` are built but not mounted anywhere), so removing it here would be an undisclosed regression in existing functionality, not a Review-experience improvement. It is rendered, unchanged, in its own section below the Review Complete band — visually and semantically outside the seven-section narrative, so it does not compete with or dilute "attention is the product."

**`CommandCenterNav` reused unchanged**, including its `#best-opportunity` anchor link ("Opportunity Review"). `NewOpportunitiesSection` (this sprint's replacement for the Best Opportunity card) carries the same `id="best-opportunity"` forward so that link continues to work without modifying the nav component itself.

## 4. Responsive Strategy

One component tree renders at every breakpoint — there is no separate mobile/tablet/desktop version of Mission Control ("Do not create separate experiences," per the CES). The Summary Strip's two-line header row (`flex-col` on mobile, `md:flex-row md:justify-between` on desktop) and its bottom stat row are the only places layout direction changes; every narrative section below is a single block at every width. Because there is no grid to reflow and no component swap, narrative order is identical at every breakpoint by construction, not by a per-breakpoint rule that has to be kept in sync.

## 5. Accessibility

- Every section is a labeled landmark (`<section aria-label="...">`), matching the existing convention `components/command-center/PriorityListCard.tsx` and others already established — DOM order is reading order is keyboard order is screen-reader order, with no exceptions in this implementation.
- Loading and error states use `role="status"`/`aria-live="polite"` and `role="alert"` respectively, matching `components/portfolio-mode/PortfolioModeGateNotice.tsx`'s existing pattern exactly rather than inventing a new one.
- No new interactive controls were introduced (no accordions, no stepper) — the only interactive elements on the page are existing `<Link>` navigation, which already carries this codebase's established focus/contrast treatment.
- No animation or transition was added anywhere in this implementation, so there is nothing for `prefers-reduced-motion` to need to suppress — the simplest possible compliance with that requirement.
- Color is used only to reinforce, never to solely convey, a fact: health status text always carries its status word alongside its color (e.g., "Healthy", not just a green dot), matching the existing `DISPOSITION_LABEL`/`DISPOSITION_STYLE` pattern in `BestOpportunitiesPanel.tsx`.

## 6. Performance

`buildMissionControlViewModel()` is called once per render inside a `useMemo` keyed on `[composition, loading, error, opportunityRecommendations, lastRefresh]`, the same memoization shape `buildCommandCenterViewModel()` already used in TC-0001 — no new re-render source was introduced. No presentation-layer caching was added, per the CES's explicit instruction not to introduce one without a profiling need. `ReviewNarrative` is consumed exactly as produced; no component recomputes, re-sorts, or re-filters any of its arrays.

## 7. Known Limitations (disclosed, not defects)

- **No Trader Commitment persistence exists yet** (explicit MB-0002 non-goal). `revalidationResults` is always `[]` in `buildMissionControlViewModel()`, so "Since Your Last Review" will read as empty ("Nothing changed since your last review.") on every visit until a future sprint wires up real commitments and a store. This is an honest empty state, not a bug.
- **Live screenshots (desktop/tablet/mobile) could not be captured in this sandbox environment.** No headless browser tooling (Playwright/Puppeteer) is installed, and installing one plus its browser binary is outside this ticket's approved scope (it would add a new dependency and likely exceed this environment's documented build/network time constraints — the same class of sandbox limitation already recorded elsewhere in this project's history for `next build`). Section 3 above documents every structural layout decision in enough detail to review without a rendered image; running `npm run dev` locally (or viewing the Vercel preview once deployed) will show the real, live-rendered page. This is flagged explicitly rather than substituting a fabricated mockup image.
- `CommandCenter`/`buildCommandCenterViewModel`/`components/command-center/CommandCenter.tsx` are no longer used by any page (this was already true of `BestOpportunitiesPanel` for a full sprint under OE-0001's own precedent). They were left in place, not deleted — removing a fully tested, previously-shipped subsystem is a separate decision this CES did not ask for. Flagged here as a candidate for a future cleanup ticket, not done unilaterally.
