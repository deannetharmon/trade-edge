# AI-POLICY-0001F — Evaluation Fixtures, Harness, and Launch-Gate Registry

**Status:** Draft — can run in parallel with 0001B–E after 0001A; **blocks enabling any route in Production**
**Epic:** [AI-POLICY-0001](./AI-POLICY-0001-epic.md) · **Delivers spec sections:** "Tests and rollout" (evaluation, launch gate)

## Problem

The spec forbids enabling any route until a versioned, approved launch-gate record exists with numeric or testable thresholds, a minimum sample, a hold period, and rollback triggers. Nothing enforces or supports that today.

## User value

Routes go live only when measured against agreed thresholds, and can be rolled back on named triggers.

## Scope

1. **Fixtures** `lib/ai-policy/eval/fixtures/<route>/*.json`: synthetic (or consented) frozen snapshots with expected properties, plus recorded model outputs (good, borderline, adversarial) for offline scoring. No real account data.
2. **Harness** `lib/ai-policy/eval/harness.ts` (pure, offline): runs the production validator/renderer over recorded outputs and computes: grounded-accuracy, claim-verification rate, prohibited-output rejection rate, false-rejection rate, freshness-handling correctness. Latency/cost and human "usefulness" scores are inputs recorded from preview runs and reviewer forms.
3. **Reviewer form** `docs/ai-policy/launch-gates/reviewer-form.md`: rubric for accuracy, citation quality, stale-data handling, prohibited-action detection, usefulness (1–5 with anchors); Ian and Quinn review a minimum sample.
4. **Launch-gate registry** `lib/ai-policy/launchGates.ts`: an in-code list of approved gate records `{ id, route, version, owner, approver, approvedAt, thresholds, minSample, holdPeriodDays, rollbackTriggers, expiresAt }`. `config.ts` treats a route as enable-able **only if** its flag is on **and** a non-expired approved gate exists for it (in Production; Preview/dev may bypass with an explicit `AI_POLICY_ALLOW_UNGATED_PREVIEW=true` that is ignored when `VERCEL_ENV === 'production'`).
5. **Template** `docs/ai-policy/launch-gates/TEMPLATE.md` (included in this package) and one **draft, unapproved** record per route left as `docs/ai-policy/launch-gates/<route>-v1-DRAFT.md`.

## Non-goals

No thresholds are chosen by Dane. No approval is recorded by code or by Dane. No real-user data collection tooling.

## Acceptance criteria

1. With the registry empty, every route is unavailable in Production even if its flag is on (test with `VERCEL_ENV=production`).
2. A gate record missing owner, approver, any threshold, minimum sample, hold period, or rollback triggers fails registry validation at test time.
3. Expired/revoked gate ⇒ route unavailable (rollback path proven without redeploying the deterministic app).
4. Harness reproduces the validator's fixture-table results from 0001A and reports every metric above; metrics are deterministic on the same inputs.
5. Draft records exist for all four live routes with blank threshold cells for Ian/Alan/Paul to fill; nothing is pre-approved.

## Implementation notes

- Approval = a reviewed commit that adds an entry to `launchGates.ts` and the matching markdown record (auditable in git). Paul is owner of the process; Ian/Alan set thresholds; Dean approves.
- Tests: `lib/ai-policy/__tests__/{launchGates,evalHarness}.test.ts`.
- Sibling: `config.ts` flag resolution from 0001A; no route file changes beyond calling `config`.

## Validation steps

`tsc --noEmit`, full `npm test`, Vercel preview build.

## Rollout notes

Merge dark. Each route's launch needs: approved gate record + minimum sample reviewed + cohort hold period elapsed, per the record. Rollback = flip the flag, set the Redis kill key, or expire the gate; then investigate and pass a **newly approved** gate before re-enabling.
