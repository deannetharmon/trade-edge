# PNL-CAL-0001: P/L Calendar sub tab on Portfolio

Requested by Dean 2026-10-27 with a reference screenshot (monthly goal card over a month calendar). The screenshot is the visual spec (Diane gate satisfied by Dean's reference, adapted to the app's dark theme).

## What it is

A new Portfolio sub tab, "P/L Calendar", after Balances. Two cards:

1. **Monthly Goal.** Locked-in profit for the viewed month against a target percent of the month's starting net liquidating value. Shows the month total, "x.xx% locked in", a progress bar, "Goal achieved" when reached, Day n/N, and Pace (30d) with its percent.
2. **P/L Calendar.** Sunday-first month grid. Each day shows the locked-in profit of trades closed that day (+$50, -$155, +$1.8k); a WEEK column totals the in-month days of each week ("–" when nothing closed). Previous/next month buttons (next stops at the current month, previous at the start of the 12-month Trade Log window).

## Decisions (team, inline)

- **Locked-in = realized.** Closed trades from the Trade Log, by close date, using `buildPerformanceReport(...).included` (complete, not user-excluded), so the month total equals Performance for the same month (Alan; tested). Excluded and incomplete counts are shown under the calendar.
- **Goal baseline** (Dean's screenshot shows 5% = $2,250, i.e. a $45,000 base): net liquidating value on the last stored closed day before the 1st, from the stored daily history (`/api/balance-history`); failing that the first stored day in the month; failing that no goal amount is shown (never a guessed one). Ian: a stated percent of a stated starting balance, not of today's balance, so a good month does not move its own target.
- **Target percent** defaults to 5 and is editable on the card, saved in the browser (localStorage), a per-viewer convenience.
- **Pace (30d)** = locked-in profit over the 30 days ending today, as a percent of the current month's baseline.
- Unmatched closing transactions (closed in the window with no opening trade) are surfaced as a note when they fall in the viewed month; totals are never fabricated.
- No scoring, qualification, order path or risk logic changed. Read-only; no new API; nothing stored.

## Out of scope (next slice, PNL-CAL-0001B)

"Open (unrealized)" and "Open CSP premium" from the reference. Both need the live position model (priced positions on the Positions tab); they are not locked-in profit, so they stay out of the calendar math. Needs Diane's placement.

## Files

- `lib/pnlCalendar/buildPnlCalendar.ts` (pure math) and `lib/pnlCalendar/__tests__/buildPnlCalendar.test.ts` (20 tests)
- `features/portfolio/pnl-calendar/PnlCalendarTab.tsx` and `__tests__/PnlCalendarTab.test.tsx` (5 tests)
- `app/portfolio/page.tsx`: tab key `pnl-calendar` (deep link `?tab=pnl-calendar`), tab button, render line. No other change.

## Known limits

- The Trade Log covers the active broker account's last 12 months; the first month is marked partial when the window starts mid-month.
- Stock sales are not in the Trade Log, so they are not in the calendar.
- The baseline needs stored balance history (filled whenever the Balances tab is opened); with none stored, the calendar still shows.
