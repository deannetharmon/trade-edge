# TE-0007A Implementation Report

## 1. Executive Summary

Added CSP (Cash-Secured Put) as a first-class, selectable strategy in the
Screener, alongside BPS/BCS/IC/PMCC. CSP opportunities are found by reusing
Wheel's existing `findBestWheelContract` search, and render through the same
`ScreenResult` card UI already used for spread results — same badges, same
data-field layout, same expand/collapse pattern.

Scope stayed within TE-0007A / DR-0001 §7.4:

- no CC or PMCC changes
- no live trade execution for CSP
- no Filter/Rank/Targeted mode changes
- no redesign of existing pages
- BPS/BCS/IC behavior unchanged (verified via typecheck + build; spread
  finder/checklist code paths were not touched)

## 2. Files Changed

Created:

- `lib/scans/csp-finder.ts` — `findBestCsp()`, wraps Wheel's
  `findBestWheelContract`
- `docs/tickets/TE-0007A-first-class-csp-screener-strategy.md`
- `docs/reviews/TE-0007A-Implementation-Report.md`

Modified:

- `lib/scans/types.ts` — added optional CSP fields to `SpreadCandidate`
  (`requiredCash`, `annualizedRoc`, `breakeven`, `assignmentPrice`,
  `capitalBlocked`, `capitalWarning`)
- `lib/scans/constants.ts` — added `DEFAULT_CSP_RULES` / `CspRulesType`
- `lib/scans/tastytrade-client.ts` — added `getAvailableCash()`
- `app/screener/page.tsx` — CSP checklist builder, scan action, UI card,
  and CSP-aware branches in the shared result-card rendering

Brought onto this branch from `main` (pure additions, no modifications —
see ticket doc for why):

- `app/wheel/page.tsx`
- `lib/wheel/chainSearch.ts`
- `app/api/wheel-candidates/route.ts`
- `app/api/wheel-config/route.ts`

## 3. How CSP Logic Was Wired

CSP was added as its own scan tool, mirroring the existing PMCC pattern
exactly (`pmccTickers` / `runPMCCScan` → `cspTickers` / `runCspScan`):

- A "CSP LIST" card in the Screener sidebar, with its own ticker box and
  an "Available Cash (optional override)" input.
- `runCspScan()` fetches an access token, resolves available cash (see §5),
  fetches market metrics, then for each symbol fetches the chain via the
  existing `getChain()` (same function BPS/BCS/IC use) with a DTE window
  from `DEFAULT_CSP_RULES`, and calls `runCspChecklist()`.
- `runCspChecklist()` follows the same shape as the existing
  `runPMCCChecklist()` — IVR check, earnings check, then `findBestCsp()` for
  the candidate, then OI/delta/credit/ROC/POP checks — and returns a
  `ScreenResult` with `strategy: 'CSP'`.
- Results are appended into the same `results` state BPS/BCS/IC/PMCC use, so
  they render through the same card component. CSP-specific branches were
  added at the points where the card genuinely needs to show different data:
  strategy badge color, `StrikesDisplay` (single put strike instead of a
  spread), the credit/ROC sub-block (labeled "Premium" / "Ann. ROC" with
  CSP-appropriate color thresholds — spread thresholds like 25-33% credit
  ratio don't apply to a cash-secured put), OTM% formula, and a "CSP — Wheel
  Entry" expanded detail block (mirroring the existing "PMCC Structure"
  block) showing required cash, breakeven, assignment price, and capital
  status.
- Trade/"Find Better" buttons are hidden for CSP results (see §7).

## 4. What Wheel Logic Was Reused

`lib/scans/csp-finder.ts`'s `findBestCsp()` does not reimplement contract
search. It calls `findBestWheelContract()` from `lib/wheel/chainSearch.ts`
directly — the same function the Wheel page uses for CSP hunting — passing
the Screener's already-fetched chain data straight through. This works
because `getChain()`'s leg shape (`strikePrice`, `delta`, `bid`, `ask`,
`mid`, `openInterest`, `occSymbol`, `expirationDate`, `optionType`) is a
strict superset of what `WheelChainLeg` requires; no data transformation is
needed, just a type cast documenting that fact.

Delta/DTE defaults (`DEFAULT_CSP_RULES`: delta 0.15–0.25, DTE 30–45) were set
to match Wheel's own defaults (`app/api/wheel-config/route.ts`
`DEFAULT_CONFIG`), so a CSP found by the Screener and a CSP found by Wheel
start from the same targeting assumptions, per the "should feel seamless,
not separate" requirement.

## 5. How the Capital Check Works

