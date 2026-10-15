# TRADE-LOOKUP-0001 — Paste a group trade, inspect it on the chain

Status: DRAFT v1 — needs Ian + Paul sign-off, Diane mock, Quinn architecture check before Dane builds.

## Goal
Dean pastes a trade post from his trading group. The app parses it, opens the live option chain for that
ticker and expiration with the posted contract highlighted, and shows nearby strikes/expirations so Dean can
pick the same trade or a neighbor with a different POP, then send it to the existing order dialog.

## Scope (v1)
- CSP (short put) and CC (short call) only. Spreads, ICs and rolls are out of scope (none seen in samples).
- Inspection only. No scoring, qualification or ranking logic changes. Order placement reuses the existing path.
- Entry point: a "Trade Lookup" box at the top of the Screener tab.
- Browser-side TastyTrade calls only (Vercel IPs are blocked; token lives ~15 min).

## Parser rules
- Tokens are recognized by shape, never by position (post order varies).
  - Expiry: `M/D`, `MM/DD`, optional year (`11/6`, `09/18`).
  - Strike + type: optional `$`, number (decimals allowed, e.g. `75.5`), suffix `P` or `C` (`$120P`, `75.5P`, `16C`).
  - Posted price: number after `@` (with or without `$`), or a bare decimal not otherwise matched (`75P 4.00 11/13`). Price is OPTIONAL.
  - Ticker: 1–5 letters, not a keyword.
  - Ignored keywords: `NEW`, `CSP`, `CC`, `COVERED`, `CALLS`, `@everyone`, usernames, emoji, reaction counts, body prose.
- Strategy comes from the suffix: `P` = CSP, `C` = CC. Keywords are never required.
- `EXIT` post (e.g. `DFEN + GGLL EXIT`): recognized, answered with "Exit signal — no contract to look up".
  Listing the tickers against open positions is v2.
- Fail closed: zero or multiple strikes/expiries, no ticker, or an unreadable paste -> "Couldn't read this post". Never guess.
- If the body mentions exit/roll (e.g. "exit the current cc and push this out"), show a "Looks like a roll" note. Roll math is v2.
- Strike is matched against the real chain strikes; never rounded. No chain strike -> "Strike not listed" with nearest strikes.
- Contracts default to 1.

## Year resolution
- If the paste includes a Discord timestamp (M/D/YY), use it as the reference date; otherwise use today.
- Year = first occurrence of M/D on or after the reference date.
- If the resolved expiry is already past today -> "This expiration has passed", no chain.
- If the resolved expiry is more than 180 days out -> banner "Resolved to <full date> — confirm".
- The resolved full date is always shown.

## Chain view
- Chain for the resolved expiration, with the posted contract highlighted.
- Neighbors: 1–2 strikes either side, plus the same strike on the next expiration out.
- Columns: strike, bid, ask, mid, delta, POP, credit, breakeven, max risk, DTE, open interest.
- Posted price shown beside current mid with the difference ("posted $5.47, now $5.10").
- Neighbors show credit and POP change versus the group's pick, sorted by closeness to the original — not by score.
- Selecting any row sends it to the existing order dialog.

## Math and data rules (Ian)
- POP, breakeven, credit and max risk come from `lib/portfolio/positionMetrics.ts` (PM-0001). No second formula.
- No bid/ask on a leg -> row shows "no quote". Never fall back to last price. Credit at mid, natural fill shown beside it.
- Debit result -> debit label, never presented as a credit trade.

## Flags (advisory, never block, never feed a score)
- DTE under 21; earnings inside the window (existing earnings data); short delta outside the Dean's band;
  wide bid/ask; thin open interest; strike below cost basis (CC); daily RSI state as a read-only badge
  from `lib/indicators/rsi.ts` / `rsiTurn.ts`.
- CC coverage rule: a call may be sent to the order dialog only if covered by shares (>= 100 x contracts,
  using the existing covered-call capacity model) or a paired LEAP (`isPairedPmccLong`,
  `lib/portfolio-data/pmccPairDetection.ts`). Not covered -> "No share coverage — cannot be placed as a covered call",
  inspection still works, order hand-off disabled. Naked calls are never offered.

## Layout constraints
- Parser, year resolution and flags live in `lib/tradeLookup/` (no named exports from any page.tsx).
- UI component in its own file; `app/screener/page.tsx` only mounts it.
- Diane mock before UI code. Vercel preview (`next build`) is the authoritative build check.

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
| `NEW SOXL 11/6 11/13 120P` | fail closed (two expiries) |
| `hello world` | fail closed |

Year cases: `ETHU 8/21 15C` pasted with timestamp 6/29/26 -> 08/21/2026, expired today -> "expiration has passed".
Pasted with no timestamp on 2026-10-15 -> 08/21/2027, shows the "confirm" banner.

## Non-goals / v2
- Spreads, ICs, rolls (net credit vs open short call), exit posts matched to open positions, multi-post paste, saved post history.

## Approvals
- [ ] Ian (logic/risk)  [ ] Paul (scope)  [ ] Diane (mock)  [ ] Quinn (architecture)
