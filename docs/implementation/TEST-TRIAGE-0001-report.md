# TEST-TRIAGE-0001 — The 15 failing tests on `main`

**Owner:** Dane, with Paul and Ian for the Filter-mode decision
**Base:** `main` @ dc6698e7

## Result

15 failing tests (11 files) traced to their causes. **One was a real bug in product code; 14 were stale tests** that were never updated after intentional changes. Full suite after this change: **255 files passed; 3275 tests passed, 2 skipped, 1 todo, 0 failed.** `tsc --noEmit` (temporary es2017 config): exit 0.

## The real bug — fixed in product code

| Test | Cause | Fix |
|---|---|---|
| `app/api/entry-context/snapshots` — "reads only through the authenticated snapshot boundary" | Commit `64cae929` ("Remove unused parameters from readEntrySnapshotsForAccount", 2026-09-12) changed the route to `readEntrySnapshotsForAccount(accountId)`. The dropped arguments were **not** unused: snapshots are written under `entrySnapshotOwnerScope(userId, accountId)` (promote route), so the read (a) missed them and (b) stopped scoping by user, using the raw client-supplied `accountId` | Route restored to `readEntrySnapshotsForAccount(accountId, undefined, entrySnapshotOwnerScope(userId, accountId))`; added a two-user test proving each user's read is scoped to their own id |

## Stale tests — updated (no product code changed)

| Test | Intentional change that made it stale | Update |
|---|---|---|
| `pmccDecision` — stale evidence | `4ea75ed7` PMCC-COMPARE-HELD-0001: a held long leg's quote no longer gates readiness; only the short leg does | Stale quote moved to the short leg; added tests that a stale held-long quote does not gate, and a new-entry pair still does |
| `portfolioExecutionIntegration` — SetStopLossButton.submit | `bcf5cbf4` added `StandaloneLeapsStopControl` (with its own `submit`, correctly guarded by `assertLiveContextReady` before `getAccessToken`) between the two components the source-text slice spanned | Test now checks each stop-order `submit` separately (`SetStopLossButtonInner` and `StandaloneLeapsStopControl`); mutation-checked |
| `OiAndSortWiring` — CC OI control | `b3bd83ad` made the OI label strategy-specific ("Call OI") | Test uses "Call OI" |
| `PmccResultCardFields` — pricing detail | `ee247b83` turned the run-on prose into a labelled grid | Assertions read the grid rows |
| `ScreenerSessionWiring` — STOP SCAN | `8a6bc4d8` bounded targeted scan concurrency (default 2) | Sequential test pins concurrency to 1; added a concurrency-2 test proving in-flight symbols finish and no new symbol starts after STOP |
| `CcCapacityGate` — out-of-order shadow diagnostic | `45f1a383` CC-SELECT-0001 disabled RUN CC SCAN while holdings load, so the old overlap could no longer occur | Overlap now created by reopening the modal; waits a full macrotask. **Mutation-checked: fails if the out-of-order guard is removed** |
| `CspScanModal` ×4, `CspCandidateDiscovery`, `ScreenerUXHierarchy` ×2, `UnifiedStrategyLauncher` (8) | `3e8d9491` FILTER-MODE-REMOVAL-0002 hid Filter from the selectable modes | See below |

## Filter mode (decision for Paul and Ian)

The eight tests expected the three-mode selector. Filter is intentionally hidden today ("hide-first"), and SCREENER-CONFIG-0001 is planned to restore it. Chosen approach: **pin today's behavior, with tripwires.** Tests that can assert current behavior now assert Rank/Targeted only (and that Filter is absent); two Filtered-results tests in `ScreenerUXHierarchy` are `it.skip` and one `CspCandidateDiscovery` case is `it.todo`, each with a comment naming SCREENER-CONFIG-0001. When Filter is reinstated the pinned assertions fail on purpose, prompting the restore (each comment says what to put back; pre-`3e8d9491` history has the original assertions).

## Verification actually run

- `tsc --noEmit`: exit 0. Full `vitest run`: 255 files / 3275 passed / 2 skipped / 1 todo / 0 failed.
- Root causes found by `git bisect` per test (and direct inspection); mutation checks on the guard tests as noted.
- Not run: `next build` (Vercel is the authoritative check).

## Follow-ups

- Paul/Ian: confirm the Filter tripwire approach; SCREENER-CONFIG-0001 must un-skip / restore the pinned tests.
- Process: the security bug sat among red tests for 8 days. Run `npm test` before pushing and keep `main` green so a real failure is visible.
- Sibling check for the same class of bug: `entrySnapshotOwnerScope` is used by pending, pending-ic, and promote routes; the snapshots route was the only reader that had dropped it. `readEntrySnapshot(accountId, executionId)` (single read) has no non-test callers.
