# WHEEL-SYSTEM-0002 — Wheel candidate ranking and the return hurdle (slice W2)

**Status:** DRAFT 1, 2026-09-26. Not approved to build. Owner: Dean Harmon.
**Parent:** WHEEL-SYSTEM-0001 (W1 is built and live). **Roadmap:** item 14.
**Mock:** screen 2 of https://claude.ai/artifact/PqJWm8PT2WvR4SwZHwDmTH was layout only. Diane must update it with the real fields below and Dean must see it before any build.

## Why

W1 shows what fits. W2 answers Dean's original question: which name on my list should I wheel next, and is the premium worth it. It ranks the names on the plan's list with plain reasons, and measures each against Dean's hurdle (annualized return at least 10%). It never places an order and never removes a name from the list.

## Decisions already made by Dean and Ian (2026-09-26)

1. **Hurdle:** annualized return on the cash tied up, measured at the actual **bid**, after fees, at least **10% a year**. Below it the verdict is "wait: premium too thin". Parked cash is counted at what it earns (shown in W4, not here).
2. **The list is the "would own" list.** Being on the plan's wheel list means Dean would own it. No separate tag in W2.
3. **Earnings is a timing flag, not a gate** (Dean and Ian, on a wheel you cross earnings): ETFs and indexes skip it. For a stock whose expected earnings date is on or before the chosen expiry the row is flagged, never blocked. The flag says the price can gap, offers the three choices (a shorter expiry that ends before it, wait until after it, or take it knowingly with the existing contract override), and adds "premium includes earnings risk" to the return so a stock cannot clear the hurdle only because the market is pricing in a gap. Default is "flag and keep ranking"; a switch makes it "wait until after earnings" (editable default). A follow-up (not W2) shows the strike's distance below the price against the stock's typical earnings move.
3b. Ranking: names without an earnings flag rank first, then flagged names; within each group by net annualized return, best first.
4. Target delta 0.30 for ETFs and indexes, 0.25 for stocks (W1, built).
5. Principle from W1: every threshold below is an editable default with a Reset, stored as an override, and the tab warns about unusual values but never blocks.

## The checks (each shows pass, warn, fail or unknown, with the reason in plain words)

| # | Check | Default | If not met |
|---|---|---|---|
| 1 | On the list | required | (not scored) |
| 2 | Net annualized return at the bid | at least 10% (1000 bps) | Wait: premium too thin |
| 3 | IV rank floor | ETF 20, stock 30 | Wait: not enough premium yet |
| 4 | Earnings timing (stocks only) | flag | Flag (or Wait, if the switch is set) |
| 5 | Not stretched: RSI(14) at or below | 70 | Wait for a pullback |
| 6 | Liquid put: (ask - bid) at most 10% of the mid, and open interest at least 100 | 1000 bps, 100 | Skip: put is illiquid |
| 7 | Fits the plan | from W1 | Not yet: unlocks in N months (W1 wording), or "Your override" |

"Unknown" (data missing) never fails a name: the row says "IV rank unavailable" and the verdict is decided by the other checks.

**Verdicts:** Candidate (checks 2, 3, 5, 6 pass or unknown, and it fits or is overridden), Wait (with the reason and, where it applies, the condition that would make it a candidate), Not yet (does not fit the profile), Skip (illiquid put or leveraged ETF). One reason per row, plus the chips.

No invented composite "score" in v1: the order is the rule in 3b, so the ranking is explainable. (The first mock showed a 0-100 score column; Diane to drop it or Dean to say he wants it.)

## Return arithmetic (integer cents and basis points, in `lib/wheel/candidateRank.ts`)

