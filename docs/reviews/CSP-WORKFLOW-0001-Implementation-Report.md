# CSP-WORKFLOW-0001 — Implementation Report

## Scope disclosure (set at the start of this pass, honored throughout)

This ticket specified a multi-week feature: a new scoring engine, a full
CSP configuration modal with focus-trap accessibility, Rank/Targeted CSP
modes, a session schema bump, roughly 40 fixtures, and live browser
verification. In this pass I implemented and tested the architectural
core — candidate identity, multi-candidate discovery, the market-
qualification/account-eligibility state model, session/schema wiring,
Best Opportunities/CSV-key fixes, and the CSP scoring module — because
that is where every BLOCKER-level defect from the audit lived. I did not
build the CSP configuration modal, Rank/Targeted CSP modes, or perform
live-browser verification. Those are reported below as deferred, not
claimed as done.

## Branch and commits

Base: `1ea2344` (docs commit, itself on `fix/csp-candidate-discovery-
correctness` @ `c0ead1e`).
Branch: `feature/csp-canonical-multicandidate-workflow`. Not pushed, not
merged.

| Commit | Scope |
|---|---|
| `c6be153` | Candidate identity (`lib/scans/candidateIdentity.ts`) + canonical multi-candidate `cspSearch.ts` rewrite (`candidates: CspRawCandidate[]`, relative liquidity classification, `bidAskPassing`-first tier ranking fix) |
| `b8d360c` | `lib/scans/cspQualification.ts` (market-qualification / account-eligibility / liquidity-class types + classifiers) + `csp-finder.ts` rewrite (`findAllCsp()`) |
| `f4ee4b9` | Session wiring: `runCspChecklist()` returns `ScreenResult[]`; Best Opportunities join by `expiration+shortStrike`/`candidateId`; React-key fallback fixes in `DisqualifiedSection`/filtered results; Best-Opportunities exclusion of `QUALIFIED_WITH_LIQUIDITY_WARNING` |
| `32f002a` | `lib/scans/cspScore.ts` (6-dimension CSP scoring module) wired into `runCspChecklist()`; `cspScore` field on `SpreadCandidate` |
| `64af8e6` | Session schema v3 → v4 bump, documented fail-closed invalidation |
| `ca54b38` | Required identity + capital acceptance fixtures (`candidateIdentity.test.ts`, `csp-finder-multicandidate.test.ts`) |

Untracked files present before this pass (`docs/handoffs/TradeEdge-
Current-State-2026-08-06.md`, `docs/reviews/portfolio-position-metrics-
audit.md`, `scanSession_model_v2.sh` through `_v5.sh`) were left untouched
and are not part of any commit above.

## Final architecture

**Candidate identity** (`lib/scans/candidateIdentity.ts`): `buildCandidateId()`
returns `occ:${occSymbol}` when the symbol passes structural validation
(`isValidOccSymbol` — non-empty, ≥6 chars, free of `undefined`/`NaN`/`null`
markers and repeated separators), else a deterministic composite
`composite:${strategy}:${underlying}:${expiration}:${P|C}:${strike}`. Used
for `candidateId` on every `ScreenResult`/`SpreadCandidate`, React keys
(`DisqualifiedSection`, filtered-results rendering), and the Best
Opportunities join.

**Multi-candidate discovery** (`lib/scans/cspSearch.ts`): `searchCspCandidates()`
returns every structurally valid put in the DTE/delta window as
`candidates: CspRawCandidate[]`, ranked (not filtered down) by
bid/ask-passing status first, then delta-distance-from-center, then width,
then OI. `findAllCsp()` (`lib/scans/csp-finder.ts`) maps every one of those
into its own `CspCandidateResult` — nothing is reduced to "the best one."
`findBestCsp()` remains as a deprecated single-candidate wrapper for any
caller not yet migrated.

**Qualification/account state model** (`lib/scans/cspQualification.ts`):
`CspMarketQualification` (`QUALIFIED`, `QUALIFIED_WITH_LIQUIDITY_WARNING`,
`DISQUALIFIED_INVALID_QUOTE`, `DISQUALIFIED_POOR_LIQUIDITY`,
`DISQUALIFIED_IVR`, `DISQUALIFIED_EARNINGS`) and `CspAccountEligibility`
(`ELIGIBLE`, `INSUFFICIENT_CAPITAL`, `CAPITAL_UNVERIFIED`,
`ACCOUNT_UNSELECTED`, `STRATEGY_NOT_PERMITTED`) are independent axes,
computed by independent functions (`marketQualificationFor()` in
`csp-finder.ts`; `classifyAccountEligibility()` in `cspQualification.ts`).
Neither reads the other. `isBestOpportunitiesEligible()` requires strict
`QUALIFIED` (not the warning tier) AND `ELIGIBLE`.

**Liquidity policy**: `classifyCspLiquidity(widthDollars, midpoint)` —
`strongLimit = max($0.10, 10% of midpoint)`, `poorLimit = max(strongLimit,
15% of midpoint)`. Width ≤ strongLimit → STRONG; ≤ poorLimit → BORDERLINE
(market-qualified with a warning, excluded from Best Opportunities by
default); above → POOR (market-disqualified, still visible for audit).
CSP-0002's safe-midpoint derivation (`deriveUsableMid`) is unchanged and
still feeds every credit/breakeven/ROC calculation.

