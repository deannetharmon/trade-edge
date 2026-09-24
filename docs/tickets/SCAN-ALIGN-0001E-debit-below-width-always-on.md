# SCAN-ALIGN-0001E — Make PMCC debit < width non-switchable

## Status

**Accepted by Dean 2026-09-24. Not built.** Build order slots 6 and 7, after A. Two commits, in its own PR (not bundled with D). Alan and Ian sign off; Ian confirms held-mode rules match A. Full suite and Vercel preview required.

## Problem

`requireDebitBelowWidth` can be switched off, so a PMCC pair can be structurally guaranteed to lose money if assigned. Both CC and PMCC mean "never sell below breakeven" (cost basis for CC; LEAP strike + debit for PMCC).

## Scope

**E1 (commit 1): stop reading the field.**
- Remove `requireDebitBelowWidth` from `validateCriteria` (`pmccConfig.ts:89`) and saved settings. A saved `false` must not survive: it is stripped on load and the check still applies.
- Stop passing it from `pmccHeldReadinessClient.ts:33`, `serverTradeReview.ts:85` and `page.tsx:5695/10126`. `app/api/pmcc-trade-review/route.ts` and `app/api/pmcc-held-trade-review/route.ts` tolerate a client that still sends it.
- Update the comment at `pmccProduction.ts:19`.

**E2 (commit 2): debit ≥ width becomes a hard reject** (`pmccPairing.ts:246-248`). Near-miss counts change (`counts.structurallyValidPairs`, `nearMissPairs`, `scanSession.ts:782-784`, `pmccAuditSummary` grouping of `NET_DEBIT_NOT_BELOW_WIDTH` as a hard reject). Add a "Debit ≥ width" always-on receipt row (Diane copy).

## Non-goals

- Held-mode breakeven itself (ticket A).
- `pmccStartPrice` changes beyond the label and held-mode input.

## Acceptance criteria (Alan)

- Debit = width − 0.01 passes; = width rejects; saved toggle `false` still rejects.
- Held: equality rejects, +0.01 passes; null, 0 or NaN `avgOpenPrice` rejects; a per-contract-scaled value (× 100) is caught by a unit guard.
- `validateCriteria` accepts criteria without the field; pin whether an unknown extra key is ignored or rejected.

## Implementation notes

- Tests that flip: `pmccPairing.test.ts` "retains debit-at-or-above-width pairs in the near-miss audit set" (line 98: `nearMissPairs` empty, `structurallyValidPairs` 0); `pmccPairOnDemand.test.ts` "outcome: near_miss ... fails only requireDebitBelowWidth" (line 109: becomes `pair_rejected`, rename). Verify `pmccPairing.test.ts` "keeps all applicable pair failure reasons" (line 195).
- Remove the field from fixtures in `pmccPairing.test.ts`, `pmccPairOnDemand.test.ts`, `pmccDecision.test.ts`, `pmccProduction.test.ts`, `pmccPairing.perf.test.ts`, `ScreenerPage.test.tsx` (lines 323, 998, 1130). `PmccResultCardFields.test.tsx:117` uses `requireDebitBelowWidth: false`: check whether its pairs have debit ≥ width.
- Diane check on UI copy about near-misses.

## Validation steps

`tsconfig.check.json` tsc, full suite, Vercel preview.

## Rollout notes

E depends on A: without A, held mode has no debit rule once the toggle goes. The saved-setting strip cannot be undone but is safe to roll back; reverting only E2 is trivial after E1.
