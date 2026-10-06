# PERF-AI-0001 — AI coaching for the selected Performance period

**Status (2026-10-06): team review done (below); waiting on Dean: scope approval and the sizing question (D-SIZE). Then Diane mock, then build.** Requested by Dean: an AI analysis of the selected period that helps trading habits and strategy, and is precise and confident.

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
| Q8 | Dean | DECIDED 2026-10-06: gpt-5.6-terra (step up to gpt-5.6-sol if answers are sloppy). Applied to the current Performance AI ahead of the rest of this ticket. |
| Q9 | Diane | Should the panel open automatically, or only when Dean clicks? Should the answer render as sections or as chat prose? |

## Out of scope (proposed)

- Trade recommendations for new positions.
- Live open-position advice (the Portfolio tab owns it).
- Changing any scoring or qualification logic.

## Team review (2026-10-06)

### Ian (trader): approve with changes
- **Coach against Dean's own rules only (Q2).** General norms are not his methodology. Exception: position sizing has no written rule. It is raised as **D-SIZE** for Dean, not invented by the AI.
- **Habits in v1 (Q1)**, limited to data the trade record actually holds:
  1. the five rule checks;
  2. **re-entry after a loss:** same ticker within 2 days of a losing close;
  3. **loss concentration:** a ticker carrying ≥ 25% of the period's losses;
  4. **day of week and time of entry:** only ever as an early signal, never a finding.
- Out of v1:
  - earnings exposure and rolls: not in the trade record;
  - IVR and delta at entry: entry context covers 1 of 67 trades.
- **The AI must report what the data says, even against a rule.** In Dean's log, the 9 spreads at or above 1/3 credit-to-width lost −$982, and the 43 below made +$426. That is 9 trades, so an early signal, not a reason to drop the rule. The coaching must say so plainly and suggest what to look at (were those near the money?). It must not recommend skipping below-1/3 trades, which would have cost $426.

### Alan (quant): approve with changes
- **Evidence tiers (Q3):**
  - finding ≥ 10 trades, early signal 5–9, below 5 not reported as a pattern;
  - a rule breach is a fact at any count;
  - a **comparison** between two groups (strategy A vs B, at-or-above vs below 1/3) needs **both** groups ≥ 10 to be a finding;
  - no confidence intervals in the text, since the tiers carry it.
- **What-ifs (Q4)**, computed in code and shown with the arithmetic:
  - **Beyond the 2× stop:** saved = Σ (actual loss before fees − credit). The 2× stop on price means the loss is capped at 1× credit. This is already `rules.beyondStop.excessLoss`. It assumes a fill at the stop: label it "at the stop price; slippage not modeled".
  - **Skipped entries** (inside 21 DTE, re-entry after a loss): saved = −Σ P/L of those trades. It can be negative, meaning skipping would have cost money. Show it either way.
  - **Credit-to-width:** report both groups' P/L; no single "saved" figure.
- **Units:** dollars after fees, per position (all contracts). Credit-to-width = credit ÷ (width × 100 × contracts).
- **Fail closed:** a what-if with any trade lacking strikes or credit is reported as "not computable: N trades missing data", never estimated.

### Quinn (QA): approve with changes
- **Number check (Q7):**
  - Every $ amount and trade count in the answer must match a value in the input, allowing ±$1 rounding.
  - The input supplies the differences and totals the AI may want, so it never adds or subtracts anything itself.
  - On a mismatch: one automatic retry that lists the bad figures. If it still fails, show the answer with a visible "unverified figures: …" banner.
- **Tests:**
  - input builder and what-if calculator against a golden fixture of Dean's 67-trade log (expected −$982 / +$426, beyond-stop 5 trades);
  - number checker: exact, rounding, invented figure, percent vs dollar;
  - period label;
  - the panel's empty-period and API-error states.
- **Architecture:**
  - builder, what-ifs, prompt text and checker live in `lib/` (`page.tsx` exports only);
  - the old `buildPerformanceAnalysisPrompt` is deleted, not left beside the new one;
  - one shared prompt version constant.
- **Size:** at 12 months (~70–200 trades) the per-trade lines stay well under the model's input limit. Cap at 400 trades, with a visible note when capped.

### Diane (UX): approve; mock next
- **Opens on click (Q9)**, never automatically: each run costs money and takes time.
- **The answer renders as sections, not chat prose:**
  1. **Top tiles:** account profit, closed-trade profit, and the biggest leak in dollars.
  2. **Habit cards:** one per habit, with dollars and a tier chip (Finding / Early signal).
  3. **Three change cards:** each with dollars, a tier chip, and a "see rule card" link that scrolls to the matching card on the tab.
  4. **Chat box** below for follow-ups.
- **Header:** period dates, trade count, the model that answered, and a "generated at" time.
- **Unverified figures:** an amber banner at the top of the answer, not hidden.

### Paul (product): scope
- **In:** R1–R6 with the changes above. The habit list is Ian's v1 list.
- **Build order:**
  1. S1, `lib/`: input builder, what-ifs, number checker, with tests.
  2. S2: prompt and the gpt-5.6-terra call with the checker and retry.
  3. S3: the panel per Diane's mock.
- **Out, separate tickets:**
  - saving analyses per period for month-over-month comparison (Q6, needs Redis);
  - entry-context coaching (Q5) until coverage is meaningful;
  - moving the Trade Log AI button onto the same builder;
  - earnings and roll coaching.
- **Dean decisions needed:**
  - approve this scope;
  - **D-SIZE:** do you have a max risk per trade (for example % of account)? If yes, the AI coaches against it; if not, sizing is reported as information only (capital at risk per trade vs account value), with no verdict.

## Dean's input (2026-10-06, after the review)

- **Open positions are unsettled.** Period results stay realized-only; open positions are context, not results.
- **Coaching must include open stock positions,** but only with enough market and company data to be intelligent. Dean: AI is too often "too deterministic" and gives bad position advice.
- **Every recommendation must be discussable.** Dean can reply back and forth in the context of that specific position.

**Paul's proposed split (pending Dean):**
- **This ticket (v1):** coaching on closed trades and habits. Open positions are listed as context only, with no advice on them.
- **New ticket PERF-AI-0002, position coaching:** per-position recommendations for open stock and option positions, with a follow-up chat per position. The AI gets:
  - quote and trend;
  - IV and IVR;
  - earnings date;
  - fundamentals (`lib/fundamentals`);
  - recent news through the route's web-search path;
  - the position's own entry, cost and history.

  Built on the AI-POLICY-0001 grounded-chat work (0001B) rather than a second chat system.
