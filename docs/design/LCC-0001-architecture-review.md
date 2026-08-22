# LCC-0001 — Architecture Review

**Reviewing:** `docs/design/LCC-0001-technical-architecture.md`
(published at commit `110f2db`, branch `docs/lcc-0001-requirements`)
**Reviewer:** Dane (self-review, pre-LCC-0001A)
**Compared against:** LCC-0001 epic, execution sequence, tickets A–E, `PMCC_SPECIFICATION.md`, both
checked-in mockups, and the current application code cited in the architecture document.
**Does not implement application code.**

---

## 1. Requirement-to-architecture coverage matrix

| Source requirement | Architecture section(s) | Coverage |
|---|---|---|
| Epic: two incomplete portfolio views (problem statement) | §2.1, §3 | Full — root cause correctly located at `acquisition.ts:952-953` |
| Epic: long call can exist independently of a short call | §5.4 (LongCallOnly), §8 | Full |
| Epic: durable short-call ↔ foundation relationship | §4.4, §5.2 | Full |
| Epic: rolls/assignment/partial fills/repeated cycles need a lifecycle model | §7 | Full |
| Epic invariants 1–15 (cross-ticket) | §5.3, §7, §12 | Full, see §6 below for one gap |
| Epic release definition (10 user-facing outcomes) | Distributed across §4–§11 | Full, not restated as a checklist — **minor correction recommended, §9** |
| Epic non-goals | Not explicitly restated | **Gap — §9** |
| Execution sequence + 5 gates (A–E) | §14 | Full — sequence adopted verbatim, correctly |
| LCC-0001A scope, source-of-truth rules, fail-closed behavior, acceptance criteria | §4.2, §5.1, §6, §12 | Full |
| LCC-0001B allocation model, invariants, derived strategies, inference/confirmation rules | §4.4, §5.2–5.4, §7.1 | Full |
| LCC-0001C workflow boundary (discovery/planning/execution/tracking), required calculations, PMCC validation, partial execution | §4.5, §8 | Partial — **required-calculation list not individually mapped, §5** |
| LCC-0001D lifecycle transitions, roll, expiration, assignment, foundation replacement, reconciliation, corrections, migration | §4.5, §7.2–7.6, §10 | Full, with one factual correction needed to the migration detector, §3 below |
| LCC-0001E scanner reframing, four launchers, transparency fields, PMCC risk checks, existing-code preservation | §4.6, §11 | Full for structure; transparency field list not individually mapped, **§5** |
| `PMCC_SPECIFICATION.md` | §2.3, §11, §15.0/§15.1 | Full — conflict identified and correctly routed to a separate ticket per resolved product decision |
| Product decisions resolved after architecture review (foundation protection, PMCC origination, PMCC scoring) | §15.0 and cross-referenced updates | Full — verified consistent everywhere referenced (§4.4 type sketch, §5.4, §7.3/7.6, §12, AD-0/AD-4) |

**Overall requirement coverage: high.** No epic invariant, ticket acceptance criterion, or resolved
product decision is contradicted. The two partial items (§9, required-calculation and
scanner-transparency field lists not individually enumerated) are presentation gaps, not
architectural gaps — the underlying design already supports every listed calculation/field, they are
simply not cross-referenced item-by-item in the master document. Recommend fixing before LCC-0001C/E
specs are written, since those specs will need the granular mapping anyway.

---

## 2. Mockup-to-architecture coverage

Checked against the execution sequence's own "Mockup map" table and a structural scan of both HTML
files' state labels.

