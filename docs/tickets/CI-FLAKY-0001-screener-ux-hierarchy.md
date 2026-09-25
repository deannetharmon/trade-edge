# CI-FLAKY-0001 — Stabilize load-flaky screener tests (ScreenerUXHierarchy, ScreenerSessionWiring)

## Status

**Proposed by Paul 2026-09-24; approved to build (Dean: go on 2). Not built.** Test-only. No product code change (stop and re-scope if a non-test file needs changing). Full suite required.

## Problem

Two screener tests fail intermittently in full-suite runs and pass alone: `app/screener/__tests__/ScreenerUXHierarchy.test.tsx` "SCREENER-UX-0001 corrective pass: production hierarchy order (Ranked) > Ranked mode also gets scan identity, accounting, and Best Opportunities in the required order, plus symbol outcomes" (failed once on origin/main: 5253 passed, 1 failed; passed twice in isolation and in later full runs) and `ScreenerSessionWiring` "accounting reconciliation" (failed twice in earlier full runs under load, passed alone). Hypothesis (unproven): waitFor/findBy default-timeout flakiness under CPU load.

## Scope

Diagnose each failure (timeouts, fake-timer interaction, unawaited async state updates, state leaking between tests, heavy render cost); fix the root cause (await the real readiness signal, flush the specific async work, remove ordering dependency, narrow fixtures). **Do not raise timeouts blindly**: allowed only with a written justification for a proven, bounded slow step, on that call only. Assertions keep their meaning.

## Non-goals

Any product or page.tsx change; sweeping the whole suite (separate ticket if a pattern emerges); global vitest config changes (testTimeout, pool, threads) unless diagnosis proves the cause is config-level, which needs Quinn's sign-off.

## Acceptance criteria

Root cause documented per test; both files pass 20 consecutive runs under load with shuffle and a concurrent CPU-heavy run (report run counts); full suite passes 3 consecutive times; no new `retry` or `.skip`.

## Implementation notes

Reproduce first (run alongside the full suite or with limited workers) and confirm the failure before fixing. Check for several sequential findBy calls each consuming the default timeout. Quinn reviews for coverage parity.

## Validation steps

`tsconfig.check.json` tsc, the loop above, three full-suite runs. Test-only; independently revertable.

## Priority

P2, right after EARNINGS-PRECHECK-0001's hold closes; escalate to P1 if it fails again on main CI.
