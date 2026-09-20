# LEAPS-AI-0003 — "Analyze with AI" Uses the Trader's Scan Filters; Prior-Session Age Cap

**Status:** Approved by Dean 2026-09-20 with D-A = (a) (team positions recorded in session); implemented — see the [implementation report](../implementation/LEAPS-AI-0003-implementation-report.md)
**Follows:** [LEAPS-AI-0002](./LEAPS-AI-0002-market-aware-analysis-freshness.md)
**Related:** [AI-POLICY-0001](./AI-POLICY-0001-epic.md) (0001D adopts the same criteria rule), decision D7

## Problem

The analysis panel and the candidate row disagree. The row is judged against the trader's **own scan filters** (delta, DTE, OI, extrinsic ceiling). The analysis (`/api/leaps-analysis`) is judged against a fixed server policy (`SERVER_LEAPS_POLICY`: delta 0.70–0.85, DTE ≥ 180, OI ≥ 100, extrinsic ≤ 20%) that the trader cannot see or change. The result is two verdicts for one contract — e.g., the row says `REVIEW REQUIRED` (no extrinsic ceiling selected) while the panel says `CONTRACT QUALIFIED`. A contract that passes the trader's filters but not the fixed policy never gets an analysis at all.

This is the same defect the order gate already fixed (see the comment at the top of `app/api/leaps-analysis/trade-review/route.ts`: "the gate you see and the gate that blocks your order are the same gate"). The analysis route was left behind. Separately, LEAPS-AI-0002 accepts prior-session quotes with no upper age limit.

## User value

One verdict per contract, judged by rules the trader chose and can see. Analysis is available for every contract the trader's own filters allow.

## Scope

1. **One home for the criteria rule.** Move `resolveCriteria` out of `app/api/leaps-analysis/trade-review/route.ts` into a shared module `lib/leaps-analysis/criteria.ts` (`resolveLeapsCriteria(body)`), with identical behavior: `deltaMin/deltaMax` 0–1, `dteMin` 0–5000, `dteMax` optional 0–5000, `oiMin` 0–1,000,000, `extrinsicPctMax` 0/omitted = "Any" (discovery mode), out-of-range or missing values fall back to `SERVER_LEAPS_POLICY` (never looser than a bound the server rejects). `spreadPctMax` and the freshness requirement stay fixed. Both routes import it (Next.js route files cannot export helpers).
2. **Analysis accepts the filters.** `POST /api/leaps-analysis` reads `deltaMin, deltaMax, dteMin, dteMax, oiMin, extrinsicPctMax` from the body; `resolveLeapsContractEvidence(userId, input, criteria = SERVER_LEAPS_POLICY)` passes them to `evaluateLeapsEntry`. The row component's `runAnalysis` (`app/screener/page.tsx`) sends the same six values it already sends to `trade-review`.
3. **Snapshot records the criteria.** New `snapshot.criteria` (the six values plus `source: 'scan_filters' | 'server_default'`); snapshot version `leaps-analysis-snapshot-v3`. Requests without filters keep `server_default`.
4. **Panel shows the rule it used.** One muted line: "Judged against your scan filters: Δ 0.70–0.85 · DTE ≥ 180 · OI ≥ 100 · Extrinsic ≤ 20%" (or "no extrinsic ceiling set"). Copy approved by Diane; when the ceiling is "Any" the panel adds "Extrinsic ceiling not set — explaining mechanics only; contract not fully qualified. Set an extrinsic ceiling to fully qualify."
5. **Prior-session age cap (from LEAPS-AI-0002).** In prior-session mode both quote timestamps must be within **5 calendar days** of now; older ⇒ `DATA_UNAVAILABLE` with "Quotes are more than 5 days old". (Five days covers the longest normal closure — a holiday weekend, ~4.8 days.) Order/review paths remain strict at 60 s and are untouched.
6. **Model instruction.** Add: "The status and gates were computed by TradeEdge from the trader's own filters; never restate them as your own judgment or suggest changing them."

## Decision D-A — resolved: (a)

