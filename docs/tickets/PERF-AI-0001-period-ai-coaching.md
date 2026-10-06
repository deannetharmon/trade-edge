# PERF-AI-0001 — AI coaching for the selected Performance period

**Status (2026-10-06): DRAFT for team review. Not approved; do not build.** Requested by Dean: an AI analysis of the selected period that helps trading habits and strategy, and is precise and confident.

## Current state (as built, verified in code)

- The Performance tab's AI button (`AIChatPanel`, `app/performance/page.tsx`) analyzes `report.included`: the complete, non-excluded trades closed in the selected period.
- Defects:
  1. **Wrong period label.** The prompt always says "last 12 months" (`range` is fixed at `'12m'` since PERF-0001), even for one month.
  2. **Different numbers from the screen.** `buildPerformanceAnalysisPrompt` computes its own stats (win rate, by strategy, by ticker, day of week, time of day, "revenge trades") from older helpers. It never receives the PERF-0001 report:
     - rule check: beyond 2× stop, inside the stop, opened inside 21 DTE, 50% target, 1/3 credit-to-width;
     - return on capital at risk, max drawdown, expectancy, profit factor;
     - account profit for the period.
  3. **No precision guardrails.** The system prompt says "brutally honest… do not hedge" but does not limit it to the numbers supplied or require sample sizes. It can state a 3-trade pattern as fact.
  4. **Model mismatch.** The client sends `model: 'claude-sonnet-4-20250514'` to `/api/analyze`, which is OpenAI (GPT-4o) and silently falls back to its configured model.

## Proposed requirements (draft — for the team to amend)

### R1. One source of truth (Paul, Quinn)
- The AI input is built from the same `PerformanceReport` and `periodAccountProfit` the screen shows, for the same period and exclusions. No separate stat computation.
- The input includes:
  - the period's from/to dates;
  - headline, rule check, exits, by strategy, by month and by ticker;
  - incomplete and excluded counts;
  - one compact line per trade: date, ticker, strategy, strikes, DTE at entry and close, credit, P/L, exit category, credit-to-width.
- The input builder is a pure function in `lib/`, unit-tested. Pinned fixture input → pinned payload.

### R2. Precision and confidence (Ian, Alan)
- Quote only numbers present in the input. No invented figures, no market predictions.
- Every claim names the trade count and dollars behind it (e.g. "5 trades, −$1,637").
- Evidence tiers, stated with each finding:
  - **Finding:** ≥ 10 trades, or a rule breach of any size, since a breach is a fact rather than a statistic.
  - **Early signal:** 5–9 trades.
  - **Not enough data:** < 5 trades. Not presented as a pattern.
  - Alan to confirm the thresholds.
- Separate **rule-following problems** (methodology says what to do) from **strategy-edge questions** (needs more data).
- Confident, direct tone. No generic disclaimers. Uncertainty is expressed only through the evidence tier.

### R3. Fixed structure for the first answer (Ian, Diane)
1. **Period in one line:** account profit, closed-trade profit, trades, and the single biggest driver.
2. **Habits.** Rule adherence, and what each break cost in this period:
   - beyond the 2× stop;
   - opened inside 21 DTE;
   - held past 21 DTE (spreads only; CSP/CC exempt per DECIDE-0001);
   - below 1/3 credit-to-width;
   - target discipline.
3. **Strategy:** which strategies made and lost money, return on capital at risk, and why, from the data.
4. **Tickers:** best and worst, and any repeat offenders.
5. **Three changes,** each with:
   - the rule or behavior to change;
   - the dollars it would have saved or added in this period (computed from the data, labeled as hindsight);
   - its evidence tier.
6. **Open follow-up chat,** with the same input and guardrails.

### R4. What-if numbers are computed, not guessed (Alan, Quinn)
- Dollar impacts in section 5 come from deterministic code, which is the basis for the "precise and confident" requirement. Examples:
  - "had beyond-stop losses been closed at 2× credit: +$X";
  - "had the spreads opened inside 21 DTE been skipped: +$Y";
  - "had spreads below 1/3 credit-to-width been skipped: +$Z".
- These are passed to the AI as inputs. The AI selects and explains them; it does not calculate them.

### R5. UX (Diane)
- Reuse the existing AI panel. The header shows the period dates and trade count, matching the screen.
- Each change in section 5 links to the matching rule card or ticker row.
- Mock required before code.

### R6. Verification (Quinn)
- Unit tests:
  - the input builder;
  - the what-if calculator, against golden fixtures from Dean's 67-trade log;
  - the period label.
- An automated check that every dollar figure in the AI answer appears in the input. Mismatches are flagged in the panel, not hidden. Open question: flag only, or regenerate?
- The prompt text is versioned in `lib/` so changes are reviewable.

## Open questions for the team

| # | Owner | Question |
|---|---|---|
| Q1 | Ian | Which habits matter most to coach, beyond the five rule checks? Candidates: day-of-week and time-of-day entries, revenge trading (a re-entry within 2 days of a loss), position size versus account, earnings exposure, rolling behavior. |
| Q2 | Ian | Should the coaching compare against Dean's own rules only, or also against general premium-selling norms? Norms could include sizing ≤ 5% per trade and IVR at entry. |
| Q3 | Alan | Evidence-tier thresholds (10 / 5). Should a win-rate claim carry a confidence interval? |
| Q4 | Alan | What-if method for beyond-stop trades: close at exactly 2× credit, or at the first close price at or beyond the stop (needs fill history)? |
| Q5 | Paul | Scope: should entry context (IVR, delta at entry, where captured) be in v1, or wait until coverage is better (1 of 67 trades today)? |
| Q6 | Paul | Should analyses be saved per period so Dean can compare month over month? This would need Redis storage. |
| Q7 | Quinn | When the dollar check fails: flag, or auto-regenerate once? |
| Q8 | Dean | Model: keep `/api/analyze` (OpenAI GPT-4o), or switch to a stronger model for this feature? This affects cost. |
| Q9 | Diane | Should the panel open automatically, or only when Dean clicks? Should the answer render as sections or as chat prose? |

## Out of scope (proposed)

- Trade recommendations for new positions.
- Live open-position advice (the Portfolio tab owns it).
- Changing any scoring or qualification logic.
