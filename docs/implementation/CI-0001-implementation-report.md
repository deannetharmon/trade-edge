# CI-0001 — Implementation Report

**Ticket:** [CI-0001](../tickets/CI-0001-continuous-integration.md)
**Base:** `main` @ 28b843eb

## What changed

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | **New.** Job `verify` (ubuntu-latest, 20-min timeout): checkout → Node 22 with npm cache → `npm ci` → `npx tsc --noEmit -p tsconfig.check.json` → `npm test`. Triggers: every push, pull requests to `main`, manual. Read-only token, no secrets, `pull_request` only. Superseded branch runs are cancelled; runs on `main` never are |
| `tsconfig.check.json` | **New.** Extends `tsconfig.json` with target es2017, `noEmit`, `incremental: false` (the config previously kept only on Dean's machine) |
| `lib/leaps-analysis/analysisService.ts` | Follow-up folded in: snapshot numbers rounded for display (money/percent 2 dp; delta, IV 4 dp). Broker prices, strike, OI and qualification status/gates unchanged |
| `lib/leaps-analysis/__tests__/snapshotRounding.test.ts` | **New**, 4 tests |

## Sibling and adjacent paths checked

- No existing `.github` directory or other workflow. `package.json` has no `engines` and there is no `.nvmrc`; Node 22 was chosen to match the version the suite was verified on (v22.22.2).
- `tsconfig.check.json` is not read by Next.js (only `tsconfig.json` is), so the Vercel build is unaffected.
- `buildSnapshot` callers: the analysis route and `analysisService.test.ts`; the panel reads only `status`/`gates` from `qualification`, so rounding its percentages changes nothing on screen except the evidence text.

## Verification actually run

- `actionlint` 1.7.12 on the workflow: clean.
- **Simulated CI on a fresh clone of `main`** (script applied, then the exact workflow steps): `npm ci` exit 0 → `npx tsc --noEmit -p tsconfig.check.json` exit 0 → `npm test` exit 0: **261 files, 3312 passed, 2 skipped, 1 todo, 0 failed** (Node 22.22.2, UTC).
- Rounding tests fail against the previous code and pass now.
- **Not verified:** the first run on GitHub's own runners (time zone or timing differences are possible, though the suite passed on a UTC Linux host).

## What Dean will see

GitHub → repository → Actions → "CI". Each push shows ✅ or ❌ next to the commit. A failing run emails the pusher by default.

## Follow-ups

- Optional: branch protection plus a pull-request workflow would make a red CI block merges (Dean currently pushes straight to `main`, so CI reports but does not block).
- Optional: a lint step once an ESLint configuration exists.
- `SEC-0001` step S1 (rotate the TastyTrade credentials in the tracked `.env.local`) is still outstanding; CI checks out that file like any other.
