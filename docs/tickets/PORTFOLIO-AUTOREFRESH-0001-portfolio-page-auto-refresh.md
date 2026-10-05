# PORTFOLIO-AUTOREFRESH-0001 — The open Portfolio page refreshes itself

## Status

**IMPLEMENTED 2026-10-05 — PENDING CI and Vercel preview.** Approved: Paul (scope), Ian (interval and market-hours rules, stop-confirmation timing accepted), Quinn (with conditions, all addressed below), Dean.

## Problem

The Portfolio page loaded once when opened and never again (`app/portfolio/page.tsx`, mount effect). P/L and recommendations stayed frozen until the trader clicked Refresh, with only a small "Updated hh:mm". Dean acted on a SOXL "Take Profit" that a refresh then replaced with "Hold Position".

## Rules (as built)

| Rule | Where |
|---|---|
| During the session, refresh every 2 minutes while the tab is visible | `lib/portfolio-data/autoRefreshPolicy.ts` `isAutoRefreshDue` |
| Returning to the tab checks immediately (refreshes if 2+ minutes old) | `components/portfolio-data/usePortfolioAutoRefresh.ts` |
| Session: Mon-Fri 9:30-16:00 New York minus NYSE holidays (`lib/scans/nyseCalendar.ts`); 13:00 early closes treated as 16:00 (display-only cost; lib/discovery may not be imported here) | `portfolioMarketPhase` |
| After the close and on non-session days: refresh once if the data predates the last close, then stop; label "Closing values · updated 4:05 PM ET" | `isAutoRefreshDue`, `refreshFreshness` |
| First 15 minutes after the open: note "Market opening: quotes are wide, recommendations settle by 9:45 AM ET" | `refreshFreshness` |
| "Updated N min ago", amber after 5 minutes during the session | `refreshFreshness`, page header |
| Paused while any order dialog is open (batch close/roll, profit target, stop, LEAPS stop, workspace dialogs, sell stock) | `useAutoRefreshPause` in each dialog |
| Checkbox selections kept; only positions that no longer exist drop out | `keepLiveSelections` |
| A background refresh with an expired session shows an error instead of navigating to /login | `PortfolioDataProvider` `background` option |
| A refresh never places, changes or cancels an order | display path only |

## Review findings

- **Stop confirmation (Quinn item 3):** breach readings are one saved snapshot per day plus the live read (`buildStopBreachObservations`, `lib/portfolio-data/acquisition.ts`). Auto-refresh adds no readings; it only re-evaluates more often. Confirmation timing is unchanged, so Ian's "settling readings do not count" condition is not needed for this ticket. If intraday readings are ever persisted, revisit it.
- **Redirect not fully removed:** the shared token helper (`lib/auth/tastytradeToken.ts`) still redirects to /login when TastyTrade cannot renew the connection at all. Changing shared auth is out of scope; the provider's own redirect is suppressed for background refreshes.
- **Broker load:** one refresh is the same request set as the Refresh button (positions, orders, complex orders, quotes); at 2 minutes this is about 30 refreshes an hour. TastyTrade's published limits were not verified in-session; watch for 429s.
- **Dialogs reviewed for pauses:** `BatchConfirmModal`, `ExtendProfitButton`, `StandaloneLeapsStopControl`, `SetStopLossButtonInner`, workspace `DialogShell`, `SellStockDialog`. Read-only panels (audit log, memory, analysis, performance) are not paused. Pending-order cancel/replace is inline and refetches itself.

## Tests

- `lib/portfolio-data/__tests__/autoRefreshPolicy.test.ts` (17): session phases (settling, open, close, weekend, holiday, early close, evening New York date), due rules, freshness labels, selection keeping.
- `components/portfolio-data/__tests__/usePortfolioAutoRefresh.test.tsx` (8): interval, hidden tab and catch-up, dialog pause and release, in-flight guards, weekend, unmount.
- `components/portfolio-data/__tests__/PortfolioDataProvider.test.tsx`: background refresh never navigates on an expired session.
