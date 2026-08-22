# LCC-0001 — Implementation-Readiness Review
Equity-Aware LEAPS, Covered Call, and PMCC Lifecycle

**Status:** Final cross-ticket review deliverable
**Companion document:** `docs/design/LCC-0001-traceability-matrix.md`
**Reviewed against:** LCC-0001 epic, execution sequence, original tickets A–E, master technical
architecture (commit `f0b1be9`), architecture review, technical specifications A–E (A `ad7bf07`,
B `f0b1be9`, C corrected `3365657`, D `f0b1be9`, E `f29db03`), `PMCC_SPECIFICATION.md`, both
checked-in HTML mockups, and current repository implementation.
**Does not implement application code. Does not begin LCC-0001A implementation.**

---

## 1. Summary

Five ticket-level technical specifications (A–E), a master architecture document, and an architecture
review were produced across this epic. All 29 ticket-level acceptance criteria, all 15 epic
invariants, all 10 epic release-definition outcomes, and all 25 product decisions named in this
review's scope are traceable to an explicit, named mechanism (full detail in the companion
traceability matrix). No cross-ticket type collision, no circular dependency, and no unresolved
product decision was found. Two genuine, low-severity design gaps and a handful of documentation-only
follow-ups were found; none blocks implementation. Verdict: **READY WITH NON-BLOCKING FOLLOW-UPS**
(§13).

---

## 2. Cross-ticket type or contract inconsistencies

None found. Verified specifically:

- `PmccOrigination` is defined once (master architecture, mirrored in B §4.1) and referenced
  identically by C, D, and E — no ticket redefines it or introduces a competing enum.
- `CoverageAllocation.status` (B) and `ShortCallCycle.status` (D) are deliberately distinct state
  spaces tracking different things (the relationship vs. the short call's own order/position
  lifecycle) — D §4 explicitly calls this boundary out as intentional, and no ticket conflates them.
- `ExecutionFill` (C) is reused unmodified by D's roll workflow (§6) rather than D defining its own
  fill shape — confirmed no parallel type exists.
- `EligibleFoundation` (B §5) is consumed identically by C (§6.5) and E (§7) with no redefinition.

## 3. Conflicting file ownership

See §10 for the full file-ownership collision audit (explicitly requested as its own deliverable
section). Summary: every shared file (`app/portfolio/page.tsx`, `app/screener/page.tsx`,
`PortfolioDataProvider.tsx`, `lib/scans/covered-call-capacity.ts`) has a clear first-owner and a
documented, additive extension pattern from later tickets — no ticket's plan silently overwrites
another's. No conflicting ownership found.

## 4. Overlapping or contradictory implementation steps

