# TRADE-LOOKUP-0001 — Paste a group trade, inspect it on the chain

Status: v3, 2026-10-15. Slice 1 (parser + expiration resolver) IMPLEMENTED with tests. Slices 2-3 not started.
Approvals: Ian approved scope, logic and mock v2. Paul approved scope as recommended in session. Diane mock v2 published
("Trade Lookup Mock" canvas, 3 boards). Quinn reviewed slice 1 inline (tests, es5-safe constructs); slices 2-3 still need
Quinn's architecture check on the two items under "Open for Quinn".

## Goal
Dean pastes a trade post from his trading group. The app parses it, opens the live option chain for that
ticker and expiration with the posted contract highlighted, and shows nearby strikes/expirations so Dean can
pick the same trade or a neighbor with a different POP, then send it to the existing order dialog.

## Scope (v1)
- CSP (short put) and CC (short call) only. Spreads, ICs and rolls are out of scope.
- Inspection only. No scoring, qualification or ranking changes. Order placement reuses the existing path.
- Browser-side TastyTrade calls only (Vercel IPs are blocked; token lives ~15 min).

## Entry point (changed in v3)
- The Screener sidebar is 320px wide (`w-80`) and the chain needs about 1,000px, so there is no inline box.
- A new "TRADE LOOKUP" `LauncherButton` in the sidebar of `app/screener/page.tsx`, next to FIND SPREADS / FIND CSPs / FIND CCs.
- It opens `features/screener/components/TradeLookupModal.tsx`, built on `ScanModalShell` (the same shell `PmccPairLookupModal` uses).
- `page.tsx` gets only an import, one state flag, the launcher and the mounted modal. No named exports from the page.
- All logic lives in `lib/tradeLookup/`.
- Diane's mock shows the content; it is the modal body.

## Parser rules (implemented: lib/tradeLookup/parsePost.ts)
- Tokens are recognized by shape, never by position (post order varies).
  - Expiry: `M/D`, `MM/DD`, optional year (`11/6`, `09/18`).
  - Strike + type: optional `$`, number (decimals allowed, e.g. `75.5`), suffix `P` or `C`.
  - Posted price: number after `@` (with or without `$`), or a single bare decimal not otherwise matched (`75P 4.00 11/13`). Optional.
  - Ticker: one all-capital word of 1-5 letters that is not a keyword. A lowercase paste fails closed.
  - Ignored: `NEW`, `CSP`, `CC`, `COVERED`, `CALLS`, `@everyone`, usernames, a pasted Discord timestamp (kept only as the date reference), emoji, reaction counts, body prose.
- The headline is the first line holding a strike token; everything after it is body (used only to spot a roll).
- Strategy comes from the suffix: `P` = CSP, `C` = CC. A keyword that disagrees (CSP with a call, covered call with a put) fails closed.
- `EXIT` post (capitals, no contract): recognized, "Exit signal. No contract to look up." Matching tickers to open positions is v2.
- Fail closed with a reason: zero or multiple strikes, expirations, tickers or prices; unreadable paste. Never guess.
- Roll-like body ("exit the current cc and push this out") sets a flag; the UI shows "Looks like a roll". Roll math is v2.
- Strike is matched against real chain strikes, never rounded. Not listed -> "Strike not listed" with nearest strikes.
- Contracts default to 1.

