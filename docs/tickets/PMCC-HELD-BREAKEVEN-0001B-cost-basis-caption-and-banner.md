# PMCC-HELD-BREAKEVEN-0001B — On-screen explanation for held-LEAP floor outcomes (caption and banner)

## Status

**Drafted by Paul 2026-09-24. Not approved. Not built.** This is the deferred UI follow-up to `PMCC-HELD-BREAKEVEN-0001` (decision 4, closed by Dean 2026-09-24: rejection reason, plus a caption on the LEAP row, plus a banner line when it is why a held LEAP shows zero shorts).

**Blocked on Diane's Mock 3b and its approval.** No approved mock exists. Mock 3 in `SCAN-ALIGN-0001-mocks.md` is "Draft mocks, not approved". It covers the zero-shorts banner. It does not cover the LEAP-row caption or multi-lot.

**Owner:** Paul drafts and approves scope. Diane produces Mock 3b. Dane builds after all approvals. Ian, Paul and Dean approve the mock. Ian also signs off on the copy where it states floor logic.

Priority: P1, following the parent ticket. It ships in a separate PR from slice A.

Note: none of the code references below were checked against the code by the drafter; they come from the parent ticket and Diane's report. Dane confirms them first.

## Problem

Slice A (PR1) is engine-only. It adds two reason codes:

- `COST_BASIS_UNAVAILABLE`. It is also used for the permanent `quantity > 1` rule, with detail "multi-lot LEAP: cost averaging unverified".
- `SHORT_NOT_ABOVE_HELD_BREAKEVEN`.

Without UI, a trader whose held LEAP has no eligible short sees an empty or generic result. They cannot tell "short calls were not checked" from "no short calls exist" from "every short is below your floor". The first two are especially misleading. Saying "no short calls found" for a case where we never looked is a false statement.

## Scope

- **Three outcomes**, each with a LEAP-row caption, a banner headline and a collapsed detail line. Copy is Diane's proposal, subject to Mock 3b.
  - **Cost basis unavailable.**
    - Caption: "Cost basis unavailable".
    - Banner: "Short calls were not checked. Cost basis for {symbol} could not be read from your broker."
    - Action: "Refresh Portfolio".
    - Detail: "Reason: COST_BASIS_UNAVAILABLE. Avg open price missing or unusable." The unit-guard variant reads "Avg open price looks mis-scaled."
  - **Multi-lot (quantity > 1).**
    - Caption: "Multi-lot LEAP: cost unverified".
    - Banner: "Short calls were not checked. This LEAP has {qty} contracts, and cost averaging across lots is unverified."
    - No action, because the rule is fixed.
    - Detail: "Reason: COST_BASIS_UNAVAILABLE. Detail: multi-lot LEAP: cost averaging unverified."
  - **Floor not met (every short fails).**
    - Caption: "Floor {floor} (LEAP strike + cost basis)".
    - Banner: "No short calls cleared the floor. Floor is LEAP strike + cost basis: {Kl} + {avgOpen} = ${floor}."
    - No action.
    - Funnel row: "N -> 0 floor (all at or below ${floor})", then reason `SHORT_NOT_ABOVE_HELD_BREAKEVEN`.
- **Not-checked causes never enter the funnel.** For the first two outcomes the funnel breakdown must not render, and the copy never says "no short calls found".
- **Avg open tile** shows an em dash when cost basis is unavailable or multi-lot.
- **Mock 3 rename.** The breakeven row and copy become "Floor" and state Ks + short bid vs Kl + cost.
- **Tiers** (three-tier visual weight):
  - Decision: banner headline and action.
  - Risk-context: amber caption under the LEAP tiles.
  - Ambient: collapsed detail behind "Show full breakdown".
- **Per-LEAP captions** when several LEAPs are held (see Decision 2).

## Non-goals

- Any change to engine logic, floor math, reason codes or the unit guard. That is slice A.
- Relaxing the `quantity > 1` rule. It needs a real multi-lot payload first.
- Reusing the `LONG_NOT_ITM` / `INVALID_EXTRINSIC` flagged tags. The OTM-LEAP flag from Mock 3 is a separate item.
- Warnings that override a disqualification ("trust the qualified realm").
- Netting prior roll credits into cost basis (separate product question).
- Changing `pmccStartPrice`.

## Decisions needed from Dean

