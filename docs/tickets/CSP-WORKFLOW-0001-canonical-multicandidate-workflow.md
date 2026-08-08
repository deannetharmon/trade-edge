# CSP-WORKFLOW-0001 — Canonical Multi-Candidate CSP Workflow

**Status:** Partially implemented. Architectural core complete and tested;
UI/mode work explicitly deferred (see the companion implementation report
for the full disposition).

**Base:** `1ea2344` (docs: FIND CSP comprehensive workflow audit + team
review completion pass), itself on `fix/csp-candidate-discovery-correctness`
@ `c0ead1e`.

**Branch:** `feature/csp-canonical-multicandidate-workflow`

## Problem

The FIND CSP audit (`docs/reviews/FIND-CSP-Comprehensive-Code-Audit.md`)
established that TradeEdge's CSP scanner silently collapsed every symbol's
option chain down to one "best" contract before it ever reached the trader —
real, structurally valid puts (e.g. NKE's 39-strike and 38-strike, or AMD's
420/425/430 strikes) were discovered, evaluated, and then discarded. A CSP
option chain routinely has multiple tradeable candidates per symbol; the
one-candidate-per-symbol model was a structural defect, not a display
choice.

The audit also found market qualification (is this contract a good trade at
all) and account eligibility (can THIS account afford it) conflated into a
single boolean, and a flat $0.10 bid/ask liquidity rule that misclassified
proportionally-tight markets on cheap underlyings as universally "poor."

## Governing architecture (approved, see the audit's Team Review
Completion Pass, §22-23)

- One CSP option contract = one `ScreenResult`. One symbol may produce many.
- Every discovered contract gets one stable `candidateId`: a valid OCC
  symbol when present, else a validated `strategy:underlying:expiration:
  type:strike` composite fallback.
- Market qualification (`QUALIFIED` / `QUALIFIED_WITH_LIQUIDITY_WARNING` /
  `DISQUALIFIED_*`) and account eligibility (`ELIGIBLE` /
  `INSUFFICIENT_CAPITAL` / `CAPITAL_UNVERIFIED` / `ACCOUNT_UNSELECTED` /
  `STRATEGY_NOT_PERMITTED`) are independent axes. Neither may silently
  substitute for the other.
- Relative liquidity classification replaces the flat rule: `strongLimit =
  max($0.10, 10% of midpoint)`; width ≤ strongLimit → STRONG; up to 15% of
  midpoint → BORDERLINE (visible, warned, excluded from Best Opportunities
  by default); beyond that → POOR (market-disqualified, still visible for
  audit).
- CSP gets its own strategy-aware scoring module, independent of the
  generic Autopilot opportunity score, with documented fail-closed
  missing-data behavior.

## What shipped (see the implementation report for full detail and test
counts)

1. Candidate identity + canonical multi-candidate search
   (`lib/scans/candidateIdentity.ts`, `lib/scans/cspSearch.ts` rewrite).
2. Market-qualification / account-eligibility state model
   (`lib/scans/cspQualification.ts`, `lib/scans/csp-finder.ts` rewrite).
3. Session wiring: `runCspChecklist()` now returns one `ScreenResult` per
   candidate; Best Opportunities/CSV/React-key joins keyed by
   `candidateId` instead of `symbol+strategy`.
4. CSP-specific scoring module (`lib/scans/cspScore.ts`) wired into
   `runCspChecklist()`.
5. Session schema bump (v3 → v4), fail-closed cache invalidation.
6. Required NKE/AMD/capital/identity acceptance fixtures.

## Explicitly deferred (not built in this pass — see implementation report
"Remaining work")

- CSP-specific configuration modal (dialog/focus-trap/Escape/radio-group).
- Rank and Targeted modes for CSP (Filter only, today).
- The immutable per-session CSP rule snapshot and its "Active CSP Rules"
  display.
- DTE/expiration grouping UI, CSV per-candidateId schema rewrite,
  accessibility live-region announcements for the new multi-candidate
  layout.
- Real desktop/mobile browser verification (validated via the automated
  suite and a production build only).

See `docs/reviews/CSP-WORKFLOW-0001-Implementation-Report.md` for the full,
itemized account of what was built, what was deferred, and why.
# Phase 2 — Strategy-aware CSP workflow

The approved continuation adds a deliberate CSP configuration step and makes
Cash-Secured Put a legal canonical strategy in Filter, Rank, and Targeted
modes. The modal owns the CSP preset and confirmed rule set; the completed
session owns an immutable copy of those rules. CSP results use CSP-only
controls, CSP scoring, candidate-level CSV rows, and expiration/DTE grouping.
Targeted sessions do not inherit mutable Filter/Rank result controls.

Acceptance includes modal/focus/live-region behavior, strict schema-v6 cache
validation, truthful multi-candidate accounting, and preservation of the
existing market-qualification/account-eligibility separation. This phase does
not modify order construction or execution.
