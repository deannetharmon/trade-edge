# Launch-Gate Record — `scan_summary` — v1

**Status:** DRAFT
**Route:** `scan_summary`
**Owner:** <n> (process owner: Paul) · **Approver:** <n> (Dean) · **Approved on:** <date> · **Expires / re-review by:** <date>
**Registry entry:** `lib/ai-policy/launchGates.ts` id `scan_summary-v1` (approval = reviewed commit adding this entry; **not added**)
**Model tier / model / provider policy version under test:** economy / `gpt-5.6-luna` (economy tier; chosen 2026-09-21, still to be entered as `AI_POLICY_ECONOMY_MODEL`) / <provider policy version>
**Prompt template + lexicon + registry versions under test:** Prompt template `scan-summary` `tmpl-v1-draft`; lexicon `lex-v1-draft`; validator `val-v1`; citable-field registry `lib/ai-policy/registries/scanSession.ts` (draft field list awaiting Ian)

> **Unapproved.** Nothing in this record is approved, and no number below has been chosen. Blank cells are not approvable: `validateGateRecord` in `lib/ai-policy/launchGates.ts` rejects a record with any threshold, sample, hold period or rollback trigger missing. Until an approved entry is added to the registry in a reviewed commit, this route is unavailable in Production even with its flags on.

Built in AI-POLICY-0001B. Offline fixtures: `lib/ai-policy/eval/fixtures/scan_summary/`. Known issue to resolve before approval: the validator rejects the standard phrase "IV rank" (the lexicon's `rankingComparison` category matches "rank"); Ian to decide.

## Thresholds (numeric or explicitly testable; blank = not approvable)

| Measure | Threshold | Owner of number |
|---|---|---|
| Grounded accuracy (human-reviewed) | | Ian |
| Claim verification rate (machine) | | Alan |
| Prohibited-output rejection rate (adversarial set) | | Ian / Quinn |
| False-rejection rate (benign set) | | Quinn |
| Freshness handling (stale/missing sources disclosed or blocked) | | Ian |
| p95 latency | | Alan |
| Cost per request (p95) and per-user monthly budget | | Paul |
| Usefulness (mean reviewer score, 1–5, anchors in reviewer form) | | Paul / Ian |

Comparators are fixed in code (`MEASURES` in `launchGates.ts`): accuracy, claim verification, rejection, freshness and usefulness are "at least"; false-rejection, latency, cost and budget are "at most". A record supplies only the number.

## Sample and hold

- Minimum fixture sample: <N> synthetic + <N> consented completed snapshots
- Minimum human-audited outputs: <N>
- Cohort hold period before wider enablement: <days>

## Rollback triggers (exact)

Proposed wording only; every number is left blank for the owners. Each trigger needs an id, a description, how it is measured, and an action (`flag_off`, `kill_switch` or `gate_expiry`).

1. Any accepted output later found to contain an invented number → kill route.
2. Prohibited-output rejection rate below threshold on the rolling audit sample → kill route.
3. Cost per request or user budget exceeded by <x>% → kill route.
4. Validator false-rejection rate above threshold for <n> consecutive days → disable, investigate.

## Results

| Measure | Result | Pass? | Evidence link |
|---|---|---|---|

## Sign-off

Owner: <name/date> · Approver: <name/date> · Quinn (test evidence reviewed): <name/date>

## Re-enable rule

After any rollback, this record is superseded by a new **approved** version before the route is re-enabled.