## Date resolution (implemented: lib/tradeLookup/resolveExpiry.ts)
- Reference date = the pasted Discord timestamp, else today. Year = first occurrence of M/D on or after the reference date.
- Checked in this order: expired (before today) -> not a listed expiration (a weekend, or not in the chain's real list)
  -> far date (more than 180 days out, asks for confirmation) -> ok.
- The resolved full date is always shown. Pure UTC date math; today is passed in.

## Chain view (slices 2-3)
- Chain for the resolved expiration with the posted contract highlighted.
- Neighbors: up to 2 listed strikes either side of the pick (same right, same expiration), shown in ascending strike order with the pick highlighted, then the same strike on the next listed expiration out as the last row. Not sorted by score. If the posted strike is not listed, nothing is rounded: the closest listed strikes are offered instead.
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
- Short delta outside Dean's band (existing label); wide bid/ask; thin open interest; strike below cost basis (CC);
  daily RSI as a read-only badge.
- No DTE-under-21 flag: the 21-DTE rule does not apply to CSP and CC (DECIDE-0001, CLAUDE.md). Corrected in v3.
- Liquidity thresholds (OI, bid/ask) come from the existing CSP/CC scan registry gates. No new numbers.
- RSI wording comes from `lib/indicators/rsi.ts` / `rsiTurn.ts` labels. Do not invent copy.
- Earnings flag only for single stocks. ETFs get no earnings flag.

## Covered-call coverage rule
- A call can go to the order dialog only if covered by shares (>= 100 x contracts, existing covered-call capacity model)
  or an existing LEAP from the PMCC foundation report (`buildPmccFoundationReport` via `getPmccBrokerSnapshot`: same underlying, expiration AFTER the call's, `availableShortCallContracts` >= contracts). Share capacity comes from `getCoveredCallCapacityReport` (`availableCoveredContracts`). If either report is unavailable and the other does not cover the call, coverage is unknown and ordering stays off.
- Not covered -> "No share coverage" panel, order hand-off disabled, inspection still works. Naked calls are never offered.

## Open for Quinn (before slices 2-3)
1. RESOLVED (slice 2): chain fetch is `lib/scans/tastytrade-client.ts` (`getChain` with a one-day DTE window, `ttFetch` nested chain for the real expirations, `getAccessToken` for the token). `lib/screener/provider.ts` is legacy and is not used.
2. ETF detection for the earnings flag (slice 2b). The lookup result carries `classification` from `getChain` / `classifyUnderlying` ('etf' | 'stock' | 'index'). A source also exists: `lib/instrument-metadata` (broker-backed resolver reports the broker's
   stock/ETF fact) and `lib/leveragedEtfs.ts` (`isLeveragedEtf`, which already lists SOXL, TQQQ, BITX, ETHU, DFEN, GGLL).
   Use the resolver's ETF fact; `isLeveragedEtf` is a fallback only, because it does not cover non-leveraged ETFs.

## Build order
1. DONE: parser + date resolution + golden fixtures (`lib/tradeLookup/`, 39 tests).
2. DONE: lookup service (`lib/tradeLookup/` chainRows, coverage, buildLookup, loadLookup, defaultDeps; 49 new tests). Metrics via positionMetrics; no-quote rule enforced; calls carry a coverage result.
2b. DONE: `lib/tradeLookup/flags.ts` (delta band, wide bid/ask, thin OI, strike below cost basis). Uses the scans' own checks (`classifyCspLiquidity`, `evaluateHybridSpread`, `assessOiLiquidity`) and the CSP/CC default rules; the modal can pass the live scan controls. Advisory only.
2c. RSI badge and single-stock earnings flag: IMPLEMENTED 2026-10-15 as TRADE-LOOKUP-0001F (`lib/tradeLookup/signals.ts`). Both are information only and use the app's own shared code, no new thresholds: RSI(14) via `classifyRsiTurn` (daily bars through the shared 60 s memo) shown as a badge in the header (teal turning up, amber turning down, else neutral); earnings via `classifyEarningsVsExpiry` for single stocks only (ETFs and indices never flagged, a missing date is silent), shown as a header date plus an amber Exp/DTE cell when earnings fall on or before that expiration or within 5 business days after. Fail-soft: a failed read shows nothing and never delays the lookup.
3. DONE: `TradeLookupModal` + sidebar launcher (button label POST LOOKUP, because an existing Screener test forbids any button named like Trade/Open). CSP rows hand off to the existing `CspTradeModal`; covered calls are inspection-only because TradeEdge has no covered-call order dialog (Covered Call scan: "Analysis only"). Column control mirrors Portfolio's Customize columns (its component is internal to Portfolio). A covered-call order dialog is a separate order-path ticket.

## Golden fixtures
Live in `lib/tradeLookup/__tests__/parsePost.test.ts` and `resolveExpiry.test.ts`. Every post Dean shared is a fixture
(`NEW CSP SOXL 11/6 $120P @ $5.47`, `DFEN + GGLL EXIT`, `NEW CSP TQQQ 75.5P 11/6 @ 3.00`, `NEW CSP SOXL 75P 4.00 11/13`,
`ETHU 8/21 15C @ 0.9 COVERED CALLS`, `BITX 8/28 16C @ 0.39 COVERED CALLS`, `NEW BITX $16C 09/18`), plus the fail-closed cases.
A new group format gets a fixture before the parser changes. Date cases use a fixed "today" of 2026-10-15.

## Non-goals / v2
- Spreads, ICs, rolls (net credit vs open short call), exit posts matched to open positions, multi-post paste, saved history.
- Leveraged-ETF concentration impact (amber 15%, red 25% tiers): waits on the approved concentration work.
