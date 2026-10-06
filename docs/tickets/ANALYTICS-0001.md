# ANALYTICS-0001: Analytics page (new, additive) on a shared calculation layer

Status: DRAFT, pending team sign-off (section 6)
Mock: Diane's v2 canvas, "TradeEdge Analytics v2" (claude.ai artifact). The mock is the layout and copy spec. Figures in it marked illustrative are placeholders, not data.
Decision log: Dean approved building this as a NEW page (2026-10-06). How it combines with existing screens is decided after it is live and validated.

## 1. Scope (Paul)

In scope, phase 1:
- New route `/analytics`. Existing pages are not modified.
- One pure calculation module, `lib/analytics/`, that the page reads from. Any later page that shows the same numbers must read from it too.
- Sections: KPI tiles; Cumulative P&L; Monthly P&L (realized vs open); Capital by strategy; Ticker concentration; Risk summary; Position size distribution; Strategy performance; Ticker performance; DTE at entry; Monthly CSP P&L; Open P&L by position.

Out of scope:
- Rule discipline panel (50% profit exits, 21-DTE management, 2x credit stop, RSI at entry). It needs an entry and exit event log that does not exist yet. Becomes ANALYTICS-0002.
- Any change to scan scoring, qualification, per-position risk tiers, recommendations, or order paths.
- New broker calls, new AI calls, new data sources.
- Phone layout. Follows the platform-layer work, starting from this page's fluid layout.

## 2. Definitions (Alan, to validate)

All figures derive from closed-trade history and current open positions already in the app.

- Realized P&L: sum of realized P&L of closed trades, bucketed by CLOSE date. Month = close month.
- Open P&L: mark-to-market of open positions, mid basis, labelled as such (consistent with PNL-BASIS-0001).
- Total P&L = Realized + Open.
- Decided trade: closed trade with realized P&L not equal to 0. Win = P&L > 0, loss = P&L < 0. Breakeven is excluded from decided counts.
- Win rate = wins / decided. Shown greyed with "n=" when decided < 3.
- Avg win / avg loss: mean realized P&L of wins / of losses.
- Expectancy = net realized P&L / decided trades.
- Rolls: OPEN QUESTION for Alan. If the data model links rolls, a roll chain counts as one trade with P&L summed at final close. If it does not, each closed leg is a trade and the page footnotes it.
- Position: one row in the Portfolio positions workspace (a spread, IC, PMCC, CSP, CC, LEAPS, or stock holding each counts as one). This single definition feeds Position size, Risk summary, and Concentration counts. v1 showed 6 positions in one chart and 10 in another; the build must find and report the cause before shipping.
- Capital deployed per position: the same basis the app already uses for "capital used" (collateral for CSP, cost for stock and LEAPS). Capital by strategy must sum to total deployed.
- Position size % = position capital / total capital deployed. Bands: 0-3, 3-7, 7-15, 15-20, 20+.
- Ticker exposure % = capital deployed on that ticker / total capital deployed. Grouped by underlying via a maintained static map (for example METU to META) with a leveraged flag from a static list in `lib/analytics/`. No runtime lookups.
- Return on secured cash: monthly realized CSP P&L / average secured cash that month (daily average of CSP collateral), averaged over months with CSP activity. Annualized = simple x12 (1.88% gives 22.6%). OPEN for Alan: confirm the denominator and whether annualization stays simple.
- DTE at entry: days to expiration on the entry date. Bands 0-14, 15-29, 30-45, 45+.

## 3. Rules (Ian, to approve; Paul co-signs)

All thresholds below are PROPOSED. They are labels and alerts only; none changes scanning or qualification.

- Ticker status, only when trades >= 3:
  - Focus: win rate >= 80% and net P&L > 0.
  - Review: win rate < 40%, or net P&L < 0.
  - Otherwise: Mixed.
  - Fewer than 3 trades: "Too few". No color judgment.
- The page footer line for Focus and Review is generated from the same rows as the table.
- Concentration: warn at >= 15% of exposure on one ticker, alert at >= 25%. An alert appears as its own "Concentration alert" row in Risk summary. It does NOT change per-position Low, Medium, High tiers.
- Position size band labels: 7-15% Optimal, 15-20% Caution, 20%+ Risk, below 7% Small. (Ian to confirm band semantics.)
- DTE: the 30-45 window is the trader's rule. Labels are "In target" and "Outside target". No "Optimal", "Too short", or "Too long".
- Win rate colors only when decided >= 3.

## 4. Architecture (Quinn)

- `lib/analytics/` holds pure functions: input = closed trades + open positions + prices already loaded by the app, output = plain objects for each section. No fetching, no side effects.
- The page `app/analytics/page.tsx` contains only layout and calls into `lib/analytics/`. No named exports other than the allowed Next.js list (see learnings: page.tsx named exports break the build).
- Static maps (underlying, leveraged) live in their own file in `lib/analytics/`.
- TastyTrade calls stay browser-side as today. This ticket adds none.
- Phases: A = module + tests; B = page; the page is not started until A is green.

## 5. Acceptance and tests

Reconciliation invariants, each a test on the module:
1. Realized + Open = Total.
2. Sum of monthly realized = Realized.
3. Sum of strategy net P&L = Realized.
4. Sum of ticker P&L = Realized.
5. Capital by strategy sums to total capital deployed.
6. Ticker exposure percentages sum to 100%.
7. Position counts in Position size and Risk summary match, or the page states why they differ.
8. Focus and Review footer lines equal the rows they summarize.

Alan supplies golden fixtures (a small hand-computed trade set) for win rate, expectancy, return on secured cash, and band assignment. CI-0001 runs the full suite on every push.

Verification: tsc plus the new analytics tests. Because Vercel Preview does not work for Dean, the page is checked on production after merge, behind a hidden route (no nav link) until Dean confirms the numbers match his records.

## 6. Sign-off

| Role | Covers | Status |
|---|---|---|
| Diane | Mock v2 | Approved (2026-10-06) |
| Paul | Section 1, 3 | Pending |
| Ian | Section 3 | Pending |
| Alan | Section 2, fixtures | Pending (rolls and secured-cash denominator open) |
| Quinn | Section 4 | Pending |

Dane builds only after Paul, Ian, Alan, and Quinn are all marked Approved.
