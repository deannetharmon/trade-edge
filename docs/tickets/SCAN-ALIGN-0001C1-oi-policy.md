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
