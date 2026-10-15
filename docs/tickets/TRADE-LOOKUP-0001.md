# TRADE-LOOKUP-0001 — Paste a group trade, inspect it on the chain

Status: v2, 2026-10-15. Ian approved (logic, risk, mock v2). Paul approved scope as recommended in session.
Diane mock v2 published ("Trade Lookup Mock" canvas, 3 boards). Quinn architecture check still pending before UI code.

## Goal
Dean pastes a trade post from his trading group. The app parses it, opens the live option chain for that
ticker and expiration with the posted contract highlighted, and shows nearby strikes/expirations so Dean can
pick the same trade or a neighbor with a different POP, then send it to the existing order dialog.

## Scope (v1)
- CSP (short put) and CC (short call) only. Spreads, ICs and rolls are out of scope.
- Inspection only. No scoring, qualification or ranking changes. Order placement reuses the existing path.
- Entry point: a "Trade Lookup" box at the top of the Screener tab.
- Browser-side TastyTrade calls only (Vercel IPs are blocked; token lives ~15 min).

## Parser rules
- Tokens are recognized by shape, never by position (post order varies).
  - Expiry: `M/D`, `MM/DD`, optional year (`11/6`, `09/18`).
  - Strike + type: optional `$`, number (decimals allowed, e.g. `75.5`), suffix `P` or `C`.
  - Posted price: number after `@` (with or without `$`), or a bare decimal not otherwise matched (`75P 4.00 11/13`). Optional.
  - Ticker: 1-5 letters, not a keyword.
  - Ignored: `NEW`, `CSP`, `CC`, `COVERED`, `CALLS`, `@everyone`, usernames, timestamps (used only as the date reference), emoji, reaction counts, body prose.
- Strategy comes from the suffix: `P` = CSP, `C` = CC. Keywords are never required.
- `EXIT` post: recognized, answered "Exit signal. No contract to look up." Matching tickers to open positions is v2.
- Fail closed: zero or multiple strikes/expiries, no ticker, or unreadable paste -> "Couldn't read this post". Never guess.
- If the body mentions exit/roll, show "Looks like a roll". Roll math is v2.
- Strike is matched against real chain strikes, never rounded. Not listed -> "Strike not listed" with nearest strikes.
- Contracts default to 1.

## Date resolution
- If the paste includes a Discord timestamp (M/D/YY), use it as the reference date; otherwise use today.
- Year = first occurrence of M/D on or after the reference date.
- Resolved date already past today -> "This expiration has passed", no chain.
- Resolved date is not a listed expiration for the ticker (for example a Saturday) -> "Not a listed expiration",
  no chain, no confirm prompt.
- Resolved date is listed but more than 180 days out -> banner "Resolved to <full date>, N days out. Confirm?".
- The resolved full date is always shown.

## Chain view
- Chain for the resolved expiration with the posted contract highlighted.
- Neighbors: 1-2 strikes either side, plus the same strike on the next expiration out. Sorted by closeness to the pick, not by score.
- Header shows market state and quote time ("Market closed · quotes as of 4:00 PM MT") with a Refresh button.
- Columns (CSP): strike, DTE, delta, POP, credit at mid with natural fill, bid/ask, breakeven, OI, credit vs pick, POP vs pick.
  CC omits breakeven.
- Column choice reuses the existing Column Visibility control and its category colors. Max risk is hidden by default
  and always shown in the Selected bar. Do not build a new column control.
- Posted price shown beside current mid with the difference; the post age is shown.
- A leg with no bid/ask shows "no quote": Greeks and credit are blank, Select is disabled. Never fall back to last price.
- Selecting a row opens the existing order dialog with a LIMIT order prefilled at mid; Dean can edit it.

## Math and data rules (Ian)
- POP, breakeven, credit and max risk come from `lib/portfolio/positionMetrics.ts`. No second formula.
- A debit result shows the debit label and is never presented as a credit trade.

## Flags (advisory only: never block, never feed a score)
- DTE under 21; short delta outside Dean's band (existing label); wide bid/ask; thin open interest;
  strike below cost basis (CC); daily RSI as a read-only badge.
- Liquidity thresholds (OI, bid/ask) come from the existing CSP/CC scan registry gates. No new numbers.
- RSI wording comes from `lib/indicators/rsi.ts` / `rsiTurn.ts` labels. Do not invent copy.
- Earnings flag only for single stocks. ETFs (SOXL, TQQQ, BITX, ETHU and similar) get no earnings flag.
  Dane to find the existing instrument-type source; if none exists, raise it with Quinn before inventing a list.

## Covered-call coverage rule
- A call can go to the order dialog only if covered by shares (>= 100 x contracts, existing covered-call capacity model)
  or a paired LEAP (`isPairedPmccLong`, `lib/portfolio-data/pmccPairDetection.ts`) whose expiry is AFTER the call's.
- Not covered -> "No share coverage" panel, order hand-off disabled, inspection still works. Naked calls are never offered.

## Layout and code constraints
- Parser, date resolution and flags live in `lib/tradeLookup/` (no named exports from any page.tsx).
- UI component in its own file; `app/screener/page.tsx` only mounts it.
- Vercel preview (`next build`) is the authoritative build check.

## Build order
1. Parser + date resolution + golden fixtures (pure functions, no UI).
2. Lookup service: chain fetch browser-side, neighbor selection, metrics via positionMetrics.
3. UI to Diane's mock v2, after Quinn's check.

## Golden fixtures (parser unit tests)
| Input | Expected |
|---|---|
| `NEW CSP SOXL 11/6 $120P @ $5.47` | CSP, SOXL, 11/06, P120, price 5.47 |
| `DFEN + GGLL EXIT` | exit signal, tickers DFEN, GGLL |
| `NEW CSP TQQQ 75.5P 11/6 @ 3.00` | CSP, TQQQ, 11/06, P75.5, price 3.00 |
| `NEW CSP SOXL 75P 4.00 11/13` | CSP, SOXL, 11/13, P75, price 4.00 |
| `ETHU 8/21 15C @ 0.9 COVERED CALLS` | CC, ETHU, 08/21, C15, price 0.90 |
| `BITX 8/28 16C @ 0.39 COVERED CALLS` | CC, BITX, 08/28, C16, price 0.39 |
| `NEW BITX $16C 09/18` | CC, BITX, 09/18, C16, no price |
| `NEW BITX $20C 6/18` | CC, BITX, 06/18/2027, C20, far-date confirm (246 days from 2026-10-15) |
| `NEW SOXL 11/6 11/13 120P` | fail closed (two expiries) |
| `hello world` | fail closed |

Date cases (reference today 2026-10-15):
- `ETHU 8/21 15C` with timestamp 6/29/26 -> 08/21/2026, "expiration has passed".
- `ETHU 8/21 15C` with no timestamp -> 08/21/2027 is a Saturday, "Not a listed expiration".

## Non-goals / v2
- Spreads, ICs, rolls (net credit vs open short call), exit posts matched to open positions, multi-post paste, saved history.
- Leveraged-ETF concentration impact (amber 15%, red 25% tiers): waits on the approved concentration work.

## Approvals
- [x] Ian (logic, risk, mock v2) 2026-10-15
- [x] Paul (scope as recommended in session) 2026-10-15
- [x] Diane (mock v2 published)
- [ ] Quinn (architecture): chain fetch placement, ETF instrument-type source
