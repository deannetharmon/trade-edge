# LCC-0001E — Technical Specification
LEAPS, Covered Call, and PMCC Scanner Reframing

**Status:** Draft for team review (Dane)
**Depends on:** LCC-0001A (published `ad7bf07`), LCC-0001B (published `f0b1be9`, includes
`UNKNOWN_MIGRATED` origination), LCC-0001C (corrected, published `3365657`), LCC-0001D (published
`f0b1be9`, all open items resolved)
**Blocks:** LCC-0001 production completion (final gate)
**Traces to:** LCC-0001 epic, LCC-0001E ticket, corrected master architecture
(`docs/design/LCC-0001-technical-architecture.md`), architecture review
(`docs/design/LCC-0001-architecture-review.md`), LCC-0001A/B/C/D technical specifications, execution
sequence, both approved mockups, and the current repository implementation cited throughout.
**Does not implement application code. This is the final ticket spec in the LCC-0001 sequence.**

---

## 1. Objective

Reframe the existing Screener/Hunter discovery experience so users can find standalone long
calls/LEAPS, stock covered calls, new PMCC combinations, and calls against existing positions —
using the shared portfolio snapshot (LCC-0001A), coverage allocations (LCC-0001B), entry workflows
(LCC-0001C), and lifecycle/reconciliation state (LCC-0001D) — while preserving the existing Screener
shell, canonical scan sessions, and PMCC ranking exactly as they are today. This is the direct
implementation of master architecture §4.6 and §11.

---

## 2. Exact affected files, functions, types, and components

### 2.1 New modules

| File | Contents |
|---|---|
| `lib/screener/launchers/findLeaps.ts` | Find LEAPS ranking/discovery (§6.1) |
| `lib/screener/launchers/findCoveredCalls.ts` | Find Covered Calls, re-pointed capacity source (§6.2) |
| `lib/screener/launchers/findPmccs.ts` | Thin orchestration wrapper — **no ranking logic** — around the existing, unmodified PMCC pipeline (§6.3) |
| `lib/screener/launchers/callsAgainstPositions.ts` | Calls Against My Positions (§6.4) |
| `features/screener/components/LeapsResultCard.tsx` | New result card for LEAPS candidates |
| `features/screener/components/ScannerTransparencyPanel.tsx` | Shared transparency-field rendering (§7), reused by every launcher's result card |
| `lib/screener/__tests__/findLeaps.test.ts`, etc. | Test suite (§13) |

### 2.2 Existing files consumed, unmodified

| File | Role |
|---|---|
| `lib/scans/pmccPairing.ts`, `pmccChainAdapter.ts`, `pmccScore.ts`, `pmccProduction.ts` | **Ranking/pairing untouched.** Per the resolved product decision (master architecture §15.0) and this ticket's own explicit non-goal, LCC-0001E does not modify `pmccScore.ts`'s 2-factor ROI/liquidity model, nor reconcile it with `PMCC_SPECIFICATION.md`. That conflict remains routed to its own separate prerequisite ticket, outside LCC-0001 entirely. |
| `lib/scans/covered-call-finder.ts` (`findBestCoveredCall`, `buildCcSpreadCandidate`) | Candidate selection logic reused unchanged; only its **capacity input** changes (§6.2), not its selection/filtering logic. |
| `app/screener/page.tsx`'s existing launcher shell, `LauncherButton`/`LauncherStrategyId`, Opportunity Universe, canonical scan sessions (`lib/screener/scanSession.ts`, `scanSessionCache.ts`, `screenerJobStore.ts`) | Reused and **extended** (new union members), not replaced — see §3. |
| `lib/position-entry/*` (LCC-0001C) | Every launcher's "Save Plan"/"Record Executed Trade" actions call LCC-0001C's existing workflow functions directly — this ticket does not duplicate entry-workflow logic, only wires launcher UI to it. |
| `lib/position-entry/dividendAssignmentRisk.ts::assessDividendAssignmentRisk()` (LCC-0001C) | **Consumed here for the first time** — this is the ticket LCC-0001C's own spec named as the intended consumer of that contract. See §7.1. |
| `lib/coverage/inference.ts::findEligibleFoundations`/`inferOrRequireConfirmation` (LCC-0001B) | Reused directly by `callsAgainstPositions.ts` (§6.4) and `findCoveredCalls.ts` (§6.2) — not reimplemented. |
| `lib/portfolio-snapshot/*` (LCC-0001A) | Sole source of holdings/capacity data for every launcher that needs it. |
| `lib/help/optionsStrategyReference.ts` | Reused for display-only educational caveats wherever LCC-0001C's pattern applies (§7.1) — never as calculation input, consistent with that ticket's established rule. |

