# CI-0001 — Continuous Integration (type check + full test suite on every push)

**Status:** Approved by Dean 2026-09-20; implemented — see the [implementation report](../implementation/CI-0001-implementation-report.md)
**Origin:** [TEST-TRIAGE-0001](../implementation/TEST-TRIAGE-0001-report.md)

## Problem

Vercel builds the app on every push but does **not** run the tests. Fifteen tests sat red on `main` for up to eight days, and among them was a real security regression (the entry-context snapshots route lost its per-user scope). Nobody could tell a real failure from stale noise, and there is no local Node to run `npm test`.

## User value

A red test appears within minutes of the push that caused it, in GitHub, with no local tooling.

## Scope

1. `.github/workflows/ci.yml` — job `verify` on `ubuntu-latest`: `actions/checkout@v4` → `actions/setup-node@v4` (Node 22, npm cache) → `npm ci` → `npx tsc --noEmit -p tsconfig.check.json` → `npm test` (the full Vitest suite). Timeout 20 minutes.
2. Triggers: every `push`, `pull_request` targeting `main`, and manual `workflow_dispatch`. Concurrency cancels superseded runs on branches but never a run on `main`.
3. Security posture: `permissions: contents: read`, no secrets, `pull_request` (not `pull_request_target`).
4. `tsconfig.check.json` — the es2017 no-emit type-check config (the repo's `tsconfig.json` targets es5, which produces false type errors). Previously kept only on Dean's machine.

## Non-goals

- **Does not block deploys.** Vercel still deploys every push to `main` independently. Blocking would need branch protection plus a pull-request workflow; today Dean pushes directly to `main`. Optional follow-up.
- No lint step (no ESLint configuration in the repo), no coverage, no `next build` (Vercel is the authoritative build).
- No new dependencies and no secrets.

## Acceptance criteria

1. A push with a type error or a failing test shows a red ❌ on the commit in GitHub; a clean push shows ✅.
2. The workflow uses only the committed files: a fresh clone runs `npm ci`, the type check, and `npm test` to green (verified in a simulated CI run).
3. `actionlint` reports no problems with the workflow file.

## Implementation notes

- Node 22 matches the version the suite was verified on (v22.22.2). Vercel's build is unaffected.
- The suite takes about 4–5 minutes; the timeout is 20.
- Third-party actions are pinned to major tags (`@v4`), the standard GitHub-maintained actions.

## Validation steps

After the push: GitHub → repository → Actions tab → "CI" → the run for the latest commit should be green. Failure notification emails go to the pusher by default.

## Rollout notes

The first hosted run may expose an environment difference from the sandbox (time zone, timing on a slower runner). If it fails for a reason that isn't a code change, capture the log and treat it as a bug in the test, not in the workflow. Rollback: delete `.github/workflows/ci.yml`.
