# WHEEL-SYSTEM-0002 — Wheel candidate ranking and the return hurdle (slice W2)

**Status:** DRAFT 2, 2026-09-26 (Alan, Quinn and Dane reviews folded in below). Not approved to build. Owner: Dean Harmon.
**Parent:** WHEEL-SYSTEM-0001 (W1 is built and live). **Roadmap:** item 14.
**Mock:** screen 2 of https://claude.ai/artifact/PqJWm8PT2WvR4SwZHwDmTH was layout only. Diane must update it with the real fields below and Dean must see it before any build.

## Why

W1 shows what fits. W2 answers Dean's original question: which name on my list should I wheel next, and is the premium worth it. It ranks the names on the plan's list with plain reasons, and measures each against Dean's hurdle (annualized return at least 10%). It never places an order and never removes a name from the list.

## Decisions already made by Dean and Ian (2026-09-26)

1. **Hurdle:** annualized ROC (return on capital: the credit at the bid divided by the cash tied up), **before fees** (Dean, 2026-09-26: no opening fee in the return), at least **10% a year**. Below it the verdict is "wait: premium too thin". Parked cash is counted at what it earns (shown in W4, not here).
2. **The list is the "would own" list.** Being on the plan's wheel list means Dean would own it. No separate tag in W2.
3. **Earnings is a timing flag, not a gate** (Dean and Ian, on a wheel you cross earnings): ETFs and indexes skip it. For a stock whose expected earnings date is on or before the chosen expiry the row is flagged, never blocked, with one short line ("NVDA reports Oct 28, before this put expires Nov 6. The price can gap.") and the return carries "includes earnings risk", so a stock cannot clear the hurdle only because the market is pricing in a gap. Dean's correction (2026-09-26): no explanatory paragraph and no three-choice list. The only action is a **"Find a shorter expiry"** button: a longer expiry is not offered because it still crosses earnings, and nobody can know how an option prices after the report. The button prices, from the same chain fetch, the put nearest the target delta among expirations from `minShortDte` (editable default 7 days) up to the day before the earnings date, outside the normal DTE window, and shows the result on the row (strike, expiry, days, delta, OTM %, net ROC at the bid). If no expiry qualifies it says so in one line. Default is "flag and keep ranking"; a switch makes it "wait until after earnings" (editable default). A follow-up (not W2) shows the strike's distance below the price against the stock's typical earnings move.
3b. Ranking: names without an earnings flag rank first, then flagged names; within each group by net annualized ROC, best first.
4. Target delta 0.30 for ETFs and indexes, 0.25 for stocks (W1, built).
5. Principle from W1: every threshold below is an editable default with a Reset, stored as an override, and the tab warns about unusual values but never blocks.

## The checks (each shows pass, warn, fail or unknown, with the reason in plain words)

| # | Check | Default | If not met |
|---|---|---|---|
| 1 | On the list | required | (not scored) |
| 2 | Annual ROC at the bid | at least 10% (1000 bps) | Wait: premium too thin |
| 3 | IVR floor | ETF 20, stock 30 | Wait: not enough premium yet |
| 4 | Earnings timing (stocks only) | flag | Flag (or Wait, if the switch is set) |
| 5 | Not stretched: RSI(14) at or below | 70 | Wait for a pullback |
| 6 | Liquid put: bid-ask gap (ask - bid) at most 10% of the mid, and open interest (OI) at least 100 | 1000 bps, 100 | Skip: put is illiquid |
| 7 | Fits the plan | from W1 | Not yet: unlocks in N months (W1 wording), or "Your override" |

"Unknown" (data missing) never fails a name: the row says "IVR unavailable" and the verdict is decided by the other checks.

**Verdicts:** Candidate (checks 2, 3, 5, 6 pass or unknown, and it fits or is overridden), Wait (with the reason and, where it applies, the condition that would make it a candidate), Not yet (does not fit the profile), Skip (illiquid put or leveraged ETF). One reason per row, plus the chips.