| Mockup state (from execution sequence's mockup map + direct HTML scan) | Architecture coverage |
|---|---|
| Mixed AAPL Position (shares + option same underlying) | §5.4 derived-strategy grouping — covered |
| Stock-Only Holding | §5.4 `StockOnly` — covered |
| Basis Incomplete | §5.1 `basisComplete`, §7.1 — covered |
| Data Unavailable | §6, §12 fail-closed table — covered |
| Share allocation / Coverage capacity | §5.2, §7.1 — covered |
| Related option / Working Reservation | §5.2 `status: 'proposed'`, §7.1 — covered |
| Blocked Close | §7.6, §12 (now unconditional per §15.0) — covered |
| AAPL assignment reconciled / Completed strategy history | §7.4, §10 — covered |
| Screener Result / LEAPS Result / PMCC Plan / Existing Coverage | §8 (discovery/planning/execution-evidence boundary) — covered |
| Ranked opportunities / Ranked LEAPS opportunities | §11 — covered |
| "What supports this short call?" (coverage choice dialog) | §5.3 rule 7 fail-closed, §4.4 `inference.ts` — covered |
| Confirm actual fills / Match the proposed trade | §8 `ExecutionRecord` — covered |
| Long-call foundation / Active short call / Completed short-call cycles | §5.2, §7.2 — covered |
| Review roll / Close current cycle / Open next cycle | §7.3 — covered |
| Today's priorities / Resolve AAPL assignment | §7.4, reconciliation queue (§10, §13.2) — covered |
| PMCC opening did not complete / Choose the intended MSFT relationship | §5.3, §12 (ambiguous foundation row) — covered |
| Review foundation replacement / Close original | §7.5 — covered |
| Covered-call capacity could not be verified | §6, §12 — covered |

**Coverage: complete.** Every distinct mockup state identified maps to an explicit architectural
mechanism. No mockup state requires a UI capability the domain model cannot support. One presentation
note: the master document does not explicitly walk through either mockup's HTML file section-by-
section — it covers the *states* via the execution sequence's summary table rather than the mockups
directly. That was a reasonable shortcut for a first pass but should be tightened in LCC-0001C's spec,
which is the ticket that actually owns UI/mockup-to-component mapping.

---

## 3. Current-code refactoring map validation

Re-verified each concrete file/line claim in the architecture document against the current repo.

| Claim in architecture doc | Verified? | Notes |
|---|---|---|
| `acquisition.ts:952-953` filters to `Equity Option`/`Index Option` | **Confirmed** | Exact line numbers still correct at reviewed commit. |
| `covered-call-capacity.ts` is a separate, independent acquisition path | **Confirmed** | `normalizeEquityHoldings`/`normalizeShortCallExposure`/`normalizeWorkingCallReservations`/`buildCoveredCallCapacityReport` all present and structured as described. |
| `Position` (types.ts) is entirely option-shaped, no equity type exists | **Confirmed** | |
| `closeOrderSafety.ts`'s `identity`/`structureAmbiguous` fail-closed pattern | **Confirmed** | |
| `positionLifecycle.ts::isPmccPosition()` is "the current best-available detector" for migration (§10) | **Needs correction** | See finding below. |
| `pmccScore.ts` is a 2-factor ROI/liquidity + earnings-deduction model, no WMD/RSI/4-pillar logic | **Confirmed** | |
| `screenerCandidateAdapter.ts` line 8 documents the PMCC/CC Best-Opportunities exclusion as intentional | **Confirmed** | Comment text matches. |
| `covered-call-finder.ts` already runs through the standard `runCcScan`/`ScreenResult` pipeline | **Confirmed** | Matches `screenerCandidateAdapter.ts`'s own comment trail, as cited. |
| `stopPolicyStore.ts` establishes the Redis persistence convention to reuse | **Confirmed** | |
| `CONTRACT_MULTIPLIER = 100` (positionMetrics.ts) assumed as the sole standard-multiplier reference | **Needs correction** | See finding below. |

### Finding A — `isPmccPosition()` is very unlikely to fire in production today

`acquisition.ts` buckets raw broker positions by `${underlying-symbol}::${expires-at date}` **before**
`classifyPositionLifecycle()` (and therefore `isPmccPosition()`) ever runs. A PMCC's long and short
calls have different expirations by construction, so under this bucketing they are already loaded as
**two separate `Position` objects**, each with a single expiration's legs. `isPmccPosition()` requires
both a short leg (<60 DTE) and a long leg (>120 DTE) to appear together in the *same* legs array it is
given — which, given the bucketing, essentially cannot happen for a real PMCC in current production.
This function's own module comment even flags a narrower version of this same fragility ("Known
limitation... checks expiration gap only, not moneyness") without noting the more fundamental issue
that it may rarely see the right leg set at all.

**Implication for the master document:** §10 (migration) currently proposes
`positionLifecycle.ts::isPmccPosition()` as "the current best-available detector" for identifying
existing PMCC records to migrate. That's the wrong tool for the job as described — it detects PMCC-
shaped *legs within one bucketed Position*, which structurally excludes real PMCCs. The actual
migration detector needs to **pair positions across the existing underlying-keyed buckets** (same
underlying, one long call far-dated, one short call near-dated, opened close in time or evidenced by
existing `pmccPairing.ts`/`pmccChainAdapter.ts` conventions) rather than rely on this function.

This is good news, not bad news, for the architecture's core thesis: it means PMCC legs in production
are **already stored as independent Position objects** today, with no fused-position data structure to
untangle. Migration is therefore about *creating the missing relationship* between two already-
separate positions, not about *splitting* a fused one. §10's "Convert existing PMCC records into...
independent long-call foundations, independent short-call cycles" language is still directionally
correct, but the "conversion" is lighter-weight than implied — recommend rewording §10 point 1 and
correcting the detector reference. See §9 (corrections) for exact wording.

### Finding B — adjusted-contract multiplier already has a home the master doc doesn't cite

`lib/scans/financials.ts` already exports `STANDARD_EQUITY_OPTION_MULTIPLIER = 100` and
`resolveOptionContractMultiplier(raw)`, which is the actual existing mechanism for adjusted-deliverable
handling (falls back to standard when unset, otherwise validates and uses the broker-reported value).
This is a better and more complete existing reference than `positionMetrics.ts`'s bare
`CONTRACT_MULTIPLIER = 100` constant, which the master document's §15.2 currently cites as the sole
prior art for "adjusted-deliverable handling is carried as a flag/override... consistent with existing
`CONTRACT_MULTIPLIER` usage." Recommend citing `resolveOptionContractMultiplier` instead/in addition —
it's a closer match to what LCC-0001B's allocation model needs (`contractMultiplier` field, adjusted
deliverable evidence).

### Structural note (not a defect): no PMCC/diagonal `StructureType`

`closeOrderSafety.ts`'s `StructureType` enum is `'NAKED' | 'VERTICAL' | 'IRON_CONDOR'` only — there is
no PMCC/diagonal structure type. This is consistent with, and further supports, Finding A: the
close-order-safety layer was never built to treat a PMCC as one fused structure, because (per the
bucketing behavior) it never receives one. This validates AD-1 (wrap the existing option adapter
unchanged) — there is no PMCC-shaped hole in `closeOrderSafety.ts` that LCC-0001B needs to patch,
because `closeOrderSafety.ts` already correctly treats PMCC legs as two independent, individually
closeable positions. No correction needed here, but worth stating explicitly in the master document
as supporting evidence for AD-1, since it currently asserts the wrap-not-replace decision without
this specific piece of confirming evidence.

---

## 4. Missing or ambiguous requirements

1. **Epic non-goals are not restated or cross-checked** (§9 below) — low risk, since nothing in the
   architecture proposes any of the six listed non-goals, but an explicit "we checked, none of these
   are proposed" line would close the loop for reviewers who don't want to re-derive that themselves.
2. **LCC-0001C's per-calculation list** (gross premium, current liability, realized/unrealized
   splits, net strategy basis, called-away return, initial theoretical max loss) is not mapped
   field-by-field to where each is computed in the target architecture. The design supports all of
   them conceptually (§7, §5.2's allocation carries what's needed) but the master document doesn't
   show its work here. Not a defect, but should be closed before LCC-0001C's own spec is written,
   since that document will need this table anyway.
