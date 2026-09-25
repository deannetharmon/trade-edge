# DECIDE-0001 — Decisive position recommendations (Epic)

**Status:** Draft for review. Nothing here is approved.
**Sponsor:** Dean. **Reviewers:** Ian (rules, broken-stock definition, action order), Alan (formulas and golden fixtures), Paul (scope, and the changes to AI-POLICY D2/D9), Quinn (testability).
**Verified against:** branch `claude/loving-lovelace-f2o0k6`, 2026-09-25

## Problem

TradeEdge collects most of the data a trader needs to manage a position, but it never says what to do. The AI panels hedge because their prompts forbid a recommendation. For example, `app/api/leaps-analysis/route.ts` says "Never select a contract, direct a transaction … or use authority language", and `app/api/advisor/route.ts` says "You do not select a contract or direct a transaction" and requires a `disclosure` field in every response. The trader gets the evidence but still has to make every call by hand.

## Outcome

For every open position, TradeEdge shows **one recommended action**, the reasons for it, what would change it, and a confidence level. Code makes the recommendation and the AI explains it. This keeps the AI-POLICY-0001 principle that "TradeEdge code stays the only authority" while giving the trader a clear call.

## Architecture

```
facts (market data, broker, entry records, news)
  → signals (pure functions: broken stock, profit, DTE, delta, stop)
  → decision (pure evaluator: one action + reasons + flip conditions + confidence)
  → AI explanation (states and explains the decision; cannot change it)
  → log (recommendation vs. what the trader did)
```

The same inputs always produce the same action. The AI cannot override the action.

## Phases

| Ticket | Title | Depends on | Approvals |
|---|---|---|---|
| DECIDE-0001A | Broken-stock signals | — | Ian, Alan |
| DECIDE-0001B | Decisive evaluator output | 0001A | Ian, Alan, Quinn |
| DECIDE-0001C | AI explains the decision (prompt rewrite) | 0001B; Paul amends D2/D9 | Paul, Ian |
| DECIDE-0001D | Recommendation vs. action log | 0001B | Paul, Quinn |
| DECIDE-0001E | News and analyst-action feed | 0001A; Dean confirms provider key | Paul, Ian |

### DECIDE-0001A — Broken-stock signals

New pure module `lib/market-intelligence/brokenStock.ts`. Any one signal marks the stock **broken**. The thresholds are starting points for Ian to set and Alan to fix in golden tests.

| Signal | Test | Data | Status |
|---|---|---|---|
| Trend break | Close < 200-day MA **and** 50-day MA < 200-day MA | `features.ts` `ma50`, `ma200` | Exists |
| Failed gap | Open ≥ 8% below prior close, and within 5 sessions the stock has not recovered half the gap | Daily bars | Add to `features.ts` |
| Support break | Close < support recorded at entry, on volume ≥ 1.5× the 20-day average | Entry record plus bars | Add `supportAtEntry` to `entryRecords.ts`; add 20-day average volume to `features.ts` |
| Relative weakness | 20-session return ≤ SPY 20-session return − 15 pts | Same Yahoo fetch for SPY | Add |
| Fundamental hit | Guidance cut, or ≥ 2 analyst downgrades in 10 days | News feed | DECIDE-0001E. Treated as "not evaluated" until then |

Output: `{ broken: boolean, signals: [{ code, fired, value, threshold }], notEvaluated: code[] }`. A missing input leaves that signal **not evaluated** and never counts it as passing. Supporting evidence can make a signal fire, but missing data never makes one fire.

**Default support at entry** (for Ian): the lower of the 20-day swing low (`swing20Low`) and the short strike, recorded when the position opens. Positions opened before this ship have no support at entry, so that signal is not evaluated for them.

### DECIDE-0001B — Decisive evaluator output

The existing evaluators (`lib/leaps-position-intelligence/evaluate.ts` and the short-premium management rules) return one shared shape:

```ts
interface PositionDecision {
  action: 'HOLD' | 'CLOSE_PROFIT' | 'CLOSE_STOP' | 'CLOSE_BROKEN' | 'ROLL' | 'LET_EXPIRE' | 'BLOCKED';
  reasons: string[];          // reason codes, rendered by the UI (top 3 shown)
  flipConditions: string[];   // e.g. "ROLL if XYZ closes below $92"
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  evaluatedAt: string;
}
```

**Precedence** (first match wins; Ian to confirm):

