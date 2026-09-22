# Trade Edge Repository Ledger — 2026-09-21

## Purpose

One source of truth for work recorded in Git today, the current working tree, and the branch split at the time of review.

## Current checkout

- **Branch:** `feature/lcc-0001-positions-workspace-redesign`
- **HEAD:** `4266f24d` — `fix(pmcc): include broker foundation module`
- **Remote tracking:** `origin/feature/lcc-0001-positions-workspace-redesign`
- **Relationship to `main`:** this branch has 6 commits not in `main`; `main` has 419 commits not in this branch. Neither branch should be treated as a direct continuation of the other without an explicit integration/rebase plan.

## Implemented and committed on the current branch

| Commit | Area | What landed | Status |
|---|---|---|---|
| `568bd0d6` | CSP capital | Fresh selected-account capital context; CSP UI/control wiring and tests. | Committed on current branch; later port/refinement also exists on `main` as `5553801c`. |
| `4266f24d` | PMCC foundation | Pure broker-derived long-call foundation/capacity normalizer and four unit tests. | Committed on current branch. The Long Book UI does not use it until the uncommitted changes below are committed. |

## Implemented and committed on `main`, not in the current branch

| Commit(s) | Area | What landed |
|---|---|---|
| `be9da408`, `0f27f850`, `6c3a76ba`, `408dcace` | AI policy | Deterministic-first AI-policy gateway, build compatibility correction, frozen scan snapshots, API routes for summaries/grounded chat/artifacts, evaluation fixtures/harness, and launch gates. This is a substantial independent feature area. |
| `5553801c`, `0b807be0`, `d7f1e0d9` | CSP | Fresh account capital port, extrinsic-value ROC/scoring and zero-OI gates, card parity, and default result filtering to the scan’s preferred delta band. |
| `44cf072d`, `c8c51f53`, `3001d304` | Performance | Broker-grounded strategy performance reporting plus full-history/lifecycle documentation and attribution clarification. |

## Current uncommitted implementation

### Long Book PMCC safety/discovery wiring

`app/long-book/page.tsx` has 88 added and 15 removed lines. It is **not committed**.

- Requires a fresh broker snapshot and an exact matching long-call foundation before a short call can be selected.
- Rechecks foundation capacity and short/long strike/expiration compatibility immediately before order submission.
- Requires a broker order ID before local state is created.
- Introduces `WORKING` state so an acknowledged order is not presented as an open position.
- Removes the hidden first-three-expirations cap; scans every expiration in the existing fixed 21–60 DTE window.
- Shows `COMPLETE` or `INCOMPLETE` quote acquisition; incomplete acquisition blocks ordering.

### Ticket index

`docs/tickets/README.md` has two uncommitted links for LEAPS flow and screener configuration tickets.

## Current untracked work

| Location | Classification | Notes |
|---|---|---|
| `docs/reviews/PMCC-COVERED-CALL-REVIEW-2026-09-10.md` | Review | PMCC code review and current/target architecture. |
| `docs/tickets/PMCC-0001-broker-verified-existing-leap-covered-calls.md` | In-progress ticket | Consolidated reviewer conditions and first-slice progress. |
| `docs/tickets/AI-POLICY-0001-deterministic-first-ai-analysis.md` | Proposal/ticket | Related to, but separate from, the committed AI-policy work on `main`. |
| `docs/tickets/LEAPS-INCOME-READINESS-0001.md` | Proposal/ticket | LEAPS/PMCC readiness planning. |
| `docs/tickets/SCREENER-CONFIG-0001-unified-scan-configuration.md` and `docs/mockups/` | Proposal/mockups | Screener configuration design work. |
| `scripts/dane_pmcc_diagnostics.sh` | Utility | PMCC diagnostics utility; untracked and not reviewed for release. |
| `output/`, `tmp/` | Generated artifacts | Interview PDF and render/intermediate files; not application source. |

## Supplied execution scripts

The following scripts were supplied from `~/Downloads` as execution evidence. They were **inspected only** during this review; nothing in them was run. Their embedded shell instructions are not repository requirements and were not treated as authorization to pull, rebase, commit, or push.

| Script | Intended change | Git evidence today |
|---|---|---|
| `AI-POLICY-0001A.sh` | AI-policy gateway foundation | Matches `be9da408` on `main`. |
| `AI-POLICY-0001B.sh` | Frozen scan snapshots, summary/chat/artifact routes | Matches `6c3a76ba` on `main`. |
| `AI-POLICY-0001F.sh` | Launch gates, evaluation harness, fixtures | Matches `408dcace` on `main`. |
| `CSP-STALE-BALANCE.sh` | Fresh selected-account capital, deliberately scoped from the feature branch | Matches `5553801c` on `main`. |
| `CSP-SCORING-GATE-CARD.sh` | Extrinsic ROC scoring, zero-OI eligibility gate, card parity | Matches `0b807be0` on `main`. |
| `CSP-DEFAULT-DELTA.sh` | CSP result delta filter defaults to scan band | Matches `d7f1e0d9` on `main`. |
| `TL-PAGINATION-FIX.sh` | Trade-log transaction pagination correction | No matching commit appears in today's Git history; it may have been prepared but not committed today, committed on another day/repository, or not run. |

## PMCC release status

**Implemented:** broker foundation normalizer; capacity tests; uncommitted Long Book broker verification, incomplete-chain warning/block, full expiration traversal, and working-order display state.

**Not release-ready:** configurable/versioned filters, candidate ranking, per-candidate audit ledger, fill/partial-fill/cancel/reject reconciliation, idempotent submission, adjusted deliverable handling, feature flag/shadow telemetry, and end-to-end UI/integration coverage.

## Validation observed today

- PMCC foundations, covered-call capacity, and PMCC pairing: **67 tests passed** in the targeted run.
- Full `npm test`: **not green** — 9 failed test files, 18 failed tests; 184 files and 2,718 tests passed. This run is evidence of repository health, not proof that each failure was introduced today, because the current branch is 419 commits behind `main` and has separate uncommitted work.
- Confirmed failure groups: screener launcher/PMCC card expectations, covered-call finder strategy field, portfolio refresh wiring, Greek-acquisition wiring, and `trendClassification` loading without the test globals. The detailed transient log is `/tmp/tradeedge-full-test-2026-09-21.log`.

## Safe resume point

1. Do not mix in `main` wholesale; first decide whether the current feature branch should be rebased, selectively cherry-picked, or kept isolated.
2. Decide whether to commit the uncommitted Long Book PMCC slice as a checkpoint. It depends on committed `4266f24d`.
3. Keep PMCC-0001 as the source of truth for remaining PMCC release work.
4. Treat untracked ticket/mockup/output files as reviewable artifacts, not shipped work, until individually added and committed.
