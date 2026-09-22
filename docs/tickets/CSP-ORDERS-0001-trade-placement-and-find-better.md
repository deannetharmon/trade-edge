# CSP-ORDERS-0001 — CSP trade placement and "Find Better"

## Status

**Approved 2026-09-22.** All open questions resolved below.

## Background

TE-0007A (first-class CSP screener strategy) deliberately shipped CSP results with both action buttons disabled, and said so explicitly in its own scope:

> No live trade execution for CSP (Trade/Find-Better buttons are disabled for CSP results) ... CSP order placement (OTOCO/GTC) — `longOccSymbol` is deliberately left unset on CSP candidates so the existing `hasOccSymbols` gate disables trade UI automatically ... "Find Better" for CSP (that modal's logic is spread-specific).

That deferral is still in effect today (`app/screener/page.tsx`, the "Manual entry only" message on every CSP result card). This ticket is the deferred follow-up.

## Problem

A trader who finds a CSP worth trading has to leave the screener and place it manually on the broker platform. Every other strategy (spreads, PMCC) gets a full dry-run → confirm → submit flow with GTC/stop brackets, in-app.

## Why this is real work, not a flag flip

`TradeModal` (the existing order-placement UI for spreads/PMCC) is built entirely around a multi-leg order shape, confirmed by reading it directly:

- **Max loss formula** is `spreadWidth − credit`. A CSP has no spread width; its real max loss is `(strike × 100) − credit`. Using the existing formula on a CSP would produce a meaningless or `NaN` number.
- **`hasOccSymbols`**, the gate that enables the Trade button, requires both a short *and* a long option symbol. A CSP has one leg. This is the exact mechanism TE-0007A used to safely disable the button — removing it without replacement logic would either block every CSP or let a malformed single-leg order through.
- **`buildOrderLegs`** assumes 2–4 legs when constructing the OTOCO payload.

"Find Better" (`BestOpportunityFinder`) is CSP-incompatible by type, not just by convention — `preferredStrategy` is typed `'BPS' | 'BCS' | 'IC'` and `strategiesToRun` hardcodes only those three.

## Scope

### 1. CSP trade placement

- A genuine single-leg order path: either a new CSP-specific code branch inside `TradeModal`, or a separate, smaller CSP order modal (open question for Quinn — see below).
- Correct single-leg max loss: `(strike × 100 × quantity) − credit`.
- Order legs built for one short put (`Sell to Open`), not a multi-leg spread shape.
- Same safety bar as everything else this session: fresh quote validation at submit time (the existing 15-second staleness rule), market-hours check, dry-run before submit, real order id returned on success.
- **Capital re-check at submit time**, following the exact pattern built for STOCKS-ORDERS-0001 (`lib/portfolio/stockOrderSubmission.ts`): re-resolve the CSP's required collateral from a freshly-fetched capital context immediately before submit, never trusted from what the screen showed when the dialog opened. `getCspCapitalContext` already exists and is exactly this check for CSP.
- GTC/stop bracket settings (the existing `gtcPct`/`stopMultiple` UI) apply the same way they do for spreads — no change to that part.

### 2. "Find Better" for CSP

- A CSP-scoped variant: reruns the CSP checklist at a small set of alternative delta/DTE presets (mirroring how BPS/BCS/IC do it today, not reusing their logic directly since the rule shapes differ), surfacing alternatives near the original candidate's DTE.

## Non-goals

- No change to spreads' or PMCC's existing `TradeModal` behavior.
- No change to CC's order-placement status (still explicitly deferred separately, per its own TE-0007C scope note).
- Not a redesign of the OTOCO bracket UI itself — only its use for a single-leg order.

## Decisions resolved (2026-09-22)

1. **Quinn:** a separate, dedicated `CspTradeModal`, not a branch inside `TradeModal`. Confirmed against the actual code: `TradeModal` is ~440 lines with 11+ existing strategy branches, and PMCC already established this exact precedent with its own `PmccTradeModal` rather than being folded into the generic component.
2. **Ian:** max-loss formula confirmed as `(strike × 100 × quantity) − credit`. GTC%/stop-multiple defaults stay identical to spreads' (50% profit target, 2× credit stop) — the same profit-target/stop discipline applies whether risk is defined (spread) or collateralized (CSP); no CSP-specific default needed.
3. **Alan:** the max-loss formula is the only math in scope; agrees with Ian.
4. **Diane's mock:** `CspTradeModal` reuses the existing spread `TradeModal`'s flow unchanged (confirm → dry run → placing → done/error phases; quantity stepper 1–20; entry-limit field labeled "Net Credit Limit · GTC"; GTC%/stop-multiple controls). Three things differ, each sourced from what already exists rather than invented:
   - **One strike line**, reusing the CSP result card's own format ("Put 235P exp 2026-10-23 (31d) · Δ0.24").
   - **"Cash Required," not "Max Loss"** as the headline risk figure, reusing the card's own label and number.
   - **The card's existing assignment-warning sentence**, carried verbatim into the modal's confirm step ("Cash-secured — assignment would mean buying 100 shares/contract at $[strike]. Only enter if owning the stock at this price is acceptable.").
   - A freshly re-fetched collateral figure shown immediately before the Place button, per the submit-time re-verification requirement below.

## Acceptance criteria (draft, pending the above)

1. A CSP's max loss is computed from strike and credit, never from a spread-width formula.
2. The Trade button is enabled for CSP only when a real, single-leg order can be safely built (no `longOccSymbol` dependency).
3. Capital/collateral is re-verified immediately before every CSP order submit, from a fresh fetch, never from a cached screen value.
4. "Find Better" for CSP never runs BPS/BCS/IC logic against a CSP candidate.
5. Every existing spread/PMCC trade-placement test continues to pass unchanged — this must not alter their behavior.
