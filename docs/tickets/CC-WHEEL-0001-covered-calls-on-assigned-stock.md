# CC-WHEEL-0001 — Covered calls on assigned stock: adjusted basis, strike floor, RSI gate

**Status:** DRAFT v2 (2026-11-04), independent review folded in; for team review. No build before Ian, Paul, Alan and Diane approve. Quinn reviews testability.
**Raised by:** Dean, asking when a covered call is worth selling after a CSP assignment (example: TQQQ assigned at $80, trading near $62).
**Related:** SCAN-ALIGN-0001, CC-ORDERS-0001, STOCKS-0001, RSI-ENTRY-0001, RSI-CALL-GATE-0001 (drafted, not in repo), PMCC-HELD-UNDERWATER-0001 (the recovery-list pattern), WHEEL-SYSTEM-0001..0003, DECIDE-0001.

## Problem (verified against main, 5c91e35)

1. **Cost basis is the broker's `average-open-price`** (`lib/scans/covered-call-capacity.ts`). After a put assignment that is the strike, not the strike less the put premium. No premium-adjusted basis exists anywhere (WHEEL-SYSTEM W3 "true cost basis" was never started).
2. **The Covered Call scan hard-floors the strike at max(stock price, broker basis)** (`lib/scans/covered-call-finder.ts`, `minStrike`). With TQQQ at $62 and basis $80 only strikes of $80 or more can qualify; those have tiny deltas. The default delta window is 0.20 to 0.35 (`lib/scans/constants.ts`). Alan's estimate for TQQQ at $62, $80 strike, 45 DTE, IV about 65%: sigma x sqrt(t) = 0.65 x sqrt(45/365) = 0.228; ln(80/62) = 0.255; d1 = (-0.255 + 0.026) / 0.228 = -1.0, so delta is about 0.16, under 0.20. The scan almost certainly returns nothing. Estimate only; not reproduced with a live run.
3. **The scan and the order dialog disagree.** The scan never shows a strike below basis. `CcTradeModal` allows one if the trader acknowledges the loss (`ccOrderMath.ts`, `ccOrderSubmission.ts`). Dean's 2026-10-23 ruling (never recommend a strike below cost basis unless he opts in per position) has no per-position opt-in in the code.
4. **Two different RSI ideas for covered calls.** Dean's 2026-10-30 rule is a level: do not sell a call unless daily RSI is 50 or above. `RSI_ENTRY_PARAMS.CC` (`lib/indicators/rsiEntryGate.ts`) is a turn-from-a-peak gate (peak at or above 60, then turning down). It is not wired to any screen: `getRsiEntryGate` and `evaluateRsiEntryGate` have no production caller (RSI-ENTRY slice A2 was never wired); only `rsiEntryForSymbol.ts` and tests use them. A turn-gate PASS needs a peak of 60 or more and latest RSI above 50, so it is a stricter subset of the level rule; the two disagree only where the level rule says Ready and the turn gate says Wait. Only one rule may run on a screen.
5. **The stock row says nothing about timing.** `StockHoldings` shows covered-call capacity only.

## Dean's direction (2026-11-04)

