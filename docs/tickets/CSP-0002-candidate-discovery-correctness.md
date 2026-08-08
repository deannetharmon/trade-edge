# CSP-0002 — Candidate Discovery, Truthful Diagnostics, and Result Metric Completeness

## Production incident

TradeEdge scanned AMD and reported:

> No qualifying put found in delta 0.15–0.25 / DTE 30–45 window

A live Tastytrade 35-DTE AMD chain (underlying ≈ $477.85) contained five puts inside that exact window:

| Strike | Raw put delta | OI | Bid | Ask |
|---:|---:|---:|---:|---:|
| 410 | -0.18 | 167 | $9.00 | $10.65 |
| 415 | -0.20 | 190 | $10.20 | $11.90 |
| 420 | -0.22 | 409 | $11.45 | $13.20 |
| 425 | -0.24 | 107 | $12.85 | $14.60 |
| 430 | -0.25 | 333 | $14.00 | $16.20 |

The message was factually false.

## Root cause

`findBestCsp()` delegated to Wheel's `findBestWheelContract()`, which:

1. Picks the single contract whose `|delta|` is closest to the center of the configured delta range — nothing else.
2. Returns that one contract without ever checking OI or bid/ask width.
3. `findBestCsp()` then rejected that one contract outright (`return null`) if its OI was below 500 or its bid/ask width exceeded $0.10.
4. No other in-window contract was ever considered as a fallback.
5. `runCspChecklist()` converted every such `null` into the generic "No qualifying put found..." message.
6. The checklist's own OI check described low OI as a warning — but that code was unreachable, since the finder had already discarded the candidate before the checklist ever saw it.

This was a "select one, then reject" architecture, not a search. It could hide an arbitrary number of valid, liquid contracts behind one bad pick.

## Fix — exhaustive search with separated discovery/qualification/display

`lib/scans/cspSearch.ts` is a new, pure, framework-free module performing four explicit stages over the *entire* chain:

1. **DTE eligibility** — normalize expirations once; count how many fall inside the inclusive DTE window.
2. **Option type + delta** — put legs only, `abs(delta)` inclusive within the configured range.
3. **Quote validity** — strike, delta, bid, ask (non-crossed), a usable mid, and a finite non-negative OI are all required; a missing/invalid field excludes a candidate from the valid set (never silently coerced into a passing value).
4. **Liquidity evaluation** — *every* structurally valid candidate (not just one) is classified as `FULLY_QUALIFIED`, `QUALIFIED_LOW_OI`, `DISQUALIFIED_WIDE_MARKET`, or `DISQUALIFIED_WIDE_MARKET_LOW_OI`. *(Renamed in the corrective pass below from `ELIGIBLE` / `LOW_OPEN_INTEREST` / `BID_ASK_TOO_WIDE` / `LOW_OI_AND_WIDE_MARKET` — the original names implied low OI was a hard eligibility failure equal to a wide market, which contradicts §"Open-interest and bid/ask policy" below. See the corrective-pass section in `docs/reviews/CSP-0002-Implementation-Report.md` for the full fix.)*

Selection policy: prefer a candidate that passes the actual hard qualification rule — bid/ask width within the configured maximum (`FULLY_QUALIFIED` or `QUALIFIED_LOW_OI`); within that tier, prefer `|delta|` closest to the configured midpoint, then narrower bid/ask width, then sufficient OI (as a tie-break preference, never a filter), then higher raw OI, then earliest expiration, then lowest strike (deterministic tie-breakers). If no hard-qualified candidate exists, the best *structurally valid* (wide-market) candidate is still returned — with its true status — for audit display. Nothing is ever discarded into `null` merely because it's imperfect.

`lib/scans/csp-finder.ts`'s `findBestCsp()` now calls this search and maps the result into the existing `SpreadCandidate` shape, adding CSP-specific diagnostic fields (`cspCandidateStatus`, `cspBidAskWidth(Pct)`, `cspOiPassing`, `cspBidAskPassing`, `cspLiquidityReason`, `cspOiWarning`, `cspSearchDiagnostics`).

## Discovery vs. qualification vs. display filtering

