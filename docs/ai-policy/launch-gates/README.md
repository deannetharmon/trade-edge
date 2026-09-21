# AI Policy Launch Gates

No AI route may be enabled in Production without an **approved, unexpired launch-gate record**. This folder holds the records; `lib/ai-policy/launchGates.ts` holds the in-code registry that actually gates the routes.

| File | Purpose |
|---|---|
| `TEMPLATE.md` | Blank record. Copy it for a new route or version. |
| `<route>-v1-DRAFT.md` | Draft, **unapproved** record with blank thresholds (one per live route). |
| `<id>.md` (e.g. `scan_summary-v1.md`) | An approved record. `<id>` is `<route>-v<version>`. |
| `reviewer-form.md` | Rubric and recording sheet for the human review. |

## How a route gets approved

1. Ian, Alan, Paul and Quinn fill in the record's thresholds, sample sizes, hold period and rollback triggers. Paul owns the process.
2. Run the offline evaluation (`evaluateFixtures` in `lib/ai-policy/eval/harness.ts` over `lib/ai-policy/eval/fixtures/`) and the preview runs; complete the reviewer form; record the results in the record's **Results** table.
3. Approval is **one reviewed commit** that (a) adds the entry to `LAUNCH_GATES` in `lib/ai-policy/launchGates.ts` and (b) adds/updates `docs/ai-policy/launch-gates/<id>.md` with `**Status:** APPROVED`. Dean approves. The registry test fails if the two disagree or if any required field is missing.
4. The route still needs its environment flags on. Cohort hold period elapses before wider enablement.

## How a route is rolled back

Any one of: flip the route or global flag off; set the Redis kill key (`ai-policy:kill:route:<route>` or `ai-policy:kill:global`); let the gate expire or set `revokedAt` on its entry (a reviewed commit). After any rollback, investigate and pass a **newly approved** gate version before re-enabling.

## Preview and development

In Preview or local development a route can be tried without a gate by setting `AI_POLICY_ALLOW_UNGATED_PREVIEW=true` (plus its normal flags). This setting is **ignored in Production**.
