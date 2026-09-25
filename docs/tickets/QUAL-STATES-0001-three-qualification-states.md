# QUAL-STATES-0001 — Qualified / Caution / Disqualified across the scans

## Status

**Approved by Dean 2026-09-25 (all lenses). Phases 0 and 1 built and pushed to `main` (full suite 369 files / 5449 tests, real `next build` pass). Phases 2-3 not built.** Rendered plan: https://claude.ai/artifact/PASofUNTQYxgfYrL78eWKo

## Problem

Dean's screenshots showed green "Strong" badges and a solid green TRADE THIS on rows the header calls disqualified. Investigation found the yes/no `qualified` flag lumps warnings in with hard fails, and that the Ranked scan could never produce a qualified row at all.

## Decisions (Dean, 2026-09-25)

- Three states: **Qualified** (every gate passes), **Caution** (no fails, at least one warning), **Disqualified** (at least one hard fail; a missing or unknown gate status fails closed).
- The override to trade a disqualified row stays available, as a named, acknowledged act. Acknowledgment lives inside the order window (not `window.confirm`), lists every fail and warning with its numbers, and is recorded on the order and carried through to the trade log.
- Header counts read "N QUALIFIED · N CAUTION · N DISQUALIFIED". Score badge: full tier badge on Qualified; normal badge plus a caution chip on Caution; on Disqualified no tier word, "Score 75 · not eligible".
- **Ranked mode** (Ian, independent ruling): gates are IVR (fail below the floor), ROC (fail below the minimum), earnings (fail inside the 10-day-after-expiry buffer, the same as Targeted, CSP and covered call), and OI (warning only, per OI-LIQUIDITY-CHOICE-0001). Credit, delta and POP have no floor in Ranked and are shown as "scored, not gated". A missing earnings date passes (Ian, 2026-09-24). Best Opportunities lists Qualified rows only.
- Phases: 0 Ranked bug fixes; 1 shared state function, header counts and card labels on spread cards; 2 order-window acknowledgment plus TRADE THIS variants (spreads), with the override recorded through to the trade log; 3 CSP cards and button (CSP already has Qualified, Qualified with liquidity warning, Disqualified). Covered call, PMCC and LEAPS wait until asked.

## Phase 0: what was built (2026-09-25)

- `lib/scans/qualificationState.ts`: pure `deriveQualificationState(checks, gateKeys)`; `RANKED_SPREAD_GATE_KEYS = ivr, earnings, oi, roc`.
- `lib/scans/rankChecks.ts`: Ranked per-candidate earnings check (shared 10-day buffer, New York basis, fail, reason recognized by the earnings follow-up button), OI check through `assessOiLiquidity` (warn, iron condors use the worse short leg), final checks, fail reasons.
- `lib/scans/rank-scoring.ts` `exploreAllCandidatesForRank`: both the IC and BPS/BCS paths use the above, and `qualified` is derived from the row's final checks. Before: `qualified` came from a strict `runChecklist` with no candidate (so it was always false), earnings used the old rule with no buffer, and low OI was a hard fail.
- Tests: `lib/scans/__tests__/rankQualification.test.ts` (Alan's fixtures: all-pass chain qualifies, low OI is caution, low IVR is disqualified, earnings 6 days after expiry fails and 10 days passes, no-date and past-date pass, non-gates ignored, missing status fails closed).
- Effect: Ranked scans will now show real qualified rows and populate Best Opportunities for the first time. Saved (cached) Ranked scans keep their old `qualified=false` until rescanned; phase 1 derives the state from the checks at display time so old and new agree.

## Known follow-ups and risks

- Ranked cached sessions: header counts use `computeSessionAccounting`'s `r.qualified`; phase 1 must derive from checks.
- CSV and PDF export read `qualified`; they will show real values for new Ranked scans.
- The override record needs a destination: trade log path not yet traced (phase 2).
- `page.tsx` `findRankModeCandidatesForSymbol` appears to be unused dead code that still holds the old `qualified: true` and old earnings text; remove in a cleanup ticket after confirming.
- Quinn: add a caution field to session accounting without changing existing meanings; test the acknowledgment (submit locked until checked, every fail and warning listed); both spread and CSP buttons change together.

## Phase 1: what was built (2026-09-25)

Display only; nothing about what qualifies, and no order path, changed.

- `lib/scans/qualificationState.ts`: `deriveSpreadQualification(result)` (Ranked and Targeted spread rows; null for other strategies) and `countQualificationStates(results)` (always derived from each row's checks, so saved and fresh scans agree; non-spread rows fall back to their qualified flag).
- `features/screener/components/QualificationBadge.tsx`: the state badge ("Qualified", "Caution: low OI 208/371", "Disqualified: IVR 3.7% below the floor +1 more"); tooltip lists every reason with its check text.
- Spread cards in Ranked and Targeted (`GenericResultCard`): the state badge leads the badge column; the left border is red for Disqualified and amber for Caution; on a Disqualified row the tier badge becomes "Score 76 · not eligible" (no tier word) in a neutral style, in both the header badge and the expanded score box. Qualified rows keep the tier badge as before.
- Header counts for Ranked and Targeted: "N QUALIFIED · N CAUTION · N DISQUALIFIED" (`QualificationCounts` shows caution only when given one). The accounting strip shows the same three states for those scans (`AccountingSummaryBar` `stateCounts`); every other scan is unchanged.
- Tests: `QualificationBadge.test.tsx` (gate descriptions, state text, "+N more", tooltip, spread-only derivation, counts ignoring a stale flag, header and strip caution).

Still true after phase 1: a green TRADE THIS button still appears on Disqualified rows until phase 2; the acknowledgment, the override record and the trade-log link are phase 2. Saved Ranked scans keep their old stored checks (old OI fail, no earnings buffer) until rescanned; their state is derived from those stored checks, so they may read more disqualified than a fresh scan.