3. **LCC-0001E's scanner-transparency field list** (quote timestamp, bid/ask, slippage, fees,
   volatility/dividend assumptions, leg deltas, intrinsic/extrinsic, liquidity, etc.) is asserted as
   "displayed or made progressively available" by reuse of existing Screener infrastructure, but the
   master document doesn't confirm which of these fields the *existing* result-card/PMCC-modal code
   already surfaces versus which are net-new. This is squarely LCC-0001E-spec territory, not a gap in
   this document's scope, but flagging it here so it isn't silently assumed complete.
4. **Ambiguous:** §5.4's rule for distinguishing "call later written against existing LEAPS" from
   "PMCC created together" uses "single roll cycle count 0" and "pre-dates the allocation... by more
   than a trivial window" as classification signals in the table, but only the resolved decision
   (§15.0) actually defines the persisted `origination` field — the *detection* logic (how the system
   decides which enum value to assign at allocation-creation time) is still described informally
   ("more than a trivial window") rather than precisely. This should be tightened: origination should
   be a value the **workflow itself asserts** at execution-evidence time (a PMCC opened via the "New
   PMCC" workflow tags `CREATED_TOGETHER`; a call added via "Sell Call Against Position" against an
   existing long call tags `ADDED_TO_EXISTING_LONG_CALL`) rather than inferred after the fact from
   timestamps. This is simpler, removes the "trivial window" ambiguity entirely, and matches how
   LCC-0001C's workflow boundary already distinguishes these two entry paths. **Recommend as a
   correction, §9.**

