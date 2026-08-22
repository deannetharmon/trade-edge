# LCC-0001A PR 4 — Covered Call Capacity Shadow Parity Implementation Report

**Status:** Implemented locally; ready for team review
**Branch:** `feature/lcc-0001a-cc-capacity-shadow-parity`
**Base:** merged PR #27 / `a877d7892a3b5bdcdd8e9942ae2edc1fa9890a30`
**Implementation commits:** `f97c0481c44d3d599d9ba13ab15e953b0a493208`
(`Add LCC-0001A capacity shadow parity`), `49b513c1dfcf88cdddd974bfe2d89241d8165c52`
(`Add durable PR4 shadow monitoring`), `dc78b6d42cd27c092f53330ce12e683f5ecc26fe`
(`Harden PR4 shadow telemetry integrity`), `c54b815b10746f867ae6d3ec79c97c6e3c1b9f06`
(`Complete PR4 telemetry evidence safeguards`), followed by the commit titled
`Enforce per-event PR4 telemetry retention`.

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
5. The result is submitted without awaiting it to an authenticated same-origin telemetry endpoint.
6. Comparator, page-boundary, transport, collector, or storage failure is isolated and cannot change
   or delay the authoritative result.

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

## Collection, logging, and redaction

Diagnostics use the structured event name `lcc0001a.covered_call_capacity_shadow`. They contain only
the normalized comparison schema. Production collection is an unawaited same-origin POST to
`/api/telemetry/cc-capacity-shadow`; browser `console.info` is development-only and is not Gate A
evidence. The route requires the repository's NextAuth server session. It uses the authenticated
user ID (or email fallback) only transiently to derive a keyed HMAC for rate limiting; the raw
identity is never stored or logged.

The server accepts only these top-level fields: `outcome`, `comparedAt`, `snapshotAsOf`,
`snapshotFreshness`, `differences`, and, for `skipped` only, `reason`. Difference variants have
closed key sets for status, symbol-only, one of the nine approved capacity fields, warnings, or
unavailable reason. Each field mismatch has exact type/nullability rules: `sharesOwned` is a finite
non-negative number and therefore preserves fractional holdings; the four contract counts are
non-negative safe integers; `costBasis` is a finite non-negative number or null; and
`costBasisComplete`, `oversubscribed`, and `hasUnclassifiedExposure` accept booleans only.
Unexpected keys, negative counts, field/type mismatches, unsafe contract integers, and non-finite
values are rejected. Payloads are limited to 32 KiB, 100 differences, 50 warning strings per side,
and bounded string lengths.

Tokens, sessions, account numbers, and raw broker payloads are never part of the retained schema.
Before Redis storage or server logging, every free-form warning and unavailable reason is replaced
at the server trust boundary with a purpose-separated HMAC-SHA-256 fingerprint; original text is
discarded. Symbols and normalized capacity values remain, so this is identifier-minimized financial
diagnostic data, not anonymous data. Transport, logger, route, and Redis failures are
non-authoritative and produce no user-facing error.

`comparedAt` must be canonical UTC ISO-8601 and within 15 minutes of server receipt time. It remains
diagnostic metadata only. Server receipt time is the sole authority for daily aggregation and rate
windows, so a client cannot select monitoring keys with an arbitrary date.

## Durable monitoring and queries

The authenticated route reuses the repository's established `REDIS_URL`/ioredis telemetry
infrastructure with a separate identifier-free namespace:

- Daily hash: `lcc0001a:cc-capacity-shadow:counts:YYYY-MM-DD`
- Recent index: `lcc0001a:cc-capacity-shadow:recent:index`
- Per-event payload: `lcc0001a:cc-capacity-shadow:recent:event:<HMAC event fingerprint>`
- Rate window: `lcc0001a:cc-capacity-shadow:rate:<HMAC identity>:<server minute>`
- Deduplication: `lcc0001a:cc-capacity-shadow:dedupe:<HMAC event fingerprint>`

Daily hashes count `total`, each `outcome:*`, each `skipped:*` reason, each `difference:*` kind, and
each `field:*` mismatch. The date suffix always comes from server receipt time. Operations can query
a day's sample with Redis `HGETALL` on the daily key. Live recent evidence must be read through the
authenticated `GET /api/telemetry/cc-capacity-shadow?limit=500` boundary, which invokes
`readCoveredCallCapacityShadowRecent()`; a raw index query is not evidence that a payload is live.

