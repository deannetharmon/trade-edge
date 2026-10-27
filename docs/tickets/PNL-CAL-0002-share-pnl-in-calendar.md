# PNL-CAL-0002: realized P/L on shares in the P/L Calendar

Requested by Dean 2026-10-27: "The profit loss calendar needs to contain all profit and loss, regardless of the transaction type."

## Why

The Trade Log reconstructs option trades only (`buildFills` keeps option transactions). A share sale (stock or ETF) therefore never reached the P/L Calendar. Found when the calendar showed +$660 for October 2026 against a reference total of +$2,401: Oct 9 was blank in TradeEdge, and the broker's Orders tab shows a META fill on 10/09 at 725.34 (a share sale; an option cannot price that high). "Needs review" on Performance was empty, so the trade was not an incomplete option trade; it was out of scope.

## What changed

- **`lib/tradeLog/equityRealized.ts` (new, pure):** `reconstructEquityRealized(transactions)` rebuilds realized share P/L with first-in-first-out lots per symbol, long and short, fees netted (commission, clearing, regulatory), close day in New York time. Shares received or delivered by an option assignment or exercise are ordinary buys and sells at the strike, so the option's P/L (premium kept) and the share P/L (sale price less strike) add up with nothing counted twice. A close with no opening purchase in the loaded history is reported as unmatched and adds nothing (never a guessed cost basis).
- **`lib/pnlCalendar/buildPnlCalendar.ts`:** `buildMonthCalendar(trades, month, equityLots?)` and `buildPace(..., equityLots?)` add share lots by close date. New fields: `CalendarDay.stockPnl`, `MonthCalendar.stockPnl`, `MonthCalendar.stockSales`. One share sale = one symbol on one day (a sale split across lots counts once).
- **Footer fix:** the "excluded by you / incomplete" counts now cover only the viewed month. Before, they counted every month in the 12-month window, so the calendar said "1 incomplete" while Performance for the period said "Nothing to review".
- **`cycleTradesLoader.ts`:** returns `equityLots` and `equityUnmatched`, built from the same transactions already fetched (no new request).
- **`PnlCalendarTab.tsx`:** day, week, month, goal and pace include shares. Footer notes "Includes N share sales (...): +$X" and an amber warning naming symbols whose cost basis is unknown. Day tooltips say how much of the day came from shares.

## Decisions

- Dean (2026-10-27): the calendar contains all realized profit and loss, whatever the instrument.
- Alan: FIFO is the lot rule; fees reduce P/L on both legs, matching the option side. Realized only; open (unrealized) P/L is still not in the calendar.
- Ian: no scoring, qualification, order or risk logic changed. Read-only reporting.
- **Performance stays options-only.** The calendar's month total no longer equals Performance's month when shares were sold; the difference is the share P/L shown in the footer. Putting shares into Performance (strategy tables, win rate) is a separate ticket and needs Dean's call.

## Known limits (stated, not hidden)

- Cost basis comes from purchases inside the 12-month window. Shares bought earlier have no basis here; their sale is listed as unmatched in the calendar footer and left out of the totals.
- TastyTrade equity transaction fields were not available in the repo as a real sample; direction is read from the action text, then the credit/debit effect. Dean's live check against the Oct 9 META sale on the preview is the confirmation.
- Corporate actions (splits, mergers) are not adjusted.

## Tests

`lib/tradeLog/__tests__/equityRealized.test.ts` (12), `lib/pnlCalendar/__tests__/buildPnlCalendar.test.ts` (+6), `features/portfolio/pnl-calendar/__tests__/PnlCalendarTab.test.tsx` (+2), `features/portfolio/positions-workspace/__tests__/cycleTradesLoader.test.ts` (+1, one updated).