No invented composite "score" in v1: the order is the rule in 3b, so the ranking is explainable. (The first mock showed a 0-100 score column; Diane to drop it or Dean to say he wants it.)

## ROC arithmetic (integer cents and basis points, in `lib/wheel/candidateRank.ts`)

- `premiumCents = round(bid x 100) x 100` per contract (bid in dollars to cents, times 100 shares). `netPremiumCents = premiumCents - openFeeCents`. Closing is assumed free (Alan to confirm the broker schedule).
- `cashCents` = strike x 100 x 100 (from W1).
- `dte` = calendar days from today to expiry on the New York basis (`daysUntilNy`, `lib/scans/earningsPrecheck.ts`), at least 1.
- `annualizedBps = floor(netPremiumCents x 365 x 10000 / (cashCents x dte))`. Pass when `annualizedBps >= hurdleBps`.
- Bid 0 or missing: return unknown and the put is treated as illiquid (check 6).
- Fee: none (Dean, 2026-09-26). `openFeeCents` stays as an editable default of 0, so a fee can be added later without a code change; with 0, net and gross are the same number.

## Data sources (all browser-side; the wheel already fetches the chain and quote)

- **IVR, earnings date:** `getMarketMetrics([symbols])` in `lib/scans/tastytrade-client.ts` (`ivRank`, `earningsExpectedDate`), one batched call for the whole list. Alan: `ivRank` is multiplied by 100 there, while the Income Engine page converts it differently (`app/engine/page.tsx` ~line 358: treats a value above 1 as already a percent). Confirm the unit once and use one conversion.
- **Earnings on or before expiry:** `earningsOnOrBeforeExpiration` (`lib/scans/earningsPrecheck.ts`), New York basis, so it agrees with the screener and Positions views.
- **RSI(14):** the app's `rsiSeries` (`lib/indicators/rsi.ts`) on the daily closes from `GET /api/chart?symbol=` (as `components/RsiLine.tsx` does). RSI is the last value of the series. Symbols with too few closes: unknown.
- **Bid, ask, open interest:** the chosen `WheelChainLeg` (already loaded in W1).
- **ETF or stock:** W1's `fetchInstrumentKind`.
- Sequential fetches (as W1), per-symbol failure states, and a single retry, same as W1. A failed metrics call marks IVR and earnings unknown for every row without blanking the tab.

## New editable defaults (added to the plan's parameters)

`minShortDte` 7, `hurdleBps` 1000, `ivrEtf` 20, `ivrStock` 30, `rsiMax` 70, `maxBidAskBps` 1000 (of the mid), `minOpenInterest` 100, `openFeeCents` 0, `earningsRule` `flag` or `wait`. Same override storage, validation (hard errors only for invalid math, warnings otherwise), reset and tests as W1.

## Where it goes