### 2.3 Existing files extended (additive)

| File | Change |
|---|---|
| `features/screener/components/LauncherButton.tsx` | `LauncherStrategyId` extended: `'spreads' \| 'csp' \| 'cc' \| 'pmcc' \| 'leaps' \| 'callsAgainstPositions'`. Existing four values and their rendering are unchanged. |
| `lib/screener/scanSession.ts` | `ScreenerRequestedStrategy` extended identically. `createScanSession`/`resolveScanPlan` logic itself is not modified — it already operates generically over whatever strategy string it's given. |
| `app/screener/page.tsx` | Additive: two new launcher buttons (Find LEAPS, Calls Against My Positions — "Find PMCCs" and "Find CCs" already exist and are relabeled/re-pointed, not replicated); line ~7739's `getCoveredCallCapacityReport(token)` call site replaced per §6.2. |

---

## 3. Reuse / extend / refactor / replace classification

| Component | Classification |
|---|---|
| `pmccPairing.ts`, `pmccScore.ts`, `pmccProduction.ts`, `pmccChainAdapter.ts` | **Reuse, unmodified** — zero lines changed. |
| `covered-call-finder.ts` | **Reuse (capacity input refactored, selection logic unchanged)** — see §6.2. |
| `LauncherStrategyId`, `ScreenerRequestedStrategy` | **Extend** — additive union members only. |
| Canonical scan sessions (`scanSession.ts`, `scanSessionCache.ts`, `screenerJobStore.ts`) | **Reuse, unmodified** — these are already strategy-agnostic. |
| `app/screener/page.tsx`'s launcher shell/Opportunity Universe | **Extend** — two new buttons, no shell redesign. |
| `getCoveredCallCapacityReport()` (`lib/scans/tastytrade-client.ts`) | **Replace at the call site only** (line ~7739) — the function itself remains in place, unwired, exactly as LCC-0001A's spec already planned for its own Gate A cutover (§6.2 here is that cutover's actual execution). |
| `lib/position-entry/*`, `lib/coverage/*`, `lib/portfolio-snapshot/*` | **Reuse, unmodified** — called, not duplicated. |
| `lib/position-entry/dividendAssignmentRisk.ts` | **Reuse (first real consumer)** — LCC-0001C built the contract; this ticket wires it in, per that ticket's own explicit hand-off. |

---

## 4. Find LEAPS

`lib/screener/launchers/findLeaps.ts`:

```ts
export interface LeapsRankingInputs {
  durationDte: number;
  delta: number;
  intrinsicValue: number;
  extrinsicValue: number;
  trendAlignment: 'aligned' | 'neutral' | 'against' | null;   // existing trend classification
                                                                 // (lib/portfolio/trendClassification.ts),
                                                                 // reused as an input signal
  liquidity: { openInterest: number; bidAskSpreadPct: number };
  valuationVsUnderlying: number | null;                        // strike vs. current price, existing
                                                                  // pattern from covered-call-finder.ts's
                                                                  // strikeVsStockPct
  exitRuleContext: { targetDte: number; targetDelta: number };  // approved exit-rule inputs per ticket
}

export function scoreLeapsCandidate(inputs: LeapsRankingInputs): { score: number; breakdown: Record<string, number> }
export function findLeapsCandidates(chain: ChainData, params: LeapsFindParams): ScreenResult[]
```