One overlap, not a contradiction: A's rollout plan (§14, PR 5) and E's rollout plan (§15, PR 3–4) both
describe the shadow-mode comparison and eventual cutover of `app/screener/page.tsx` line ~7739 from
`getCoveredCallCapacityReport()` to the shared snapshot. This is **the same real-world PR**, described
twice because A's spec (written first) planned for its own Gate A closure and E's spec (written after,
once E's own launcher work made the cutover concretely actionable) correctly identified itself as the
ticket that actually executes it. E §3 and §16 explicitly acknowledge this ("this ticket is where that
cutover is actually specified to happen... closing the loop LCC-0001A opened"). This is not a
contradiction — both specs agree on what happens and why — but it does mean the **final PR sequence**
(§11 below) must assign this specific PR to exactly one place, not duplicate it. Resolved in §11.

## 5. Missing dependencies

One soft duplication, not a missing dependency: the traceability matrix (§11) notes that
"Portfolio/Screener capacity parity" is a named test obligation in both A §15 and E §13. This is the
same underlying assertion (Portfolio and Screener report identical capacity from the identical
snapshot) verified at two different points in the rollout — A verifies it once the shared snapshot
exists but before Screener consumes it (shadow mode), E verifies it after Screener's cutover is live.
Both tests are legitimate and should both exist (they test different states of the system), but the
final test-ownership record (§11's exit criteria) should note that E's version supersedes A's as the
*production* parity guarantee once E ships — A's version becomes a pre-cutover regression check, not
a permanently-duplicated test.

No genuinely missing dependency was found — every ticket's stated `Depends on:` header is consistent
with what its spec actually consumes (verified against each spec's own §2 "existing files consumed"
tables in the traceability matrix).

## 6. Circular dependencies

None. The dependency graph is a strict line: A → B → C → D, with E depending on A, B, C directly (not
D) per the execution sequence's own note ("LCC-0001E design and isolated LEAPS-ranking work may begin
after LCC-0001A, but production integration must consume the canonical models delivered by A through
D"). E's actual technical specification correctly reflects this: E's `findCoveredCalls.ts` (§5) reads
A+B state; E's `findPmccs.ts` (§6) and `callsAgainstPositions.ts` (§7) read B+C state; nothing in E's
spec requires D's lifecycle/reconciliation machinery to *function*, only benefits from it being
present for a fuller picture (E §7's foundation eligibility check is unaffected by whether D exists,
since B's `findEligibleFoundations` already excludes fully-allocated foundations regardless of D).
This matches the execution sequence's stated allowance precisely — no cycle, no reordering needed.

## 7. Unresolved product decisions

None remain. All three product decisions raised during this epic's review cycle (foundation
protection, PMCC origination persistence, PMCC scoring conflict routing) were resolved in the master
architecture's §15.0. The three LCC-0001D open items raised in that ticket's first draft
(`partiallyFilled` transitions, expiration-price authority, migrated-origination semantics) were
resolved by explicit decision and are reflected consistently across the master architecture, B, and D
(traceability matrix §5, items 1/11-13/14). See §12 (verified decisions) below for the full
citation-backed confirmation of all 25 items named in this review's scope.

## 8. Remaining open items

None found in any of the five ticket specs' own "open items" sections — A, B, C, and D each closed
their open items in a subsequent revision (confirmed against each document's revision-history
section); E's spec was written after all four were closed and raised no new open items of its own
(E §14: "No open items. Every design question this ticket raised was resolvable by direct composition
of A–D's already-built, already-approved primitives").

## 9. Dead, duplicated, or incompatible existing code

Findings surfaced across the five specs, consolidated here as a single register (all are already
correctly handled — none is a blocker, listed for team visibility since they were found in the course
of this epic's work and are otherwise undocumented anywhere else in the repository):

| Finding | Found in | Disposition |
|---|---|---|
| `app/api/positions/route.ts` — server-side position fetch with the same option-only filter bug as the client path; no discoverable caller anywhere in the app | A §2.3 | Flagged for separate cleanup ticket; not touched by LCC-0001. Also architecturally suspect given the TastyTrade browser-side-only constraint. |
| `lib/portfolio/positionLifecycle.ts::isPmccPosition()` — cannot see both PMCC legs together under current `underlying::expiration` bucketing, effectively non-functional for its apparent purpose | Architecture review Finding A; corrected in A §10/D §12.1 | Not reused for migration detection; correctly superseded by cross-bucket pairing. Left in place, unmodified, for whatever pre-LCC-0001 caller uses it. |
| `lib/portfolio/positionLifecycle.ts::isAssignedStock()` — weak, legs-shape-only heuristic with no broker-event backing | D §2.2 | Not reused for lifecycle assignment detection; D's evidence-driven reconciliation supersedes it functionally without modifying it. |
| `app/portfolio/page.tsx`'s `RollSuggestion`/`findRollCandidates` — hardcoded to two-leg, same-expiration vertical spreads only; structurally cannot represent a single-leg or cross-expiration short-call roll | D §2.2 | Correctly identified as architecturally incompatible; D's roll logic (§6) is new, not an extension. Left in place, unmodified, for its existing BPS/BCS/IC use case. |
| `lib/scans/pmccScore.ts` vs. `PMCC_SPECIFICATION.md` | Master architecture §2.3/§11/§15.0 | Explicitly out of scope for LCC-0001; routed to a separate prerequisite ticket. See §14 of this review. |
| `calcCalledAwayProfit()` (`positionLifecycle.ts`) — correct, existing function with zero prior callers | C §7.1 (correction) | Not dead in the "wrong code" sense — dead only in the "never invoked" sense. C is its first real caller; no duplication was introduced once this was found. |

No genuinely incompatible or duplicated *new* code was found across A–E's own deliverables — every
finding above is about **pre-existing** code the specs correctly chose not to reuse, with reasoning
recorded in each case.

## 10. File-ownership collision audit

| File | First-owning ticket | Extending ticket(s) | Required merge order | Protecting tests |
|---|---|---|---|---|
| `app/portfolio/page.tsx` | A (equity rows, additive) | B (allocation/strategy display), C (entry-point wiring), D (roll/assignment/replacement surfaces) | A → B → C → D (matches epic execution order exactly; no reordering needed) | Each ticket's own component test file for `PortfolioPage.test.tsx`, extended incrementally, never replaced. A's original equity-row tests must remain green after B/C/D's additions — each spec's own regression-suite requirement (A §15, B §15, C §16, D §16) covers this. |
| `app/screener/page.tsx` | C (Save Plan/Record Execution actions on *existing* result cards) | E (new launcher buttons, capacity-source cutover at line ~7739) | C → E (C's action-wiring must land before E's launcher work needs somewhere to attach "Review PMCC Plan" etc. — though C only needs *a* candidate card, per C §2.3, not E's full launcher, so this is a soft not hard ordering constraint) | `app/screener/__tests__/ScreenerPage.test.tsx`, `UnifiedStrategyLauncher.test.tsx` — existing suites, both C and E explicitly list "existing Screener suites remain green" as a validation requirement. |
| `components/portfolio-data/PortfolioDataProvider.tsx` | A (`snapshot` field) | B (`allocations`), C (`plans`/`executions`), D (`cycles`/`reconciliationItems`) | A → B → C → D (each adds one field, never modifies a prior ticket's field shape — verified: no spec's "extend" description touches another ticket's field) | `PortfolioDataProvider.test.tsx`, extended per-ticket; the PI-0014C latest-request-wins generation-gating contract (pre-existing, unmodified by any LCC-0001 ticket) is the boundary every addition must respect — each spec explicitly confirms it does. |
| `lib/scans/covered-call-capacity.ts` | A (ports its logic into `lib/portfolio-snapshot/`, leaves original as thin wrapper) | E (cuts over the last live caller, `app/screener/page.tsx` line ~7739, away from the pre-LCC-0001 `getCoveredCallCapacityReport()` path) | A → E, with the gap between them being the "shadow mode" period both specs describe | A's own §15 ports the *existing* `covered-call-capacity.test.ts` fixtures verbatim as the first acceptance bar for the new module — this is the specific test that protects the boundary between "ported logic" and "original logic" from silently diverging. |
| `lib/coverage/store.ts`'s `POST /api/coverage-allocations` endpoint | B (defines and implements) | C (calls it from entry workflows), D (calls it from roll/replacement workflows) | B → C, B → D (C and D are siblings with respect to this endpoint, not sequential relative to each other) | B's own server-side re-validation tests (B §15) protect this boundary structurally — every caller, regardless of which ticket, is re-validated against the same invariants server-side, so no caller can bypass the boundary even if a later ticket's workflow logic has a bug. |

No file has more than one "first owner" claim across the five specs. Every later-touching ticket's own
spec explicitly classifies its touch as "extend/additive," never "refactor" or "replace," for every
file another ticket already owns — verified against each spec's own §3 classification table.

## 11. Migration and rollout risks

- **Shadow-mode window ambiguity**: neither A nor E's rollout plan specifies a concrete duration for
  the shadow-mode parity-monitoring period before cutover (both use "an agreed monitoring window" /
  "until parity is demonstrated clean" without a number). This is appropriately left to
  implementation-time judgment given real production data, but should be explicitly decided (a
  specific number of days, or a specific sample-size threshold) before PR execution begins, not left
  ambiguous through the actual cutover PR. **Non-blocking follow-up.**
- **Migration ambiguity volume is unknown until a real dry-run runs** — D's own spec already flags
  this as a risk (inherited from the master architecture's §15.3); this review does not add a new
  risk, only confirms it remains accurately characterized as unquantifiable until real data is
  available, and that D's rollout plan (report-only dry-run first, explicit acceptance gate before
  apply) is the correct mitigation already in place.
- **`app/portfolio/page.tsx` size (8,800+ lines)** — every ticket that touches this file (A, B, C, D)
  independently notes the SWC-parser-trap risk and the "full Vercel build required, not just `tsc
  --noEmit`" requirement. This is consistent across all four, not contradictory, but worth restating
  here as a compounding risk across four sequential PRs against the same large file — recommend the
  PR sequence (§11 of this document, i.e., the implementation sequence below) treat each ticket's
  `page.tsx` touch as its own isolated PR with its own full build verification, never batched with
  other changes, which is already what each spec's own rollout plan independently arrives at.

## 12. Security and fail-closed gaps

No new gap found. Verified specifically:

- Every allocation-mutating and lifecycle-transition API route re-validates server-side (B §4.2, D
  §13.1) — no route in any ticket trusts client-supplied state for a business-rule decision.
- The 60-second snapshot-staleness threshold (B §13) is the one genuinely new security-adjacent
  decision introduced by this epic (not present in the master architecture originally); it is now
  fully specified (server-configurable, refresh-and-retry UX) and consistently referenced by C and D's
  own specs wherever they call B's allocation-creation endpoint.
- Fail-closed behavior is consistent end-to-end: A's snapshot-level fail-closed (§9) → B's
  allocation-level fail-closed (§6.7) → C's execution-level fail-closed (§11, "short fills without
  sufficient foundation") → D's lifecycle-level fail-closed (§7, expiration; §8.2, PMCC assignment) →
  E's discovery-level fail-closed (§5 step 1, inherited directly from A). No ticket introduces a path
  that bypasses this chain.

## 13. Auditability and observability gaps

No blocking gap found. One documentation-completeness note: D's spec (§15) is the ticket that
actually produces the reconciliation-queue-depth and unresolved-assignment-count dashboards that A's
and B's own observability sections (A §13.2, B §14) explicitly anticipated without building — this is
correctly sequenced (D depends on A/B/C) and not a gap, but worth stating explicitly here as
confirmation that the anticipated metric actually gets built somewhere, not silently dropped.

## 14. Missing unit, integration, component, or acceptance tests

No missing test obligation found relative to what each ticket's own acceptance criteria require (see
traceability matrix §3 and §11 for the full enumeration — 29/29 acceptance criteria have a named test
in their owning ticket's own test matrix). The one soft duplication (Portfolio/Screener capacity
parity tested in both A and E) is addressed in §5 above, not a gap.

## 15. UX behavior not supported by the technical design

None found. Every mockup state identified in the traceability matrix §4 maps to an owning ticket and
an explicit rendering mechanism — no state in either checked-in HTML mockup requires a domain
capability absent from A–E's combined design.

## 16. Whether the implementation sequence is safe

Yes, with the one PR-assignment clarification from §4 applied (below). The epic's own execution
sequence (A→B→C→D, E parallel-eligible after A per its own documented exception) is internally
consistent with every ticket spec's own stated `Depends on:`/`Blocks:` headers, and no spec violates
it — verified against §6 (circular dependencies) above.

---

## 17. Explicit verification of all 25 named product decisions

Each item below cites the exact spec section establishing it, per this review's requirement to
"explicitly verify."

1. **`PmccOrigination` includes `UNKNOWN_MIGRATED`; migration never guesses** — Master architecture
   §5.2 (type), §5.4 ("`UNKNOWN_MIGRATED` is reserved exclusively for LCC-0001D's migration path...
   and is never assigned by either live entry workflow"), §10, §15.0, AD-4; B §4.1; D §12.2
   ("Every migrated `CoverageAllocation` carries `origination: 'UNKNOWN_MIGRATED'`
   unconditionally"). **Verified.**
2. **Live workflows assert only `CREATED_TOGETHER`/`ADDED_TO_EXISTING_LONG_CALL`** — C §6.2 ("tagged
   `origination: 'CREATED_TOGETHER'` directly by that workflow"), §6.3 ("`origination: null`" for
   equity, correctly never assigning a PMCC value to a non-PMCC allocation). **Verified.**
3. **Allocation writes require a snapshot ≤60s old** — B §13 ("the client includes its
   `PortfolioSnapshot.asOf` timestamp with the POST, and the server rejects (422) if that timestamp
   is older than... 60 seconds"). **Verified.**
4. **Staleness threshold server-configurable** — B §13 ("implemented as a server-configurable value
   (environment variable, not a hardcoded constant)"). **Verified.**
5. **Rejected stale writes produce refresh-and-retry** — B §13 ("the API returns a 422 with a message
   instructing the user to refresh... 'Your data is out of date — refresh and try again'").
   **Verified.**
6. **`calledAwayReturn` reuses `calcCalledAwayProfit`** — C §7.1 ("composed **around** the existing,
   imported `calcCalledAwayProfit`"). **Verified.**
7. **Incomplete basis → null called-away return** — C §7.1 (`if (!foundation.basisComplete ||
   foundation.basis == null) return null;`). **Verified.**
8. **Dividend/assignment risk uses LOW/ELEVATED/UNKNOWN** — C §8.1 (`DividendAssignmentRiskState =
   'LOW' | 'ELEVATED' | 'UNKNOWN'`). **Verified.**
9. **Missing dividend data always → UNKNOWN, never LOW** — C §8.1 ("`dataAvailable === false` →
   `state: 'UNKNOWN'`... unavailable dividend data is never silently classified as `LOW`").
   **Verified.**
10. **Scanner gives UNKNOWN equal prominence to ELEVATED** — E §8.1 ("`state: 'UNKNOWN'` → rendered
    identically prominently to `ELEVATED`, never downgraded"). **Verified.**
11. **Expiration outcomes require authoritative broker evidence** — D §7 ("broker positions,
    executions, transactions, and assignment activity are **authoritative** for expiration
    outcomes"). **Verified.**
12. **Market expiration price advisory only** — D §7 ("Market expiration-price data is **advisory
    only**... never by itself determines whether a cycle resolves"). **Verified.**
13. **Missing/contradictory evidence → reconciliationRequired** — D §7 ("Any other case... →
    `outcome: 'reconciliationRequired'`"). **Verified.**
14. **`partiallyFilled` explicit state, finalized transitions** — D §5 ("kept as an explicit lifecycle
    state by decision, confirmed as a necessary refinement... Its transitions (`open`, `cancelled`,
    `reconciliationRequired`) are final"). **Verified.**
15. **`CorrectionEvent` cannot fabricate cash flow** — D §4 ("A correction NEVER carries a cash-flow
    delta field... this type cannot represent a fabricated cash flow"). **Verified.**
16. **Existing PMCC ranking/scoring unchanged** — E §6, §16 ("this module changes zero lines of
    `pmccScore.ts`"). **Verified.**
17. **`findPmccs` is only a thin wrapper** — E §6 ("the thinnest of the four launcher modules, by
    design... a pass-through wrapper, not new logic"). **Verified.**
18. **Four scanner workflows supported** — E §4 (Find LEAPS), §5 (Find Covered Calls), §6 (Find
    PMCCs), §7 (Calls Against My Positions). **Verified.**
19. **Portfolio displays actual equity holdings** — A §11. **Verified.**
20. **Portfolio and scanner use same unified snapshot** — A §6 (single-fetch boundary), E §5 ("reads
    a shared `PortfolioSnapshot`/`CoverageAllocation[]`... satisfied by construction, since... there
    is no second timestamp to disagree"). **Verified.**
21. **Old independent CC capacity path retired/adapted** — A §3 ("absorbed, not deleted"), E §3
    ("replace at the call site only... the function itself remains in place, unwired"). **Verified**
    — with the timing nuance noted in §4/§11 of this review (E's spec is where the actual cutover PR
    is executed; this is documented consistently, not contradictorily, across A and E).
22. **Saved plans cannot become positions without execution evidence** — C §5 ("A `SavedPlan` is
    structurally incapable of creating a `CoverageAllocation`"). **Verified.**
23. **Foundation closure blocked while active dependent short call exists** — B §6.5
    (`canCloseFoundation`). **Verified.**
24. **No uncovered-state override in initial release** — Master architecture §15.0 ("there is no
    'authorized uncovered state' path in LCC-0001D"); B §6.5 ("no override parameter, no 'authorized
    uncovered' flag, no privileged bypass"). **Verified.**
25. **Migrated relationships evidence-driven and idempotent** — D §12.1 (cross-bucket pairing,
    evidence-driven), §12.3 ("deterministic id derivation... re-running... is a no-op"). **Verified.**

**All 25 items independently confirmed against the current, published specifications. No discrepancy
found.**

---

## 18. Final implementation sequence

Consolidates all five tickets' individual rollout plans into one ordered, cross-ticket sequence,
resolving the one PR-assignment overlap identified in §4.

| # | PR | Ticket | Entry criteria | Exit criteria | Required tests | Approval gate | Rollback/flag |
|---|---|---|---|---|---|---|---|
| 1 | `lib/portfolio-snapshot/types.ts` + `normalizeEquity.ts`, no wiring | A | None | Unit tests pass, zero consumer wiring | A §15 unit suite, ported `covered-call-capacity.test.ts` fixtures pass verbatim against new module | Code review only | N/A — pure addition |
| 2 | Complete snapshot module + `PortfolioDataProvider` wiring, flagged off | A | PR 1 merged | Flag exists, off by default, zero visible change | A §15 integration suite | Code review | Feature flag |
| 3 | Equity-row Portfolio UI, flagged independently | A | PR 2 merged | Mockup states render correctly behind flag | A §15 component tests, full Vercel build | Code review + Diane (mockup fidelity) | Feature flag |
| 4 | Shadow-mode CC capacity parity logging | A | PR 3 merged | Parity diff logged, zero live cutover yet | A §15 parity test | Code review | N/A — logging only |
| 5 | `lib/coverage/types.ts` + `invariants.ts`, no wiring | B | A complete (Gate A) | Unit tests pass | B §15 invariant tests | Code review | N/A |
| 6 | `deriveStrategy.ts` + `inference.ts` | B | PR 5 merged | Strategy projections correct against A's fixtures | B §15 projection tests | Code review | N/A |
| 7 | `/api/coverage-allocations` routes + `store.ts`, incl. 60s staleness check | B | PR 6 merged | Server-side re-validation confirmed, staleness threshold configurable and tested | B §15 integration tests | Code review + security review (staleness threshold, server-side trust boundary) | N/A — no consumer yet |
| 8 | `PortfolioDataProvider` wiring, inference in suggestion-only mode, flagged | B | PR 7 merged | Inference creates `proposed`-status allocations only, requires confirmation | B §15 ambiguous-import tests | Code review | Feature flag, independent of A's |
| 9 | Portfolio allocation/strategy UI, flagged | B | PR 8 merged | Mixed Position/Blocked Close mockup states render | B §15 component tests, full Vercel build | Code review + Diane | Feature flag |
| 10 | Enable B enforcement (blocking behavior default) | B | PR 9 stable, reconciliation-adjacent queue surfaced | Blocking behavior live | B §15 full regression | Product sign-off (Ian/Paul) | Flag removal is the rollback boundary |
| 11 | `lib/position-entry/*` types, `calculations.ts` incl. `calledAwayReturn`, `dividendAssignmentRisk.ts`, `pmccValidation.ts` | C | A+B complete (Gate B) | Unit tests pass, Alan's sign-off on golden calculation fixtures | C §16 unit tests | **Alan (calculation approval, blocking)** | N/A |
| 12 | `/api/position-entry-plans`, `/position-entry-executions` routes + stores | C | PR 11 merged | Upsert-without-overwrite verified | C §16 integration tests | Code review | N/A |
| 13 | `leapsOnly.ts` workflow + UI wiring, flagged | C | PR 12 merged | LEAPS-only entry path works end to end | C §16 workflow tests | Code review | Feature flag, per-workflow |
| 14 | `stockCoveredCall.ts` + `callAgainstPosition.ts` workflows, flagged | C | PR 13 merged | Both workflows create correct allocations | C §16 | Code review | Feature flag, per-workflow |
| 15 | `newPmcc.ts` workflow, flagged | C | PR 14 merged | Two-leg partial-fill handling verified | C §16 partial-fill matrix | Code review | Feature flag |
| 16 | `buyWrite.ts` workflow, flagged | C | PR 15 merged | Shared-order-reference linking verified | C §16 | Code review | Feature flag |
| 17 | `lib/lifecycle/types.ts` + `transitions.ts`, no wiring | D | A+B+C complete (Gate C) | State-machine guard passes every table row (including `partiallyFilled`) | D §16 transition tests | Code review | N/A |
| 18 | `roll.ts`, `expiration.ts` (authoritative-evidence), `assignment.ts` | D | PR 17 merged | Roll's 3-operation sequence verified non-mutating; expiration falls back to `reconciliationRequired` correctly | D §16, Alan (roll/called-away golden fixtures) | **Alan (blocking)** | N/A |
| 19 | `foundationReplacement.ts`, `reconciliation.ts`, `corrections.ts` | D | PR 18 merged | Every `detect*` function covered | D §16 | Code review | N/A |
| 20 | Lifecycle API routes + `store.ts` + `PortfolioDataProvider` wiring, flagged | D | PR 19 merged | Server-side transition re-validation confirmed | D §16 integration | Code review | Feature flag, independent |
| 21 | Portfolio UI for roll/assignment/replacement/reconciliation, flagged | D | PR 20 merged | Mockup states render | D §16 component tests, full Vercel build | Code review + Diane | Feature flag |
| 22 | Migration dry-run (report-only), against production-like data | D | PR 21 stable | Ambiguity report + before/after P/L diff produced, **no live writes** | D §16 migration tests | **Alan (P/L comparison tolerance) + Quinn (acceptance framework)** | N/A — report-only |
| 23 | Migration apply + rollback, gated on explicit ambiguity-report acceptance | D | PR 22 reviewed and accepted | Idempotent rerun verified, rollback tested pre- and post-accept | D §16 apply/rollback tests | **Product sign-off on accepted ambiguity report (blocking, per-batch)** | Staged rollback until broker sync validated |
| 24 | Enable D enforcement (blocking behavior default) | D | PR 23 stable, post-migration broker sync validated | Full lifecycle enforcement live | D §16 full regression | Product sign-off | Flag removal boundary |
| 25 | `findLeaps.ts` scoring + fixtures | E | A+B+C complete (may start parallel to D per execution sequence's explicit exception) | Unit tests pass | E §13, **Alan (LEAPS golden fixtures)** | **Alan (blocking)** | N/A |
| 26 | LEAPS launcher UI + result card, flagged | E | PR 25 merged | Renders, no coverage dependency | E §13 | Code review | Feature flag |
| 27 | `findCoveredCalls.ts` new capacity path, **shadow mode** alongside existing call site | E | A's PR 4 (shadow logging) + B complete | Shadow parity clean for agreed window (§11 finding — window length to be decided, non-blocking follow-up) | E §13 parity test | Code review | N/A — shadow only |
| 28 | **Cutover**: line ~7739 switched to shared snapshot; this is the single PR resolving the A/E overlap in §4 | E | PR 27 parity clean | Old `getCoveredCallCapacityReport()` unwired from live call site | E §13, A's original parity test now runs as pre-cutover regression only | Product sign-off (Gate A + Gate E closure) | Revert = re-point call site back; old function still present |
| 29 | `findPmccs.ts` wrapper + `callsAgainstPositions.ts`, flagged | E | B+C complete | Zero-diff regression against pre-existing PMCC ranking confirmed | E §13 ranking regression | Code review | Feature flag |
| 30 | `ScannerTransparencyPanel.tsx` incl. dividend/assignment consumption | E | C's `dividendAssignmentRisk.ts` available (PR 11) | UNKNOWN/ELEVATED visual parity verified | E §13 component test | Code review + Diane | Feature flag |
| 31 | Epic-wide production cutover: all flags default-on | All | PRs 1–30 stable in production for an agreed bake period | All five gates (A–E) closed per execution sequence | Full cross-ticket regression | **Full team sign-off (Ian, Paul, Alan, Quinn, Diane, Dane)** | Per-ticket flags remain available individually |

This sequence is the definitive answer to §4's overlap: PR 28 is the single cutover PR; A's original
"PR 5" and E's original "PR 3–4" language both describe pieces of PRs 27–28 above, consolidated here
rather than executed twice.

---

## 19. Findings, separated by severity

### BLOCKERS

None.

### NON-BLOCKING FOLLOW-UPS

1. **Shadow-mode monitoring window is unspecified** (§11) — decide a concrete duration or sample-size
   threshold before executing PR 27/28 above; does not block earlier PRs.
2. **`app/api/positions/route.ts`** (§9) — orphaned, likely-dead server-side code with the same filter
   bug LCC-0001A fixes elsewhere; recommend a small separate cleanup ticket to confirm no caller
   exists and delete it. Does not block any LCC-0001 PR.
3. **Portfolio/Screener capacity parity test duplication** (§5, §14) — A's and E's versions of this
   test should be explicitly re-labeled at implementation time (A's as pre-cutover regression, E's as
   the production guarantee) rather than left as two same-named tests; a documentation/test-naming
   task, not a design change.

### OUT-OF-SCOPE SEPARATE TICKETS

1. **`PMCC_SPECIFICATION.md` vs. `lib/scans/pmccScore.ts` scoring conflict** — remains explicitly
   out of scope for LCC-0001 in its entirety, per the resolved product decision (master architecture
   §15.0) and reaffirmed by every subsequent ticket (most recently E §6, §16: "this ticket does not
   touch that conflict, consistent with every prior ticket in this sequence"). This review does not
   resolve, implement, or take a position on which model should prevail — it is administratively
   noted (per the master architecture's own §15.1.1) that someone still needs to file the separate
   prerequisite/product-decision ticket for this; this review recommends that filing happen
   independently of LCC-0001's own implementation timeline, since it has no dependency on LCC-0001's
   completion in either direction.
2. **Future "authorized uncovered state" override** — explicitly deferred to its own future ticket
   with its own authorization/audit requirements, per the resolved product decision (master
   architecture §15.0). Not proposed, not designed, not scoped by this review.
3. **Multi-account aggregation** — remains genuinely open per the epic itself (not something any
   ticket in this epic was asked to resolve); no action from this review beyond confirming it stays
   out of scope.

---

## 20. Final verdict

# READY WITH NON-BLOCKING FOLLOW-UPS

All 29 acceptance criteria, all 15 epic invariants, all 10 release-definition outcomes, and all 25
explicitly-requested product decisions are verified, traceable, and internally consistent across the
five ticket specifications, the master architecture, and the architecture review. No blocking
contradiction, missing dependency, circular dependency, type collision, or unresolved product decision
was found. The three non-blocking follow-ups above (shadow-mode window sizing, one piece of
orphaned/dead code, one test-naming clarification) do not require any specification change and can be
resolved during implementation without gating the start of LCC-0001A. The `PMCC_SPECIFICATION.md`
scoring conflict correctly remains outside LCC-0001's scope in every ticket and in this review, and is
not resolved or implemented here.
