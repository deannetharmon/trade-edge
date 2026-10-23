# DTE-CSP-CC-0001: No 21-DTE roll for CSP and CC

Status: DRAFT, found 2026-10-23 in the independent review of RECO-UNIFY-0001B. Not built.
Owner: Paul (scope), Ian (sign-off, risk logic), Alan (fixtures), Quinn (regression). Part of DECIDE-0001.

## Problem

Dean decided on 2026-10-17 (DECIDE-0001, recorded in docs/ROADMAP.md): there is no 21-DTE management rule for a cash-secured put or a covered call, because assignment is an acceptable outcome. The rule stays for spreads, iron condors and PMCC short legs.

The live engine does not do that yet. In `lib/portfolio-intelligence/objectives/positionObjective.ts` (the `roll-soon` branch, about line 1033) the rule fires for any short-premium position with `8 <= dte <= 21` unless `assignmentPlanned`. `assignmentPlanned` only covers a lone short put whose intent is Acquire or Wheel (POSITION-INTENT-0001). So:

- an **Income** CSP at 21 DTE or below shows "roll-soon" (bucket Roll in the unified verdict);
- a **covered call** (`strategy` CALL, short premium) at 21 DTE or below shows "roll-soon".

An existing test (`assignmentPlannedRecommendation.test.ts`) pins the Income put behavior ("an Income put at 20 DTE still does"), so the old behavior was deliberate under POSITION-INTENT-0001. Dean's 2026-10-17 decision supersedes it.

## Proposal

Exempt CSP and CC from the 21-DTE `roll-soon` rule in the engine, for every intent. Spreads (BPS, BCS), iron condors and PMCC short legs keep it. Nothing else changes: the 50% profit exit, the 2x credit stop, earnings and assignment risk all still apply to CSP and CC.

## Care points (Ian)

1. A covered call and a PMCC short call can both have `strategy` CALL. The exemption must tell them apart (the PMCC short leg carries `pairedShortCallKey` on its long call, and shares back a covered call). Do not exempt a PMCC short leg.
2. The management-intent layer already says Hold at 21 DTE (it "never lets Roll win from bare DTE"). Only the legacy rule layer needs the change; check that the cohere step then produces plain Hold with no leftover roll wording.
3. Remaining DTE-driven text (for example "inside the standard management window") must not appear for CSP and CC.

## Tests (Alan, Quinn)

- Income CSP at 22, 21, 8, 7 DTE: no `roll-soon` at any of them; verdict bucket Hold.
- Covered call (shares plus short call) at 21 DTE: no `roll-soon`.
- PMCC short call at 21 DTE: still `roll-soon` (guard against over-exempting).
- BPS, BCS, IC at 21 DTE: still `roll-soon` (the golden fixtures in `lib/portfolio-facts/__tests__/verdict.test.ts` already pin the spread case).
- Replace the `it.todo` in `verdict.test.ts` and update the Income-put assertion in `assignmentPlannedRecommendation.test.ts`.
- Hard rules unchanged for CSP and CC: 50% captured still Close, loss at 2x credit still Cut Losses.

## Out of scope

Any other threshold change; roll suggestions the trader asks for explicitly.

## Acceptance

An Income CSP and a covered call never show "roll-soon" or a Roll bucket because of DTE alone; spreads, iron condors and PMCC short legs still do; the golden fixtures and the pre-refactor snapshot test pass unchanged for every other position.