**New ranking logic** (unlike Find Covered Calls/PMCCs, there is no existing LEAPS-only ranking
function anywhere in the repository — verified absent from `lib/scans/*`). `scoreLeapsCandidate()`
follows the same breakdown-transparency convention `pmccScore.ts` already established (a full
breakdown, not just a total, "per Paul's explicit requirement that the score never be a mystery
number" — that comment in `pmccScore.ts` applies equally here and this function's shape mirrors it
deliberately). **Does not require a short call** — `findLeapsCandidates` never reads coverage/
allocation data at all; a long call stands entirely on its own merits.

**Workflow actions**: "Review LEAPS Plan" (→ LCC-0001C's `leapsOnly.ts::reviewLeapsCandidate`),
"Compare" (existing multi-candidate comparison UI pattern, if one exists in the Screener shell —
reused, not rebuilt), "Save" (→ LCC-0001C's `SavedPlan` store), "Add Short Call" (optional — routes
directly into `callsAgainstPositions.ts`, §6.4, once the long call is an actual held position, not
from the scanner result itself, since a scanner result is never a position per LCC-0001C's boundary).

---

## 5. Find Covered Calls

`lib/screener/launchers/findCoveredCalls.ts`:

```ts
export async function runFindCoveredCalls(
  universe: string[],
  snapshot: PortfolioSnapshot,           // LCC-0001A
  allocations: CoverageAllocation[],     // LCC-0001B
): Promise<ScreenResult[]>
```

**The single mechanism that closes LCC-0001A's original Portfolio/Screener parity gap end to end**:
this function replaces `app/screener/page.tsx` line ~7739's `getCoveredCallCapacityReport(token)`
call with a read from the **same** `PortfolioSnapshot`/`CoverageAllocation[]` that `PortfolioDataProvider`
already exposes to Portfolio (LCC-0001A/B). Internally:

1. Compute available capacity per symbol using LCC-0001A's `computeCoveredCallCapacity()` (unchanged)
   **minus** LCC-0001B's active/proposed allocations (the "conservative capacity" LCC-0001A shipped
   with, now correctly reduced by durable allocations — this is the exact upgrade LCC-0001A's own
   spec anticipated: "LCC-0001A may initially show capacity derived from the existing conservative
   capacity logic while LCC-0001B adds durable allocations").
2. Pass the resulting per-symbol capacity into `covered-call-finder.ts::findBestCoveredCall()`
   **unchanged** — that function's own signature (`params.capacity.availableCoveredContracts`)
   already accepts exactly this shape; only what's fed into it changes, not the function itself.
3. **Opportunity Universe may narrow eligible holdings but never creates eligibility**: the universe
   filter (existing `lib/screener/opportunityUniverse.ts`, unmodified) is applied as a symbol-list
   intersection **before** step 1's capacity computation, never as a substitute for it — a symbol in
   the universe with zero available capacity still returns zero candidates, exactly as before.
4. **Refresh capacity before finalizing a plan**: `reviewStockCoveredCallPlan` (LCC-0001C, already
   built) already re-checks `findEligibleFoundations()` immediately before returning candidates — this
   ticket's launcher calls that existing re-check, not a new one.

**Acceptance criterion verification** ("Portfolio reports one available standard share unit... scans
at most one new contract and shows the same snapshot timestamp"): satisfied by construction, since
step 1 and Portfolio's own allocation display (LCC-0001B §11) now read the identical snapshot object
— there is no second timestamp to disagree.

---

## 6. Find PMCCs

`lib/screener/launchers/findPmccs.ts` — **the thinnest of the four launcher modules**, by design:

```ts
export async function runFindPmccs(
  universe: string[],
  scanConfig: PmccScanConfig,   // existing shape, unchanged
): Promise<PmccSessionResult>   // existing lib/scans/pmccTypes.ts shape, unchanged
```

This function is a **pass-through wrapper**, not new logic: it calls `pmccChainAdapter.ts` →
`pmccPairing.ts` → `pmccScore.ts` → `pmccProduction.ts` in exactly the sequence
`app/screener/page.tsx` already invokes them today, with zero changes to inputs, outputs, or ranking
math. Its only additions are at the **UI action** layer, not the discovery layer:

- **Review PMCC Plan** → LCC-0001C's `newPmcc.ts::reviewPmccPlan()`.
- **Review Long Call Only** → LCC-0001C's `leapsOnly.ts::reviewLeapsCandidate()`, applied to just the
  proposed long leg of a PMCC pair — satisfying the ticket's explicit requirement that a PMCC result
  supports viewing the long leg on its own.
- **Replace proposed long/short leg** → re-invokes the existing pairing engine (`pmccPairing.ts`) with
  one leg pinned and the other re-searched — this is exactly what `pmccPairing.ts`'s existing
  eligibility-checking design already supports (it evaluates leg compatibility generically, not
  index-by-index against a fixed pair), so no new pairing logic is needed.
- **Use an eligible existing long call** → calls LCC-0001B's `findEligibleFoundations()` (reused
  directly) to check whether the user already holds a compatible long call, and if so, routes to
  `callAgainstPosition.ts` (LCC-0001C) instead of `newPmcc.ts` — this is the concrete mechanism behind
  "substituting an eligible existing long call."
- **Save and compare** → LCC-0001C's `SavedPlan` store, same as every other launcher.

**Existing PMCC ranking parity**: because this module changes zero lines of `pmccScore.ts`/
`pmccPairing.ts`/`pmccProduction.ts`, ranking parity is guaranteed by construction, not by a
regression test alone (though §13 still includes one) — there is no code path in this ticket that
could alter a ranking output.

---

## 7. Calls Against My Positions

`lib/screener/launchers/callsAgainstPositions.ts`:

```ts
export async function runCallsAgainstPositions(
  snapshot: PortfolioSnapshot,
  allocations: CoverageAllocation[],
): Promise<{ foundation: EligibleFoundation; candidates: ScreenResult[] }[]>
```

- **Begins from a verified stock or long-call foundation**: calls LCC-0001B's
  `findEligibleFoundations()` (reused directly) across every underlying in the snapshot, not a
  separate eligibility re-derivation.
- **Respects remaining capacity**: the same capacity figure §6.2 already establishes — one shared
  computation path across both launchers, not two.
- **Preselects only an unambiguous support source; requires confirmation where multiple eligible
  foundations exist**: calls LCC-0001B's `inferOrRequireConfirmation()` directly — this launcher does
  not re-implement the preselect/confirm decision, it consumes LCC-0001B's existing function exactly
  as LCC-0001C's `callAgainstPosition.ts` workflow already does (§6.5 of that spec). This is the
  literal mechanism behind the ticket's own acceptance criterion ("multiple eligible foundations →
  TradeEdge requires the intended support relationship before recording execution").
- Result cards route directly into LCC-0001C's `callAgainstPosition.ts` workflow for planning/
  execution-evidence — no separate entry path is built here.

---

## 8. Scanner transparency

`features/screener/components/ScannerTransparencyPanel.tsx` — one shared component, reused by every
launcher's result card (LEAPS, CC, PMCC, Calls Against My Positions), implementing the ticket's full
transparency-field list in one place rather than four separately-maintained copies:

| Field | Source |
|---|---|
| Quote timestamp | Existing per-leg quote timestamp fields already carried on `ScreenResult`/chain data |
| Bid, ask, assumed execution price | Existing chain-data fields, unchanged |
| Slippage and fee assumptions | LCC-0001C's `PlanAssumptions` (already defined, §4 of that spec) |
| Volatility and dividend assumptions | Volatility: existing IV/IVR fields already surfaced elsewhere in the app. Dividend: **§8.1 below** |
| Leg deltas | Existing delta fields |
| Intrinsic and extrinsic value | Existing `pmccLegEconomics.ts` output, reused |
| Net debit and strike width | Existing `financials.ts::calculatePmccCapital`, reused |
| Liquidity and open interest | Existing `pmccQuoteQuality.ts`/`covered-call-finder.ts` liquidity warnings, reused |
| Stale-data state | LCC-0001A's `staleQuote`/`dataQualityWarnings` fields, reused |
| Estimated outcome at short-call expiration | New, thin composition of existing P/L calculations (LCC-0001C §7) evaluated at the proposed strike — not a new calculation engine |
| Estimated versus confirmed values | Structural: `SavedPlan.proposedLegs[].assumedPrice` vs. `ExecutionFill.price` (LCC-0001C §4) — the panel simply renders both fields side by side when both exist |

### 8.1 Dividend and early-assignment exposure — consuming LCC-0001C's contract

This is the integration point LCC-0001C's own specification (§8.1, §19 of that document) explicitly
named as deferred to this ticket. `ScannerTransparencyPanel` calls
`assessDividendAssignmentRisk()` (unmodified, reused directly) for every PMCC and covered-call result
card, and renders:

- `state: 'LOW'` → a neutral, unobtrusive indicator.
- `state: 'ELEVATED'` → a visible warning, styled consistently with `covered-call-finder.ts`'s
  existing `ccAssignmentWarning` styling convention (yellow, `⚠` prefix — matching
  `app/screener/page.tsx` line ~4557's existing pattern, reused for visual consistency rather than
  inventing a new warning style).
- `state: 'UNKNOWN'` → **rendered identically prominently to `ELEVATED`**, never downgraded to a
  quiet/neutral treatment — per LCC-0001C's explicit requirement ("never silently classify it as low
  risk"), this ticket's UI treatment must not silently *soften* an `UNKNOWN` state either, since a
  quiet rendering of "we don't know" would functionally reproduce the exact failure mode the contract
  was built to prevent, just at the display layer instead of the calculation layer.
- `caveatText` (LCC-0001C's field, sourced from `optionsStrategyReference.ts`) is rendered alongside
  the state indicator, exactly as LCC-0001C specified — this ticket adds no new educational copy.

**Data source status, restated from LCC-0001C's own spec**: no real dividend-date data source exists
in the repository today. This ticket's launchers call `assessDividendAssignmentRisk()` with
`dataAvailable: false` honestly (identical to LCC-0001C's own callers) **unless** a real dividend-date
source is identified and wired in as part of this ticket's implementation — which is explicitly
**this ticket's opportunity to close that gap**, since LCC-0001C's spec named LCC-0001E as the
natural point where a real source might get supplied. Whether that happens is a scoping/resourcing
question for implementation, not a design gap in this spec: the contract works correctly either way
(`UNKNOWN` if no source is wired, real states if one is).

**`initial net debit < strike width` remains a warning signal, never a profitability guarantee**
(restated from LCC-0001C, carried into this shared panel's copy) — this UI component is the single
place this exact language now lives for every launcher that shows the check, rather than being
duplicated per launcher.

---

## 9. PMCC risk checks (ticket-level, distinct from §8's general transparency)

Directly restates the ticket's "PMCC risk checks" scope, implemented as the composition of already-
built pieces, not new logic:

- Underlying, deliverables, quantities, expirations → LCC-0001B's `validatePmccCompatibility()`,
  reused directly (already the mechanism LCC-0001C's `pmccValidation.ts` calls, §8 of that spec).
- Net debit vs. strike width → `financials.ts::calculatePmccCapital`, reused, with the
  never-a-guarantee framing from §8 above.
- Assignment and expiration risk → §8.1's `assessDividendAssignmentRisk()`, plus LCC-0001D's
  authoritative-evidence expiration model (§7 of that spec) informing what "expiration risk" even
  means going forward — a scanner result's projected outcome is explicitly labeled as an *estimate*
  (per §8's transparency table), never presented with the same certainty LCC-0001D's
  authoritative-evidence-only lifecycle transitions require for an actual position.

---

## 10. Existing-code preservation (ticket-mandated, verified)

The ticket explicitly lists what must be reused: "the unified launcher, Opportunity Universe,
canonical scan sessions, PMCC modal, PMCC pair lookup, result hierarchy, and recommendation pipeline
where valid." Verified against §2–§3 above: every one of these is classified **reuse-unmodified** or
**extend-additive** in this spec, none is **replace**. "Refactor calculation ownership behind shared
services rather than duplicating logic in the page" is directly satisfied by §4–§7's launcher modules
living in `lib/screener/launchers/*` rather than inline in `app/screener/page.tsx`. "Do not use the
legacy CC Tracker as the new lifecycle foundation" — verified: no launcher in this spec reads from or
writes to any CC-Tracker-named module; LCC-0001B/D's coverage/lifecycle machinery is the sole
foundation, as the ticket requires.

---

## 11. API/service boundaries

No new persisted domain state (consistent with LCC-0001A's pattern — Screener launchers are
read/derive-only against LCC-0001A–D's existing persistence). No new API routes: every launcher reads
from `PortfolioDataProvider`'s existing context (snapshot, allocations, cycles, reconciliation items)
and calls LCC-0001B/C's existing API routes only when a user takes an entry-workflow action (Save
Plan, Record Execution) — those routes already exist and are unmodified.

---

## 12. Portfolio UI integration — N/A, this is the Screener-side ticket

No `app/portfolio/page.tsx` changes beyond what LCC-0001B/C/D already specified. This ticket's UI
surface is entirely `app/screener/page.tsx` plus the new `features/screener/components/*` files
(§2.1, §2.3).

---

## 13. Unit, integration, and acceptance-test matrix

| Test | Type | Location | Traces to |
|---|---|---|---|
| `scoreLeapsCandidate`: breakdown transparency, no short-call dependency | Unit | `lib/screener/__tests__/findLeaps.test.ts` | Ticket "Find LEAPS" scope |
| `findLeapsCandidates`: does not require a short call | Integration | Same | "LEAPS-only path" acceptance criterion |
| `runFindCoveredCalls`: capacity read from shared snapshot, same timestamp as Portfolio | Integration | `lib/screener/__tests__/findCoveredCalls.test.ts` | "Covered Call eligibility" acceptance criterion |
| `runFindCoveredCalls`: fully reserved shares → no new call recommended, blocking reason visible | Integration | Same | "Fully reserved shares" acceptance criterion |
| `runFindCoveredCalls`: Opportunity Universe narrows but never creates eligibility | Integration | Same | Ticket "Find Covered Calls" scope |
| `runFindPmccs`: zero-diff regression against pre-LCC-0001E ranking output for a fixed fixture set | Integration (regression) | `lib/scans/__tests__/pmccProduction.test.ts` (extended) | "Existing PMCC ranking parity" requirement |
| `runFindPmccs`: "Review PMCC Plan" shows proposed long leg as support without an unnecessary coverage-selection step | Integration | `lib/screener/__tests__/findPmccs.test.ts` | "New PMCC" acceptance criterion |
| `runCallsAgainstPositions`: multiple eligible foundations → confirmation required before execution | Integration | `lib/screener/__tests__/callsAgainstPositions.test.ts` | "Existing position" acceptance criterion |
| `assessDividendAssignmentRisk()` consumption: `UNKNOWN` rendered with the same visual prominence as `ELEVATED`, never downgraded | Component | `features/screener/components/__tests__/ScannerTransparencyPanel.test.tsx` | LCC-0001C hand-off, §8.1 |
| Data-unavailable: coverage cannot be verified → Find Covered Calls fails closed, existing holdings still visible | Integration | `lib/screener/__tests__/findCoveredCalls.test.ts` | "Data unavailable" acceptance criterion |
| `LauncherStrategyId`/`ScreenerRequestedStrategy` extension: existing four values' behavior unchanged | Unit (regression) | `features/screener/components/__tests__/LauncherButton.test.tsx`, `lib/screener/__tests__/scanSession.test.ts` | Dependency integrity |
| Existing PMCC/CC/spreads/CSP suites remain green (regression) | Existing suites, unmodified | `lib/scans/__tests__/*`, `app/screener/__tests__/*` | "Existing Screener and canonical scan-session suites" validation requirement |
| Accessibility: plans and disclosures | Component | Extends `app/screener/__tests__/ScreenerUXHierarchy.test.tsx` | Ticket validation requirement |
| `npx tsc --noEmit --incremental false` | Type check | CI | Standing convention |
| Full Vercel preview build | Build | Manual/CI per PR | Standing convention |
| `git diff --check` | Lint | CI | Standing convention |

**Golden fixtures requiring Alan's approval**: LEAPS ranking fixtures (new, per ticket's own
"LEAPS ranking golden fixtures" validation requirement) and PMCC ranking regression fixtures
(confirming zero drift, not new approval — the ranking itself was already approved and is unchanged).

---

## 14. Acceptance-criterion traceability

| LCC-0001E acceptance criterion | Implementing mechanism |
|---|---|
| LEAPS-only path (Review Long Call Only → proposed plan, no position created) | §4, §6 "Review Long Call Only" |
| Covered Call eligibility (one available unit → scans at most one contract, same snapshot timestamp) | §5 steps 1–2 |
| Fully reserved shares (no new call recommended, blocking reason visible) | §5 step 1 (capacity reduced to zero → `findBestCoveredCall` returns null per its own existing `availableCoveredContracts <= 0` guard) |
| New PMCC (proposed long leg shown as support, no unnecessary coverage-selection step) | §6 "Review PMCC Plan" |
| Existing position (multiple eligible foundations → confirmation required) | §7, `inferOrRequireConfirmation()` |
| Data unavailable (coverage unverifiable → scan fails closed, holdings stay visible) | §5 step 1 inherits LCC-0001A's fail-closed snapshot behavior directly |

All six acceptance criteria map to an explicit, named, testable mechanism.

**No open items.** Every design question this ticket raised was resolvable by direct composition of
LCC-0001A–D's already-built, already-approved primitives — this ticket introduces no new domain
model, no new persisted state, and no new product decision.

---

## 15. Migration and rollout plan

Per the ticket's own "Rollout" section:

1. **PR 1** — `lib/screener/launchers/findLeaps.ts`, `scoreLeapsCandidate` golden fixtures pending
   Alan's approval. No consumer wiring.
2. **PR 2** — `LauncherStrategyId`/`ScreenerRequestedStrategy` extension, `LeapsResultCard.tsx`,
   Find LEAPS launcher button, **behind a feature flag** (ticket requirement: "Introduce Find LEAPS
   behind a feature flag").
3. **PR 3** — `findCoveredCalls.ts`'s new capacity-source path, run in **shadow mode** alongside the
   existing `getCoveredCallCapacityReport()` call site (ticket requirement: "Shadow-compare old/new
   Covered Call... calculations") — logged, not yet switching the live call site.
4. **PR 4** — cut over line ~7739 to the new capacity source once shadow-mode parity is clean for the
   agreed monitoring window (this is the literal Gate A/Gate E closing action both LCC-0001A's and
   this ticket's own rollout sections call for).
5. **PR 5** — `findPmccs.ts` wrapper + `callsAgainstPositions.ts`, **preserving current PMCC ranking
   until parity is demonstrated** (ticket requirement) — since this module changes zero ranking code,
   parity is immediate, but the shadow/monitoring period is still observed for the *workflow* changes
   (new action wiring) even though the *ranking* itself carries no risk.
6. **PR 6** — `ScannerTransparencyPanel.tsx` including §8.1's dividend/assignment consumption, flagged
   independently.
7. Track workflow completion and reconciliation rates, **not trading outcomes** (explicit ticket
   requirement, restated because it's a measurement-scope constraint, not just a feature gate).

Each PR touching `app/screener/page.tsx` requires a full Vercel preview build, per standing
convention.

---

## 16. Explicit exclusions

- **New global navigation or application-shell redesign** — epic non-goal, verified not introduced
  anywhere in this spec (§10).
- **Automatic order submission** — not added; every launcher routes to LCC-0001C's execution-evidence
  workflows (manual record or broker match), never to `ttPost`/`ttValidateOrder` directly.
- **Naked-call recommendations** — not introduced; `findCoveredCalls.ts` and
  `callsAgainstPositions.ts` both derive exclusively from verified capacity (§5, §7); no code path in
  this spec can recommend a short call without a verified foundation.
- **Unvalidated changes to existing PMCC scoring** — explicitly not made (§6); `pmccScore.ts` is
  reused with zero modification.
- **Reconciling `PMCC_SPECIFICATION.md` with `pmccScore.ts`** — remains routed to its own separate
  prerequisite ticket per the resolved product decision (master architecture §15.0); this ticket does
  not touch that conflict, consistent with every prior ticket in this sequence.

---

## 17. Self-review against source material

- **Epic:** release-definition item 9 ("Use Find LEAPS, Find Covered Calls, Find PMCCs, and Calls
  Against My Positions against the shared portfolio model") is the direct objective of this ticket,
  satisfied by §4–§7 — every launcher reads the shared snapshot/allocation state, none maintains an
  independent view.
- **LCC-0001E ticket:** every scope item (Find LEAPS, Find Covered Calls, Find PMCCs, Calls Against My
  Positions, scanner transparency, PMCC risk checks, existing-code preservation) and all six
  acceptance criteria map to an explicit mechanism — §14 traceability table. Non-goals (new
  navigation, automatic order submission, naked-call recommendations, unvalidated PMCC scoring
  changes) are respected and restated in §16.
- **Corrected master architecture:** §4.6, §11 are implemented without deviation — no new discovery
  infrastructure is built; every launcher composes existing pipelines.
- **Architecture review:** no direct new findings apply to this ticket's own scope; its predecessor
  findings (Finding A on `isPmccPosition()`, Finding B on the multiplier reference) were already
  resolved in LCC-0001A/B/D and this ticket correctly does not re-touch either.
- **LCC-0001A/B/C/D technical specs:** every type and function this ticket calls
  (`PortfolioSnapshot`, `CoverageAllocation`, `findEligibleFoundations`, `inferOrRequireConfirmation`,
  `SavedPlan`, `ExecutionFill`, `assessDividendAssignmentRisk`, the authoritative-evidence expiration
  model) is consumed exactly as those specs defined it. §8.1 is specifically the hand-off point
  LCC-0001C's own spec named for this ticket, and is implemented as that spec anticipated: consuming
  the contract, not rebuilding it, with `UNKNOWN` given equal visual weight to `ELEVATED` per that
  ticket's explicit non-negotiable requirement.
- **Execution sequence / Gate E:** all five Gate E criteria (four launchers use shared services;
  Covered Call capacity matches Portfolio; existing PMCC ranking parity demonstrated; quote/assumption
  transparency present; feature flags and monitoring support safe rollout) map to §5/§7, §5, §6/§13,
  §8, and §15 respectively.
- **Mockups:** the execution sequence's LCC-0001E mockup-map row (Screener Result, LEAPS Result, PMCC
  Plan, Coverage Choice) is fully covered — LEAPS Result by §4/§4's new result card, PMCC Plan by §6,
  Coverage Choice by §7's `inferOrRequireConfirmation()` consumption, Screener Result generally by
  §8's shared transparency panel used across all four launchers.
- **`PMCC_SPECIFICATION.md`:** not applicable to this ticket's scope; `pmccScore.ts` explicitly reused
  unmodified (§6), consistent with the resolved product decision — restated one final time since this
  is the last ticket in the sequence where that conflict could have been tempting to fold in, and it
  is correctly kept out.
- **Current code:** §2 verified every cited file/function against the repository at the synced
  commit, including confirming the exact call site (`app/screener/page.tsx` line ~7739) LCC-0001A's
  spec identified as the eventual cutover point — this ticket is where that cutover is actually
  specified to happen (§15 PR 4), closing the loop LCC-0001A opened.

No contradiction with the epic, the ticket, the corrected architecture, the architecture review, the
LCC-0001A/B/C/D specs, the execution sequence, the mockups, or `PMCC_SPECIFICATION.md` was found. No
open items remain. None of the three resolved product decisions from the master architecture's §15.0
are reopened. This is the final per-ticket technical specification in the LCC-0001 sequence
(A through E); the remaining deliverable is the cross-ticket traceability and implementation-readiness
review spanning all five tickets.
