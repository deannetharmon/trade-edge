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