---

## 5. Contradictions and unresolved product decisions

- **No contradictions found** between the master document and the epic, the five tickets, the
  execution sequence, or the two mockups, after the three product decisions recorded in §15.0 (this
  review confirms those updates are applied consistently everywhere they touch — allocation type
  sketch, invariant list, fail-closed table, architecture-decision list).
- **`PMCC_SPECIFICATION.md` is a very short document (21 lines)** — essentially a single scoring-
  engine ticket, not a competing full specification. The master document's treatment of it (§2.3,
  §11) is proportionate; nothing in this review changes that assessment. The resolved product
  decision (§15.0) correctly defers reconciliation to a separate ticket rather than trying to resolve
  it here.
- **One remaining open item, correctly flagged as administrative rather than architectural**: per
  §15.1.1, someone (Paul or Dean, per the doc) still needs to actually file the separate
  prerequisite/product-decision ticket for the `PMCC_SPECIFICATION.md` vs. `pmccScore.ts` conflict.
  This review recommends that filing happen before or in parallel with LCC-0001A, so it doesn't get
  lost once implementation work starts.
- **Multi-account aggregation** (§15.1.3/5) remains genuinely open per the epic itself, not something
  this architecture document was expected to resolve. No action needed beyond what's already noted.

---

## 6. Data-model and lifecycle completeness review

- **`CoverageAllocation`** (§5.2) covers every field the epic/LCC-0001B ask for: account, underlying,
  short-call identity/quantity, foundation type/identity/quantity, multiplier, effective timestamps,
  status, source, audit history, plus the now-added `origination` field. Complete.
- **Short-call lifecycle state machine** (§7.2) matches LCC-0001D's transition table exactly,
  including the three prohibited-by-omission transitions (no `Closed → *`, no `Expired → Open`, etc.
  implied by only listing allowed edges). Complete.
- **Roll representation** (§7.3) correctly avoids in-place mutation and matches the epic's invariant 7
  and LCC-0001D's explicit roll acceptance criterion. Complete.
