# CSP-0002 Implementation Report

Branch: `fix/csp-candidate-discovery-correctness`
Base commit: `c88f1eb` (`main`'s actual tip at branch time — `SCREENER-LAUNCHER-0001: unify strategy launcher selected/unselected visual model`). `main` contains SCREENER-RESULTS-0001, SCREENER-UX-0001, and Partial Profit `d67575d` as ancestors (`d67575d` confirmed via `git merge-base --is-ancestor`).

## Root cause (confirmed)

`findBestCsp()` delegated to Wheel's `findBestWheelContract()`, which picks only the single delta-closest-to-center contract and never evaluates liquidity. `findBestCsp()` then hard-rejected that one contract (`return null`) on low OI or wide bid/ask, discarding every other in-window contract along with it. See `docs/tickets/CSP-0002-candidate-discovery-correctness.md` for the full writeup.

## Before / after selection behavior

- **Before:** one candidate picked by delta-proximity alone → immediately discarded on liquidity → `null` → generic false "no put found" message, even when 5 real puts existed in-window.
- **After:** the entire chain is searched (`lib/scans/cspSearch.ts`). Every DTE/delta-window put is structurally validated and liquidity-classified. The best fully eligible candidate wins if one exists; otherwise the best structurally valid (but disqualified) candidate is returned with its true status, never `null` unless nothing genuinely exists in the window.

## AMD fixture outcome

Using the exact chain from the incident report (5 puts, 410–430 strike, deltas -0.18 to -0.25, OI 107–409, all wider than $0.10):

- `expirationsInDteWindow: 1`, `putsInDeltaWindow: 5`, `validQuoteCandidates: 5`, `oiPassingCandidates: 0`, `spreadPassingCandidates: 0` — an honest account of a real, if illiquid, chain.
- Search `reason` is `null` (a candidate was found) — never `NO_PUT_IN_DELTA_WINDOW`.
- Selected candidate's `shortDelta` is a positive absolute value (normalized from the negative raw delta).
- `qualified: false`; `disqualificationReason` names the actual failing rule(s) with real dollar/OI values — never the old generic message.
- Full-session wiring test: AMD's `symbolOutcomes` status is `evaluated`, never `failed`; the accounting bar shows "1 evaluated," never "failed"; the disqualified candidate's fundamentals (Δ, credit/share, cash required, etc.) are visible in the (default-collapsed) card; AMD never appears in the `/api/autopilot/recommendations` request body (Best Opportunities stays qualified-only); accounting is reconciled (1 selected · 1 planned · 1 attempted · 1 evaluated).

## Truthful reason taxonomy (implemented verbatim)

All five required messages plus the combined "multiple liquidity findings" message are implemented in `describeCspSearchOutcome()` and covered by table-driven tests, including the exact combined-message assertion (`open interest 190 is below 500; bid/ask width $1.70 exceeds $0.10`).

## CSP card metrics displayed

Collapsed disqualified card (new): Δ, POP, OTM %, Bid/Ask, Credit/share, Premium/contract, OI (highlighted when below OI_MIN), Cash required, Breakeven, ROC, plus the OI warning line when applicable. Qualified card (pre-existing from TE-0007A, unmodified): the same fundamentals plus IVR, checklist rows, and the "CSP — Wheel Entry" expanded panel (Required cash, Breakeven, ROC period/annualized). Single-leg presentation (`Put {strike}`, single OI number) verified — the OI display row is now CSP-specific (single number) rather than reusing the two-leg `short/long` pair.

## Wheel compatibility

`lib/wheel/chainSearch.ts` — **0 lines changed**. `lib/scans/covered-call-finder.ts` still calls `findBestWheelContract()` exactly as before; its 23-test suite passes unmodified. CSP now has its own independent exhaustive search, so no shared-function behavior change exists to audit beyond "this file was never touched."

## Focused tests

| File | Tests | Result |
|---|---:|---|
| `lib/scans/__tests__/cspSearch.test.ts` (Layer 1, table-driven) | 17 | ✓ pass |
| `lib/scans/__tests__/csp-finder.test.ts` (Layer 2, AMD fixture) | 6 | ✓ pass |
| `app/screener/__tests__/CspCandidateDiscovery.test.tsx` (Layer 2 session wiring + Layer 3 presentation) | 4 | ✓ pass |
| **New tests total** | **27** | **✓ all pass** |

Layer 4 regression (targeted): `app/screener` + `lib/scans` + `lib/screener` — **16 test files, 266 tests, all pass** (includes `ScreenerSessionWiring.test.tsx`, `UnifiedStrategyLauncher.test.tsx`, `CcCapacityGate.test.tsx`, `covered-call-finder.test.ts`, `covered-call-capacity.test.ts`, `scanSession.test.ts`, `screenerResultOrdering.test.ts`, `opportunityUniverse.test.ts`, and the new CSP files above).

## Final full-suite result

Run in time-bounded chunks (sandbox per-command limit), summed:

- `app/screener` + `lib/scans` + `lib/screener`: 16 files / 266 tests
- `lib` (excl. `lib/scans`, `lib/screener`): 74 files / 1232 tests
- `app` (excl. `app/screener`): 3 files / 46 tests
- `features` + `components`: 35 files / 304 tests

**All chunks: 0 failures.** (A small number of files match more than one glob across chunks — e.g. `features/screener/lib/__tests__/*` — so the raw sum overstates unique test count by roughly 8 tests; every chunk independently reported 100% pass, which is what matters for release confidence.)

## Final build result

`npx tsc --noEmit`: clean. `git diff --check`: clean. `npx next build`: **succeeded** — `/screener` route: 70.5 kB (+0.6 kB from the new diagnostics/presentation code), no errors or warnings introduced.

## Remaining liquidity-threshold policy decision

Not decided by this ticket, per its own scope boundary ("a new liquidity threshold" is explicitly out of scope). Every candidate now carries `cspBidAskWidth` (dollars) and `cspBidAskWidthPct` (percent of mid) so a future product decision — absolute vs. percentage-of-mid vs. tiered-by-premium vs. broker liquidity data — can be made without another discovery-layer change. See the ticket doc's "Open-interest and bid/ask policy" section for the concrete AMD numbers illustrating why the current $0.10 absolute threshold scales poorly for higher-premium CSPs.

---

## Corrective pass (post-review, before merge)

Branch unchanged: `fix/csp-candidate-discovery-correctness`. Original commit `7d85932` was later rebased onto the updated `main` (which by then included `SCREENER-LAUNCHER-0001` corrective `9209230`) with zero conflicts, landing at `fd712ea` — same content, new parent. This corrective pass adds one further commit on top of `fd712ea`. Everything above this line describes the original, directionally-approved implementation exactly as it shipped; nothing above was rewritten. This section documents what changed and why.

### BLOCKER — candidate selection now matches the actual qualification policy

**The bug:** `searchCspCandidates()`'s selection tier required a candidate to pass BOTH `oiPassing` AND `bidAskPassing` to be preferred (the old `ELIGIBLE` status), while `findBestCsp()` qualifies a candidate on bid/ask width and capital alone — OI is advisory only. The two policies disagreed. A narrow-market, low-OI candidate that `findBestCsp()` WOULD qualify (with a warning) could lose the selection to a closer-delta, wide-market, sufficient-OI candidate that `findBestCsp()` would NOT qualify — hiding the genuinely tradeable contract behind one the policy actually rejects.

**The fix:** the selection pool in `searchCspCandidates()` is now every candidate that passes `bidAskPassing` alone (`FULLY_QUALIFIED` or `QUALIFIED_LOW_OI` — see rename below), matching `findBestCsp()`'s real rule exactly. Only when no candidate passes bid/ask width does the pool fall back to every structurally valid candidate, for audit display. Within the hard-qualified tier, ranking now also prefers OI-passing candidates as a tie-break (when delta distance and bid/ask width are otherwise equal) before falling back to raw OI value — added to `rankCandidates()` in `lib/scans/cspSearch.ts`.

**Regression scenario, exact result:** Candidate A (strike 415, delta 0.20 — dead center, OI 1000, bid/ask $10.20/$11.90 — width $1.70, over the $0.10 max) vs. Candidate B (strike 410, delta 0.15 — off-center, OI 190 — under the 500 minimum, bid/ask $8.95/$9.05 — width $0.10, within the max). `searchCspCandidates()` now selects Candidate B with status `QUALIFIED_LOW_OI`; `findBestCsp()` reports it `qualified: true` with `cspOiWarning: 'OI 190 is below the preferred minimum of 500.'` and `disqualificationReason: null`. Candidate A is never selected. Covered by `lib/scans/__tests__/cspSearch.test.ts` ("a narrow-market, low-OI candidate is selected...") and `lib/scans/__tests__/csp-finder.test.ts` ("selects the narrow-market, low-OI candidate as QUALIFIED...").

**Renames** (status values only — no other public API shape changed): `ELIGIBLE` → `FULLY_QUALIFIED`, `LOW_OPEN_INTEREST` → `QUALIFIED_LOW_OI`, `BID_ASK_TOO_WIDE` → `DISQUALIFIED_WIDE_MARKET`, `LOW_OI_AND_WIDE_MARKET` → `DISQUALIFIED_WIDE_MARKET_LOW_OI`. The unused `INVALID_QUOTE` status (never actually assigned to any candidate object — structurally invalid legs are excluded before a status is computed) was removed from the type. Every comment, module header, and the original ticket doc (`docs/tickets/CSP-0002-candidate-discovery-correctness.md`) were updated to match — none now describe low OI as a hard eligibility failure.

### IMPORTANT — midpoint is validated or safely derived

**The bug:** `toValidCandidate()` accepted any finite, non-negative supplied `mid` outright, even if it fell outside `[bid, ask]`. A stale/malformed mid would silently distort credit, premium, breakeven, ROC, `bidAskWidthPct`, and candidate ranking.

**The fix:** new `deriveUsableMid(bid, ask, suppliedMid)` in `lib/scans/cspSearch.ts` — a supplied mid is used only when `bid <= mid <= ask`; otherwise the canonical `(bid + ask) / 2` is derived. One rule, applied once, at the point of discovery — nothing downstream re-derives or second-guesses it. The exact mid used is now also carried onto the final `SpreadCandidate` as `cspMid` (new field, `lib/scans/types.ts`), so presentation code displays the mid actually used in the math rather than recomputing `(bid+ask)/2` independently and risking drift.

**Tests** (`lib/scans/__tests__/cspSearch.test.ts`): mid below bid → canonical derived; mid above ask → canonical derived; missing mid → canonical derived; valid mid within range → used as supplied; bid equal to ask (locked market) → handled safely, mid equals that price, width is exactly 0. A layer-2 test in `lib/scans/__tests__/csp-finder.test.ts` confirms `candidate.cspMid`, `credit`, and `breakeven` all derive from the canonical mid when the chain supplies a nonsense mid ($99 on a ~$10.30 market).

### IMPORTANT — every candidate-specific diagnostic states real values

`describeCspSearchOutcome()` and `csp-finder.ts`'s `oiWarning` now read, verbatim:

- Low OI only: `OI 190 is below the preferred minimum of 500.`
- Wide market only: `Put found in the requested DTE and delta range, but its bid/ask spread exceeded the configured maximum: Bid/ask width $1.70 exceeds the maximum of $0.10.`
- Combined: `Put found in the requested DTE and delta range, but it did not meet liquidity requirements: OI 190 is below the preferred minimum of 500; Bid/ask width $1.70 exceeds the maximum of $0.10.`
- Insufficient cash (unchanged, already value-bearing): `Insufficient cash — requires $41,500, $10,000 available. Margin is not used by default.`

No generic "below configured minimum" / "market too wide" text remains anywhere a candidate exists. Covered by updated assertions in both `cspSearch.test.ts` and `csp-finder.test.ts`.

### Complete the CSP metric presentation

**The gap:** the qualified `ResultCard` path (`app/screener/page.tsx`) only ever showed Bid/Ask/Cash-required/Breakeven inside its EXPANDED "CSP — Wheel Entry" panel — a viewer had to click to expand. The disqualified audit card (`DisqualifiedSection.tsx`) already showed its fundamentals unconditionally; the two paths were not at parity, contrary to the ticket's original "qualified and disqualified CSP cards show the same fundamentals" claim, which only held once a card was expanded.

**The fix:** extracted the fundamentals row into one shared component, `features/screener/components/CspFundamentalsRow.tsx`, used by both `DisqualifiedSection.tsx` (unchanged behavior, now sourced from the shared component) and `app/screener/page.tsx`'s `ResultCard` (new — rendered unconditionally for CSP results, not gated by `expanded`). The shared row now also adds a clearly labeled "Mid" (sourced from `candidate.cspMid`, never recomputed) and "Ann. ROC" to both cards, closing the last gap against the ticket's required field list. Two-leg values (long strike, long-leg OI, spread width) are structurally impossible to render here — the component only ever reads single-leg CSP fields and returns `null` for any non-CSP strategy.

**Tests:** `app/screener/__tests__/CspCandidateDiscovery.test.tsx` gained one new test proving the qualified card shows Bid, Ask, a labeled Mid, Cash required, Credit/share, and Breakeven **without expanding** (`csp-qualified-fundamentals` testid, queried immediately after the scan completes, no click). The pre-existing expanded-state test and the "no two-leg values" / "single OI number" tests were left as-is and continue to pass unmodified.

### Explicitly not touched (per scope)

The $0.10 `BID_ASK_MAX` threshold itself; `lib/wheel/chainSearch.ts`'s `findBestWheelContract()` (0 lines changed, reconfirmed); `lib/scans/covered-call-finder.ts` and its 23-test suite (unmodified, passes as part of the full-suite run below); scoring formulas; `lib/screener/scanSession.ts` accounting; `LauncherButton.tsx` / launcher running/selected-state behavior (rebased in, not re-touched — `runningLauncher` derivation and all four `isRunning={...}` call sites confirmed present verbatim post-rebase); live order execution (CSP still has no `longOccSymbol`, still no Trade button); capital-blocked/required-cash policy (unchanged formula, unchanged gating, only the OI-warning message text changed).

### Validation

| Scope | Files | Tests | Result |
|---|---:|---:|---|
| `lib/scans/__tests__/cspSearch.test.ts` (Layer 1, table-driven) | 1 | 24 | ✓ pass (7 new: blocker regression ×2, midpoint ×5) |
| `lib/scans/__tests__/csp-finder.test.ts` (Layer 2, AMD fixture) | 1 | 8 | ✓ pass (2 new: blocker regression, canonical-mid) |
| `app/screener/__tests__/CspCandidateDiscovery.test.tsx` (Layer 2 wiring + Layer 3 presentation) | 1 | 5 | ✓ pass (1 new: qualified-card-without-expanding) |
| `features/screener/components/__tests__/DisqualifiedSection.test.tsx` | 1 | 8 | ✓ pass (unchanged, confirms shared-component extraction is behavior-preserving) |
| Targeted regression (`app/screener` + `lib/scans` + `lib/screener`) | 17 | 286 | ✓ pass |
| `npx tsc --noEmit` | — | — | ✓ clean |
| `git diff --check` | — | — | ✓ clean |
| `npx next build` | — | — | ✓ succeeded, `/screener` route 70.5 kB (no regression) |
| Full suite, `lib` | 81 | 1431 | ✓ pass |
| Full suite, `app` | 13 | 133 | ✓ pass |
| Full suite, `features` + `components` | 35 | 304 | ✓ pass |

All chunks: 0 failures. (Run once, in full, per the ticket's explicit "do not repeatedly rerun it during each small edit" instruction — chunked only because of the sandbox's per-command time limit, not because any chunk was rerun.)

### Remaining policy decisions

Unchanged from the original implementation: the $0.10 absolute bid/ask threshold vs. a percentage-of-mid or tiered alternative is still an open product decision, not made by this ticket or this corrective pass (`cspBidAskWidth` and `cspBidAskWidthPct` remain available on every candidate for that future decision). No new open decisions were introduced by this corrective pass.
