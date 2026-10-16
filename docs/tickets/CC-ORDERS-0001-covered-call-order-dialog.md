# CC-ORDERS-0001: covered-call order dialog

Status: slice A IMPLEMENTED 2026-10-15 (`lib/scans/ccOrderMath.ts`, `ccOrderSubmission.ts`; 31 tests; not wired to any screen). Slice B (dialog `features/screener/components/CcTradeModal.tsx`, broker deps `lib/scans/ccOrderDeps.ts`) IMPLEMENTED 2026-10-15, not wired to any screen. Slice C next.
Origin: TRADE-LOOKUP-0001 shows covered-call posts but cannot order them because TradeEdge has no covered-call order
dialog (the Covered Call scan card says "Analysis only", TE-0007C). Order path: Ian gate required, decisions below.

## Goal
Place a single-leg covered call (Sell to Open call) from the Trade Lookup and the Covered Call scan card, only when the
broker's own data proves the call is covered at the moment of ordering.

## Precedent
CSP-ORDERS-0001: a dedicated `CspTradeModal`, not a branch inside the multi-leg `TradeModal`. Same here: a dedicated
`CcTradeModal`, reusing the CSP modal's confirm -> dry run -> placing -> done/error flow, quantity stepper, entry-limit
field, 15-second quote freshness rule and market-hours rule unchanged.

## Ian's rulings (recorded, not open)
1. Coverage is proven twice: when the dialog opens, and again immediately before the dry run and before Place, by a fresh
   broker read (`getCoveredCallCapacityReport` for shares, `getPmccBrokerSnapshot` foundations for a LEAP). Coverage is
   `lib/tradeLookup/coverage.ts` `evaluateCoverage` (already tested): shares `availableCoveredContracts` >= quantity, or a
   LEAP whose expiration is AFTER the call's with `availableShortCallContracts` >= quantity. Unknown or unavailable =
   no order. Naked calls are never offered. Quantity is capped at the covered contracts.
2. Exits: entry order plus a GTC buy-to-close at 50% of the credit (the program's profit rule). NO stop order: assignment
   is an acceptable outcome for a covered call (DECIDE-0001; 21-DTE and 2x-credit stops do not apply to CC). This needs a
   new builder (`buildCreditEntryOto`, entry + one GTC exit); `buildCreditEntryOtoco` always adds a stop and is not reused.
3. Strike below cost basis: allowed, but the dialog states the loss if assigned (strike minus cost basis, times 100,
   times contracts) and requires an explicit acknowledgment before Place. Cost basis unknown = say so, no acknowledgment
   needed, no number shown.
4. Earnings: the existing covered-call earnings advisory text is shown as information, not a gate (SCAN-EARNINGS rules
   stay in the scan; the lookup shows contracts the scan never qualified).
5. Price: Limit order prefilled at mid, editable, per share (same units rule as CSP-UNITS-0001). Entry-walk ("Walk the
   price") is NOT included in v1.
6. Before Place the dialog shows a freshly re-fetched coverage line (e.g. "Covered by 200 shares, 2 contracts available").

## Slices
- A. Pure, tested: `buildCreditEntryOto`, `buildCcOrderLeg` (Sell to Open, call symbol, quantity), `guardCcOrder`
  (coverage + quantity + price rules, fail closed), assignment-loss math. No UI. Alan validates the loss math.
- B. `CcTradeModal` in `app/screener/page.tsx` (page.tsx gets an additive block; the dialog logic lives in a
  `features/screener/components` file, not a new page.tsx function), dry run via the same complex-order endpoint as CSP.
- C. Wire entry points: Trade Lookup covered-call rows (replace "not enabled" with SEND TO ORDER when covered) and the
  Covered Call scan card's "Analysis only" line (separate approval, may stay analysis-only).

## Tests (Quinn)
Coverage gate fails closed (unknown, partial, stale reads); quantity above covered contracts refused; LEAP that expires
before the call refused; per-share units; payload shape (one trigger order plus one GTC buy-to-close, no stop);
acknowledgment required below cost basis; market closed refuses; quote older than 15 seconds refuses; dry run before
Place; double-read of coverage (open and pre-Place) both called.

## Out of scope
Rolls (net credit vs an open short call), PMCC short calls from existing LEAPs through this dialog (the PMCC flow owns
that), spreads, exit orders for open covered calls (Portfolio owns exits), price walking.
