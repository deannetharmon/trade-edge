# TE-0007A — First-Class CSP Screener Strategy

**Status:** Implemented
**Branch:** `feature/autopilot-paper-mode`
**Related Design Doc:** `docs/design/DR-0001-Strategy-Unification-and-Wheel-Opportunity-Finder.md`

> Note on numbering: DR-0001 §11 labels this scope "TE-0007B — CSP First-Class
> Screener Strategy" (with TE-0007A reserved for taxonomy/selector-only work).
> This ticket is filed as TE-0007A per the request that created it, but its
> scope matches DR-0001's TE-0007B.

## Objective

Add CSP (Cash-Secured Put) as a first-class, selectable strategy in the
Screener's opportunity workflow, reusing Wheel's existing CSP contract-search
logic, so CSP opportunities appear with the same look and feel as BPS/BCS/IC
results.

## Required Reading

- `docs/design/DR-0001-Strategy-Unification-and-Wheel-Opportunity-Finder.md`
- `app/screener/page.tsx`
- `app/engine/page.tsx`
- `app/wheel/page.tsx`
- `app/portfolio/page.tsx`
- `lib/wheel/chainSearch.ts`

## Pre-existing condition found before implementation

`app/wheel/page.tsx`, `lib/wheel/chainSearch.ts`, and the wheel API routes
existed on `main` but not on `feature/autopilot-paper-mode`. They were
cherry-picked onto this branch (pure additions, no conflicts) before this
ticket's work began, since DR-0001's CSP scope depends on them.

`app/engine/page.tsx` was also found to already contain a separate,
pre-existing "Wheel Engine" section with its own CSP/CC suggestion and live
order-placement logic (`EngineOrderModal`, `mode: 'wheel'`). That logic uses a
simpler heuristic (strike = 95% of spot, rounded to $5) rather than
delta-targeted chain search, and was left untouched — it is a distinct,
already-functioning subsystem, and reworking it is out of scope here.

## Scope

- Add CSP as a strategy alongside BPS/BCS/IC/PMCC in the Screener, using the
  same "separate tool, own card" pattern already established for PMCC
  (own ticker list, own scan button, results appended to the shared
  results list).
- Reuse Wheel's `findBestWheelContract` for the actual contract search.
- CSP results render through the same `ScreenResult`/`SpreadCandidate`-based
  card UI as spread results.
- CSP capital check: `required cash = strike × 100 × contracts`, checked
  against the account's cash balance (not margin/buying power).
- No margin used by default; insufficient-cash candidates are shown with a
  blocked/warning state rather than hidden.
- Spread (BPS/BCS/IC) behavior unchanged.
- No CC or PMCC changes.
- No redesign of existing pages.
- No live trade execution for CSP (Trade/Find-Better buttons are disabled
  for CSP results).

## Out of scope / explicitly deferred

- Wiring CSP into Filter/Rank/Targeted scan modes (those are deeply
  trend-gated and spread-shaped; CSP was added as its own scan action
  instead, matching the existing PMCC precedent).
- CSP order placement (OTOCO/GTC) — `longOccSymbol` is deliberately left
  unset on CSP candidates so the existing `hasOccSymbols` gate disables
  trade UI automatically.
- "Find Better" for CSP (that modal's logic is spread-specific).
- Any changes to Engine's existing Wheel Engine section.
- CC and PMCC-as-first-class-strategy (DR-0001 TE-0007C/D).
