# LCC-0001A PR 4 — Covered Call Capacity Shadow Parity Implementation Report

**Status:** Implemented locally; ready for team review
**Branch:** `feature/lcc-0001a-cc-capacity-shadow-parity`
**Base:** merged PR #27 / `a877d7892a3b5bdcdd8e9942ae2edc1fa9890a30`
**Implementation commit:** commit titled `Add LCC-0001A capacity shadow parity`

## Outcome

PR 4 adds a deterministic, redacted shadow comparison between the existing Covered Call capacity
report and the LCC-0001A shared-snapshot report. The existing
`getCoveredCallCapacityReport(token)` result remains the only report used for eligible holdings,
blocked holdings, scan inputs, UI state, and user actions. The snapshot report is observed only; no
cutover or capacity-math change occurs in this PR.

## Data flow and authority

1. `loadCcCapacity()` obtains the legacy report exactly as before.
2. The legacy report immediately continues through the existing authoritative UI/scan path.
3. When `NEXT_PUBLIC_LCC_0001A_CC_CAPACITY_SHADOW_ENABLED=true`, a flag-gated bridge reads the
   already-acquired `PortfolioSnapshot` from the global `PortfolioDataProvider` into a local ref.
4. After the legacy request resolves, a microtask performs the shadow comparison. A monotonically
   increasing request identity suppresses diagnostics for superseded capacity loads.
5. Comparator or logger failure is swallowed inside the shadow boundary and cannot change or delay
   the authoritative result.

The snapshot side performs no account, position, order, quote, balance, or token fetch. It consumes
only Provider state. Snapshot acquisition remains independently controlled by
`NEXT_PUBLIC_LCC_0001A_SNAPSHOT_ENABLED`; the equity-display flag is unrelated.

## Comparison schema

`CapacityShadowResult` has one of three outcomes:

- `parity`: current usable snapshot and no differences.
- `difference`: current usable snapshot with deterministic differences.
- `skipped`: snapshot missing, last-known, data-quality unavailable, or capacity unavailable.

Every result includes comparison time, snapshot `asOf`, and snapshot freshness. These fields expose
observation skew without claiming that the independently acquired legacy report shares the snapshot
timestamp.

Differences are ordered deterministically: status, sorted union of symbols, fixed field order,
normalized warnings, then unavailable reason. Per-symbol fields are:

- `sharesOwned`
- `costBasis`
- `costBasisComplete`
- `grossCoveredContracts`
- `existingShortCallContracts`
- `workingShortCallContracts`
- `availableCoveredContracts`
- `oversubscribed`
- `hasUnclassifiedExposure`

Symbols present on only one side are reported explicitly. Numeric comparisons are exact; no
floating-point tolerance was introduced because these reports should be the same normalized
financial calculation, and tolerance could hide a real divergence.

## Logging and redaction

Diagnostics use the structured event name `lcc0001a.covered_call_capacity_shadow`. They contain only
the normalized comparison schema. Tokens, sessions, account numbers, and raw broker payloads are
never passed to the logger. Any occurrence of the snapshot account number in warnings or an
unavailable reason is replaced with `[REDACTED_ACCOUNT]`; warnings are trimmed, deduplicated, and
sorted. Logger failure returns `null` inside the isolated shadow boundary.

## Feature flags

`NEXT_PUBLIC_LCC_0001A_CC_CAPACITY_SHADOW_ENABLED` is new, additive, independent, and default off.
Only the exact string `true` enables it. Because it is a `NEXT_PUBLIC` build-time variable, rollback
through the flag requires rebuild/redeploy.

Existing flags retain their contracts:

- `NEXT_PUBLIC_LCC_0001A_SNAPSHOT_ENABLED` controls snapshot acquisition.
- `NEXT_PUBLIC_LCC_0001A_EQUITY_DISPLAY_ENABLED` controls Portfolio equity UI only.

No combination makes the snapshot report authoritative.

## Files

- `lib/portfolio-snapshot/shadowParity.ts` — pure comparator, flag parser, redaction, and isolated
  structured emitter.
- `lib/portfolio-snapshot/__tests__/shadowParity.test.ts` — parity, deterministic difference,
  symbol-only, status/warning/reason, skipped-state, privacy, non-mutation, flag, and logger-failure
  coverage.
- `app/screener/page.tsx` — narrow flag-gated Provider snapshot bridge and best-effort shadow
  scheduling after the unchanged legacy acquisition.
- `app/screener/__tests__/CcCapacityGate.test.tsx` — proves a differing shadow result cannot replace
  the legacy eligible-holdings/capacity result.
- This report.

## Verification

- Focused PR 4 matrix (all snapshot tests, legacy capacity, Covered Call gate, Screener session
  wiring, and launcher state): **153/153 passing** across 12 files.
- TypeScript: only the merged-main baseline of 41 errors in
  `lib/portfolio/__tests__/trendClassification.test.ts`; zero PR 4 errors.
- `npm run build`: passed. Local Redis `ECONNREFUSED` warnings were environmental because no local
  Redis service was running; compilation, validation, static generation, and optimization completed.
- `git diff --check`: clean before commit; the committed range is checked again against
  `origin/main` in the final handoff.

No real broker production account was available locally, so this PR establishes the deterministic
harness but does not claim production parity evidence.

## Scope boundaries

No live cutover, capacity-math change, legacy-path removal, API route, broker acquisition path,
Portfolio UI change, persistence, allocation, lifecycle, launcher, PMCC ranking/scoring, PR 5, or
LCC-0001B–E behavior was introduced. Differences are reported rather than normalized away.

## Operational follow-up and PR 5 gate

The production monitoring duration/sample threshold remains deliberately unresolved. Before PR 5:

1. Product/operations must approve an explicit monitoring duration or sample threshold.
2. Shadow evidence must be reviewed over that window/sample.
3. No unexplained differences may remain.
4. Product must explicitly approve the authoritative Screener cutover.

PR 4 completion alone does not close Gate A.

## Rollback

Set `NEXT_PUBLIC_LCC_0001A_CC_CAPACITY_SHADOW_ENABLED=false` and rebuild/redeploy, or revert the PR 4
merge commit. The legacy report remains authoritative either way.