1. **Routing of cost-basis-unavailable.**
   - Conflict: Mock 3 says it blocks before the modal (technical failure). Decision 4 says a banner line.
   - **Recommendation: split by cause**, as Diane proposes.
     - A fixable technical read failure (null, zero, unparseable or mis-scaled basis) blocks before the modal with an error. Action: Refresh Portfolio. This follows the CLAUDE.md principle "technical failures block before a modal".
     - Multi-lot and floor-not-met are verified results, not read failures. They open the modal with an in-modal banner and caption.
   - This refines decision 4 and does not contradict it. Dean's ruling is needed because decision 4 was closed with a banner line.
2. **Multiple held LEAPs.**
   - Question: does a block for one LEAP stop results for the others?
   - **Recommendation: no.** Results are per LEAP. A LEAP with a fixable read failure shows a caption card with the error and Refresh Portfolio. The other LEAPs still show results.
   - A pre-modal block applies only when every selected LEAP has a fixable read failure. If that is too complex, the fallback is to show the caption card in-modal for all causes. Diane should say which is simpler in Mock 3b.

## Acceptance criteria

- For each of the three outcomes, the caption, banner and detail render as specified in the approved Mock 3b.
- For the two not-checked causes, no funnel breakdown renders and the text "no short calls found" never appears.
- The Avg open tile shows an em dash for unavailable and multi-lot.
- The floor-not-met banner shows the actual Kl, avgOpen and floor values, computed from the engine result and not recomputed in the UI.
- Fixable read failure follows Decision 1's ruling. Multi-LEAP behavior follows Decision 2's ruling.
- With several held LEAPs, one LEAP's not-checked state does not hide another LEAP's results.
- The unit-guard detail line ("looks mis-scaled") appears only for the unit-suspect case.
- **Rejected, not near-miss (Ian's condition, 2026-09-24):** floor-failed, unit-suspect and multi-lot held pairs appear in `nearMissPairs` as data, but the held UI shows them as rejected with the reason code, not styled or ranked as near-misses, with no order or promote affordance. Diane and Quinn cover this in Mock 3b and the tests.
- The existing zero-shorts banner (Mock 3) and its "Adjust short delta" action are unchanged for the delta-bound case.
- Engine outputs and PMCC new-entry results are unchanged.

## Implementation notes

- **page.tsx rules.**
  - Do not read `app/screener/page.tsx` in full. Grep for the symbol and read only the relevant range.
  - Put non-page logic in `lib/` (caption and banner selection as a pure function keyed on reason code and detail). Do not add non-allowed named exports to page.tsx.
  - Before handoff, Dane states which sibling code paths were checked and that real tsc and tests were run.
- The results component is likely under `features/screener/components/` (Mock 3 tile names were not verified against it). Dane confirms the actual component and tile names first.
- Read the detail string ("multi-lot LEAP: cost averaging unverified", unit-suspect) from the engine result. Do not re-derive the cause in the UI.
- Add unit tests for the pure selector (each code and detail maps to the right caption, banner and funnel visibility) and component tests for the not-checked cases. The component tests must assert there is no funnel and no "no short calls found" text.

## Validation steps

- `tsconfig.check.json` tsc.
- Affected existing tests, plus the new selector and component tests. Ask before running the full suite.
- **Vercel preview is required and authoritative** (touches page.tsx or its imports). Manual check on preview: the three outcomes on a held LEAP. The multi-lot case cannot be reproduced with Dean's real positions (UBER, NFLX, one contract each), so it is covered by test only.

## Rollout notes

- **Sequencing relative to PR1.**
  - PR1 (slice A, engine-only) is safe to merge only if Mock 3b is approved within 1-2 working sessions of 2026-09-24. If not, **hold the PR1 merge**. Without this UI the new fail-closed states are silent and misleading.
  - After approval: Diane's Mock 3b, then Ian, Paul and Dean approve, then Dane builds, then Vercel preview, then merge.
  - Dane must not build UI before the mock is approved.
- Approvals needed before build: Diane's Mock 3b; Ian, Paul and Dean approve the mock; Dean's rulings on Decisions 1 and 2. Alan is not needed unless the floor display value needs a fixture.
- Ships revertable on its own commit.
- The parent ticket's decision 4 line should be updated to point here once Dean rules on Decision 1.