- **Discovery** (`cspSearch.ts`): never discards a delta/DTE candidate for liquidity reasons — it demotes it to a non-`ELIGIBLE` status and keeps it.
- **Qualification** (`findBestCsp()` / `runCspChecklist()`): a candidate is qualified (`ScreenResult.qualified`) only when its bid/ask width is within the configured maximum and it isn't capital-blocked. **Low OI never disqualifies by itself** — it is surfaced only as a warning (`cspOiWarning`), matching the checklist's pre-existing, previously-unreachable policy.
- **Post-scan display filtering** (the sidebar's "Minimum relevant-leg OI" control and similar): purely a client-side view filter over already-computed, already-qualified/disqualified results. It can hide or show cards but never touches `ScreenResult.qualified`, canonical accounting, or Best Opportunities eligibility.

## Open-interest and bid/ask policy (as implemented)

- OI_MIN (500) and BID_ASK_MAX ($0.10) are both preserved unchanged — no new threshold was introduced.
- OI below OI_MIN: warning only (`cspOiWarning`), never disqualifying.
- Bid/ask width above BID_ASK_MAX: disqualifying (`cspBidAskPassing = false`), with the true dollar width, threshold, and (if OI is also low) the OI figure surfaced in the reason text.
- **Remaining product-policy decision (not made by this ticket):** an absolute $0.10 width threshold is unrealistic for higher-premium CSPs (a $11 mid can easily have a >$0.10 wide but still perfectly tradeable market — see the AMD 415 put, width $1.70 on an $11.05 mid, ~15%). Options for a follow-up product decision, not selected here:
  - Absolute-width threshold (current) — simple, but scales badly with premium.
  - Percentage-of-mid threshold — scales correctly but needs a product-chosen cutoff (5%? 10%?).
  - Tiered threshold by option premium band.
  - Broker-supplied liquidity/market-quality data, where available, instead of a synthetic width rule.
  Every candidate now carries both `cspBidAskWidth` (dollars) and `cspBidAskWidthPct` (percent of mid) so this decision can be made later without another discovery-layer change.

## Truthful reason taxonomy

`describeCspSearchOutcome()` in `cspSearch.ts` produces exactly the messages specified by the ticket (no expiration, no delta match, no valid quote, low OI, wide market, and the combined low-OI-and-wide-market message with real values substituted in). The old generic "No qualifying put found in delta X-Y / DTE A-B window" message is only ever shown when the search itself found no expiration, delta match, or valid quote at all — never once a real contract has been discovered.

## CSP metrics and formulas (unchanged, now reliably reached)

```text
Absolute delta = abs(raw put delta)
Estimated POP  = (1 - absolute delta) x 100
OTM %          = (underlying price - short put strike) / underlying price x 100
Credit/share   = selected contract midpoint
Premium/contract = credit/share x 100
Cash required  = strike x 100 x contracts
Breakeven      = strike - credit/share
```

ROC and annualized ROC formulas are unchanged from TE-0007A (`roc = premium/contract / requiredCash x 100`; `annualizedRoc = roc x 365/dte`) — not modified by this ticket, flagged here only for visibility per the ticket's instruction not to silently change them.

## Presentation changes

- `features/screener/components/DisqualifiedSection.tsx` — a disqualified CSP card now shows its core fundamentals (Δ, POP, OTM, bid/ask/mid, credit/share, premium/contract, OI, cash required, breakeven, ROC) directly in the collapsed row, plus the OI warning line when applicable, instead of collapsing into a reason-only row. Qualified and disqualified CSP cards now show the same fundamentals.
- `app/screener/page.tsx`'s OI display row now shows a single relevant-leg number for CSP (previously rendered `shortOI/longOI`, which for CSP always duplicated the same number — implying a two-leg pair that doesn't exist).
- The existing single-leg `StrikesDisplay` (`Put {strike}`, no long strike/width) was already correct from TE-0007A and required no change.

## CSV export

The existing CSV export (`app/screener/page.tsx`'s `downloadCSV`) uses one shared header row across all strategies and does not currently branch per-strategy. Adding full CSP-specific columns (IV Rank, warning/failure-reason text, etc.) would require broadening that export architecture — out of scope for this correctness ticket per its own instruction to document rather than unsafely broaden export architecture. **Limitation documented, not fixed.**

## Wheel / Covered Call compatibility

`lib/wheel/chainSearch.ts` (`findBestWheelContract`) is **untouched** — zero lines changed. CSP now uses its own exhaustive search (`lib/scans/cspSearch.ts`) exclusively; Wheel's own-writing-cc path and `lib/scans/covered-call-finder.ts` still call `findBestWheelContract` exactly as before. `lib/scans/__tests__/covered-call-finder.test.ts` (23 tests) passes unmodified, confirming no collateral behavior change.

## Canonical session

No change was needed to `lib/screener/scanSession.ts` or `runCspScan()`'s session wiring: `runCspChecklist()` already always returns a `ScreenResult` (never throws), which is always recorded via `recordSymbolEvaluated(session, symbol, [result])`. AMD was always going to be "evaluated," not "failed," once a real result object exists — the bug was that the result's own `bestCandidate` was `null`. Fixing discovery fixes this automatically; verified by a dedicated wiring test.