**Capital/account correctness** (`computeAvailableCspCapital()` in
`csp-finder.ts`): available CSP capital = `min(optionBuyingPower,
cashBalance)` for the selected account only; any missing/non-finite/
negative figure, or no account selected, produces `CAPITAL_UNVERIFIED` /
`ACCOUNT_UNSELECTED` — never a fallback constant, never treated as
unlimited. Required cash = `strike × 100 × contracts`, evaluated
independently for every discovered candidate (not only a preselected
one). **Deferred:** the config-modal UI for explicit account selection was
not built in this pass — `findAllCsp()`'s `capital` parameter is ready to
receive a real selected-account identifier once that UI exists, but
`app/screener/page.tsx`'s current CSP call site still passes the legacy
`availableCash` single-value path (see "Remaining work" below).

**CSP scoring** (`lib/scans/cspScore.ts`, version `csp-score-v1`): six
weighted 0-100 subscores — downside/entry cushion (POP 10 + OTM% 10 of
20), premium efficiency (period ROC 10 + annualized ROC 15 of 25),
liquidity quality (width/class 15 + OI 5 of 20), underlying technical (15,
fails closed/null when `trendResult.scores.total` is unavailable — never a
fabricated neutral 50), volatility context (IVR, 10), event risk (10;
`true`/`false`/`null` distinguishes known-earnings / no-known-earnings /
truly-unknown). Missing components are excluded from the weighted sum and
renormalized over available weight, not treated as zero — a documented
product-policy choice flagged for review, not asserted as the only correct
one. Wired into `runCspChecklist()`: each candidate's own strike/OI/ROC/
liquidity/OTM% and the shared IVR/technical/per-candidate-earnings context
produce an independent `cspScore` per contract (two contracts on the same
ticker score differently).

**Session/schema**: `ScreenerScanSession.results` was already a flat
`ScreenResult[]` (not nested per symbol); `recordSymbolEvaluated(session,
symbol, results[])` already accepted an array and needed no change.
`ScreenResult.candidateId` (added) mirrors `bestCandidate.candidateId`.
`SCHEMA_VERSION` bumped 3 → 4; `validateSessionData()`'s existing
`UNKNOWN_SCHEMA_VERSION` check makes this bump alone sufficient to fail-
closed-invalidate every previously cached session (accepted, documented,
one-time cost — including spreads/cc/pmcc sessions whose own shape didn't
change). `rawScanCache` (IndexedDB) was audited and confirmed to hold only
per-symbol+strategy chain data (`RawScanEntry`), never per-contract data —
its two `symbol+strategy` lookup call sites in `page.tsx` are correct as
written and do not deduplicate CSP candidates. **Deferred:** a dedicated
`ruleSnapshot` session field (the immutable CSP rule/config snapshot) was
not added — it depends on the config-modal work below.

**Best Opportunities / React keys / CSV**: `buildBestOpportunityRows()`
now joins on `expiration+shortStrike` (parsed from both the ScreenResult's
own `bestCandidate` and the Autopilot recommendation's `candidateId`
format) instead of the old silent `symbol+strategy` overwrite, and carries
a `resultKey` distinct from the Autopilot-facing id. `DisqualifiedSection`
and the filtered-results render block use `candidateId ?? \`${symbol}-
${strategy}\`` as the React key. Best Opportunities excludes
`QUALIFIED_WITH_LIQUIDITY_WARNING` results (borderline liquidity) even
though they remain visible in the ordinary qualified-results list.
**Deferred:** CSV export was not rewritten to a per-candidateId CSP-
specific schema in this pass (see "Remaining work").

## NKE / AMD regression evidence

**NKE** (`lib/scans/__tests__/csp-finder-multicandidate.test.ts`): the
exact 39-strike put (Δ0.24, bid $0.66/ask $0.73, OI 78) and 38-strike put
(Δ0.17, bid $0.44/ask $0.50, OI 628) both survive `findAllCsp()` as two
`CspCandidateResult`s with distinct `candidateId`s (`occ:NKE_39P_OCC`,
`occ:NKE_38P_OCC`), each independently scored (different credit/POP), the
39 put carrying its own low-OI advisory warning and the 38 put carrying
none. Also proven at the session-wiring layer in
`app/screener/__tests__/CspCandidateDiscovery.test.tsx`'s existing NKE
describe block: both reach the recommendation POST as two distinct
`screenResults` entries, strikes `[38, 39]`, `candidateCount` reconciles
to 2.

**AMD** (`lib/scans/__tests__/csp-finder.test.ts`,
`CspCandidateDiscovery.test.tsx`): all five strikes (410/415/420/425/430)
remain discoverable; under the relative liquidity policy, 420/425/430
classify BORDERLINE (not uniformly POOR, as the old flat-$0.10 rule would
have produced) — `spreadPassingCandidates` is 3, up from the old
expectation of 0, a deliberate, approved behavior change documented in
both the audit (§8) and the updated test. `accountingText()` shows "3
qualified"; the disqualified section shows "Disqualified (2)" and expands
to reveal 2 distinct fundamentals rows; the Autopilot recommendation POST
still excludes AMD per its own eligibility rules. Candidate-count
reconciliation holds throughout (`sessionResultsReconcile()`).

## Capital/account behavior evidence

`lib/scans/__tests__/csp-finder-multicandidate.test.ts` "required capital
fixtures": a closer-delta-but-unaffordable contract and a farther-but-
affordable contract both remain visible with `marketQualification:
QUALIFIED` on both — account state never touches market qualification;
only the affordable one is `ELIGIBLE`. A capital-lookup failure (null
buying power) produces `CAPITAL_UNVERIFIED` with `cspAvailableCapital:
null` — never a $100,000 or any other fallback. No account selected
produces the distinct `ACCOUNT_UNSELECTED` state even when raw capital
numbers are present. Available capital is proven to be exactly
`min(optionBuyingPower, cashBalance)`. `contracts: 3` scales
`requiredCash`/`credit` correctly without corrupting per-share math. A
negative buying-power figure is treated as unverified, not as valid-but-
tiny capital.

