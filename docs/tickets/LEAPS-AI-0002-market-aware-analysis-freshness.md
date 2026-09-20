# LEAPS-AI-0002 — Market-Aware Quote Freshness for "Analyze with AI"

**Status:** Approved by Dean 2026-09-20 (Ian, Paul, Alan, Quinn, Diane positions recorded in session); implemented — see the [implementation report](../implementation/LEAPS-AI-0002-implementation-report.md)
**Related:** [AI-POLICY-0001](./AI-POLICY-0001-epic.md) (0001D will adopt the same rule; decision D7)

## Problem

On the LEAPS scan, **Analyze with AI** re-reads the contract from the broker on every click, then requires both the option and stock quote to be no more than 60 seconds old. When the market is closed the broker has nothing newer than the last session, so the check can never pass: the panel showed `Contract status: DATA UNAVAILABLE` and `AI review: MORE INFORMATION NEEDED`, and the model was never called. Captured evidence (Sunday 06:25Z): option quote ~20 h 39 m old, stock quote ~19 h 27 m old, every other gate passing.

## User value

Analyze with AI works whenever the trader wants to review a contract, and always says plainly when the prices are from the prior session.

## Scope

1. **Analysis-only freshness mode** in `resolveWithContext` (`lib/leaps-analysis/serverTradeReview.ts`): optional parameter `freshness: 'strict' | 'analysis'`, default `'strict'`. Only `resolveLeapsContractEvidence` (used solely by `/api/leaps-analysis`) passes `'analysis'`.
   - **Market open** (`derivePmccMarketSession` = `open`): both quotes must be ≤ **300 s** old.
   - **Market not open** (weekend, NYSE holiday, pre-market, after-hours, closed): the broker's last quote is accepted if both quote timestamps exist. The existing `marketData` (valid two-sided, non-crossed quote) and `spreadPct` gates still apply, so a crossed, one-sided, or wide quote never qualifies. Same principle as `pmccDecision`'s `MARKET_CLOSED_QUOTES`.
   - Session `unknown` falls back to the strict-style age check.
2. **Snapshot** (`analysisService.ts`): contract gains `quoteBasis` (`live` | `last_session`) and `marketSession`; provenance gains `freshnessPolicy: 'analysis-market-aware-v1'`; snapshot version `leaps-analysis-snapshot-v2`.
3. **Model instruction** (`app/api/leaps-analysis/route.ts`): when `contract.quoteBasis` is `last_session`, state that pricing is from the prior session at the start of the mechanics, never call those prices current, and say pricing must be rechecked after the market opens.
4. **Panel wording** (`app/screener/page.tsx`): amber line — "Market closed — quotes are from the prior session (option quote <time>). Recheck pricing after the market opens." — replaces the misleading "DATA UNAVAILABLE" in that case.
5. Stale-quote gate message in analysis mode reads "…no more than 300 seconds old while the market is open".

## Non-goals

- **No change to any order or review path.** `reviewLeapsContract`, `submitLeapsOrder`, dry-run/submit, `/api/leaps-analysis/trade-review`, and all PMCC order gates keep the strict 60-second rule.
- No change to `evaluateLeapsEntry`, scan qualification, scoring, or the server LEAPS policy values.
- The server still judges with `SERVER_LEAPS_POLICY` (delta 0.70–0.85, DTE ≥ 180, OI ≥ 100, extrinsic ≤ 20%, spread ≤ 10%), not the user's scan filters — separate question for Ian/Paul (see AI-POLICY-0001D).
- No half-day (1 PM close) calendar support; on those afternoons a stale quote fails safe as unavailable.

## Acceptance criteria

1. Weekend and market-holiday: a contract with a valid two-sided quote and existing timestamps qualifies for analysis with `quoteBasis: 'last_session'`.
2. Market open: quotes ≤ 300 s qualify (`quoteBasis: 'live'`); a quote older than 300 s is `DATA_UNAVAILABLE` with the 300-second message.
3. Crossed quote → `DATA_UNAVAILABLE`; spread wider than the policy limit → `NOT_QUALIFIED`; missing option timestamp → `DATA_UNAVAILABLE`, even when the market is closed.
4. Order/review path (`reviewLeapsContract`) rejects a 200-second-old quote while open and does not accept prior-session quotes on a weekend; its gate message is unchanged.
5. Snapshot records `quoteBasis`, `marketSession`, `freshnessPolicy`, and version v2.

## Implementation notes

- Files: `lib/leaps-analysis/serverTradeReview.ts`, `lib/leaps-analysis/analysisService.ts`, `app/api/leaps-analysis/route.ts`, `app/screener/page.tsx` (three added lines), new `lib/leaps-analysis/__tests__/marketAwareFreshness.test.ts`.
- Reuses `derivePmccMarketSession` (already imported by `serverTradeReview.ts`); no new calendar.
- Known limit: in prior-session mode there is no upper bound on quote age (same as the PMCC precedent). A sanity cap (e.g., 7 days) is a possible follow-up for Ian.

## Validation steps

`tsc --noEmit`, full `npm test`, Vercel preview build. Then: on a weekend, Analyze with AI on a qualifying LEAPS candidate returns an analysis that opens by saying prices are from the prior session, with the amber line in the panel. On Monday during market hours it returns a normal analysis; if it reports the 300-second message, capture `snapshot.contract` timestamps for Ian.

## Rollout notes

No flag and no new environment variables; existing `LEAPS_ADVISOR_ENABLED` gating is unchanged. Rollback is a revert of the commit.
