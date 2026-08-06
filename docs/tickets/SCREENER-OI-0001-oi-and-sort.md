# SCREENER-OI-0001 — Screener Minimum OI Filter and Two-Level Sorting

## Scope

Add a user-selectable minimum relevant-leg open-interest (OI) filter and primary/secondary result sorting to the Screener. **Production integration is Ranked mode and Filtered mode only.**

Targeted mode is explicitly out of scope for this ticket's user-facing controls: it keeps its pre-existing, established strategy-specific eligibility and single-field sort behavior, unchanged. The canonical pure OI/sort functions (`lib/screener/screenerResultOrdering.ts`) remain available for Targeted — or a future scanner — to adopt later, but nothing in Targeted's result panel calls them, and Targeted exposes neither the minimum-OI control nor the secondary sort field. This scope correction was made after an initial pass had wired the controls into all three modes; see `docs/reviews/SCREENER-OI-0001-implementation-report.md` for the regression tests proving the exclusion and the absence of any state leak between modes.

## Minimum OI control

Label: **Minimum relevant-leg OI**. Presets: Any / 100 / 250 / 500, plus a custom numeric input. Helper text explains the relevant leg depends on the strategy.

## Canonical strategy-aware OI rules

- Cash-Secured Put: short put OI.
- Covered Call: short call OI.
- Bull Put Spread: short put OI (protective long put not required).
- Bear Call Spread: short call OI (protective long call not required).
- Bull Call Spread: short call OI (protective long call not required) — canonical rule implemented and tested; no scan strategy currently generates Bull Call Spread candidates (see Deviations).
- Iron Condor: both short legs (put and call) required independently; relevant-leg OI for display/sort is the lower of the two.
- PMCC: both the long LEAPS call and the short call required independently.
- Long LEAPS Call: long call OI — canonical rule implemented and tested; no scan strategy currently generates Long LEAPS Call candidates (see Deviations).

"Any" (0) never fails a candidate for missing OI and never fabricates a value. Any positive floor fails a candidate closed if a required leg's OI is missing or below the floor. Protective legs are never required to clear the floor; weak or missing protective-leg OI is surfaced as a separate warning, never silently implied to be fine because the required leg passed.

## Sorting

Fields: Score, POP, Credit dollars, Credit percentage, ROC percentage, OTM percentage, Relevant-leg OI, DTE. Primary and secondary sort, secondary supports "None." Selecting a primary field equal to the current secondary clears the secondary. All fields sort descending (matches the pre-existing codebase convention). Missing values always sort last. Final tie-breaker: stable preservation of input order (Array.prototype.sort's spec-guaranteed stability), fully deterministic for identical inputs.

Score-band note: no grouped/tolerance-based Score ranking exists anywhere in the codebase today (confirmed by investigation) — Score has always been a flat, continuous descending sort. This ticket preserves that; the presentational green/yellow/orange/red tier counts (`RankedScoreTierSummary`) are unaffected.

## Architecture

One canonical, pure module: `lib/screener/screenerResultOrdering.ts`. Exports strategy-aware OI-eligibility evaluation, relevant-leg OI computation, a quote-validity diagnostic, sort-field selection/dedup helpers, a generic two-level `sortItems`, and a combined `filterAndSortByOi`/`filterSortAndSliceTop` pipeline. One shared UI component, `OiAndSortControls` (defined once in `app/screener/page.tsx`), renders identically in the Filtered and Ranked result panels — filtering/sorting logic is never duplicated per component. It is not rendered in the Targeted result panel.

Ranked mode: filtering (existing chips + new OI floor) and both sort levels apply before "Show Top N." Filtered mode: existing eligibility (qualify/disqualify split + existing chips) applies first, then the OI floor and ordering, applied to the QUALIFIED section (the disqualified section remains an unfiltered audit trail). Targeted mode keeps its pre-existing single-field sort and strategy-specific eligibility/ordering logic exactly as it was before this ticket — no OI floor, no secondary sort, no call into the canonical module. Switching the Screener's run-mode picker between Ranked/Filtered and Targeted never carries an OI floor or sort selection across modes; each mode's state is independent.

## Enabling correction (in scope)

Filtered mode's Strategy filter chip defaulted to `['BPS', 'BCS', 'IC']` and had no toggle for CSP/CC/PMCC, predating those strategies (TE-0007/TE-0007C). This silently excluded their results from the QUALIFIED/DISQUALIFIED display regardless of OI — a pre-existing gap, but one that directly blocked this ticket's own "consistent behavior" requirement for those strategies in Filtered mode. Extended the default and the toggle row to include CSP/CC/PMCC.

## Deviations

Bull Call Spread and Long LEAPS Call are not implemented Screener scan strategies (no candidate-generation exists for them anywhere in the codebase, confirmed by investigation prior to implementation). Per product decision, this ticket implements and exhaustively unit-tests their canonical OI rule as pure functions, but does not build new scanning/candidate-generation for them — building two new full strategy scanners was judged out of scope for an OI/sort ticket. **They are not currently available as a Screener scan in any mode** (Filtered, Ranked, or Targeted), unchanged from before this ticket.

## Backlog (out of scope for this ticket)

- **Bull Call Spread first-class Screener scan** — candidate generation, eligibility checklist, and a scan action/mode entry for Bull Call Spread do not exist. The canonical OI rule and its tests are ready for a future scanner to adopt; the scanner itself is a separate, unscheduled backlog item.
- **Long LEAPS Call first-class Screener scan** — same status: canonical OI rule implemented and tested, no candidate-generation or scan action exists, and building one is a separate, unscheduled backlog item.

Neither strategy should be implied as an available Screener scan anywhere in product-facing documentation or UI copy until one of these backlog items is picked up.