**Not covered** (deferred, since it depends on undelivered UI): "multiple
accounts returned in different API orders cannot change the chosen
account" is a config-modal-level guarantee that has no code to test yet —
`findAllCsp()`'s `capital.accountId` field exists and is threaded through,
but nothing in this pass populates it from a real multi-account API
response or UI selection.

## Filter / Rank / Targeted behavior

**Filter**: fully migrated — `runCspChecklist()` returns one `ScreenResult`
per candidate, all recorded via `recordSymbolEvaluated()`, all shown
truthfully (qualified, warned, disqualified, capital-blocked) in the
existing results presentation.

**Rank / Targeted for CSP: NOT implemented.** `lib/screener/scanSession.ts`'s
`STRATEGY_ALLOWED_MODES` still restricts `csp` to `filter` only — this
ticket's mode-compatibility change was not made. Building Rank/Targeted
CSP requires the not-yet-built CSP configuration modal (targeted mode
needs deliberate DTE/delta/POP/OTM/OI inputs) and was out of scope for
this pass given the time available. Spreads' Filter/Rank/Targeted and CC/
PMCC's Filter-only behavior are unchanged.

## Cache/schema result

`SCHEMA_VERSION` 3 → 4. `validateSessionData()` rejects any mismatch,
producing a one-time, whole-repo cache invalidation (including CC/PMCC/
spreads sessions) rather than a partial migration — accepted per the
ticket. Two session-fixture tests updated (`AccountingSummaryBar.test.tsx`,
`SymbolOutcomesDisclosure.test.tsx`, `schemaVersion: 3 → 4`).
`ruleSnapshot` field NOT added (deferred, tied to the modal).

## Validation

- `tsc --noEmit`: clean after every scope, and again at the end.
- Focused suites run after each scope (`lib/scans`, `app/screener`,
  `lib/screener`, `features/screener`) — all green throughout.
- Full repository suite run once, split across several `vitest run`
  invocations by directory (the sandbox's shell tool hard-caps any single
  command at ~178s, and one detached-background attempt confirmed
  background processes do not survive between tool calls in this
  environment — so a single unsplit `vitest run` across ~1,970 tests was
  not possible in one invocation). Reconciled totals, all passing:

  | Batch | Files | Tests |
  |---|---|---|
  | `lib/scans` | 7 | 130 |
  | `lib/screener` | 3 | 105 |
  | `features/screener` | 8 | 41 |
  | `app/screener` | 10 | 88 |
  | `lib/autopilot`, `lib/opportunity-engine`, `lib/command-center`, `lib/recommendations`, `lib/decision-engine`, `lib/decision-review`, `lib/review-conductor` | 16 | 236 |
  | `lib/portfolio*`, `lib/position*`, `lib/priorityScore` | 33 | 624 |
  | `lib/mission-control`, `lib/dailyBriefing`, `lib/morning-briefing`, `lib/help`, `lib/tradeLog`, `lib/trader-commitments`, `lib/revalidation` | 7 | 146 |
  | `components/**` | 19 | 168 |
  | `features/portfolio`, `app/api/paper-trading`, `app/help`, `app/portfolio`, `lib/paper-trading`, `lib/todays-priorities-queue`, `lib/todaysPriorities`, `lib/__tests__` | 37 | 435 |
  | **Total** | **140** | **1,973** |

  Zero failures across the full run. (Sandbox-only "network disabled in
  test" and IndexedDB-unavailable warnings appeared in stderr on several
  unrelated pre-existing tests — non-blocking, expected in this jsdom
  environment, not a regression.)
- Production build (`npm run build`): succeeded, all routes compiled,
  including `/screener`.
- **Real desktop/mobile browser verification: NOT performed.** No browser
  automation was available in this pass; this is disclosed as deferred,
  not claimed as done.

## Deviations from the ticket

- Rank/Targeted CSP modes: not implemented (see above).
- CSP configuration modal, immutable rule snapshot, "Active CSP Rules"
  display, Spread-only-control removal during CSP sessions: not
  implemented.
- DTE/expiration grouping UI, accessible expand/collapse for the new
  multi-candidate presentation, live-region scan announcements specific to
  this ticket: not implemented (the pre-existing
  `SCREENER-UX-0001`-era results presentation and its own accessibility
  work are unchanged and still function for CSP's now-multi-candidate
  results, but the ticket's CSP-specific DTE-grouping/collapse
  requirements were not built).
- CSV per-candidateId CSP schema rewrite: not implemented — CSV export
  still uses the pre-existing schema.
- Multi-account selection UI and its "different API orders can't change
  the chosen account" guarantee: not implemented (no modal exists to
  select an account from).
- Real browser/mobile verification: not performed.

## Remaining work (for a follow-up pass)

1. CSP configuration modal (dialog/focus-trap/Escape/radio-group a11y,
   presets, DTE/delta/OI/POP/OTM/ROC inputs, earnings handling, account
   selector) — this unblocks the immutable rule snapshot, Rank/Targeted
   CSP modes, and the multi-account capital guarantees above.
2. Wire the modal's account selection into `findAllCsp()`'s `capital`
   parameter at the `page.tsx` call site (currently still passing the
   legacy `availableCash` path).
