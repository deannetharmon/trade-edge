# PERF-0001 — Performance tab: one trade dataset, trader-relevant metrics

**Status: IAN REVIEW DONE (2026-10-06); next Paul scope + Diane mock, then build.** Reported by Dean: the Performance tab does not match the Trade Log and is not useful.

## Evidence (Dean's 2026-10-06 export + screenshots)

| Source | Window | Trades | Total realized P/L |
|---|---|---|---|
| Trade Log CSV export | 2026-07-09 to 10-05 (about 3 months) | 22 (2 incomplete partial closes) | **+$3,085** (CSP +$2,831 / 12; BPS +$110 / 9; BCS +$143 / 1) |
| Performance header (12 MO) | 12 months | 67 | — |
| Strategy Performance Report (12 MO) | 12 months | 62 complete (5 excluded) | **+$2,017** (CSP +$2,912 / 13; BPS −$1,038 / 48; BCS +$143 / 1) |
| Exit Analysis (12 MO) | 12 months | 67 (all records) | **+$2,363** |

## Ian's findings

1. **Three different "your P/L" totals on one screen** (+$2,017, +$2,363, and the log's +$3,085 for a different window). The panels use different record sets: the strategy table drops incomplete records, Exit Analysis and Best Trades keep them (MU 8/5 BPS, a partial close of 1 of 5 contracts, is a "best trade" at +$822 while excluded from the strategy table).
2. **The Trade Log export and the Performance tab use different windows** (3 months vs 12), with no shared selector; they cannot be compared as shown.
3. **Exit categories differ between the log and the tab** (log: SCRATCH_WIN, TARGET_HIT, FAST_CUT, MAX_LOSS; tab: Partial Profit, Target Hit, Fast Cut, Max Loss, Time Stop, Held to Expiry) and do not follow the methodology. "Max Loss" (>150%, >$400 or held too long) mixes a disciplined stop (ORCL CSP, −106% of credit in 3 days) with a true rule breach (SMH BPS, −155%). Win rate per exit category is 0% or 100% by construction and tells nothing.
4. **Return % on credit is misleading for spreads** (SMH −154.9% of credit). Spreads need return on max risk; CSPs return on collateral.
5. **Quantity is ambiguous** in the log ("Quantity 2" on a 1-lot spread is the leg count; opened 5 / closed 5 elsewhere).
6. **Entry Context Outcomes** (1 eligible of 67) carries no information yet.
7. **What is missing that a premium seller needs:** expectancy per trade, P/L by month (equity curve of realized), return on capital at risk, max drawdown, by underlying, and **rule adherence**: closed at 50% target, stopped at 2x credit, managed at 21 DTE, **losses beyond the 2x stop (the real leak)**, CSP/CC assignment handled per DECIDE-0001.

## Ian's required design

- **One canonical closed-trade dataset** feeds the Trade Log, its export and every Performance panel; one window selector shared by both; every panel shows the same N and the same total, with incomplete records either completed (all closes linked) or listed separately and excluded everywhere.
- **Headline:** realized P/L (net of fees), trades, win rate, avg win / avg loss, profit factor, expectancy, return on capital at risk, max drawdown, open P/L shown separately.
- **By strategy and by month;** by underlying (top and bottom 5).
- **Exit categories = the methodology:** Target (>= 50% of credit), Early profit (< 50%), Stopped at <= 2x credit, Beyond stop (> 2x credit) — the leak, 21-DTE managed, Expired, Assigned. Same names in the log and the tab.
- **Returns:** spreads on max risk, CSP on collateral, long options on debit.
- **Drop** Entry Context Outcomes until it has data; keep Hold Time only with the same dataset.
