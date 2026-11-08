# CC-SIMPLIFY-0001: covered-call pre-scan filters made truthful, then moved to the results screen

Full plan and rationale live in the TradeEdge project doc `claude/CC-SIMPLIFY-0001.md`. DTE is the only pre-scan setting; delta and width are results-screen chips; the safety gates are never filters.

## Phase 1 (shipped, 28b53c5)

Descriptions match the engine; a "Left out of the best pick" line on a result (counts by rule).

## Phase 2 (built 2026-11-07, Ian signed off the parity fixture)

- The scan only fetches (tickers + DTE). It grades wide open and keeps a pool of every call the safety gates let through (`lib/scans/ccView.ts`: `buildCcPool`). Strike floor, usable quote, real open interest, earnings and share capacity stay fixed gates.
- Results screen: Delta chips (Keep more upside .10-.20, Balanced .20-.35 default, More income .30-.40, Custom) and Width chips (5 / 10 default / 15 percent; ceiling $0.50). Changing a chip re-picks each ticker's best call from the pool through the SAME finder and closest-call fallback (`findBestCoveredCallWithFallback`) with no rescan, so score, exports, order warnings and Best Opportunity read the active view.
- "N calls hidden by result filters" banner with Reset filters. Every new scan resets to the default view. The Phase 1 "left out of the best pick" line is replaced by the banner on view-enabled results.
- Delta check on a fallback pick is now a warning, not Passed.
- Premium (Ian): the mid rounded DOWN to the cent everywhere (`lib/scans/ccPremium.ts`), so the header, grid, sentence and order limit agree.
- Parity: `lib/scans/__tests__/ccViewParity.test.ts` (normal, empty window, width, strike floor, earnings, half-cent mid; six views each).
- Scan modal: DTE only. Research scans keep their own fixed rules.
- Not done here: removing the S4 fallback (kept; the parity test depends on it).

## Phase 2b (2026-11-07, Dean yes)

"At the money" delta chip (.45-.55) added after More income, for a trader who expects a dip and wants the most premium while accepting assignment near today's price. The strike floor still applies: an underwater stock offers no call below its cost basis under any chip.

## Phase 2c (2026-11-07)

Fix: the accounting bar (qualified / caution / disqualified) now counts the regraded rows when the covered-call view is active. Found on a live scan: the bar said "2 qualified, 0 disqualified" while the list showed 1 qualified and 1 disqualified, because the bar read scan-time counts graded wide open.

## Phase 2d (2026-11-07, Dean + Ian)

Dean: show only valid covered calls. The CC-WHEEL-0001 S4 closest-call fallback is removed. A ticker with no call inside the active delta range is NOT qualified; its reason names the delta range, the nearest valid call (information only, never a pick) and, when the stock is below cost basis, the lowest allowed strike. The chips can bring a call into range, which makes the ticker qualify. The banner now reads "N calls outside this delta and width view" because it counts the delta/width view only, not the POP / OTM / IVR / Call OI chips.