3. `ruleSnapshot` session field + schema follow-up bump if its shape
   changes after the modal is built.
4. CSV per-candidateId CSP schema.
5. DTE/expiration grouping UI, CSP-specific accessible disclosure/live-
   region work.
6. Real desktop/mobile browser verification.

## Unresolved blockers

None encountered in the scope actually implemented. All committed work is
tsc-clean, fully test-covered, and does not regress any existing suite.

---

## Core-correction pass (BLOCKER-01 through BLOCKER-06)

A follow-up review found six BLOCKER-level defects still present in the
production path despite the architecture above being built: market
qualification was still conflated with account eligibility in
`runCspChecklist()`; the production CSP call still passed the deprecated,
single-number `availableCash` and implicitly assumed an account was
selected; `cspScore` was computed but never actually used for display,
sorting, or Best Opportunities ranking; Best Opportunities still parsed a
separately-formatted recommendation ID and fell back to symbol/strategy,
which collides across multiple CSP contracts on one symbol; the required
AMD acceptance fixture was five strikes instead of six; and schema v4
shipped without the rule-snapshot field the original ticket called for.
This section reports the correction of all six, on the same branch, not
pushed or merged. **No modal/Rank/Targeted/DTE-grouping/mobile work was
started in this pass** — those remain exactly as deferred above.

### Commits (this pass, in order)

| Commit | Blocker |
|---|---|
| `d9314dd` | BLOCKER-01 — stop conflating market qualification with account eligibility |
| `e425477` | BLOCKER-02 — wire real selected-account capital into the production CSP path |
| `714c329` | BLOCKER-03 — make cspScore authoritative |
| `9aa44e2` | BLOCKER-04 — propagate canonical candidateId end to end |
| `17da613` | BLOCKER-05 — complete the AMD fixture to six strikes |
| `c788810` | BLOCKER-06 — canonical CSP rule-snapshot type |
| `948646a` | test fix — pre-existing duplicate-React-key fixture exposed by BLOCKER-04's key change (not a blocker itself) |

### BLOCKER-01 — market qualification vs. account eligibility

`runCspChecklist()`'s per-candidate `qualified` is now `isMarketQualified(r.marketQualification)`
alone (`lib/scans/cspQualification.ts`) — market-qualified-but-account-
ineligible contracts (insufficient capital, capital unverified, no
account selected) stay in the qualified result set with a clear
account-status label (amber, not red, in the collapsed row), never
mislabeled as market-disqualified. Best Opportunities eligibility is the
strict AND: `isBestOpportunitiesEligible()` requires `QUALIFIED` (not the
`QUALIFIED_WITH_LIQUIDITY_WARNING` tier) **and** `ELIGIBLE` account state.
Scan accounting now distinguishes `qualifiedCandidateCount` (market-
qualified) from `accountActionableCount` (also affordable/verified),
surfaced in both `formatSessionAccountingSummary()` and
`AccountingSummaryBar` whenever the two diverge.

### BLOCKER-02 — production capital wiring

Exact path: `runCspScan()` → (no manual override) → `getCspCapitalContext(token)`
(`lib/scans/tastytrade-client.ts`) → `CspCapitalContext { accountSelected,
accountId, optionBuyingPower, cashBalance }` → `runCspChecklist(..., capital, ...)`
→ `findAllCsp(chainData, price, { rules, contracts: 1, capital })`.
`getCspCapitalContext()` resolves an account **only** when the Tastytrade
customer has exactly one account (zero or multiple accounts fail closed
to `ACCOUNT_UNSELECTED`/`CAPITAL_UNVERIFIED` — never a guessed
`accounts[0]`). Capital verification uses `min(optionBuyingPower,
cashBalance)`; either missing/invalid → `CAPITAL_UNVERIFIED`. A manual
cash override remains an explicit trader assertion (`accountId:
'manual-override'`), preserving prior always-wins behavior. The
deprecated `getAvailableCash()` single-number path is no longer called by
production CSP code (kept only for unchanged legacy callers/tests).

### BLOCKER-03 — cspScore authoritative

`lib/scans/cspScore.ts`'s missing-data policy was reversed: all 9
components are now required — any single missing dimension makes the
**whole** score `scoreStatus: 'UNAVAILABLE'`, `total: null` (never a
renormalized partial number, never a fabricated 0). Proof of authority:
`app/screener/page.tsx`'s two Filter-mode result sorts now sort CSP
results by `cspScore.total` (available-first, highest-first; UNAVAILABLE
sorts last, never as if it scored 0); `features/screener/lib/
bestOpportunityRows.ts` sets a CSP row's `opportunityScore` from
`cspScore.total` (rounded to a whole number) instead of the generic
engine's `opportunityScoreTotal`, excludes CSP candidates whose score is
UNAVAILABLE from the Best Opportunities list entirely, and re-ranks the
CSP subset by this score (non-CSP rows keep their original order —
stable sort); `CspFundamentalsRow.tsx` displays the rounded score with
per-dimension components inspectable via tooltip, or "Score unavailable"
with the missing-input list. The generic Decision Engine score remains
unchanged and in use for every non-CSP strategy.

### BLOCKER-04 — canonical candidateId propagation