The recent index is scored only by server receipt milliseconds and contains only HMAC event
fingerprints. Each transformed financial payload is stored separately with an absolute Redis
`PXAT` expiry exactly 90 days after its own server receipt time. A later event cannot extend an
earlier payload's lifetime. The atomic write script removes index entries at or beyond the inclusive
90-day cutoff, deletes their payloads, and immediately deletes both index entry and payload for any
event displaced by the 500-event cap. The supported read script applies the same inclusive age
pruning, omits expired payloads, cleans dangling fingerprints, and returns at most 500 live payloads.
The index may outlive an individual payload, but contains no symbols or capacity values and is never
treated as financial evidence. Daily hashes also have a 90-day TTL. Rate keys are atomically incremented with a 65-second TTL
and admit at most 60 submissions per authenticated identity per 60-second server window. Exact
replays are suppressed for 24 hours with an HMAC event fingerprint. Duplicates return 202 and rate
excess returns 429; neither increments monitoring counts nor appends recent evidence. The route logs
only transformed evidence plus server receipt time. Redis keys contain keyed hashes, never raw
identity. Rejected, duplicate, and rate-limited submissions are excluded from Gate A evidence.

The write-side retention operations run inside the same Redis transaction as the daily counters;
the small Lua command receives keys and values through `KEYS`/`ARGV`, never string interpolation.
The authenticated read boundary runs a separate cleanup script before returning evidence. Stateful
clock-driven tests prove quiet-period expiry after a later day-89 write, exclusion at the exact
90-day boundary, complete quiet-period expiry, immediate event-1 payload deletion when event 501 is
accepted, dangling-index cleanup, and server-receipt-time authority.

This supplies countable evidence but does not select the monitoring window or sample threshold.
Product/operations must choose a window compatible with the documented 90-day retention and review
the stored evidence before PR 5.

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
  the legacy eligible-holdings/capacity result, an older overlapping request cannot emit, and an
  unexpected page-boundary shadow throw cannot affect the legacy UI.
- `lib/portfolio-snapshot/shadowTelemetry.ts` and its tests — detached same-origin transport with
  rejection isolation.
- `lib/portfolio-snapshot/shadowTelemetrySchema.ts` — closed allowlist and size/count bounds.
- `lib/portfolio-snapshot/shadowTelemetryServer.ts` — server-only identity/event HMACs and
  irreversible warning/reason transformation.
- `lib/portfolio-snapshot/shadowTelemetryStore.ts` and its tests — identifier-free daily Redis
  counters, per-event-expiring recent payloads, HMAC-only index, authenticated read cleanup, atomic
  age/count enforcement, rate limiting, and replay suppression.
- `app/api/telemetry/cc-capacity-shadow/route.ts` and its tests — authenticated validation,
  centralized storage/logging, authenticated live-evidence reads, and failure responses isolated
  from the browser workflow.
- This report.

## Verification

- Focused PR 4 matrix (all snapshot/telemetry tests, authenticated collector route, legacy capacity,
  Covered Call gate, Screener session wiring, and launcher state): **239/239 passing** across 15 files.
- TypeScript: only the merged-main baseline of 41 errors in
  `lib/portfolio/__tests__/trendClassification.test.ts`; zero PR 4 errors.
- `npm run build`: passed. Local Redis `ECONNREFUSED` warnings were environmental because no local
  Redis service was running; compilation, validation, static generation, and optimization completed.
- `git diff --check`: clean before commit; the committed range is checked again against
  `origin/main` in the final handoff.

No real broker production account was available locally, so this PR establishes the deterministic
harness but does not claim production parity evidence.

## Scope boundaries

No live cutover, capacity-math change, legacy-path removal, broker acquisition path, Portfolio UI
change, trading-domain persistence, allocation, lifecycle, launcher, PMCC ranking/scoring, PR 5, or
LCC-0001B–E behavior was introduced. The only new route and persistence are the authenticated,
identifier-minimized PR 4 diagnostic collector described above. Differences are reported rather
than normalized away.

## Operational follow-up and PR 5 gate

The production monitoring duration/sample threshold remains deliberately unresolved. Before PR 5:

1. Product/operations must approve an explicit monitoring duration or sample threshold.
2. Shadow evidence must be reviewed over that window/sample.
3. No unexplained differences may remain.
4. Product must explicitly approve the authoritative Screener cutover.

PR 4 completion alone does not close Gate A.

## Rollback

Set `NEXT_PUBLIC_LCC_0001A_CC_CAPACITY_SHADOW_ENABLED=false` and rebuild/redeploy, or revert the PR 4
merge commit. Before merge, revert the commit titled `Enforce per-event PR4 telemetry retention`,
then `c54b815b10746f867ae6d3ec79c97c6e3c1b9f06`, then
`dc78b6d42cd27c092f53330ce12e683f5ecc26fe`, then
`49b513c1dfcf88cdddd974bfe2d89241d8165c52`, then
`f97c0481c44d3d599d9ba13ab15e953b0a493208`. The legacy report remains authoritative either way.