- **One completeness gap:** the epic's invariant 12 ("Cancelled, rejected, expired, or otherwise
  inactive orders release reservations appropriately") is implicitly covered by §7.2's state machine
  (a `Pending → Cancelled/Rejected` transition exists) but the master document never explicitly states
  that a `'proposed'` allocation (§5.2, tied to a working order) is released/deleted when its backing
  order is cancelled or rejected. The state machine covers the *option position's* state; it doesn't
  explicitly say the **allocation record** tied to that pending order is torn down in lockstep. This
  is very likely the intended behavior given the rest of the design, but it should be stated as an
  explicit rule in §5.3 or §7.2, not left implicit. **Recommend as a correction, §9.**
- **Assignment (§7.4)** correctly handles both the stock-covered and PMCC cases per LCC-0001D's
  acceptance criteria, including the fail-closed basis-completeness gate. Complete.
- **Foundation replacement (§7.5)** matches LCC-0001D's scope exactly, including retaining both
  foundations permanently. Complete.

---

## 7. Failure-mode and reconciliation review

- The consolidated fail-closed table (§12) correctly incorporates the corrected, unconditional
  foundation-close block from §15.0.
- The unattributable-exposure fail-closed behavior (§6, §12) correctly ports `covered-call-
  capacity.ts`'s existing, already-hardened "final corrective pass" logic rather than re-deriving it,
  which this review considers the single best risk-reduction decision in the document — that logic
  has already been through multiple corrective rounds in production and re-implementing it from
  scratch would be strictly worse.
- **Gap:** reconciliation-queue *triggers* are listed at the ticket level (LCC-0001D's own scope
  section — missing events, duplicate executions, corrected/reversed executions, snapshot/history
  disagreement, adjusted contracts, ambiguous coverage, manual-then-broker-matched records) but the
  master document's §10/§13.2 only names "reconciliation queue depth" as an observability metric
  without restating which specific conditions populate that queue. Since LCC-0001D's own ticket
  already enumerates this exhaustively, the master document doesn't need to duplicate it verbatim, but
  it should at minimum reference "see LCC-0001D ticket for the full trigger list" explicitly rather
  than only naming the metric. **Minor, recommend as a correction, §9.**
- **Broker correction / reversal handling** (LCC-0001D acceptance criterion: "broker reverses an
  assignment... TradeEdge records a reversal event... without deleting history") is covered under the
  general "Corrections" principle in §7.6 but not given its own explicit walk-through the way roll and
  assignment are. Given this is called out as its own acceptance criterion in LCC-0001D, it would
  benefit from the same explicit treatment §7.3/§7.4 get. Deferred to the LCC-0001D spec rather than
  required here, since this master document is already reasonably specific for this section relative
  to its level of detail elsewhere.

---

## 8. Security, observability, migration, and testing gaps

- **Security (§13.1):** adequate for this stage. The one enforcement mechanism named as a mitigation
  ("enforce via code review + a lint rule / module boundary if the repo has one") is explicitly
  hedged/uncertain in the document itself. Recommend resolving this uncertainty before LCC-0001B
  implementation begins — confirm whether the repo has an existing module-boundary enforcement
  mechanism (e.g., dependency-cruiser, ESLint import restrictions) to point at, or explicitly decide to
  add one. Not a blocking gap for this review, but shouldn't carry forward as an open hedge into the
  LCC-0001B spec.
- **Observability (§13.2):** the shadow-mode parity logging plan is sound and directly reuses the
  existing `warnings: string[]` pattern. See §7 above for the one reconciliation-trigger
  cross-reference gap.
- **Migration (§10):** directionally sound; requires the Finding-A correction (§3) to its detector
  reference. The dry-run/staging/rollback design (hold proposed writes outside the live store until
  acceptance) is a good pattern and needs no changes.
- **Testing (§13.3):** the matrix is complete against every ticket's own Validation section, and the
  explicit call-out of golden fixtures requiring Alan's approval is correctly scoped. One addition
  worth making: given Finding A, the migration test suite should explicitly include a test case for
  "two independently-bucketed positions (long far-dated call + short near-dated call, same
  underlying, no existing relationship) get correctly paired and migrated" — the current test-matrix
  row ("Migration: simple, rolled, partial, closed, ambiguous") doesn't obviously include this
  already-separate-positions case, which per Finding A is actually the **common** case, not an edge
  case. **Recommend as a correction, §9.**

