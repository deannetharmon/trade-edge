# CC-RSI-GUARD-0001 -- stop before selling a call when RSI is weak

Dean (2026-11-09): before a covered call or a PMCC short call, if the stock's daily RSI is below 50, the app must stop him and tell him to go back and look.
Mock "RSI stop before selling a call" approved by Ian (speed bump, not a hard block).

## Rules
- Fires on the click that opens the order screen: covered-call "Trade this" and PMCC "Sell short call". Nothing else changes.
- Stops when daily RSI < saved cutoff (same setting as the Ready / Wait chip, default 50) or RSI cannot be read (fail closed, "Check the chart yourself").
- At or above the cutoff: no dialog.
- "Go back" is the default (focused; Escape also goes back). "Sell anyway" runs the existing path unchanged.
- Pricing, quantity and submission code are untouched.

## Files
lib/scans/ccRsiGuard.ts, features/screener/components/RsiStopDialog.tsx (portal, so it is never inside a card's clickable root), wiring in app/screener/page.tsx.
Tests: ccRsiGuard.test.ts (4), RsiStopDialog.test.tsx (5).