In discovery mode (`extrinsicPctMax` = Any) `evaluateLeapsEntry` returns `REVIEW_REQUIRED`, and the analysis route today only proceeds for `CONTRACT_QUALIFIED`.
- **(a) Proceed for `REVIEW_REQUIRED` caused only by discovery mode; still block `NOT_QUALIFIED` and `DATA_UNAVAILABLE`.** The panel states "Extrinsic ceiling not set — explaining mechanics only; contract not fully qualified." Rationale: the analysis is read-only and explains mechanics including extrinsic %; a missing ceiling is undecided, not a failure. Consistent with AI-POLICY D14 (AI never explains away a failure).
- (b) Keep blocking and show "Select an Extrinsic ceiling" in the panel, matching Review trade.

## Non-goals

- No change to scan qualification, scoring, `evaluateLeapsEntry`, or `SERVER_LEAPS_POLICY` values.
- No change to order paths: dry-run/submit keep their current criteria handling (only the helper moves) and the strict 60-second rule.
- No new flag or environment variable.

## Acceptance criteria

1. `resolveLeapsCriteria` has a table test (defaults, each bound, `0`/`null` extrinsic ⇒ discovery, out-of-range ⇒ server default) and **both** routes use it; the order route's behavior is unchanged (same inputs ⇒ same criteria as before, asserted with golden cases taken from the current function).
2. A contract with delta 0.65 that fails the default policy but passes filters `deltaMin=0.60` receives an analysis; one that fails the trader's filters does not.
3. Requests with no filters behave exactly as today (`source: 'server_default'`).
4. With D-A (a): discovery-mode `REVIEW_REQUIRED` proceeds and is labelled; `NOT_QUALIFIED` / `DATA_UNAVAILABLE` still return `MORE_INFORMATION_NEEDED` with no model call (provider spy: zero calls).
5. Prior-session quotes older than 5 days ⇒ `DATA_UNAVAILABLE`; 4 days 20 hours ⇒ accepted (weekend and holiday-weekend fixtures with an injected clock).
6. Snapshot contains `criteria` and version v3; the panel shows the rule line; Review trade behavior is unchanged.

## Implementation notes

- **Alan:** for now the analysis takes the six filter values from the request body, exactly like the order route. AI-POLICY-0001D must instead take the criteria from the **frozen scan input** (never from a client-supplied value); it reuses `resolveLeapsCriteria`.
- Files: new `lib/leaps-analysis/criteria.ts`; `lib/leaps-analysis/serverTradeReview.ts` (criteria parameter; age cap); `lib/leaps-analysis/analysisService.ts` (snapshot `criteria`, v3); `app/api/leaps-analysis/route.ts` and `app/api/leaps-analysis/trade-review/route.ts` (import the helper); `app/screener/page.tsx` (send six values; one display line, three-to-six lines total). Tests (Quinn's additions included): `lib/leaps-analysis/__tests__/criteria.test.ts` (golden comparison to a verbatim copy of the pre-move function), `lib/leaps-analysis/__tests__/analysisCriteria.test.ts` (filters, discovery mode, age-cap boundaries at 4 d 20 h accepted / 5 d 1 min rejected, snapshot), `app/api/leaps-analysis/__tests__/analysis.test.ts` (route-level, provider spy: zero model calls for `NOT_QUALIFIED` / `DATA_UNAVAILABLE`), `app/api/leaps-analysis/trade-review/__tests__/criteria.test.ts` (order route passes exactly `resolveLeapsCriteria(body)`).
- Verify current contents of both routes and the row component's props before patching (standing rule); the row already holds the six filter values (it uses them for its own `evaluateLeapsEntry` call).
- `currentKey` (stale marking) stays keyed by contract + policy version + intent; each new run becomes current as today.

## Validation steps

`tsc --noEmit`, full `npm test`, Vercel preview build; then on the LEAPS scan: change a filter (e.g., delta floor), click Analyze with AI — the panel's rule line matches the filters and the verdict matches the row; set an extrinsic ceiling and confirm the row and panel agree.

## Rollout notes

No flag. Rollback is a revert. Deep analysis (AI-POLICY-0001D) reuses `resolveLeapsCriteria`.