A "Next candidate" table above the unlock ladder on the Plan tab. Columns: Stock, Verdict, Contracts ("auto: N", or the trader's own number with a "Yours" tag and a one-line cost warning), Fundamentals (chips), Put (strike, expiry, delta, and its OTM %, from W1's `percentBelowPriceTenths`), Credit (dollars per contract at the bid, and per share; W1's `creditPerContractCents`), Req. Cash, Annual ROC at the bid, Earnings note. The ladder below stays as built. No changes to Candidates, recommendations or any order path.

## Files (proposed)

New: `lib/wheel/candidateRank.ts` (pure: checks, verdicts, order, return math), `lib/wheel/__tests__/candidateRank.test.ts`, `lib/wheel/candidateData.ts` (fetch adapters for metrics and closes, injectable for tests), `features/wheel/NextCandidateTable.tsx` and tests. Edit: `lib/wheel/capitalPlan.ts` (new parameters and validation), `lib/wheel/planSchema.ts`, `features/wheel/WheelPlanTab.tsx` (wire in), `docs/ROADMAP.md`.

## Golden fixtures (Alan to confirm)

Balanced, ETF, bid 0.85, strike 51 (cash 5,100), dte 30, no fee: credit 8,500 cents; annualizedBps = floor(8,500 x 365 x 10,000 / (510,000 x 30)) = 2,027 (20.27%): passes a 10% hurdle. Same put at bid 0.40: 4,000 cents gives 954 (9.54%): "Wait: premium too thin". At bid 0.41 the return is 978 (fails) and at 0.42 it is 1,001 (passes), the reachable edge. Formula boundary (Alan, recomputed by script; pure function inputs): strike 51, dte 30, cash 510,000: 4,192 cents gives 1000 bps and passes; 4,191 gives 999 and fails (not reachable from whole-cent bids, which move in 100-cent steps; the reachable edge is 0.41 versus 0.42 above). Bid 0: unknown and illiquid. Bid-ask gap exactly 10% of the mid passes; one basis point over fails. IVR exactly on the floor passes. RSI exactly 70 passes; 70.01 fails (compare in integer hundredths). Earnings on the expiry date counts as inside.

## Acceptance criteria

1. Every check shows its reason; unknown never fails a name; one reason per row.
2. Order: Candidates without an earnings flag first, then flagged, each by net annualized ROC; then Wait, Not yet and Skip rows.
3. Changing any threshold recalculates the table; Reset returns the default.
4. An ETF or index never shows an earnings flag. A stock with earnings on or before expiry shows the one-line flag with the date, "includes earnings risk", and a "Find a shorter expiry" button; the button prices only expirations ending before the earnings date (never a longer one) and shows the result on the row; with `earningsRule = wait` the verdict is Wait until after the date.
5. Missing data shows "unavailable" for that check only; nothing blanks the tab; retry works.
6. No order, position or recommendation changes; standing line "Guidance from TradeEdge rules. You decide; no orders are placed automatically."

## Open items

- **O1** CLOSED (Dean, 2026-09-26): no opening fee in the return; `openFeeCents` defaults to 0.
- **O2** IVR unit (Alan).
- **O3** Diane's updated screen 2 (drop the score column or keep a score).
- **O4** Whether RSI 70 applies to ETFs too (Ian: yes, same rule; confirm).
- **O5** Expected-move follow-up ticket (earnings distance versus strike).
- **O8** (Dean, 2026-09-26: "show the premium on the new option, and on the other positions"; label is "Credit", matching the rest of the app) Credit, what is collected per contract at the bid before fees, is shown on every suggested put: the W1 ladder (built), each candidate row, and the "Find a shorter expiry" result. Ian: show it as dollars per contract with the per-share figure on hover.
- **O7** (Dean, 2026-09-26: "%OTM is important") OTM % is shown on every row in W1 (built) and in this table, as information. An optional minimum distance as a check, default off, is Ian's call; also whether to show the break-even (strike less the premium) as a second figure.
- **O6** Ranking tie-break within a group (net annualized ROC; then the lower cash need).

## Review gates

Ian: the checks, defaults and verdict wording. Alan: return math, fixtures, IVR unit. Quinn: data failures, tests, regression to W1. Diane: updated screen 2 mock. Dane: developer review last. Paul: scope (W2 only; W3 and W4 stay separate).

## Revision 2: review changes (Alan, Quinn, Dane; all three: approve with changes)

Verified by the reviewers: every cited path and function exists; both fixtures recompute (2,003 and 930 bps). Required changes, now part of the spec:

**Units and arithmetic (Alan)**
1. **IVR.** Convert once, in `getMarketMetrics` (`lib/scans/tastytrade-client.ts:129-131`, which multiplies the raw fraction by 100). Do not use the Income Engine's `> 1` guess (`app/engine/page.tsx:363-365`); it is a heuristic on the same 0-1 fraction, not a competing unit (correction to draft 1). The raw field being a 0-1 fraction is recalled, not verified against a live payload: mark it unverified. Compare in hundredths: `ivRankHundredths = Math.round(raw * 10000)` against `floor * 100`, so "exactly on the floor passes" is not broken by float error (0.29 x 100 = 28.999...). A result outside 0-100 is unknown.
2. **RSI.** `rsiSeries` returns unrounded floats and 50 for a flat series (`lib/indicators/rsi.ts:17-48`). Use the last value, `rsiHundredths = Math.round(last * 100)`, compared to `rsiMax * 100`. Fixtures: 70.00 passes, 70.01 fails. IVR and RSI floors are stored as points (20, 30, 70), not basis points.
3. **Bid.** `bidCents = Math.floor(bid * 100 + 1e-6)` (floor is the conservative choice; the epsilon guards float error). If `netPremiumCents <= 0` (bid at or below the fee) the return is not a pass: the verdict is Wait with the reason "bid does not cover the fee", and negative values never throw. Add a sub-cent fixture (bid 0.855 counts as 85 cents).
4. **dte.** Calendar days on the New York basis (`daysUntilNy`, `lib/scans/earningsPrecheck.ts:29`). Under 1 day the return is unknown ("expires today"), not clamped to 1 (a clamp would inflate the annualization about 365 times); W1 allows `dteMin` 0 so this can occur. The annualization is simple, not compounded (stated on screen).
5. **Fee.** Superseded by Dean's decision (no opening fee, `openFeeCents` default 0, editable).
6. **Liquidity in integer cents.** Bid-ask passes when `2 x (askCents - bidCents) x 10000 <= maxBidAskBps x (askCents + bidCents)`. A bid of 0 with an ask above 0 is illiquid (W1's `selectPlanPut` only skips 0 and 0, `lib/wheel/planPut.ts:31`). W2 scores only the put W1 chose; it never re-selects a more liquid one.

**Unknown never reads as pass (Quinn)**
7. `earningsOnOrBeforeExpiration` returns false for a missing date and for a past date (`lib/scans/earningsPrecheck.ts:46,51`), so a missing or stale date would silently join the "no flag" group. Distinguish three states: **no date on file**, **date in the past (stale)** and **unavailable (call failed or item missing)**. Each shows an "earnings unverified" chip, and a stock with any of them ranks with the flagged group, not ahead of verified rows. ETFs and indexes are unaffected. If the ETF-or-stock type could not be read, earnings is unknown, not "ETF: skip".
8. **Earnings margin (Ian's ruling, subject to Dean).** Use the priced put's expiry (`PlanPut.expirationDate`). Earnings on or before that expiry is the amber flag. Earnings within 10 days AFTER expiry (the scans' `EARNINGS_MIN_DAYS_AFTER_EXPIRY`, `lib/scans/earningsPrecheck.ts:58-63`, because projected dates can move earlier) is a grey note, "date may move", with no ranking effect. This keeps the wheel consistent with the CSP scan without flagging most names.

**Verdicts, order and states (Dane and Quinn)**
9. **Precedence** (first that applies): no verdict while loading, on a chain error, a missing quote, or no put found (those keep W1's states); Skip for a leveraged or inverse ETF (no data is fetched for it, so nothing loads); Not yet when it does not fit the profile and the trader has not typed a contract count; Skip when the put is illiquid; Wait, with one reason chosen in this fixed order: return under hurdle (or bid not covering the fee), IVR under floor, RSI over the limit, earnings-wait when `earningsRule` is `wait`; otherwise Candidate. A contract count the trader typed never replaces the verdict: it shows in a Contracts column with a small amber "Yours" tag (a typed count also counts as "fits" for check 7). "Warn" means a chip in amber that does not change the verdict (RSI within 3 points of the limit, an earnings flag, a note that dates may move).
10. **Order inside groups:** Candidates: no earnings issue first, then flagged or unverified, each by net annualized ROC descending (ties: lower cash need, then symbol). Wait: by net annualized ROC descending. Not yet: by "fits at" ascending. Skip: by symbol.
11. **Plumbing.** New parameters go in `PlanParams` and `DEFAULT_PLAN_PARAMS` (`lib/wheel/capitalPlan.ts:18`), eight entries in `FIELD_CHECKS` (`lib/wheel/planSchema.ts`, typed by key), and warnings in `validateParams` (hard errors only for invalid math). `earningsRule` is an enum, so the adjustable-defaults list needs a small select control (the current `FieldSpec` and `ParamField` are number-only). Metrics come from one batched `getMarketMetrics` call: give it its own state, a cancelled-run guard and a retry, do not fold it into `loadSymbol` or `FetchOutcome`, batch the symbols (the list holds up to 40) and URL-encode them, and match returned items by upper-cased symbol (a missing item means unknown). Chart closes come from `GET /api/chart?symbol=` (server-side Yahoo, about 125 daily closes, response `{bars}` or `{error}`); that is not a broker call, so the ticket's "all browser-side" applies to the broker calls only; fewer than 15 closes means RSI unknown; share the index-symbol map now private in `components/RsiLine.tsx:12`.
12. **Retry:** W1 has a manual Retry per row and Retry all, not automatic retries; W2 does the same (correcting "single retry, same as W1").

**Added tests (Quinn)**
Every unknown state above; verdict precedence and the fixed Wait reason order; a stale metrics answer dropped when the list changes; the sub-cent, fee-exceeds-bid, dte-under-1 and bid-0-ask-above-0 cases; the 4,192 and 4,191 boundary; IVR on the floor and RSI 70.00 versus 70.01; leveraged ETFs trigger no metrics or chart call; and a regression test that W1's ladder, allocation and stress outputs are unchanged.

**Still open:** O3 Dean's answers on the updated mock (https://claude.ai/artifact/HFep9MoqLENf5KQDvmxFbW): the order, dropping the 0-100 score column, and near misses shown as Wait; item 8 Ian's earnings margin, for Dean to confirm.

### Labels (Dean, 2026-09-26)
"IVR" replaces "IV rank" everywhere it is shown, and "ROC" (return on capital) replaces "yield", and the column is called "Annual ROC" (it was briefly "Net Annual ROC" while a fee was in the return; with no fee there is nothing to net), matching the rest of the app (the Wheel page's "Annual ROC", the spread rules' ROC minimums). Code names for the broker field stay `ivRank`; the new parameters are `ivrEtf` and `ivrStock`.

Label note (Dean asked what "Spread x%" means, 2026-09-26): it was the bid-ask gap as a percent of the midpoint, and "spread" collides with credit spreads. The chip and column now say "Bid-ask", and the parameter is `maxBidAskBps`.

**Display rule (added with the fee removal):** show the return floored to one decimal (9.97% reads 9.9%, never 10.0%), so a name that fails the 10% hurdle can never display as 10.0%. Comparisons use the integer basis points.

Labels (Dean, 2026-09-26): "Req. Cash" replaces "Req. Cash" in the ladder and this table.

Labels (Dean, 2026-09-26): the column "Put to sell" and the ladder's "Put priced" are both just "Put". Dean also asked whether the "Why" column should be called "Fundamentals"; Ian says no: the chips are option-market and chart checks (IVR, RSI, bid-ask, open interest, earnings date), not company fundamentals, and there is no fundamentals data source in the app. Suggested label "Checks", or keep "Why"; a real Fundamentals check (profitable, growing, low debt) would be a separate ticket with a data feed. Awaiting Dean.

Labels (Dean, 2026-09-26, decided): the "Why" column is called **Fundamentals**, and "Cash per Put" is **Req. Cash** (required cash). Ian had advised against "Fundamentals" (in trading it usually means company financials); Dean decided. In this table the Fundamentals column holds the trade's own checks: Annual ROC against the hurdle, IVR, RSI, bid-ask and open interest, earnings timing and fit. A company-health check (profitable, growing, low debt) remains a possible separate ticket and would need a data feed.

Override flow (Dean, 2026-09-26, was confused by a "Your override" verdict): the verdict column always shows the plan's own opinion. A contracts box on each row shows what the plan would place ("auto") and lets the trader type a number; a typed number shows a small amber "Yours" tag and a one-line warning of what it costs (over the per-name limit, over the wheel cash), and clearing it returns to auto. There is no "Your override" verdict.
