# BALANCE-CHART-0001 — Balances chart: performance excludes deposits and withdrawals

**IMPLEMENTED 2026-10-06.** Reported by Dean: the Net Liq chart fell sharply at the end although trading was up; a $5,000 withdrawal about a week earlier was plotted as a loss.

**Diane (display):** default view **Performance** (net liq with deposits/withdrawals taken back out since the first plotted day), toggle **Net liq** for the raw account value; caption states which; deposits/withdrawals marked as amber dots with their amount on hover; dollar scale (high / mid / low); hover shows date, value and (in Performance) the raw net liq; the line ends at the live balance, labelled "(live)". No new colours or controls beyond the existing range chips.

**Quinn (data):** only completed days are stored (today's figure is drawn live, never saved); the server lets the 5 most recent stored days be corrected once by a different non-zero completed snapshot (the old client stored today's partial value first-write-wins). Money movements come from TastyTrade transactions (`Money Movement`: deposit, withdrawal, transfer, ACH, wire, journal); interest and fees stay in performance.

Code: `lib/portfolio-data/balancePerformance.ts` (pure, tested), `components/BalancesTab.tsx`, `app/api/balance-history/route.ts`. Tests: `lib/portfolio-data/__tests__/balancePerformance.test.ts`.
