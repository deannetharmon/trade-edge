# CC-WHEEL-0001 — Covered calls on assigned stock: cost basis, strike floor, RSI chip, strike grid

**Status:** v3 (2026-11-04). Team consensus reached (Ian, Paul, Diane, Alan, Quinn); Dean's three defaults confirmed by team ruling. Build is gated per slice (see Gates). Frank facilitates.
**Raised by:** Dean, asking when a covered call is worth selling after a CSP assignment (example: TQQQ assigned at $80 or $82, trading near $62).
**Related:** SCAN-ALIGN-0001, CC-ORDERS-0001, STOCKS-0001, RSI-ENTRY-0001, RSI-CALL-GATE-0001 (drafted, not in repo), PMCC-HELD-UNDERWATER-0001 (recovery-list pattern), WHEEL-SYSTEM-0001..0003, DECIDE-0001. Audit: project docs `CC-FLOW-AUDIT-0001` and its addendum (the other tool's analyzer).

## Problem (verified against main, 5c91e35)

1. **Cost basis is the broker's `average-open-price`** (`lib/scans/covered-call-capacity.ts`): after a put assignment that is the strike, not the strike less premium. No premium-adjusted basis exists.
2. **The scan fails open when basis is unknown** (CCAUD-01). `covered-call-finder.ts` computes `minStrike = max(price, costBasis)` with nulls dropped (two sites); with no basis the floor is just the stock price, so a strike that locks in a loss can qualify.
3. **With basis known, the scan almost certainly returns nothing for TQQQ.** Floor $80 at price $62: Alan's estimate of delta is about 0.16 (sigma x sqrt(t) = 0.228, ln(80/62) = 0.255, d1 = -1.0), under the 0.20 delta floor. Estimate only; not reproduced live.
4. **One contract per stock.** `findBestCoveredCall` returns a single contract; `findAllCoveredCalls` has no production caller. No yield or score.
5. **Scan and order dialog disagree.** The scan never shows a strike below basis; `CcTradeModal` allows one with an acknowledgment. Dean's 2026-10-23 ruling (no strike below cost basis unless he opts in per position) has no per-position opt-in.
6. **Two RSI ideas.** Dean's level rule (daily RSI at or above 50) versus the turn-from-peak gate `RSI_ENTRY_PARAMS.CC`, which has no production caller (`getRsiEntryGate` unused). The turn gate is a stricter subset of the level rule.
7. **Three conflicting "when to sell" ideas:** the scan, the Income Engine (`app/engine/page.tsx` line 879 suggests `ceil(basis x 1.03 / 5) x 5` with 28 DTE and no chain data), and the AI analysis, whose prompt carries no chain, premium, IV, RSI or trend.
8. **Working-order statuses differ:** `covered-call-capacity.ts` line 239 counts live and working; `existingGtcReplacement.ts` line 248 counts Received, Routed, In Flight, Live, Contingent. A pending buy-to-close can be missed.
9. **The stock row says nothing about timing** (`StockHoldings`).

## Decisions (team consensus 2026-11-04)

**D1. Strike floor.** Never recommend a strike below cost basis. The floor is a hard filter ("trust the qualified realm"). A per-position opt-in allows strikes below it; the order dialog's loss acknowledgment stays.

**D2. Recovery list.** When price is below cost basis, show only far-OTM, low-delta calls (delta 0.10 to 0.20, Ian), best premium first, with the loss if called. Never auto-picked, never recommended.

**D3. RSI.** Level rule on daily RSI, default cutoff 50, per-user setting editable without code. Wilder 14 on completed daily bars only (no partial bar). Below the cutoff the chip reads Wait (soft gate; the Recovery and grid views stay reachable behind the warning). The turn-from-peak CC branch is retired. No AI recommends the cutoff.

**D4. One "cost basis" concept with a source label.** The screen shows one number, "Cost basis", labeled by source: *typed* (the user's own figure), *adjusted* (proven from assignment history), or *broker* (fallback). Precedence: typed, then adjusted, then broker. If none is available the scan fails closed (no results, with a message), never open.

**D5. Strike grid replaces "one best contract".** Expiration columns by strike rows. Each cell: premium, delta, total if called, and the "not called" line (premium kept, shares kept, cost per share lowered). Three named goals map to the existing delta presets (Ian): Upside .10-.20, Balanced .20-.35 (default), Income .30-.40. Cells below the floor are shaded and read "locks in loss"; they need the opt-in. A 7-14 DTE weekly preset is added. Delta comes from the broker quote, not an estimate.

**D6. Total formulas (Alan).** Called away: (strike - cost basis) x 100 + premium x 100, where cost basis already includes earlier premiums; never count a premium twice. Not called: premium kept, effective cost basis lowered by the premium per share.

## Slices (Paul's order; each ships alone)

**S1. Fail-closed floor (safety fix).** Remove the fail-open `minStrike` in both finder sites; no basis means no results with a clear in-modal message. One shared floor helper used by the finder, `ccOrderMath.ts`, `lib/tradeLookup/flags.ts` and the engine page. Unify working-order statuses in one shared constant. Quinn tests below.

**S2. Typed cost basis + per-position opt-in.** Per-position typed basis and opt-in stored per user (Redis per user, nav-config pattern). Source label shown. Resolves the "no basis" case for the user immediately, with no history linkage.

**S3. RSI chip and setting.** Daily RSI from `lib/indicators/rsi.ts`; chip Ready / Recovery / Wait on `StockHoldings`; setting on the Profile page and in the CC scan modal for one run. Data panel (deterministic; counts and sample size shown, thin samples labeled; Ian and Alan check leveraged-ETF behavior before the default is trusted). Optional later: weekly RSI beside daily, information only.

**S4. Strike grid and goals.** Per D5, multi-candidate results, Recovery list, weekly preset. Fixes the one-contract-per-stock gap.

**S5. Adjusted basis from assignment history (last).** Needs new linkage; none exists today (`reconstructTrades.ts` lines 31-36; `equityRealized.ts` builds the lot separately; Trade Log covers the active account and 12 months). Matching rule (Alan, proposed): symbol, assignment date, shares equal to contracts x 100, one-to-one. Fail closed (show typed or broker basis) when: any lot opened before the window; an unmatched closure; shares not fully explained; partial assignment or two assignments into one lot; a PMCC long call on the same underlying; the same symbol in more than one account; a roll that cannot be proven; a possible broker wash-sale adjustment (check first so premium is not subtracted twice). **Alan's gate: golden fixtures for every case, including fees, approved before any code.**

**S6. Income Engine and AI analysis aligned.** The engine page uses the shared floor and real chain data or says it has none; the AI prompt (`lib/portfolio/stockAnalysis.ts`) receives the chip state, cost basis with source, and the top grid candidates, so it no longer guesses.

## Gates

- **Ian:** approved D1 to D5 with conditions (hard floor stays hard; recovery bounds 0.10-0.20 shown before the scan; RSI default 50 validated on TQQQ and similar by the data panel, else per-ticker setting).
- **Paul:** approved scope and the slice order.
- **Alan:** approved the formulas (D6) and RSI definition; **S5 blocked until golden fixtures are approved.** Delta must be the broker's quote.
- **Diane:** mock approved for the shape below; the final mock is attached to the PR for S3 and S4 before UI code.
- **Quinn:** approved test list below.

## Diane's mock (shape)

Stock row: `TQQQ  100 sh  Cost basis $82.00 (typed)  Price $62.85  -23%   [Recovery]`. The chip is one of Ready (green), Recovery (amber), Wait (grey, RSI value on click).
Expanded panel, two columns, collapsed by default:
- Left: Cost basis with source, broker basis, price, distance %, RSI vs cutoff, goal selector (Upside / Balanced / Income).
- Right: grid, expirations across (7, 9, 12, 14 DTE or the standard presets), strikes down. Each cell: `$75  +$29  d.12`, then `called: -$671 (-8.2%)` and `not called: cost $81.71`. Below-floor cells shaded amber with "locks in loss". No donut, no chart in the first version (entry and strike lines on the chart are later, lower priority).

## Out of scope

Rolls and roll recommendations; PMCC short calls; the options bot; ex-dividend handling; an AI recommendation of the cutoff (decided no); percent-above-price strikes (the other tool's method).

## Tests (Quinn)

- **S1:** no basis returns no results and a message (regression for the fail-open); strike below basis is excluded; the finder, order math, flags and engine agree on one fixture; one working-order status constant used everywhere; capacity ignores a statuses mismatch.
- **S2:** typed basis precedence over broker; opt-in per position allows below-floor and the dialog still requires acknowledgment; opt-in does not leak to other positions.
- **S3:** Ready, Recovery, Wait each with a fixed fixture; RSI exactly at the cutoff; RSI unavailable fails closed to Wait; partial bar excluded; setting persists per user, defaults to 50, rejects invalid values; data panel deterministic on a fixed bar series.
- **S4:** grid cell math for called and not called (including the -$671 / -$1,190 / -$1,502 style cases at an $82 basis); delta from the quote; Recovery bounds; weekly preset.
- **S5:** single assignment; two assignments into one lot; rolled put; calls expired, bought back and rolled; partial assignment; pre-window lot; PMCC long call on the same symbol; two accounts; short window falls back and is labeled; fees; wash-sale case.
- **S6:** the AI prompt contains chip, basis source and candidates; engine strike agrees with the shared helper.

## Sibling check before each build

Every site that reads `ccCostBasis`, `costBasis`, `averageOpenPrice` or `minStrike` must use the shared helper: `lib/scans/covered-call-capacity.ts`, `lib/scans/covered-call-finder.ts` (two sites), `lib/portfolio-snapshot/normalizeEquity.ts` (second copy of the basis logic), `lib/portfolio-snapshot/capacity.ts`, `features/portfolio/positions-workspace/model/stockHoldings.ts`, `lib/scans/ccOrderMath.ts`, `lib/scans/ccOrderSubmission.ts`, `lib/tradeLookup/flags.ts` and `loadLookup.ts`, `lib/tradeLookup/coverage.ts`, `lib/screener/scanConfig/ccRegistry.ts`, `app/screener/page.tsx` (`ccCostBasis` around lines 6915 and 12433; grep, do not read in full), `app/wheel/page.tsx`, `app/api/wheel-candidates/route.ts`, `app/engine/page.tsx` (lines 430 and 879), `lib/market/holdings.ts`, `lib/portfolio/stockAnalysis.ts`, `lib/portfolio/existingGtcReplacement.ts`. `long-book` `costBasis` is the LEAP debit and unrelated. Cut Losses availability (`lib/portfolio/cutLossesAvailability.ts`) must keep treating wheel and acquisition calls as "assignment is the plan".

## Open items

1. Reproduce the empty TQQQ scan live before S1 changes the finder.
2. Verify real working-order statuses from broker payloads.
3. Confirm multi-account behavior (the capacity report reads the active account only).
4. Find which screens read `evaluateCcThesis` (`lib/decision/strategy-thesis/cc.ts` treats bullish evidence as high call-away risk).
5. Phase 2 of the audit (managing an open covered call: take profit, roll, called away; trade log treatment) may add items; it does not block S1 to S3.
6. Alan: golden fixtures for S5.
