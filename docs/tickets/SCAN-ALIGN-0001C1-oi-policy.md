# SCAN-ALIGN-0001C1 — Open-interest policy: PMCC short becomes a warning; CC rejects missing OI

## Status

**Accepted by Dean 2026-09-24. Not built.** Build order slot 3 (after A and B). PR3, commit 1 of 2 (C2 is commit 2). Full suite required. Vercel preview required (touches `page.tsx:1494`).

## Problem

PMCC hard-rejects a short call below the OI minimum, while covered call only warns. Covered call shows missing OI as a "NaN" warning instead of rejecting.

## Scope

- PMCC **short leg**: OI below the minimum becomes a warning (`OI-LIQUIDITY-CHOICE-0001` applies). Missing, null or non-finite short OI still rejects. OI of 0 is data and warns.
- A **new LEAP** keeps the hard OI reject (fill risk). Null OI on a new LEAP rejects as `INSUFFICIENT_DATA`.
- **Held longs** skip the OI check entirely, including when chain OI is missing (`pmccPairing.ts:164` currently rejects).
- **Covered call**: reject null, undefined, NaN and Infinity OI. Fix the "NaN" display at `page.tsx:1494` (`shortOI >= OI_MIN`). Ranking must stay deterministic (no NaN in sorts).

## Non-goals

- Bid/ask changes (C2).
- Any change to CSP OI handling.

## Acceptance criteria

- Short OI = min passes with no warning; min − 1 warns and stays eligible; null rejects on CC and PMCC; 0 warns.
- A short below min OI reaches a pair; the new gate is a warning, not a disqualifier.
- A held long with missing chain OI is not rejected and raises no OI gate. A new LEAP with null OI is rejected.
- CC null, NaN, Infinity and undefined OI each reject.

## Implementation notes

- Existing tests that flip (Quinn, 2026-09-24): `pmccPairing.test.ts` "reports distinct leg rejections when no long or short is eligible" (short OI 99 no longer rejects; repoint to null OI); `pmccPairOnDemand.test.ts` "leg_rejected ... short leg ... (OI below minimum)" (repoint to null OI). Stay green: `ccConfigTruthfulness.test.ts` "open interest is advisory"; the `pmccPairing.test.ts` long-leg OI 99 row. Comment-only: `covered-call-finder.test.ts` 14c. Verify only: `pmccHeldLeaps.test.ts`, `pmccDecision.test.ts`, `pmccProduction.test.ts` (grep for short OI below min; counts may change).
- Add a component test with null OI for the `page.tsx:1494` display.
- Thin-OI tag copy is Diane's. OI change ships revertable on its own commit.

## Validation steps

`tsconfig.check.json` tsc, full suite, Vercel preview.

## Rollout notes

Alan signs off on fixtures before build. Quinn's test-flip review is done (2026-09-24).

## Golden fixtures (Alan, 2026-09-24) and Ian's rulings

**Blockers found on main, now in scope:** (B1) `pmccPairing.ts:169-170` rejects a held long with null OI as `INSUFFICIENT_DATA` before the held floor (PR1) sees it. C1 exempts held longs (`!isHeldLong && (null || !finite)`); `PmccEligibleLeg.openInterest` may be `null` **only for held longs** (type guard or comment; non-held legs must be non-null and finite, with a test enforcing it; no consumer does arithmetic on OI without a null check). Also `:190` puts any leg with `openInterest == null` into `rejected` with EMPTY reasons: every rejection must carry a reason code (test). (B2) `isEligibleCcLeg` (`covered-call-finder.ts:63-95`) has no OI check today; null/NaN/Infinity OI is eligible and reaches the `:145` sort comparator (NaN). C1 adds a real check: OI must be finite, >= 0 and at or above the floor for eligibility; null/NaN/Infinity/negative are ineligible with an `INSUFFICIENT_DATA` reason. (Ian) Negative OI is invalid data, not zero. (Ian) Add strike ascending as the final CC sort tie-break so ranking is deterministic.

M = `shortOiMin` / `longOiMin` (100 in the pairing fixtures; CC uses `OI_MIN`).

| # | Leg | OI input | Expected |
|---|---|---|---|
| 1 | PMCC short | M | eligible, no OI warning |
| 2 | PMCC short | M-1 (99) | eligible, OI warning (not `OPEN_INTEREST_BELOW_MINIMUM`), reaches `qualifiedPairs` |
| 3 | PMCC short | 0 | eligible, warns (0 is data) |
| 4 | PMCC short | null / undefined / NaN / +Inf / -Inf | rejected `INSUFFICIENT_DATA` "Open interest is missing or invalid" |
| 5 | PMCC short | -1 | rejected `INSUFFICIENT_DATA` |
| 6 | new LEAP | M / M-1 / 0 | pass / `OPEN_INTEREST_BELOW_MINIMUM` / same code (unchanged) |
| 7 | new LEAP | null, NaN, Inf | `INSUFFICIENT_DATA` |
| 8 | held long | 50, 0, null, NaN | eligible, no OI reason; with a basis entry it reaches `evaluateHeldBreakevenFloor` and passes/fails on price only |
| 9 | held long, null OI, no basis | | `COST_BASIS_UNAVAILABLE` (proves it reached the floor, not an OI reject) |
| 10 | CC leg | null, undefined, NaN, +Inf, -1 | excluded from `selectAllEligibleCcLeg`; a good leg in the same chain survives |
| 11 | CC leg | M / M-1 / 0 | M passes; M-1 and 0 stay eligible and warn |

Held order asserted: filterLegs (OI skipped) -> evaluatePair structural -> NET_DEBIT checks skipped -> held floor; no OI code may appear on a held long.

**Display (`page.tsx:1494`, `OI_MIN` = 500):** 500 -> pass "500", "≥ 500 minimum"; 499 -> warn "499", "Below 500"; 0 -> warn "0"; null/undefined/NaN (defensive) -> value "—", reason "Open interest unavailable"; assert `not.toMatch(/NaN|null|undefined/)`. Component test with null OI required.

**Ranking:** OI 500 vs 300 vs 0 at equal delta ranks 500, 300, 0; every input permutation yields the same order; no comparator returns NaN.

**Tests that flip:** `pmccPairing.test.ts:149` "reports distinct leg rejections…" (repoint short OI 99 to null; `legRejections` stays 2); `pmccPairOnDemand.test.ts:84` (repoint to null OI). `ccConfigTruthfulness.test.ts` "open interest is advisory for covered calls" stays green unless it uses null OI (verify). `covered-call-finder.test.ts:326` (14c): comment only. Not grepped: `pmccHeldLeaps`, `pmccDecision`, `pmccProduction` (verify by grep for short OI below min).

Ian's rulings: APPROVED as above (B1 to B3, Q4 to Q6).
