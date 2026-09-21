# AI-POLICY-0001F — Implementation Report

**Ticket:** [AI-POLICY-0001F](../tickets/AI-POLICY-0001F-evaluation-and-launch-gates.md)
**Base:** `main` @ 6c3a76b (0001B)
**Effect:** in Production every AI route is unavailable until a reviewed commit adds an approved, unexpired gate for it. Nothing is approved here, no threshold is chosen, and no route or UI file changed.

## What changed

| File | Change |
|---|---|
| `lib/ai-policy/launchGates.ts` | **New.** The gate registry (`LAUNCH_GATES`, **empty**), the record shape, `validateGateRecord` / `validateRegistry`, `isGateActive`, and the Production / preview-bypass rules |
| `lib/ai-policy/config.ts` | `isRouteEnabled` now also requires a valid, unexpired, unrevoked gate for the route (Production), or `AI_POLICY_ALLOW_UNGATED_PREVIEW=true` outside Production |
| `gateway.ts`, `freezeScanSession.ts`, `artifactRead.ts` | Pass the gate registry and clock into `isRouteEnabled` (injectable for tests). Nothing else changed |
| `lib/ai-policy/eval/harness.ts`, `loadFixtures.ts` | **New.** Offline harness (pure, deterministic) and the fixture loader |
| `lib/ai-policy/eval/fixtures/{scan_summary,grounded_chat}/*.json` | **New.** 10 synthetic fixtures, 137 recorded outputs |
| `docs/ai-policy/launch-gates/` | **New:** `reviewer-form.md`, `README.md`, and `<route>-v1-DRAFT.md` for the four live routes. `TEMPLATE.md` was already in the repo |
| Tests | `launchGates.test.ts` (86), `evalHarness.test.ts` (40), plus `fixtures/testGate.ts` (test-only record) |
| `.env.example`, `lib/ai-policy/index.ts`, 0001B report | Comment-only env doc; public exports; one sentence added to the 0001B preview instructions (see "What you need to do") |

## How the gate works

- A route is enable-able only if the global flag **and** its route flag are on **and** an **active** gate exists for that route. Active means: valid (passes `validateGateRecord`), `approvedAt` ≤ now < `expiresAt`, and not revoked. An invalid record never enables anything.
- **Production** = `VERCEL_ENV=production`, or, when there is no `VERCEL_ENV`, `NODE_ENV=production`. (Preview builds run with `NODE_ENV=production`, so `NODE_ENV` alone would be wrong.)
- **Outside Production** the gate is also required, unless `AI_POLICY_ALLOW_UNGATED_PREVIEW=true`. That setting is ignored in Production.
- A missing or expired gate returns the existing `FLAG_OFF` state (no new reason code, so the HTTP table and UI states are unchanged).
- Rollback works with no redeploy of the deterministic app: expire or revoke the gate (a reviewed commit), flip a flag, or set the Redis kill key. Tests run one route before and after a gate's expiry and revocation with identical code and environment.

**Record shape** (`LaunchGate`): the ticket's fields plus an optional `revokedAt`. `id` must be `<route>-v<version>`. The nine thresholds are fixed measures with fixed comparators (`MEASURES`): accuracy, claim verification, prohibited-output rejection, freshness and usefulness are "at least"; false-rejection, p95 latency, p95 cost and the per-user budget are "at most". A record supplies only the numbers.

## Defaults I chose where the ticket was silent

1. **Validation is stricter than "not missing":** placeholder text (`<name>`, `TBD`) does not count as filled in; a threshold every result would pass (a rate of 0 for an "at least" measure, 1 for an "at most", a usefulness of 1) is refused; hold period must be at least 1 day; minimum synthetic and audited samples must be at least 1; `expiresAt` must be after `approvedAt`. I did not require owner and approver to differ.
2. **The gate is required in Preview and dev too**, not only Production, unless the bypass is set (the ticket says Preview/dev "may bypass").
3. **Approved records** live at `docs/ai-policy/launch-gates/<id>.md` with `**Status:** APPROVED`; the registry test fails if an entry has no such file.
4. The draft records carry the template's rollback examples as **proposed wording** with the numbers left blank, and the economy model `gpt-5.6-luna` as the model under test for the scan routes.

## Evaluation harness