| # | Rule | Short premium (BPS, BCS, IC, CSP, CC) | LEAPS / PMCC long |
|---|---|---|---|
| 1 | Data | A required quote or broker field is stale after one refresh, or the token has expired → `BLOCKED` | Same |
| 2 | Loss stop | Mark ≥ 2× credit received → `CLOSE_STOP` | — |
| 3 | Broken stock | → `CLOSE_BROKEN` (CSP/BPS: or `ROLL` down and out for a net credit if one exists) | → `CLOSE_BROKEN`, or `ROLL` to a deeper strike |
| 4 | Profit target | ≥ 50% of max profit → `CLOSE_PROFIT` | — |
| 5 | Time | DTE ≤ 21 → `ROLL` if a net-credit roll exists, else `CLOSE_PROFIT` / `CLOSE_STOP` by P&L sign | DTE < 180 → `ROLL` |
| 6 | Delta | Short delta ≥ 0.50 → `ROLL` | Long delta < 0.70 → `ROLL` |
| 7 | Default | `HOLD` | `HOLD` |

Rule 1 follows the data rule agreed with Dean: refresh a stale quote once before using it; fail outright on an expired token.

**Confidence** (deterministic):

- **HIGH:** the rule that fired is clear of its threshold by at least 10%, and no other rule points the other way.
- **MEDIUM:** a conflicting signal is present (for example, profit target hit while the stock is broken), or any broken-stock signal is not evaluated.
- **LOW:** the deciding value is within 10% of its threshold.

### DECIDE-0001C — AI explains the decision

- Rewrite the prompts in `app/api/advisor/route.ts` and `app/api/leaps-analysis/route.ts`. The AI receives the `PositionDecision` and its evidence, states the action first, explains the reasons in plain language, and names what would change it.
- The AI may not change the action. If its reasoning disagrees, it says so in a separate `dissent` field, which is logged and shown collapsed.
- Remove the per-response `disclosure`. Show one standing disclaimer in the UI.
- **Requires Paul to amend AI-POLICY-0001 decisions:**
  - **D2** freezes `/api/advisor` and `/api/leaps-advisor` "as-is (no new features)".
  - **D9** gives Ian the prohibited-language lexicon. It needs an exception so the AI can state an action that code has already decided.

### DECIDE-0001D — Recommendation vs. action log

- Record every `PositionDecision` shown, and the trader's next action on that position within 3 sessions, in Redis keyed by user.
- The Performance page reports:
  - agreement rate by rule and by confidence
  - P&L of followed vs. overridden recommendations

This is the evidence base for any later autopilot scope. Autopilot for PMCC/CC stays Dean's open decision.

### DECIDE-0001E — News and analyst-action feed

- Provider: Finnhub or Polygon. Dean is checking which keys he has.
- Server-side fetch, cached per symbol. Classify items into `GUIDANCE_CUT`, `DOWNGRADE`, `UPGRADE` and `OTHER` using provider tags first and the AI only for untagged headlines.
- Only `GUIDANCE_CUT` and `DOWNGRADE` feed the "Fundamental hit" signal.
- Any action driven by the AI's classification of a headline is capped at **MEDIUM** confidence until the log from 0001D shows the classifier is reliable.

## Non-goals

- No automated order placement. Recommendations only.
- No change to scan qualification or scoring ("trust the qualified realm" stands).
- No change to autopilot scope.

## Acceptance criteria

1. Every broken-stock signal and every precedence rule is pinned by golden fixtures (Alan). The fixtures include each threshold boundary and the not-evaluated cases.
2. The same inputs always return the same `PositionDecision`; covered by a property test.
3. A stale quote is refreshed once. If the refresh fails, or the token has expired, the result is `BLOCKED` with the reason shown, never a guessed action.
4. The AI response always repeats the code's action unchanged; a test fails the build if the parsed AI action differs from the input action.
5. The UI shows the action, the top 3 reasons, the flip conditions and the confidence for every open position, per Diane's mock.

## Open questions

| # | Question | Owner |
|---|---|---|
| Q1 | Broken-stock thresholds (8% gap, 1.5× volume, −15 pts vs. SPY, 200-day MA rule) | Ian |
| Q2 | Precedence order, and whether a broken stock beats a hit profit target | Ian |
| Q3 | Amend D2 and D9 for 0001C | Paul |
| Q4 | News provider: Finnhub or Polygon | Dean |
| Q5 | UI mock for the recommendation card | Diane |