- `premiumCents = round(bid x 100) x 100` per contract (bid in dollars to cents, times 100 shares). `netPremiumCents = premiumCents - openFeeCents`. Closing is assumed free (Alan to confirm the broker schedule).
- `cashCents` = strike x 100 x 100 (from W1).
- `dte` = calendar days from today to expiry on the New York basis (`daysUntilNy`, `lib/scans/earningsPrecheck.ts`), at least 1.
- `annualizedBps = floor(netPremiumCents x 365 x 10000 / (cashCents x dte))`. Pass when `annualizedBps >= hurdleBps`.
- Bid 0 or missing: return unknown and the put is treated as illiquid (check 6).
- Fee: `openFeeCents` is a named constant with its source and date (Dean or Alan to confirm from the broker's published schedule; nothing in the code has one today: `page.tsx` says fees are excluded from all P&L figures). Editable default. Placeholder until confirmed: 100 cents per contract, unverified.

## Data sources (all browser-side; the wheel already fetches the chain and quote)

- **IV rank, earnings date:** `getMarketMetrics([symbols])` in `lib/scans/tastytrade-client.ts` (`ivRank`, `earningsExpectedDate`), one batched call for the whole list. Alan: `ivRank` is multiplied by 100 there, while the Income Engine page converts it differently (`app/engine/page.tsx` ~line 358: treats a value above 1 as already a percent). Confirm the unit once and use one conversion.
- **Earnings on or before expiry:** `earningsOnOrBeforeExpiration` (`lib/scans/earningsPrecheck.ts`), New York basis, so it agrees with the screener and Positions views.
- **RSI(14):** the app's `rsiSeries` (`lib/indicators/rsi.ts`) on the daily closes from `GET /api/chart?symbol=` (as `components/RsiLine.tsx` does). RSI is the last value of the series. Symbols with too few closes: unknown.
- **Bid, ask, open interest:** the chosen `WheelChainLeg` (already loaded in W1).
- **ETF or stock:** W1's `fetchInstrumentKind`.
- Sequential fetches (as W1), per-symbol failure states, and a single retry, same as W1. A failed metrics call marks IV rank and earnings unknown for every row without blanking the tab.

## New editable defaults (added to the plan's parameters)

`hurdleBps` 1000, `ivRankEtf` 20, `ivRankStock` 30, `rsiMax` 70, `maxSpreadBps` 1000 (of the mid), `minOpenInterest` 100, `openFeeCents` 100 (placeholder), `earningsRule` `flag` or `wait`. Same override storage, validation (hard errors only for invalid math, warnings otherwise), reset and tests as W1.

## Where it goes

A "Next candidate" table above the unlock ladder on the Plan tab. Columns: Stock, Verdict, Why (chips), Put to sell (strike, expiry, delta), Cash for one put, Net yield a year at the bid, Earnings note. The ladder below stays as built. No changes to Candidates, recommendations or any order path.

## Files (proposed)

New: `lib/wheel/candidateRank.ts` (pure: checks, verdicts, order, return math), `lib/wheel/__tests__/candidateRank.test.ts`, `lib/wheel/candidateData.ts` (fetch adapters for metrics and closes, injectable for tests), `features/wheel/NextCandidateTable.tsx` and tests. Edit: `lib/wheel/capitalPlan.ts` (new parameters and validation), `lib/wheel/planSchema.ts`, `features/wheel/WheelPlanTab.tsx` (wire in), `docs/ROADMAP.md`.

## Golden fixtures (Alan to confirm)

Balanced, ETF, bid 0.85, strike 51 (cash 5,100), dte 30, fee 100 cents: premium 8,500 cents, net 8,400 cents; annualizedBps = floor(8,400 x 365 x 10,000 / (510,000 x 30)) = 2,003 (20.03%): passes a 10% hurdle. Same put at bid 0.40: net 3,900, bps = 930 (9.30%): "Wait: premium too thin". Boundary: net premium exactly on the hurdle passes; one cent below fails. Bid 0: unknown and illiquid. Spread exactly 10% of the mid passes; one basis point over fails. IV rank exactly on the floor passes. RSI exactly 70 passes; 70.01 fails (compare in integer hundredths). Earnings on the expiry date counts as inside.

## Acceptance criteria

1. Every check shows its reason; unknown never fails a name; one reason per row.
2. Order: Candidates without an earnings flag first, then flagged, each by net annualized return; then Wait, Not yet and Skip rows.
3. Changing any threshold recalculates the table; Reset returns the default.
4. An ETF or index never shows an earnings flag. A stock with earnings on or before expiry shows the flag with the date, "premium includes earnings risk", and the three choices; with `earningsRule = wait` the verdict is Wait until after the date.
5. Missing data shows "unavailable" for that check only; nothing blanks the tab; retry works.
6. No order, position or recommendation changes; standing line "Guidance from TradeEdge rules. You decide; no orders are placed automatically."

## Open items

- **O1** Fee constant and its source (Dean or Alan from the broker schedule).
- **O2** IV rank unit (Alan).
- **O3** Diane's updated screen 2 (drop the score column or keep a score).
- **O4** Whether RSI 70 applies to ETFs too (Ian: yes, same rule; confirm).
- **O5** Expected-move follow-up ticket (earnings distance versus strike).
- **O6** Ranking tie-break within a group (net annualized return; then the lower cash need).

## Review gates

Ian: the checks, defaults and verdict wording. Alan: return math, fixtures, IV rank unit, fee. Quinn: data failures, tests, regression to W1. Diane: updated screen 2 mock. Dane: developer review last. Paul: scope (W2 only; W3 and W4 stay separate).
