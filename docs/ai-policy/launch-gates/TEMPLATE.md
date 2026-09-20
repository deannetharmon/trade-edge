# Launch-Gate Record — `<route>` — v<N>

**Status:** DRAFT | APPROVED | REVOKED | EXPIRED
**Route:** `scan_summary` | `grounded_chat` | `leaps_deep_analysis` | `pmcc_deep_analysis` | `retrospective_batch`
**Owner:** <name> · **Approver:** <name> · **Approved on:** <date> · **Expires / re-review by:** <date>
**Registry entry:** `lib/ai-policy/launchGates.ts` id `<id>` (approval = reviewed commit adding this entry)
**Model tier / model / provider policy version under test:** <…>
**Prompt template + lexicon + registry versions under test:** <…>

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

## Sample and hold

- Minimum fixture sample: <N> synthetic + <N> consented completed snapshots
- Minimum human-audited outputs: <N>
- Cohort hold period before wider enablement: <days>

## Rollback triggers (exact)

List each trigger, its measurement, and its action (flag off / Redis kill key / gate expiry), e.g.:
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
