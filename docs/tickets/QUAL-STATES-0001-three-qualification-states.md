# QUAL-STATES-0001 — Qualified / Caution / Disqualified across the scans

## Status

**Approved by Dean 2026-09-25 (all lenses). All phases built and pushed to `main` (phase 3: full suite 375 files / 5491 tests, real `next build` pass). Covered call, PMCC and LEAPS remain out of scope until asked.** Rendered plan: https://claude.ai/artifact/PASofUNTQYxgfYrL78eWKo

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

## Phase 2: what was built (2026-09-25)

Order path for Ranked and Targeted spread orders (BPS, BCS, IC). CSP and PMCC order windows are unchanged (CSP is phase 3).

- **Card buttons** (`GenericResultCard`): Qualified rows keep the solid green "TRADE THIS"; Caution rows get an amber outlined "TRADE THIS (CAUTION)"; Disqualified rows get a quiet outlined "Trade anyway (override)". Rows with a three-state verdict no longer show the old OI `window.confirm`; the acknowledgment moves into the order window. Rows without a verdict (other modes) keep the old behavior.
- **Order window** (`TradeModal`): a non-Qualified trade shows `OrderOverrideAcknowledgment`: a red or amber block listing every failed rule and warning with its real numbers, and a checkbox "I understand and want to place this order anyway." "REFRESH & VALIDATE", the re-validate button and "PLACE + GTC" stay locked (label "ACKNOWLEDGE TO CONTINUE") until it is ticked, and `placeOrder` refuses independently. Qualified trades and trades with no verdict are never locked. Pure lock rule: `qualificationGateBlocking`.
- **Record** (`lib/entry-context/entryQualification.ts`): `{ state, failing[], warning[], overridden, acknowledgedAt, scanMode }` is sent with the pending entry (`/api/entry-context/pending` and `-ic`), sanitized on the server (malformed records are dropped, never thrown, since the order is already placed), stored with the pending entry, copied into the immutable entry snapshot when the fill is confirmed (`capture.ts`), and read back by the existing snapshots API. Optional on both snapshot types, so older orders and snapshots are unaffected.
- **Trade Log** (`app/trade-log/page.tsx`, `features/entry-context/EntryOverrideChip.tsx`): a red "Overrode scan" or amber "Entered on caution" chip beside the strategy badge on every trade whose entry snapshot carries an override, with every reason in the tooltip; the full-detail CSV gains "Entry State" and "Entry Overrides" columns.
- **Tests**: record build and sanitize, pending entry, promotion (credit spread and iron condor), chip and CSV, acknowledgment component and the lock rule.

Limits, stated plainly:
- The chip only appears once the entry snapshot exists, which happens after the broker confirms the fill (the same as every other snapshot-driven feature). A trade whose snapshot could not be saved has no override record.
- The Trade Log joins on the existing snapshot matching, so a trade that cannot be matched to a snapshot shows no chip.
- `TradeModal` itself is not unit-tested at page level (it lives in `page.tsx`); its behavior rests on the tested pure pieces above plus tsc and the build.

## Phase 3: what was built (2026-09-25)

CSP cards and CSP order window, plus the recording path for CSP orders.

- **State** (`lib/scans/qualificationState.ts` `deriveCspQualification`): from the candidate's own states. Disqualified: any `DISQUALIFIED_*` market state (IVR above the cap, IVR unavailable, earnings inside the 10-day buffer, poor liquidity, invalid quote, foundation ineligible or insufficient evidence) or a failed targeted minimum. Caution: `QUALIFIED_WITH_LIQUIDITY_WARNING`, or market-qualified but outside the preferred delta range (not a Best Opportunity). Qualified otherwise. **Account capital is a separate axis** (shown on the card, enforced by the order window's collateral guard) and does not change the state.
- **Cards and buttons**: the state badge, red or amber left border, "Score N · not eligible" on Disqualified, and the same three TRADE THIS variants as spreads. The Qualified and Disqualified sections, the section counts, Best Opportunities and the CSP header ("N of M QUALIFIED") are unchanged; a CSP in the Qualified section can now carry a Caution badge (liquidity or delta).
- **Order window** (`CspTradeModal`): the same acknowledgment block, and DRY RUN / PLACE stay locked ("ACKNOWLEDGE TO CONTINUE") until it is ticked; `placeOrder` refuses independently. The existing capital re-check is untouched.
- **Recording**: cash-secured puts had no entry-snapshot pipeline, so they get entry notes: `lib/entry-context/entryNote.ts` (validated pending note, promotion on confirmed fills, exact transaction matching), `entryNoteStore.ts` (Redis, owner-scoped, idempotent), `/api/entry-context/notes` (save and list) and `/api/entry-context/notes/promote`. Deliberately separate from the spread snapshots so their score fields and rollups are untouched. The order window saves the note after the order is placed (a failure is only a warning). The Trade Log promotes pending notes on load, loads notes, and shows the same chip and CSV columns, matching by exact broker transaction ids like a snapshot.
- **Shared**: the broker-transaction reader moved to `lib/entry-context/brokerTransactions.ts` and is used by all promote routes.

### Correction to phase 2, and the fix

Phase 2 said the override record reaches the Trade Log for BPS, BCS and IC. It did for BPS and BCS. **Iron condor pending entries were saved but nothing ever promoted them to snapshots** (`persistPromotedPendingIronCondorEntry` had no caller), so an IC override stopped at the pending stage. Fixed here: `/api/entry-context/promote-ic`, called by the Trade Log on load. Side effect to know: iron condor trades now get entry snapshots, so the Performance rollups (which read snapshots) will start including them.

### Tests and limits

- Tests: `cspQualificationState.test.ts` (every CSP market state, targeted failure, delta, capital separate, null cases), `entryNote.test.ts` (validation, promotion, exact matching), chip and `qualificationForTrade` tests.
- `CspTradeModal` is not unit-tested at page level (it lives in `page.tsx`); it rests on the tested pure pieces plus tsc and the build.
- Pending entries and notes are never removed after promotion, and the Trade Log tries to promote every one on each load (each attempt reads broker transactions). That was already true for spreads; notes and iron condors add to it. Candidate follow-up: skip pending entries already promoted.
- The chip appears only after the fill is confirmed and promoted.

