# LEAPS-PMCC-START-0001 — "PMCC start price" on every Find LEAPS result

**Status:** Approved by Dean 2026-09-20 on Ian's recommendation; implemented — see the [implementation report](../implementation/LEAPS-PMCC-START-0001-implementation-report.md)
**Requested by:** Dean — "for each Find LEAPS scan, return the target price for when I should start doing poor man's covered calls."

## Problem

The app shows a LEAPS candidate's breakeven, but not when the first short call can safely be sold. The one hard PMCC rule is never to sell a call struck below the LEAPS's breakeven (strike + debit paid), or an assignment locks in a loss. A trader with a candidate whose breakeven is well above the stock needs to know the stock price from which that rule can be met with calls in their normal short-call range.

## Ian's recommendation (2026-09-20)

Show one clear number, labelled as an estimate: **the stock price from which every call in your PMCC short-call range clears this LEAPS's breakeven.**

- **Definition:** the stock price at which a call struck *at the breakeven* has the trader's **highest allowed short delta**, using the **shortest allowed short DTE** (defaults: delta ≤ 0.35, DTE ≥ 21, taken from the trader's own PMCC short-call settings on the Screener). Those are the conservative extremes — a higher delta and a shorter DTE both raise the price — so from the start price upward *every* call in the trader's range clears the breakeven.
- **Status on the card:** `✓ stock above` when the stock is at or above it, otherwise `needs +X%`. Wording is neutral: it is a rule-derived level, not a buy/sell signal.
- **Hard rule stays exact:** the strike floor is the breakeven already shown on the card; only the start price is modelled.

Team positions (advisory): Ian recommends this definition; Paul approves the scope (one line per card, no new data source); Alan requires a pure, tested module reusing the trader's existing settings; Quinn requires an independent check of the math; Diane approves the compact "PMCC start ≥ $X est." item next to Breakeven.

## User value

Each LEAPS card says when a first call becomes safe to sell, so candidates can be compared on that — for example a candidate already above its start price versus one that needs a 3% rise first.

## Scope

1. `lib/scans/pmccStartPrice.ts` (pure): `computePmccStartPrice({ spot, breakeven, ivxPct, shortDeltaMax, shortDteMin })` → `{ status: 'above' | 'below' | 'unavailable', startPrice, pctToStart }`. Black-Scholes call delta (no dividends), the underlying's **IVx** as the volatility (closest available proxy for a 21–45 DTE call), a fixed 4% risk-free rate. Solves `S* = B · exp(d1·σ·√T − (r + σ²/2)·T)` with `d1 = N⁻¹(delta)`; `N⁻¹` by Acklam's approximation (~1e-9).
2. `LeapsResultRow` shows `PMCC start ≥ $X est.` + status beside Breakeven, with a tooltip stating the assumptions. The row receives the trader's `pmccShortDeltaMax` and `pmccShortDteMin` from the Screener's existing PMCC short-call state (defaults 0.35 and 21 when absent).
3. Missing IVx, breakeven, or price ⇒ a dash. Never a guessed number.

## Non-goals

- Not a recommendation or timing signal. Does not consider IVR/premium richness, earnings, trend, or dividends.
- No new broker calls (uses data already on the card). Not added to the Analyze with AI snapshot, CSV export, or held-position views.
- No change to LEAPS scan filters, scoring, qualification, or any order path.

## Acceptance criteria

1. GOOGL 250C Jun-2027 example (spot $350.858, breakeven $363.55, IVx 36.4%, delta 0.35, DTE 21) returns ≈ $349.38 and status `above`; at a $340 stock it returns `below` with ≈ +2.76%.
2. Round trip: a Black-Scholes call struck at the breakeven has the target delta (±0.001) at the returned start price, for deltas 0.20–0.40 and DTE 14–45.
3. Monotonic conservatism: higher delta ceiling ⇒ higher start price; shorter DTE floor ⇒ higher start price.
4. Missing/invalid inputs ⇒ `unavailable` and a dash on the card.
5. Every card shows the item, labelled "est.", with the assumptions in its tooltip.

## Implementation notes

- New: `lib/scans/pmccStartPrice.ts`, `lib/scans/__tests__/pmccStartPrice.test.ts`. Edited: `app/screener/page.tsx` (import, two optional row props, one computed value, one display item, two call sites), `app/screener/__tests__/ScreenerPage.test.tsx` (3 tests).
- Assumptions are visible in the module header and in the card tooltip. The estimate can differ from a live short-call chain by a few dollars (term structure, dividends).

## Validation steps

On the LEAPS results: each card shows "PMCC start ≥ $X est." with either "✓ stock above" or "needs +X%". Hover for the assumptions. Change the PMCC short-call delta or DTE in the Screener and confirm the number moves in the expected direction (higher delta or shorter DTE → higher price).

## Rollout notes

No flag, no environment variables. Rollback is a revert.

## Follow-ups

- Exact version: read the live short-call chain and find the real strike/delta, replacing the estimate (one extra broker call per ticker).
- Premium-selling readiness beyond price (IVR floor, earnings), if Ian wants "start" to mean more than the breakeven test.
- Show the same level on held LEAPS in Positions and in the Analyze with AI facts.