Path, every hop a straight pass-through, never re-derived: `ScreenResult.
candidateId` → `screenResultsToAutopilotCandidates()` sets
`AutopilotCandidate.screenerCandidateId` (new, additive field) →
`decisionAnalysisToOpportunityCandidate()` reads it off the retained
`DecisionAnalysis.candidate` → `evaluateOpportunityCandidate()` copies it
onto `OpportunityRecommendation.screenerCandidateId` → `bestOpportunityRows.ts`
joins directly on this id (a `Map` keyed by `ScreenResult.candidateId`)
instead of parsing `rec.candidateId`'s internal `screen_...` format →
`BestOpportunitiesShortlist`'s React key uses `row.resultKey` (the
canonical id) → both CSV export paths (`page.tsx`'s `downloadCSV`, `/api/
csv/route.ts`) gained a "Candidate ID" column. A CSP recommendation with
no resolvable canonical id now fails closed (row dropped, console
diagnostic) rather than falling back to symbol+strategy, which would
collide across multiple contracts on one symbol. Non-CSP strategies (not
yet multi-candidate per ScreenResult) keep an unchanged symbol+strategy
fallback. **Deviation, documented, not fixed in this pass**: the ticket
also asked for `candidateIdentity.ts`'s permissive `isValidOccSymbol`
(length ≥ 6) to be replaced by the strict canonical OCC parser (`lib/
optionSymbol.ts`). Not done — the permissive validator is deliberately
structural because the codebase's own CSP test/mock chain fixtures use a
synthetic `${symbol}_${exp}_P${strike}_${i}` shape that the strict
`OCC_SYMBOL_RE` would never match; swapping it would flip a large number
of currently-passing identity/AMD-fixture tests to the composite fallback
and risks conflicting with BLOCKER-05's "do not modify the fixture"
instruction. The propagation defect the ticket actually describes (no
recommendation-ID parsing, no symbol/strategy fallback for CSP) is fully
closed by the `screenerCandidateId` join, which eliminates that parsing
rather than swapping which parser performs it. **Superseded below** — the
OCC-parser strictness question this deviation flagged for review has since
been resolved; see "Final candidate-identity correction" at the end of
this section.

### BLOCKER-05 — six-strike AMD result

Added 405 (delta −0.16, OI 245, bid $6.90, ask $7.60 — real values, not
adjusted to force a classification) to the shared AMD fixture in both
`lib/scans/__tests__/csp-finder.test.ts` and `app/screener/__tests__/
CspCandidateDiscovery.test.tsx`. Under the approved relative-liquidity
policy, 405 lands STRONG (fully market-qualified), 420/425/430 BORDERLINE,
410/415 POOR — all three tiers now represented. The multi-candidate
acceptance test proves all six structurally valid candidates survive as
independent results, `4 qualified + 2 disqualified = 6` reconciles
exactly, and Best Opportunities eligibility is evaluated per candidate
(405, the one STRONG-liquidity contract, is the sole AMD candidate that
reaches the recommendation request; 420/425/430 BORDERLINE and 410/415
POOR are correctly excluded).

### BLOCKER-06 — rule-snapshot schema disposition

`SCHEMA_VERSION` bumped 4 → 5 (documented, same fail-closed full-cache-
invalidation pattern as every prior bump). New `lib/scans/
cspRuleSnapshot.ts`: canonical `CspRuleSnapshot` type, `buildCspRuleSnapshot()`
(maps every `DEFAULT_CSP_RULES` field; `source: 'default'` today, `'user'`
reserved for the future configuration modal — same type, no further schema
bump needed), `isValidCspRuleSnapshot()` structural validator.
`ScreenerScanSession.ruleSnapshot: CspRuleSnapshot | null` — populated on
every new CSP session (`runCspScan()`'s `beginScanSession()` call passes
`buildCspRuleSnapshot(DEFAULT_CSP_RULES)`), `null` for every other
strategy. `validateSessionData()` fails closed (`INVALID_RULE_SNAPSHOT`)
on a structurally malformed snapshot or a non-CSP session that
unexpectedly carries one; it does **not** require a CSP session to have a
non-null snapshot, a deliberate minimal/backward-compatible choice so the
many existing CSP session test fixtures built before this field existed
keep validating. No historical snapshot is ever fabricated for an old
cache — an old-schema session already fails `UNKNOWN_SCHEMA_VERSION` and
is discarded before any code path would need to backfill one. Render is
unchanged, per the ticket's "render need not be redesigned in this pass."

### Working-tree hygiene

`tsconfig.tsbuildinfo` restored (checked out, discarding the tsc-run
artifact diff) before every commit in this pass. The pre-existing
untracked files (`docs/handoffs/TradeEdge-Current-State-2026-08-06.md`,
`docs/reviews/portfolio-position-metrics-audit.md`,
`scanSession_model_v2.sh` through `_v5.sh`) were never touched.

### Focused validation (this pass only — full suite/build intentionally NOT run, per instruction)

- `tsc --noEmit`: clean after every commit.
- `git diff --check`: clean (no whitespace errors).
- Candidate identity: `candidateIdentity.test.ts` 16/16.
- CSP scoring: `cspScore.test.ts` 12/12.
- CSP finder / multi-candidate: `cspSearch.test.ts`, `csp-finder.test.ts`
  8/8, `cspQualification.test.ts` 14/14, `getCspCapitalContext.test.ts`
  7/7, `screenerCandidateAdapter.test.ts` 4/4.
- Session/cache: `scanSession.test.ts` 67/67, `cspRuleSnapshot.test.ts`
  9/9.
- Best Opportunities: `bestOpportunityRows.test.tsx` 20/20,
  `BestOpportunitiesShortlist.test.tsx` 6/6.
- CSP page-wiring: `CspCandidateDiscovery.test.tsx` 8/8,
  `AccountingSummaryBar.test.tsx` 5/5, `SymbolOutcomesDisclosure.test.tsx`
  5/5.
- Adjacent (verified not regressed, not in the required list):
  `lib/autopilot` + `lib/opportunity-engine` suites, 104/104.
- Combined single run across the full required set: 239/239 passing (one
  pre-existing test-fixture duplicate-React-key warning found and fixed
  along the way — `948646a` — not a blocker, not a regression this pass
  introduced beyond exposing it).

**Not run in this pass, per explicit instruction**: the full repository
test suite, `next build`. These belong after the remaining feature scopes
(modal/Rank/Targeted/DTE-grouping/mobile) are integrated in a future pass.

### Remaining work (unchanged from above, plus)

All six items in "Remaining work" above are still outstanding and were
NOT touched in this pass. Item 7 (the OCC-parser strictness deviation
flagged by BLOCKER-04) is resolved — see the next section.

---

## Final candidate-identity correction

A follow-up, narrowly-scoped pass closed the BLOCKER-04 deviation flagged
above: `candidateIdentity.ts`'s OCC validator accepted any string ≥ 6
characters as primary identity, structurally rather than semantically
correct. It has been replaced with a validator that reuses the codebase's
one canonical OCC parser (`lib/optionSymbol.ts`'s `parseOccSymbol` — no
second, competing parser was written) and only accepts an OCC symbol as
primary identity when its **parsed fields actually match the candidate**.

**Final OCC validation rule** (`isOccSymbolMatch()`): an OCC symbol is
accepted as primary identity only when all of the following hold —
`parseOccSymbol()` successfully parses it (a synthetic or malformed string
like `AMD_2026-01-19_P415_0` never does); the parsed option type equals
`P` for a CSP (put) candidate — a call OCC symbol is rejected; the parsed
underlying, upper-cased and trimmed, equals the candidate's normalized
underlying; the parsed expiration equals the candidate's expiration
exactly; and the parsed strike matches the candidate's strike within a
documented ±$0.0005 tolerance (half of the smallest OCC increment,
$0.001, absorbing the floating-point noise `strikeDigits / 1000` can
introduce without ever letting two genuinely different strikes compare
equal). Any single failure — wrong underlying, wrong expiration, wrong
strike, wrong option type, or a parse failure — is rejected; length or
"plausible shape" alone is never sufficient. The accepted OCC symbol is
then canonicalized (whitespace stripped, upper-cased — the same
normalization `parseOccSymbol` applies internally) before being used, so
"AMD260119P00415000" and "amd 260119 p 00415000" for the same contract
always produce the identical candidateId.

**Composite fallback rule** (unchanged in shape, now reached more often):
`composite:{strategy}:{normalizedUnderlying}:{expiration}:{P|C}:{strike}`.
The candidate is never discarded for having a missing, malformed, or
mismatched OCC symbol — it always falls through to this deterministic,
timestamp-free composite identity instead, stable across repeated scans
and cache restoration.

**Effect on existing fixtures**: this codebase's own synthetic CSP test
chains (the `${symbol}_${exp}_P${strike}_${i}` shape used throughout the
NKE/AMD acceptance fixtures) were never real OCC symbols and now correctly
fall to the composite identity rather than being accepted at face value.
Updated: `lib/scans/__tests__/csp-finder-multicandidate.test.ts`'s NKE
fixture assertion, from expecting `occ:NKE_39P_OCC`/`occ:NKE_38P_OCC` to
expecting the composite ids for those same two strikes. No multi-candidate
assertion was weakened — the test still proves both puts survive
discovery as distinct, non-colliding candidates; only the expected id
*format* changed to reflect the corrected, honest validation. The AMD
six-strike fixture (`csp-finder.test.ts`, `CspCandidateDiscovery.test.tsx`)
and the CSP page-wiring/session tests made no candidateId format
assertions and needed no changes — they already only asserted
distinctness, which composite ids still guarantee per strike/expiration.

**Identity propagation proof, re-verified end to end**: `lib/scans/
__tests__/candidateIdentity.test.ts` covers the validator/builder in
isolation (compact OCC match, whitespace/casing-insensitive match, wrong
underlying, wrong expiration, wrong strike, call-for-CSP rejection,
malformed OCC, missing OCC, synthetic-fixture rejection, canonicalization
equivalence, composite determinism, and no-collision across distinct
strikes/expirations). The unchanged-through-the-pipeline claim is
re-verified hop by hop with dedicated tests: `screenerCandidateAdapter.
test.ts` (ScreenResult.candidateId → AutopilotCandidate.
screenerCandidateId), `decisionAnalysisAdapter.test.ts` (→
OpportunityCandidate.screenerCandidateId), `evaluateOpportunityCandidate.
test.ts` (→ OpportunityRecommendation.screenerCandidateId, null not
fabricated when absent), `bestOpportunityRows.test.tsx` (→ the Best
Opportunities join, no collision across same-symbol contracts), and a new
`app/api/csv/__tests__/route.test.ts` (→ the CSV "Candidate ID" column,
carried through unchanged, empty rather than fabricated when absent).

### Commits (this correction)

| Commit | Content |
|---|---|
| `b44f8d8` | `candidateIdentity.ts` rewrite (`isOccSymbolMatch`) + all identity/propagation tests |
| (this commit) | Report-only: this section |

### Status

Stopped here, as instructed. Not pushed, not merged. Branch:
`feature/csp-canonical-multicandidate-workflow`.

## Phase 2 — Strategy-aware CSP scan modes and presentation

### Implemented

- `FIND CSPs` now opens a CSP-specific confirmation modal. Opening it creates
  no session, performs no chain fetch, and sets no launcher busy state.
- Filter, Rank, and Targeted are legal CSP session modes. CC and PMCC remain
  Filter-only.
- CSP sessions require a validated immutable rule snapshot. The cache schema
  is now version 6; older or malformed sessions fail closed.
- CSP presets and DTE/delta/OI plus optional POP/OTM/period-ROC targeting
  inputs live in the modal. The completed session renders those values in a
  read-only Active CSP Rules section with Edit / Run Again.
- The generic spread preset strip, strategy chips, credit-ratio controls,
  protective-leg explanation, and Smart Suggestions are absent from CSP
  results.
- Filter and Rank share the CSP single-short-put OI and deterministic
  two-level ordering controls. Targeted ignores that mutable state and is
  governed only by its confirmed snapshot.
- Qualified and disqualified CSP candidates are grouped by expiration/DTE.
  Stable candidate identity continues to distinguish strikes and expirations.
- CSP CSV export is one candidate per row and carries session/mode/rule
  provenance without fabricated long-leg or spread fields.
- Scan-start and scan-complete status announcements were added, together with
  Escape, initial focus, focus trapping, launcher focus restoration, and
  radio semantics for the CSP modal.
- Scan identity now says Filtered, Ranked, or Targeted Cash-Secured Put Scan
  explicitly.

### Policy preserved

Discovery remains exhaustive. Invalid quotes fail closed, excessive relative
width disqualifies, and low OI remains advisory. Market qualification and
account eligibility remain separate. No order-execution code changed.

### Explicit boundary

The existing capital bridge still resolves exactly one broker account and
fails closed for zero or multiple accounts. A full multi-account selector is
separate product scope; this phase does not guess `accounts[0]` or fabricate
capital.

### Validation

Authoritative validation on the final tree:

- TypeScript: `tsc --noEmit --incremental false` clean.
- App tests: 14 files / 142 tests passing.
- Library tests: 88 files / 1,540 tests; the first pass found one stale
  snapshot-shape expectation, which was corrected, and its complete 9-test
  file then passed. No production defect was masked.
- Features/components: 36 files / 317 tests passing.
- Reconciled total: 138 files / 1,999 tests, all passing after the single
  stale test-fixture correction.
- `git diff --check`: clean.
- `next build`: successful; `.next/BUILD_ID` generated.

Real browser verification was attempted against the local server at desktop
and mobile-validation stage, but NextAuth redirected to its configuration
error before `/screener` could render because the local runtime lacks the
repository's required authentication provider configuration. A temporary
local-only `NEXTAUTH_SECRET` was insufficient. No visual result is claimed;
modal/responsive behavior remains covered by component/page tests and the
successful production build. No credentials or production data were used.

The resulting local commit hash is recorded after the commit is created.

## Corrective pass — canonical mode qualification and accessible expiration groups

This continuation completed the interrupted schema-v7 draft without discarding
its eight pre-existing modified files. CSP candidates now carry an explicit,
validated mode-qualification axis (`NOT_APPLICABLE`, `PASSED`, or `FAILED`)
with consistent failure reasons. Overall CSP qualification is derived from
market plus mode qualification; account eligibility remains a separate axis
used for account-actionable accounting and Best Opportunities eligibility.
Malformed, contradictory, and old-schema cached sessions fail closed.

The CSP modal now owns independent Filter, Rank, and Targeted drafts. Switching
modes does not leak DTE/delta/preset/target values; Rank alone owns its supported
secondary sort; Targeted alone exposes POP/OTM/ROC constraints and requires a
deliberate confirmation step. Radio controls use roving keyboard focus and
visible checkmark/Selected cues. Reopening and Edit / Run Again restore the
confirmed draft for the corresponding mode.

Rank ordering is captured in the immutable rule snapshot, structurally
validated, restored with the session, and displayed by Active CSP Rules. CSP
CSV rows include mode qualification, reasons, and overall qualification. Best
Opportunities excludes canonical Targeted failures while retaining compatibility
with legacy test fixtures that predate the canonical qualification fields.

Qualified and grouped-disqualified expiration sections now share a button-based
`ExpirationDisclosure`: accessible names include expiration, DTE, and candidate
count; `aria-expanded`/`aria-controls`, expanded/collapsed text, polite live
announcements, and collapse focus restoration are provided. Qualified groups
start open; disqualified groups start collapsed.

Validation on the final tree: focused CSP/accessibility set 8 files / 134 tests
passing; one clean full-suite command 137 files / 1,986 tests passing;
`tsc --noEmit --incremental false` clean; `git diff --check` clean; and
`next build` successful. The first full-suite attempt had one unrelated timing
failure in `ScreenerUXHierarchy.test.tsx`; it passed unchanged in isolation,
and the required subsequent single full-suite command was entirely clean.

Desktop and 375×812 mobile browser verification were attempted against the
built local `/screener`. Both were redirected before the app rendered to
`/api/auth/error?error=Configuration`; the server reported NextAuth
`MissingSecretError` (`NO_SECRET`). No authenticated visual verification is
claimed. The viewport was reset and the local server stopped after the attempt.

### Alan / Quinn corrective review follow-up

The follow-up closes the review gaps without changing the CSP state model.
Targeted mode now requires at least one valid POP, OTM, or period-ROC narrowing
constraint before confirmation. Snapshot validation is semantic as well as
structural: numeric ranges, percentage/unit bounds, nonnegative DTE/OI/spread
limits, mode-owned target fields, and Rank sort invariants all fail closed.
Restored CSP candidates must also use `NOT_APPLICABLE` outside Targeted and
`PASSED` or `FAILED` within Targeted. The preset radiogroup now has the same
roving-tabindex and arrow-key selection behavior as the mode radiogroup.

Focused regression tests cover each of these invariants, the canonical CSV
qualification headers/values, and the complete Rank snapshot lifecycle from
supported-secondary creation and validation through IndexedDB restoration and
Active CSP Rules display. Cache validation also rejects any purportedly
qualified CSP result that lacks a concrete candidate and its full canonical
qualification state; the Rank restoration fixture carries that real payload.
The preset radiogroup retains a selected/tabbable Custom choice after any
manual rule or target edit, including full arrow-key navigation back into the
named presets. The final follow-up command passed 6 focused files / 119 tests.
`tsc --noEmit --incremental false` and `git diff --check` were also
clean. These counts are specific to the Alan / Quinn follow-up and do not alter
the historical validation totals above.

### Final validation pass — first true full-suite run since the Alan/Quinn follow-up, one regression found and fixed

This session picked up the branch mid-work (uncommitted, credits exhausted in
the prior tool). Before touching anything, the actual working tree was
inspected directly (`git status`, `git diff --stat`, `tsc --noEmit`, targeted
test runs) rather than trusting either the handoff note or this report's own
prior claims. The tree was materially further along than a separate handoff
summary suggested: `ExpirationDisclosure`, the CSV module, and the Rank
snapshot display were already complete, not "not yet started."

One real gap was found and closed: `isModeQualified()` and
`isOverallCspQualified()` (`lib/scans/cspQualification.ts`) had no isolated
unit tests — only indirect coverage through page-level integration tests.
Added 12 focused tests directly against these two functions, including the
required "market-disqualified regardless of mode result" matrix (every
`DISQUALIFIED_*` state × every mode-qualification state) and the
`isBestOpportunitiesEligible` mode-qualification parameter (default,
Targeted-PASSED, Targeted-FAILED). `lib/scans/__tests__/cspQualification.test.ts`
is now 24/24.

The full suite was then run as four disjoint Vitest shards (`--shard=1/4`
through `4/4`, guaranteed non-overlapping, summing to the complete 139-file
suite — not arithmetic assembled from separately-targeted runs). This
surfaced a genuine regression the prior "137 files / 1,986 tests passing"
full-suite claim above predates: `app/screener/__tests__/LauncherSelectedState.test.tsx`'s
"a restored CSP session selects FIND CSPs" fixture persisted a `qualified:
true` CSP result with `bestCandidate: null` — valid under the old cache
validator, but exactly the shape the Alan/Quinn follow-up's stricter
`INVALID_CSP_QUALIFICATION` check (added after that "137 files" run, and
only re-validated afterward with a 6-file/119-test focused run, not a full
suite) now correctly rejects: a "qualified" CSP result with no concrete
contract is nonsensical and must fail closed on cache restore. Confirmed via
`git stash` that this test passed cleanly on the pre-corrective-pass base
commit (12/12) and failed only with the corrective-pass diff applied,
proving it was a genuine regression, not a pre-existing flake. Fixed by
giving the fixture a real `bestCandidate` with the canonical
`cspMarketQualification: 'QUALIFIED'`, `cspAccountEligibility: 'ELIGIBLE'`,
`cspModeQualification: 'NOT_APPLICABLE'` (Filter mode never mode-gates)
states — i.e. the shape production code actually produces — rather than
loosening the validator. `LauncherSelectedState.test.tsx` is now 12/12.

One additional failure surfaced in the same full-suite run,
`lib/scans/__tests__/cspSearch.test.ts` (2 of 24 tests, both asserting an
exact `dte` of 40 that came back 41). Confirmed via `git status` that neither
`lib/scans/cspSearch.ts` nor its test file is touched anywhere in this
corrective pass — both are byte-identical to the base commit. This is a
pre-existing relative-date rounding flake (the fixture builds its expiration
from `new Date()` at test-run time) unrelated to this pass's scope and was
left untouched, per instruction not to fix unrelated defects while executing
this ticket.

**Final full-suite result** (4 disjoint shards, complete coverage): 139 test
files, 2,018 tests, 2,016 passing, 2 failing (the pre-existing, unrelated
`cspSearch.test.ts` date flake documented above; both files confirmed
untouched by this pass). `npx tsc --noEmit` clean. `git diff --check` clean.
`npx next build` — clean production build, all 53 static pages generated,
all routes compiled (build output included non-fatal `ioredis
ECONNREFUSED` warnings from the sandbox having no local Redis instance,
unrelated to this pass and not a build failure).

**Browser verification**: not attempted in this session. No browser
automation or computer-use tool was available (this session had shell and
raw HTTP fetch only, neither of which can render a JS application, click
through an authenticated workflow, or capture a screenshot). This is a
different, more fundamental blocker than the NextAuth `MissingSecretError`
documented above for the prior attempt; that blocker's disposition is
unchanged and unverified either way in this session. No visual verification
of any kind is claimed.

**Commits this session**: candidate-identity and qualification test/fixture
work is committed as one focused commit on
`feature/csp-canonical-multicandidate-workflow` (see commit hash in the
final chat response); this report update follows as a second, report-only
commit. Neither commit was pushed or merged. All previously-protected
untracked files (`docs/handoffs/TradeEdge-Current-State-2026-08-06.md`,
`docs/reviews/portfolio-position-metrics-audit.md`,
`scanSession_model_v2.sh` through `_v5.sh`) remain untouched and untracked.
