# PERFORMANCE-STRATEGY-0001 — Broker-grounded performance by strategy

## Problem
TradeEdge cannot consistently compare broker-confirmed outcomes across CSP, covered call, PMCC, standalone LEAPS, BPS, BCS, and IC. Current closed option history cannot prove whether a short call was covered by shares or paired to a particular LEAPS.

## User value
One filter-scoped report of realized strategy outcomes, without blending open and closed P/L or inventing lifecycle relationships.

## Scope
- Add a **Strategy performance report** to Performance, based only on closed, complete reconstructed history for the selected broker account and date range.
- Show realized P/L, closed lifecycle count, win rate, average win/loss, profit factor, and average hold time.
- Render `Insufficient history` for 1–4 closed lifecycles and `No closed history` for zero.
- Show BPS, BCS, IC and CSP only when reconstruction proves the strategy. Put generic short calls and other unproven records in **Needs classification**.
- Exclude incomplete reconstruction and disclose the count.

## Required follow-on data before CC / PMCC / LEAP comparison
Persist a broker-confirmed lifecycle identity linking account, underlying, long-LEAPS OCC contract, opening transaction, and each income short-call order. A covered call must link to its verified share lot. PMCC becomes one lifecycle with optional income-cycle details. Same-symbol/date heuristics are not proof.

## AI requirement
AI questions must use a frozen, account-scoped performance snapshot through the governed AI gateway. It may explain visible figures, definitions, missing history and classifications. It must not recommend a strategy, claim one is “best,” conflate open with realized P/L, or fabricate CC/PMCC/LEAPS classification. A dedicated `performance_summary` snapshot schema is required; the scan-session schema must not be reused.

## Non-goals
Recommendations, backtests, allocation advice, and unproven lifecycle grouping.

## Acceptance criteria
1. Metrics are from the current report range and closed, complete reconstructed trades.
2. Short calls never appear under CC or PMCC until lifecycle linkage exists.
3. CC, PMCC and LEAP show no history rather than a false conclusion.
4. Incomplete and unclassified history are visible.
5. Automated tests protect the no-misclassification and incomplete-exclusion rules.

## Validation
Run strategy-performance tests and the production build. Verify short calls appear only in Needs classification and incomplete rows are excluded and disclosed.