`evaluateFixtures(fixtures)` runs the **production validator and renderer** (with the production route specs) over recorded outputs. Each output is **good**, **borderline** (benign near-misses such as "frank", "safety", "submitted-by", "monitoring") or **adversarial**, with an expectation (accepted, exact rule, required rendered text, required citations). It reports:

| Metric | Meaning | Result on the shipped fixtures |
|---|---|---|
| Prohibited-output rejection rate | adversarial outputs rejected | **118 / 118** |
| False-rejection rate | benign outputs rejected | **1 / 19** (the known issue below) |
| Claim-verification rate | citations in accepted outputs that an independent re-check (own pointer resolution, hash, formatting, as-of, freshness) confirms | **32 / 32** |
| Freshness-handling rate | stale/missing-source fixtures blocked or disclosed as expected | **6 / 6** |
| Grounded accuracy (machine proxy) | good outputs accepted **and** meeting their fixture expectations | **18 / 19** |

Latency, cost, human accuracy and usefulness cannot be measured offline. They are **recorded inputs** (`RecordedInputs`, from preview runs and the reviewer form). `compareToGate` then judges every measure against a gate record; an unmeasured measure cannot pass, and human accuracy always comes from the reviewers, never from the machine proxy.

Fixtures cover every prohibited category with at least 3 rejecting outputs per route (invented digits, number words and symbols, derived math, ranking, recommendation, order commands, state/filter override, prediction, markup/URLs, state words, uncited claims, unregistered and unresolved pointers, malformed and off-schema JSON, bad placeholders, stale and missing sources), plus prompt-injection outputs for grounded chat. The harness's verdict and rule for every output equal what the validator returns on its own (tested). Reports are identical on repeat runs, in any fixture order, and regardless of the clock.

**Fixtures exist only for `scan_summary` and `grounded_chat`.** The deep routes have no registry or template yet, so their fixtures arrive with 0001D / 0001E; their draft records are placeholders.

## Finding for Ian: the validator rejects "IV rank"

Probing 71 ordinary options phrases ("short strike", "open interest", "return on capital", "credit spread", "assignment risk", …) against the validator, exactly one was rejected: **"IV rank"** (the lexicon's `rankingComparison` category matches "rank"). It is recorded as a documented **known issue** in `scan_summary/csp-filters` (so it stays visible in the false-rejection rate instead of being hidden), and if the lexicon is changed the harness will flag the stale note. Ian decides whether to allow the phrase.

## Sibling and adjacent paths checked

- Every caller of `isRouteEnabled` (`gateway.ts`, `freezeScanSession.ts`, `artifactRead.ts`; no others) passes the registry and clock. No route file changed.
- The 0001A/0001B tests all use `TEST_ENV`, which now sets the bypass (tests are never Production). The gated behavior is tested separately with explicit environments.
- Import boundary test still passes (the new files import nothing from scan/screener code).

## Verification actually run (sandbox clone of `main` + this change)

- `tsc --noEmit` with the **real `tsconfig.json`** (es5): 0 errors; with `tsconfig.check.json`: 0 errors.
- New tests: 126 passed. Full `vitest run`: **310 files passed; 4467 tests passed, 2 skipped, 1 todo, 0 failed.**
- Not run: `next build` (does not run in the sandbox: no network for `next/font`); the Vercel preview is the authoritative build.

## Acceptance criteria

1 empty registry ⇒ unavailable in Production even with flags and bypass set, through `isRouteEnabled`, the gateway, freeze and artifact read · 2 a record missing owner, approver, any threshold, sample, hold period or rollback trigger fails validation (about 60 table cases) · 3 expired, revoked and not-yet-approved gates ⇒ unavailable, proven end to end · 4 harness reproduces validator results, reports every metric, deterministic · 5 draft records for all four live routes with blank threshold cells, none approved.

## What you need to do

Preview now also needs **`AI_POLICY_ALLOW_UNGATED_PREVIEW=true`** (plus the flags from the 0001B report), because a route needs an approved gate unless the bypass is set. It is ignored in Production. Nothing else, until the owners are ready to fill in the records.

## Open items for the owners

- **Ian:** the "IV rank" decision; the draft citable-field list (0001B); the lexicon.
- **Ian, Alan, Paul, Quinn:** fill in the thresholds, samples, hold period and rollback triggers in the four `-DRAFT.md` records. Nothing can be approved until they do. **Dean** approves.
- **Paul:** process owner for approval.
- Deep-route fixtures and records complete with 0001D / 0001E.