---

## 9. Specific corrections recommended for the master document

1. **§10 (Migration), point 1:** replace the `isPmccPosition()` detector reference. Correct wording
   should describe pairing across the existing underlying-keyed position buckets (long-dated call +
   near-dated short call, same underlying, deliverable-compatible) rather than relying on
   `positionLifecycle.ts::isPmccPosition()`, which structurally cannot see both legs together under
   the current `underlying::expiration` bucketing (Finding A, §3).
2. **§15.2 (Assumptions):** replace or supplement the `CONTRACT_MULTIPLIER` (positionMetrics.ts)
   citation with `resolveOptionContractMultiplier`/`STANDARD_EQUITY_OPTION_MULTIPLIER`
   (lib/scans/financials.ts) as the reference implementation for adjusted-deliverable handling
   (Finding B, §3).
3. **§5.4:** replace the informal "pre-dates the allocation... by more than a trivial window" timing
   heuristic with a workflow-asserted rule: origination is set directly by which LCC-0001C entry
   workflow created the allocation (New PMCC → `CREATED_TOGETHER`; Sell Call Against Position against
   an existing long call → `ADDED_TO_EXISTING_LONG_CALL`), never inferred from timestamps after the
   fact (§4, item 4).
4. **§5.3 or §7.2:** add an explicit rule that a `'proposed'` `CoverageAllocation` tied to a working
   sell-to-open order is released (not merely left stale) when that order is cancelled or rejected,
   closing the implicit gap noted in §6.
5. **§10/§13.2:** add an explicit cross-reference to LCC-0001D's full reconciliation-trigger list
   rather than only naming "reconciliation queue depth" as a metric (§7).
6. **§13.3 (Testing matrix):** add a migration test-matrix row for "already-independent positions,
   same underlying, no existing relationship, correctly paired" as a normal case, not folded silently
   into "simple" (§8).
7. **§9 in the reviewed document (new, minor):** add one line confirming the epic's six non-goals were
   checked against the proposal and none are inadvertently introduced (§4, item 1) — a completeness
   statement, not a design change.
8. **§3 (supporting evidence for AD-1):** add a short note that `closeOrderSafety.ts`'s absence of a
   PMCC/diagonal `StructureType` is confirming evidence (not a gap to patch) that the existing option
   adapter already treats PMCC legs as independent positions, consistent with Finding A.

None of these corrections change any architectural decision, invariant, API boundary, or the resolved
product decisions in §15.0. They are factual precision fixes (items 1, 2, 8), one design-tightening
simplification that removes an ambiguity rather than adding scope (item 3), and three documentation
completeness additions (items 4–7).

---

## 10. Final recommendation

**Approve with corrections.**

The master architecture document is sound: it correctly identifies the root cause of the current
two-views problem, proposes a canonical snapshot and allocation model that satisfies every stated
invariant and acceptance criterion across all five tickets, correctly reuses rather than replaces the
existing hardened option-position and capacity-calculation code, and correctly incorporates the three
product decisions resolved after the initial review. No contradiction with any approved requirement,
mockup, or prior sign-off was found.

The eight corrections above should be applied before LCC-0001A implementation begins, since two of
them (items 1 and 3) affect statements that later ticket specs and migration tooling will build on
directly, and applying them now is cheaper than discovering the discrepancy mid-implementation. None
of the corrections require a new team review cycle — they can be applied directly to
`docs/design/LCC-0001-technical-architecture.md` and re-published without changing the document's
approved shape or reopening any of the three resolved product decisions.

**Recommended next step:** apply corrections 1–8 to the master document, then proceed to
`docs/design/LCC-0001A-technical-spec.md`.