- Wants the most robust model, shown as simply as possible; Ian, Paul and Diane to weigh in.
- The RSI cutoff must be adjustable without a code change.
- Team-supplied guidance (the trading group's Assigned Stock framework): no single hard minimum; look for RSI 50 to 70 on the daily or weekly chart; below 40 to 50, hold off or sell very wide out-of-the-money calls. Treated as input, not as Dean's tested rule.
- Taking a loss is the last thing he wants (2026-10-29); assignment, rolls and holding come first.

## Proposed design (one name per concept, Diane and Ian)

**Three numbers per wheel stock:** broker basis, adjusted basis, current price. Distance to adjusted basis is shown as a percent.

**Two states:**
- **At or above adjusted basis:** the normal covered-call scan. Strike floor = adjusted basis.
- **Below adjusted basis (Recovery):** a held-LEAP-style list (PMCC-HELD-UNDERWATER-0001): far-OTM, low-delta calls, best premium first, with strike, expiry, premium per contract, % above price, delta and P/L if called. Never auto-picked; no call is recommended below basis.

**One chip on each stock row:** Ready (green: RSI at or above the cutoff and a qualifying strike exists), Recovery (amber: price below adjusted basis), Wait (RSI below the cutoff, with the RSI value on click). Wait is a soft gate: the far-OTM list stays reachable behind the warning. Detail is collapsed; two columns when expanded (Dean's layout rule).

## Slices

**A. Adjusted basis (Alan validates; Ian approves the definition).** New pure module. Adjusted basis per share = lot cost less premium received (net of fees) on the short puts that ended in assignment into the lot and on covered calls sold since.

*Feasibility (review 2026-11-04):* no assignment linkage exists today. `lib/tradeLog/reconstructTrades.ts` (lines 31-36) states it does not do assignment lifecycle linkage. The put comes out as a closed trade with `closureMechanism: 'ASSIGNED'`, and `equityRealized.ts` builds the share lot separately from the Receive/Deliver row; nothing joins them by id. `cycleHistory.ts` cannot tell a covered call from a PMCC short call, and rolls are guessed from same-day dates. The Trade Log covers only the active account and 12 months. So this slice must first **build the linkage**, with a stated matching rule (symbol, assignment date, share quantity equals contracts x 100, one-to-one) that Alan approves before any code.

*Fail-closed:* show broker basis, labeled "broker basis", and never a guessed adjusted figure, whenever any of these is true: any share lot on the symbol opened before the window; an unmatched closure on the symbol; shares not fully explained by assignments plus buys; any partial assignment or two assignments into one lot (until the rule handles them); a PMCC long call on the same underlying; the same symbol held in more than one account. A call that expired, was bought back or was rolled is counted at its realized amount; a rolled put's credit is carried only if the roll can be proven, otherwise fail closed.

**B. Strike floor mode.** Floor = adjusted basis by default, and it stays a hard filter (trust the qualified realm), not a warning. When adjusted basis is unavailable the floor is broker basis (the more conservative choice), labeled. A per-position opt-in allows strikes below the floor, storing the choice per position, and the order dialog's loss acknowledgment stays. Scan, dialog, Trade Lookup and the engine page use one shared rule. Recovery list per the design above; because it widens below the default delta 0.20, it needs its own delta bounds (Ian rules).

**C. Stock-row chip and drill-in.** `features/portfolio/positions-workspace/StockHoldings.tsx`. Diane's mock first; no UI before approval.

**D. RSI cutoff.** Daily RSI from the existing `lib/indicators/rsi.ts` and completed daily bars. Setting stored per user (same Redis-per-user pattern as `app/api/nav-config/route.ts`; the shared setting is edited on the Profile page, with the same control in the CC scan modal for a single run). Default 50. Retire the CC branch of the turn gate (it has no production caller, so no screen changes; `rsiEntryGate.test.ts` and `rsiEntryForSymbol.test.ts` CC cases are updated) so one rule applies (Ian rules; RSI-ENTRY-0001 stays for CSP).
 - **D2. Data panel (no AI).** Next to the setting: for the user's tickers, the share of the last year's days that would read Ready at each cutoff, and how entries on those days did afterward. Deterministic, built on stored daily bars. Ian and Alan check leveraged-ETF behavior before the default is trusted; a per-ticker cutoff is only considered if the data shows it is needed.
 - **D3 (optional, later). Weekly RSI shown beside daily for information only.** Not computed anywhere today; it would be derived from daily closes. The gate stays on daily.

## Out of scope

Rolls and roll recommendations; PMCC short calls (PMCC flow owns them); the options bot; ex-dividend handling; an AI recommendation of the cutoff (decided no, 2026-11-04: it would add a second source that can disagree with the data panel).

## Open items

1. Dean confirms: default floor is adjusted basis with per-position opt-in below it; recovery shows only far-OTM low-delta calls, never auto-picked; default RSI cutoff 50 (not 60).
2. Ian to rule on replacing the CC turn gate (finding 4) and on the exact "far-OTM, low delta" bounds for Recovery (reuse the held-LEAP defaults: 7 to 10 DTE, delta range selectable before the scan).
3. Alan: approve the assignment-matching rule and fail-closed list in slice A (review verdict on v1: reject as written; v2 rewrites it). Also dividends and broker basis adjustments after wash sales.
4. Reproduce finding 2 with a live scan on a below-basis holding before slice B changes the finder.
5. Independent review 2026-11-04 (advice, not approval; no tests, tsc or live scan were run): Ian approve with changes, Alan reject slice A as written, Quinn approve with changes. v2 applies the changes.

## Tests (Quinn)

Adjusted basis: single assignment; two assignments in one lot; rolled put before assignment; calls expired, bought back and rolled; partial assignment (fails closed); a lot bought before the window mixed with an assigned lot (fails closed); a PMCC long call on the same symbol (fails closed); the same symbol in two accounts (fails closed); history window too short (falls back to broker basis, labeled); fees. The engine-page strike agrees with the shared helper. Floor: default blocks below adjusted basis; opt-in allows it and the dialog still requires acknowledgment; scan and dialog agree on one fixture. Chip: Ready, Recovery and Wait each with a fixed fixture; RSI exactly at the cutoff; RSI unavailable fails closed to Wait. Setting: persists per user; defaults to 50; invalid values rejected. Data panel: deterministic output on a fixed bar series.

## Sibling check to do before build

Every site that reads `ccCostBasis`, `costBasis`, `averageOpenPrice` or `minStrike` must use the same basis helper: `lib/scans/covered-call-capacity.ts`, `lib/scans/covered-call-finder.ts` (two `minStrike` sites), `lib/portfolio-snapshot/normalizeEquity.ts` (a second copy of the basis logic), `lib/portfolio-snapshot/capacity.ts`, `features/portfolio/positions-workspace/model/stockHoldings.ts`, `lib/scans/ccOrderMath.ts`, `lib/tradeLookup/flags.ts` and `loadLookup.ts` (below-basis flag), `lib/screener/scanConfig/ccRegistry.ts` (minStrike hint and chip text), `app/screener/page.tsx` (`ccCostBasis` passed to the dialog, around lines 6915 and 12433; grep, do not read in full), `app/wheel/page.tsx` and `app/api/wheel-candidates/route.ts` (basis typed in by hand), `app/engine/page.tsx` (recommends its own strike as ceil(basis x 1.03 / 5) x 5), `lib/market/holdings.ts`. The `long-book` page's `costBasis` is the LEAP debit and is unrelated. After the change, and Cut Losses availability (`lib/portfolio/cutLossesAvailability.ts`) must keep treating wheel and acquisition calls as "assignment is the plan".
