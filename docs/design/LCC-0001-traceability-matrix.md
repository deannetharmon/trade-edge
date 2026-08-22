# LCC-0001 — Traceability Matrix
Equity-Aware LEAPS, Covered Call, and PMCC Lifecycle

**Status:** Final cross-ticket review deliverable
**Reviewed against:** LCC-0001 epic, execution sequence, original tickets A–E, master technical
architecture (commit `f0b1be9`), architecture review, technical specifications A–E (A `ad7bf07`,
B `f0b1be9`, C corrected `3365657`, D `f0b1be9`, E `f29db03`), `PMCC_SPECIFICATION.md`, both
checked-in HTML mockups, and current repository implementation.
**Does not implement application code.**

This document is deliberately structured as a lookup table rather than prose. Each numbered group
below is one traceability dimension requested by the review scope. "Coverage status" uses three
values: **Covered** (an explicit, named mechanism exists), **Covered (cross-ticket)** (satisfied by
the composition of two or more tickets, not one alone), **Gap** (no mechanism found — always paired
with a discrepancy note and carried into the readiness review's findings).

---

## 1. Epic invariants (cross-ticket invariants 1–15)

| # | Invariant | Owning ticket | Spec section | Files | Tests | Prerequisite | Status |
|---|---|---|---|---|---|---|---|
| 1 | Every broker instrument/execution independently identifiable | A | A §4, §6 | `lib/portfolio-snapshot/types.ts` | A §15 idempotency test | None | Covered |
| 2 | Short call cannot consume more foundation quantity than available | B | B §6.1 | `lib/coverage/invariants.ts::validateCapacity` | B §15 capacity tests | A (snapshot) | Covered |
| 3 | Same foundation cannot support multiple simultaneous short calls | B | B §6.3 | `lib/coverage/invariants.ts::validateLongCallSingleUse` | B §15 | A | Covered |
| 4 | PMCC short call must expire before long call | B | B §6.4 | `lib/coverage/invariants.ts::validatePmccCompatibility` | B §15 | A | Covered |
| 5 | Short stock never provides covered-call support | A, B | A §5 (visibility), B §6.2 (enforcement) | `normalizeEquity.ts`, `invariants.ts::validateFoundationType` | A §15, B §15 | None | Covered (cross-ticket) |
| 6 | Closing a foundation cannot silently leave a short call unsupported | B | B §6.5 | `lib/coverage/invariants.ts::canCloseFoundation` | B §15 (unconditional-block test) | A, B | Covered |
| 7 | Roll cannot overwrite or delete prior short-call cycle | D | D §6 | `lib/lifecycle/roll.ts` | D §16 roll test | A, B, C | Covered |
| 8 | Strategy classification reproducible from instruments/relationships | B | B §8 | `lib/coverage/deriveStrategy.ts` | B §15 | A | Covered |
| 9 | Relationship changes cannot rewrite transactions or fabricate cash flow | B, D | B §9 (narrow endpoints), D §11 (`CorrectionEvent`) | `lib/coverage/store.ts` release endpoint, `lib/lifecycle/corrections.ts` | B §15, D §16 | A, B | Covered (cross-ticket) |
| 10 | Broker sync and migration idempotent | A, D | A §15, D §12.3 | `lib/portfolio-snapshot/acquire.ts`, `lib/migration/apply.ts` | A §15, D §16 rerun test | A→D | Covered (cross-ticket) |
| 11 | Portfolio and Screener calculate coverage from same normalized snapshot | A, E | A §6, §8, E §5 | `lib/portfolio-snapshot/*`, `lib/screener/launchers/findCoveredCalls.ts` | A §15 parity test, E §13 parity test | A→E | Covered (cross-ticket) |
| 12 | Symbol-level and strategy-level P/L count every instrument exactly once | B | B §8.2 | `lib/coverage/deriveStrategy.ts::sumTotalSymbolExposure` | B §15 dedup test | A, B | Covered |
| 13 | Premium received remains a liability until short call resolved | C, D | C §7 (`currentShortCallLiability`), D §4 (`ShortCallCycle.status`) | `lib/position-entry/calculations.ts`, `lib/lifecycle/types.ts` | C §16, D §16 | A, B | Covered (cross-ticket) |
| 14 | Net strategy basis is a management metric, not tax basis | C | C §7 | `lib/position-entry/calculations.ts::netStrategyBasis` | C §16 | A, B | Covered |
| 15 | Fail closed when coverage cannot be verified | A, B | A §9, B §6.7 (via §6.1/§6.2) | `lib/portfolio-snapshot/dataQuality.ts`, `lib/coverage/invariants.ts` | A §15, B §15 | None | Covered (cross-ticket) |

---

## 2. Epic release-definition outcomes (10 items)

| # | Outcome | Owning ticket | Spec section | Status |
|---|---|---|---|---|
| 1 | See actual shares and option positions in Portfolio | A | A §11 | Covered |
| 2 | See allocated/reserved/available/remainder share quantities | B | B §11 | Covered |
| 3 | Hold a long call without an active short call | C | C §6.1 | Covered |
| 4 | Open a new PMCC or add a short call to an existing long call | C | C §6.2, §6.5 | Covered |
| 5 | Sell a covered call against verified available shares | C | C §6.3 | Covered |
| 6 | Track every short-call cycle independently | D | D §4 | Covered |
| 7 | Close, expire, roll, assign, reconcile without losing history | D | D §6–§11 | Covered |
| 8 | Distinguish stock covered calls from PMCC long-call diagonals | B | B §8.1 | Covered |
| 9 | Use Find LEAPS/Find Covered Calls/Find PMCCs/Calls Against My Positions against shared model | E | E §4–§7 | Covered |
| 10 | Migrate existing PMCC records without lost history/duplicates/unexplained P/L | D | D §12 | Covered |

---

## 3. Ticket acceptance criteria (all five tickets, full enumeration)

### LCC-0001A (6 criteria) — all Covered, per A §16
Equity visibility · Short stock · Incomplete basis · Portfolio/Screener parity · Data failure ·
Idempotency. Implementing mechanisms: A §4 (`EquityHolding`), §5 (normalization), §6 (single-fetch
boundary), §9 (fail-closed table), §12 (no persistence ⇒ inherently idempotent).

### LCC-0001B (6 criteria) — all Covered, per B §16
Share allocation · Long-call allocation · Action availability · Ambiguous coverage · Blocked
foundation close · P/L deduplication. Implementing mechanisms: B §6.1, §6.3, §8.1, §7, §6.5, §8.2.

### LCC-0001C (5 criteria) — all Covered, per C §17
LEAPS only · New PMCC · Existing shares · Proposed versus executed · Partial PMCC. Implementing
mechanisms: C §6.1, §6.2, §6.3, §4/§7, §6.2+§11.

### LCC-0001D (6 criteria) — all Covered, per D §17
Roll · Stock assignment · PMCC assignment · Foundation replacement · Migration rerun · Broker
correction. Implementing mechanisms: D §6, §8.1, §8.2, §9, §12.3, §11.

### LCC-0001E (6 criteria) — all Covered, per E §14
LEAPS-only path · Covered Call eligibility · Fully reserved shares · New PMCC · Existing position ·
Data unavailable. Implementing mechanisms: E §4/§6, §5, §5 (capacity→null candidate), §6, §7, §5
(inherits A's fail-closed snapshot).

**Total: 29/29 acceptance criteria across A–E map to an explicit, named, testable mechanism.**

---

## 4. UX and mockup behavior

| Mockup state | Source | Owning ticket | Status |
|---|---|---|---|
| Stock-Only Holding, Basis Incomplete, Data Unavailable | Equity-aware Portfolio mockup | A | Covered (A §11) |
| Mixed AAPL Position, Stock Holding Detail, Working Reservation, Blocked Close | Equity-aware Portfolio mockup | B | Covered (B §11) |
| Screener Result, LEAPS Result, PMCC Plan, Existing Coverage, Portfolio, Stock Covered Call | Integrated flow mockup | C | Covered (C §12) |
| Roll, Assignment, Partial Execution, Import Reconciliation, Replace Foundation | Integrated flow mockup | D | Covered (D §14) |
| Screener Result, LEAPS Result, PMCC Plan, Coverage Choice | Integrated flow mockup | E | Covered (E §8, consuming B's `inferOrRequireConfirmation`) |
| "What supports this short call?" dialog | Integrated flow mockup | B (data source) / C (trigger point) | Covered (cross-ticket: B §5.3 rule 7 / C §12) |
| Today's priorities / Resolve assignment | Integrated flow mockup | D | Covered (D §14) |

Every distinct mockup state identified across both HTML files maps to an owning ticket and an
explicit rendering mechanism. No mockup state requires a UI capability absent from the domain model.

---

## 5. Confirmed product decisions (all 25 requested verifications)

See §7 of the implementation-readiness review for the full verification with direct spec citations.
Summary table:

| # | Decision | Confirmed in | Status |
|---|---|---|---|
| 1 | `PmccOrigination` includes `UNKNOWN_MIGRATED`; migration never guesses | Master arch §5.2/§5.4/§10/§15.0/AD-4; B §4.1; D §12.2 | Confirmed |
| 2 | Live workflows assert only `CREATED_TOGETHER`/`ADDED_TO_EXISTING_LONG_CALL` | C §6.2, §6.3 | Confirmed |
| 3 | Allocation writes require snapshot ≤60s old | B §13 | Confirmed |
| 4 | Staleness threshold server-configurable | B §13 | Confirmed |
| 5 | Rejected stale writes → refresh-and-retry UX | B §13 | Confirmed |
| 6 | `calledAwayReturn` reuses `calcCalledAwayProfit` | C §7.1 | Confirmed |
| 7 | Incomplete basis → null called-away return | C §7.1 | Confirmed |
| 8 | Dividend/assignment risk uses LOW/ELEVATED/UNKNOWN | C §8.1 | Confirmed |
| 9 | Missing dividend data always → UNKNOWN, never LOW | C §8.1 | Confirmed |
| 10 | Scanner gives UNKNOWN equal prominence to ELEVATED | E §8.1 | Confirmed |
| 11 | Expiration outcomes require authoritative broker evidence | D §7 | Confirmed |
| 12 | Market expiration price advisory only | D §7 | Confirmed |
| 13 | Missing/contradictory expiration evidence → reconciliationRequired | D §7 | Confirmed |
| 14 | `partiallyFilled` explicit state, finalized transitions | D §5 | Confirmed |
| 15 | `CorrectionEvent` cannot fabricate cash flow | D §4, §11 | Confirmed |
| 16 | Existing PMCC ranking/scoring unchanged | E §6, §16 | Confirmed |
| 17 | `findPmccs` is a thin wrapper only | E §6 | Confirmed |
| 18 | Four scanner workflows supported | E §4–§7 | Confirmed |
| 19 | Portfolio displays actual equity holdings | A §11 | Confirmed |
| 20 | Portfolio and scanner use same unified snapshot | A §6, E §5 | Confirmed |
| 21 | Old independent CC capacity path retired/adapted | A §3, E §3/§15 | Confirmed — see readiness review §9 for the one timing nuance |
| 22 | Saved plans cannot become positions without execution evidence | C §5 | Confirmed |
| 23 | Foundation closure blocked while active dependent short call exists | B §6.5 | Confirmed |
| 24 | No uncovered-state override in initial release | Master arch §15.0; B §6.5 | Confirmed |
| 25 | Migrated relationships evidence-driven and idempotent | D §12 | Confirmed |

---

## 6. Domain types (canonical inventory, by owning module)

| Type | Owning ticket | File | Consumed by |
|---|---|---|---|
| `PortfolioSnapshot`, `EquityHolding`, `WorkingOrder`, `SnapshotDataQuality` | A | `lib/portfolio-snapshot/types.ts` | B, C, D, E |
| `Position` (unmodified, wrapped) | Pre-existing | `lib/portfolio-data/types.ts` | A (adapter), all |
| `CoverageAllocation`, `AllocationStatus`, `AllocationSource`, `PmccOrigination`, `AuditEvent`, `DerivedStrategy` | B | `lib/coverage/types.ts` | C, D, E |
| `SavedPlan`, `ExecutionRecord`, `ExecutionFill`, `ExecutionSource` | C | `lib/position-entry/types.ts` | D (fills reused in rolls), E (launcher actions) |
| `DividendAssignmentRiskState`, `DividendAssignmentRiskInput/Result` | C | `lib/position-entry/dividendAssignmentRisk.ts` | E (first real consumer) |
| `ShortCallCycle`, `CycleStatus`, `RollEvent`, `ReconciliationItem`, `CorrectionEvent` | D | `lib/lifecycle/types.ts` | E (informs eligibility indirectly via allocation state) |
| `AuthoritativeExpirationEvidence`, `AdvisoryExpirationPriceEvidence` | D | `lib/lifecycle/expiration.ts` | D only (not exposed further) |

No type is defined in more than one ticket. No two tickets independently define competing types for
the same concept.

---

## 7. Lifecycle rules and transitions

| Rule | Owning ticket | Spec section | Status |
|---|---|---|---|
| `Proposed → Pending → Open` | D | D §5 | Covered |
| `Pending → Cancelled \| Rejected \| PartiallyFilled` | D | D §5 | Covered |
| `PartiallyFilled → Open \| Cancelled \| ReconciliationRequired` | D | D §5 (decision-resolved) | Covered |
| `Open → ClosingPending → Closed` | D | D §5, §6 | Covered |
| `Open → Expired \| Assigned \| ReconciliationRequired` | D | D §5, §7 | Covered |
| `ReconciliationRequired → Open \| Closed \| Expired \| Assigned` | D | D §5 | Covered |
| Roll = 3 independent operations, never mutation | D | D §6 | Covered |
| Foundation-close block, unconditional | B | B §6.5 | Covered |
| Foundation replacement revalidates every active cycle | D | D §9 | Covered |

---

## 8. API/service responsibilities

| Route/service | Owning ticket | Purpose |
|---|---|---|
| `lib/portfolio-snapshot/acquire.ts::acquireSnapshot()` | A | Sole broker-position/order acquisition boundary |
| `GET/POST /api/coverage-allocations`, `POST .../release` | B | Allocation CRUD, server-validated |
| `POST /api/position-entry-plans`, `/position-entry-executions` (+ `mark-applied`) | C | Plan/execution persistence |
| `POST /api/lifecycle/{roll,expire,assign,replace-foundation,correct}` | D | One narrow route per transition |
| `GET /api/reconciliation-queue` | D | Reconciliation item listing |
| `POST /api/migration/lcc-0001/{dry-run,apply,rollback}` | D | Migration control |
| `lib/screener/launchers/{findLeaps,findCoveredCalls,findPmccs,callsAgainstPositions}.ts` | E | Discovery-stage orchestration, no new persistence |

No route is defined by more than one ticket. Every lifecycle-transition route re-validates
server-side against the owning ticket's invariants (B's staleness check, D's transition guard).

---

## 9. Persistence responsibilities

| Redis key namespace | Owning ticket | Notes |
|---|---|---|
| None (derived, in-memory per refresh) | A | No persisted entity introduced |
| `coverage-allocations:{userId}` | B | Upsert-by-id |
| `position-entry-plans:{userId}`, `position-entry-executions:{userId}` | C | Upsert-without-overwrite |
| `short-call-cycles:{userId}`, `roll-events:{userId}`, `reconciliation-items:{userId}`, `correction-events:{userId}`, `migration-staging:{userId}` | D | Narrow-mutation, append-only pattern |
| None (read/derive only) | E | No new persistence |

No key namespace collision across tickets. Every namespace follows the same established
Redis-blob-per-user pattern (`position-stop-policies` template).

---

## 10. Failure and reconciliation behavior

| Failure mode | Owning ticket | Mechanism |
|---|---|---|
| Positions/orders fail to load | A | `SnapshotDataQuality.status: 'unavailable'` |
| Unattributable short-option exposure | A | Account-wide fail-closed, ported from `covered-call-capacity.ts` |
| Ambiguous foundation at import time | B | `inference.ts::inferOrRequireConfirmation` |
| Short fills without foundation | B (classification) / C (creation path) | `ActionNeeded` derived strategy |
| Two-step apply failure (execution recorded, allocation call fails) | C | §14 — same `ActionNeeded` fallback as above, by design |
| Missing/contradictory expiration evidence | D | `reconciliationRequired`, never guessed |
| PMCC assignment without exercise evidence | D | `reconcilePmccAssignment` — unresolved short-share state |
| Broker reversal/correction | D | `CorrectionEvent`, append-only |
| Migration ambiguity | D | Ambiguity report, staged, not auto-applied |
| Coverage unverifiable at scan time | A, E | E §5 inherits A's fail-closed snapshot directly |

---

## 11. Test obligations (by category, cross-referenced to owning spec's §15/§16/§13)

| Category | Owning ticket(s) | Notes |
|---|---|---|
| Unit — normalization, invariants, projections | A, B | A §15, B §15 |
| Unit — calculations, PMCC validation, dividend risk | C | C §16 |
| Unit — transitions, migration pairing | D | D §16 |
| Unit — LEAPS scoring | E | E §13 |
| Integration — workflow apply functions | C | C §16 |
| Integration — roll/assignment/replacement/reconciliation | D | D §16 |
| Integration — capacity parity (Portfolio ↔ Screener) | A, E | A §15, E §13 — **same test obligation, two tickets; see readiness review §5 for ownership resolution** |
| Component — Portfolio/Screener UI states | A, B, C, D | Each ticket's own §15/§16 |
| Regression — existing option/PMCC suites remain green | All | Every ticket's §15/§16/§13 explicitly lists this |
| Golden fixtures (Alan's approval) | C, D, E | C §16 item, D §16 item, E §13 item |
| Accessibility | C, D, E | Each ticket's own test matrix |

---

## 12. Implementation PR / owning ticket — cross-reference index

Full PR sequences are specified per-ticket in each spec's own §14/§17/§15/§18/§15 (A/B/C/D/E
respectively — section numbers differ per document, all under "Migration and rollout plan" or
equivalent). The implementation-readiness review's final implementation sequence (its own §11)
consolidates all five into one ordered, cross-ticket PR list with entry/exit criteria — see that
document rather than duplicating the full sequence here.