`findBestCsp()` computes `requiredCash = strike × 100 × contracts` (contracts
defaults to 1 — sizing happens at trade time, not scan time, and there is no
trade-time flow for CSP yet per §7).

Available cash comes from `getAvailableCash()` (new, in
`lib/scans/tastytrade-client.ts`), which reads
`cash-available-to-withdraw` / `cash-balance` from
`/accounts/{accountNumber}/balances` — deliberately the same endpoint
`app/engine/page.tsx` already reads, but picking the cash-only fields rather
than `derivative-buying-power`/`option-buying-power`, so margin is never
factored in by default, per DR-0001 §9.

The Screener's CSP card also has a manual "Available Cash" override input,
for cases where the live balance fetch fails or the trader wants to plan
against a smaller reserve than their full cash balance.

When `requiredCash > availableCash`, the candidate is **not discarded** — it
is still found and shown, with `capitalBlocked: true` and a
`capitalWarning` message, and `qualified` is forced to `false`. This matches
DR-0001 §7.4: "show the candidate as unavailable or blocked" rather than
hiding it.

## 6. Vercel Build Result

Vercel is the authoritative build validation per project convention. From
this environment I do not have direct access to the Vercel dashboard, so I
ran the equivalent checks locally before pushing:

- `npx tsc --noEmit` — clean, no errors
- `npm run build` (`next build`) — succeeded, exit code 0, all 42 routes
  generated including `/screener` (50.9 kB, up from its pre-change size)

Please confirm the actual Vercel preview deployment for
`feature/autopilot-paper-mode` once it builds — I could not query the
deployment status myself. (The `ioredis ECONNREFUSED` lines in the build log
are expected/harmless — the wheel-config/wheel-candidates API routes try to
reach Redis during the build's route-collection pass; they are dynamic
routes, not statically prerendered, so this doesn't affect the build result.)

## 7. Deferred Work

- **CSP trade placement.** `SpreadCandidate.longOccSymbol` is deliberately
  left `undefined` for CSP candidates, which makes the existing
  `hasOccSymbols` gate in the Trade modal flow evaluate to `false` — so no
  order-placement path exists for CSP yet. The Trade/"Find Better" buttons
  are hidden for CSP results with an explanatory note instead.
- **"Find Better" for CSP.** `BestOpportunityFinder` (the "Find Better"
  modal) runs BPS/BCS/IC checklists at different risk-tolerance presets. It
  was not extended to CSP, since CSP isn't a vertical spread and doing this
  properly is its own scoped piece of work.
- **CC (Covered Call).** Not touched — DR-0001 TE-0007C.
- **PMCC changes.** Not touched — DR-0001 TE-0007D. (Existing PMCC code was
  used only as a structural reference/pattern.)
- **Filter/Rank/Targeted mode integration.** CSP is currently its own scan
  action (matching the existing PMCC precedent), not wired into the
  trend-gated Filter mode or the exhaustive Rank/Targeted modes. Those modes
  are structurally spread-specific (trend → BPS/BCS/IC selection, spread
  width iteration); integrating CSP there is DR-0001 §11's later
  "Unified Opportunity Result UI" (TE-0007E) work.
- **Engine's Wheel Engine section** already has its own simpler, pre-existing
  CSP/CC suggestion and order-placement logic (heuristic strike selection,
  not delta-targeted). It was left as-is; reconciling it with the Screener's
  new delta-targeted CSP search is future work, not part of this ticket.

## 8. Manual Testing Steps

1. On `feature/autopilot-paper-mode`, open `/screener`.
2. In the sidebar, find the new "CSP LIST" card (below PMCC).
3. Enter a ticker known to have decent options liquidity (e.g. a large-cap
   the account already trades), leave "Available Cash" blank, click
   "SCAN SELECTED FOR CSP".
4. Confirm a CSP result card appears in the results list with:
   - an amber "CSP" badge
   - a single put strike (not a strike pair)
   - "Premium" / "Ann. ROC" fields instead of "Credit" / "Cr Ratio"
   - OTM%, IVR, earnings check, and OI populated
   - no "TRADE THIS" or "FIND BETTER" buttons — instead the
     "Manual entry only" note
5. Expand the card — confirm the "CSP — Wheel Entry" detail block shows put
   strike/expiration/delta, premium, required cash, breakeven, assignment
   price, period ROC, and annualized ROC.
6. Re-run the scan with a very low "Available Cash" override (e.g. `100`) —
   confirm the same candidate now shows a red "Insufficient cash" warning in
   the expanded detail block and is not marked qualified.
7. Run a normal BPS/BCS/IC scan (Filter or Rank mode) and confirm existing
   spread behavior is unchanged.
