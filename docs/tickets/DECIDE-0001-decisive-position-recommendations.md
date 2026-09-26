# DECIDE-0001 — Decisive position recommendations (Epic)

**Status:** REVISION 2 (2026-09-25), **not yet approved to build.** Revision 1 was aligned by Ian, Alan, Quinn and Paul; the team review in `docs/tickets/DECIDE-0001-review-2026-09-25.md` found three blocking issues and three serious ones. This revision addresses them. It now needs the independent lens reviews (Ian, Alan, Quinn, Paul, Diane), and then the developer's (Dane's) pre-development review, before any code. See "Review gates" at the end.
**Dean's decisions (2026-09-25):** the stop stays at production's level (a mark of 2x the credit); proceed with this epic now and do CUT-LOSSES-REVIEW-0001 after it; the CSP/CC 21-DTE exception; Finnhub for news.
**Sponsor:** Dean.
**Follow-up:** DECIDE-0002 (ex-dividend assignment guard, earnings-before-expiry rule, PMCC short-leg column, CC Growth-mode upside test).

## Problem

TradeEdge collects most of the data a trader needs to manage a position, but it never says what to do. The AI panels hedge because their prompts forbid a recommendation. For example, `app/api/leaps-analysis/route.ts` says "Never select a contract, direct a transaction … or use authority language", and `app/api/advisor/route.ts` says "You do not select a contract or direct a transaction" and requires a `disclosure` field in every response.

## Outcome

For every open position, TradeEdge shows **one recommended action**, with its reasons, what would change it, and a confidence level. Code makes the recommendation and the AI explains it. This keeps the AI-POLICY-0001 principle that "TradeEdge code stays the only authority".

## Architecture

```
facts (market data, broker, entry records, news)
  → signals (pure: broken stock)
  → decision (pure evaluators → adapters → PositionDecision)
  → AI explanation (states and explains the decision; cannot change it)
  → log (recommendation vs. what the trader did)
```

**Engines (Paul, P1):** keep the existing rule engines. Do not merge them. There are three that shape what the trader sees today, not two:

- **Legacy recommendation:** `getRecommendation` in `lib/portfolio-data/acquisition.ts`. This is the source of today's Hold and Cut Losses, and of the Acquire exemption (a lone short put set to Acquire or Wheel returns Hold and skips the breach and stop exits, `acquisition.ts` around line 2314). The stop trigger itself comes from `lib/portfolio/stopLossPolicy.ts` (`DEFAULT_ENTRY_STOP_MULTIPLE = 2`) and the stop-loss wiring in `lib/portfolio-data`. **This answers open item O2.**
- **Portfolio intelligence:** `lib/portfolio-intelligence/managementIntent.ts` and `objectives/positionObjective.ts`, with settings in `lib/portfolio-intelligence/policies/defaults.ts` (50% profit, 21 DTE, a material loss of -100% of the credit).
- **LEAPS:** `lib/leaps-position-intelligence/evaluate.ts`.
- **Adapter:** one thin adapter per engine that maps its result to the shared `PositionDecision`.
- **Cutover (open item O7):** the app must show exactly one recommended action per position. This ticket states which existing recommendation display each adapter replaces, and the old display is removed in the same slice, not left beside the new one.
- **Revisit a merge** only if the adapters start duplicating logic.

## Phases

| Ticket | Title | Depends on |
|---|---|---|
| DECIDE-0001-0 | Data prerequisites (chart history and volume, entry support level, log investigation) | — |
| DECIDE-0001A | Broken-stock signals (display only, no action changes) | 0001-0 |
| DECIDE-0001B | Decision rules and the `PositionDecision` adapters | 0001A |
| DECIDE-0001C | AI explains the decision (prompt rewrite) | 0001B; Paul's D2/D9 amendment |
| DECIDE-0001D | Recommendation vs. action log (extends `lib/decision-review`) | 0001B |
| DECIDE-0001E | Finnhub news and analyst-action feed | 0001A |

## Conventions (all phases)

- `n` is the last **completed** session. A partial intraday bar is never used. Bars are sorted by `t` and de-duplicated.
- Prices are per-share. Stop, target and roll math use the combo **mid**; the natural price is shown as the expected fill. Money comparisons use integer cents.
- `C` is the cumulative net credit per share, including all rolls.
- `P&L = C − mark`.
- DTE is in calendar days, New York time.
- Short delta is the largest |delta| across the short legs.
- Every value the evaluator needs is an explicit input. The evaluator reads no hidden state.
- **Intent is an explicit input** for a lone short put or short call: the stored value from `/api/position-intent` (`income`, `acquisition`, `wheel`, `neutral`). A missing value is treated as the position's default, and the default is part of the rules below.
- **Presentation (Dean, 2026-09-25):** an action is never shown as a loud red command. The UI states the action calmly with its top reasons, the flip conditions, and what the position needs to recover. Diane's mock governs the exact look.

## DECIDE-0001-0 — Data prerequisites

The signals in 0001A cannot run on today's data. Verified 2026-09-25:

- `app/api/chart/route.ts` requests `interval=1d&range=6mo` from Yahoo (about 125 bars). The trend rule needs 201 completed bars.
- The route returns bars with only `t, o, h, l, c`. The support-break rule needs volume `v`.
- Positions opened before 2026-09-25 have no entry snapshot, so no support level `S` exists for them (the Trade Log CSV has empty Score, Entry State and Entry Overrides columns on all 65 rows).
- `lib/decision-review` holds 0 stored reviews on Dean's account; nothing writes to it today.

Work in this phase:

1. **Chart route:** request at least `range=2y` and return volume. Alan rules on adjusted versus unadjusted closes (splits must be adjusted; dividend adjustment must be consistent between the bars used for ma200, the gap rule and the support level). Cache per symbol per session date; a partial intraday bar is never returned as complete. The route must keep its current response shape for existing callers (add fields, do not remove).
2. **Relative-weakness benchmark:** SPY bars over the same range and the same timestamps.
3. **Entry support level `S`:** stored in the entry record when a position opens (as written). For positions with no record, compute `S` on first evaluation from the 20 completed sessions before the recorded entry date, mark it `source: 'reconstructed'`, store it write-once, and show it as reconstructed. If the entry date is unknown, the support signal is NE.
4. **Log investigation:** find out why no `DecisionReview` is ever created (where `lib/decision-review` is called from, and whether a UI action was expected to create one). Report before 0001D is scoped.

Acceptance: a unit test with a 2y fixture yields 201+ completed bars and volume; the existing chart callers (quick chart, RSI strip, order-window RSI line) still work unchanged.

## DECIDE-0001A — Broken-stock signals

New pure module: `lib/market-intelligence/brokenStock.ts`.

`broken = trend ∨ gap ∨ support ∨ fundamental`. Relative weakness is corroborating only (see below).

| Signal | Fires when | Not evaluated (NE) when |
|---|---|---|
| Trend break | `c[n] < ma200(n)` **and** `c[n−1] < ma200(n−1)` **and** `ma50(n) < ma200(n)`. Each close is compared with its own day's ma200. | Fewer than 201 completed bars (needs 0001-0) |
| Failed gap | See the formulas below the table. The gap day `g` is within the last 20 sessions. | Fewer than 21 closes before `g` |
| Support break | `c[n]·100 < 99·S` (in cents) **and** `v[n] ≥ 1.5 · avg(v[n−20..n−1])`. The volume average excludes today. | No entry record, or any missing `v` in those 21 bars |
| Fundamental hit | A guidance cut, or ≥ 2 analyst downgrades within 10 days (from 0001E) | Always, until 0001E ships. A signal that isn't built yet is exempt from the confidence rules. |

**Failed-gap formulas**

- `gap = O[g]/C[g−1] − 1`
- `ADM20 = mean over i = g−20 … g−1 of |C[i]/C[i−1] − 1|`
- Threshold `T = max(0.08, 3·ADM20)`. There is no fallback to 8% when the data is short.
- Recovery level `R = O[g] + 0.5·(C[g−1] − O[g])`
- It fires when `gap ≤ −T` and `max(C[g..g+4]) < R`, once `g+4 ≤ n`. The gap day counts as session 1.
- Before `g+4` it is **pending**: not fired and not NE.

**Support at entry:** `S` is the lowest low of the 20 completed sessions before entry, frozen when the position opens and stored in `lib/leaps-position-intelligence/entryRecords.ts` (and the short-premium entry record). Positions with no record use the reconstructed, write-once value from 0001-0 and say so. The short strike is **not** used; a breached short strike is handled by the stop and delta rules.

**Display only in this phase.** 0001A shows the signals as information. It changes no recommendation and no action.

**Relative weakness (corroborating only)**

- Fires when `r20(stock) − r20(SPY) ≤ −0.15`.
- Returns are joined on identical `t` at both endpoints. A date mismatch makes it NE.
- It never marks a stock broken and never changes an action.
- When another signal fires, it is added as a reason and raises confidence one step, LOW to MEDIUM only.
- When nothing else fires, it is shown as risk context.
- Its NE never lowers confidence.

**Applicability**

| Position | Rule |
|---|---|
| BCS | Broken-stock signals are **N/A**, which is distinct from NE. A falling stock helps a BCS. |
| IC | Only the put side is evaluated. |
| All others | All signals apply. |

**Output**

```
{ broken, signals: [{ code, state: 'FIRED'|'CLEAR'|'PENDING'|'NE'|'NA', value, threshold }] }
```

Missing data can never make a signal fire.

## DECIDE-0001B — Decision rules

```ts
type DecisionAction =
  | 'HOLD' | 'CLOSE_PROFIT' | 'CLOSE_STOP' | 'CLOSE_BROKEN' | 'CLOSE_TIME'
  | 'ROLL' | 'ACCEPT_ASSIGNMENT' | 'BLOCKED';

interface PositionDecision {
  action: DecisionAction;
  reasonCode: string;                          // BLOCKED uses DATA_UNAVAILABLE or STOP_PENDING_CONFIRMATION
  reasons: string[];                           // reason codes; the UI shows the top 3
  flipConditions: string[];                    // e.g. "ROLL if XYZ closes below $92"
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null; // null if and only if action === 'BLOCKED'
  pendingStop?: { firstReadingAt: string; mark: number } | null;
  evaluatedAt: string;
}
```

Every `switch` on `action` or `confidence` ends with a `satisfies never` exhaustiveness check.

### Precedence (first match wins)

**Spreads and IC (BPS, BCS, IC)**

| # | Rule | Action |
|---|---|---|
| 1 | Data (see Data rules) | `BLOCKED` |
| 2 | Stop: `mark ≥ 2·C` (a loss of 1× the credit; production's trigger, `DEFAULT_ENTRY_STOP_MULTIPLE = 2`) | `CLOSE_STOP` |
| 3 | Broken stock (N/A for BCS; IC put side only) | `CLOSE_BROKEN`. Close the whole position (IC: all 4 legs). Never roll. |
| 4 | Profit: `(C − mark)/C ≥ 0.50` | `CLOSE_PROFIT` |
| 5 | Time: DTE ≤ 21, and entry DTE was > 21 | If `P&L ≥ 0` → `CLOSE_TIME`. If `P&L < 0` → `ROLL` if a qualifying roll exists, else `CLOSE_TIME`. Winners never roll. |
| 6 | Short delta ≥ 0.50 | `ROLL` if a qualifying roll exists, else `CLOSE_STOP` |
| 7 | Default | `HOLD` |

**CSP and CC** (Dean approved: no 21-DTE rule and no delta-roll rule). **The intent branch below is evaluated first.**

| # | Rule | Action |
|---|---|---|
| 1 | Data | `BLOCKED` |
| 2 | Stop: `mark ≥ 2·C` | `CLOSE_STOP` (see the intent branch below: not for Acquire or Wheel) |
| 3 | Broken stock | `CLOSE_BROKEN`. CC closes the call only; whether to sell the shares is shown as a separate note, never recommended by this rule. (Not for Acquire or Wheel: see below.) |
| 4 | Profit ≥ 50% (CC: the call leg only) | `CLOSE_PROFIT` |
| 5 | Assignment: short delta ≥ 0.50 and the stock is not broken | See below |
| 6 | Default | `HOLD` |

### Intent branch for lone short puts and short calls (Dean, 2026-09-25)

A put or call sold to be assigned (to own the shares, or to start a wheel) has an Acquire or Wheel aspect, so a strong recommended action does not make sense for it. This matches the existing behavior in `getRecommendation` (Acquire returns Hold and skips the breach and stop exits).

| Intent | Rules that apply | Result |
|---|---|---|
| `income` (and `neutral`) | The table above unchanged | As above |
| `acquisition`, `wheel` | Rule 1 (Data) and rule 4 (Profit ≥ 50%: `CLOSE_PROFIT`) only. Rules 2 and 3 (stop, broken stock) do **not** produce an action. | `HOLD`, or `ACCEPT_ASSIGNMENT` when the short delta is ≥ 0.50, with the loss versus credit and the broken-stock signal shown as context lines, never as the action |

- A missing intent uses the position's default. Today the app **defaults every lone short put to `acquisition`**, which means a default CSP is never stopped. **Open item O6 (Ian): keep that default, or change it?** This ticket does not change it.
- **Open item O5 (Ian):** does a hard loss limit still apply to Acquire and Wheel positions (for example, an action at a loss of 3x the credit)? Recommendation: no hard limit, matching production behavior, but the context line must state the loss plainly.
- For a CC, the intent is the intent stored on the short call. Growth mode remains DECIDE-0002.

Rule 5 by position:

- **CSP:** `ROLL` if a qualifying roll exists with `K' ≤ K`, `DTE_new > DTE_old` and `DTE_new ≤ 60`. Otherwise `ACCEPT_ASSIGNMENT`.
- **CC, Income mode:** `ROLL` if a qualifying roll exists with `K' ≥ K` and `AR_roll > AR_entry`. Otherwise `ACCEPT_ASSIGNMENT`.
  - `AR_roll = (rollNet + (K' − K))/S × 365/DTE_new`
  - `AR_entry = C/S_entry × 365/DTE_entry`
- **CC, Acquire or Growth mode:** `ACCEPT_ASSIGNMENT`. The Growth-mode upside test is in DECIDE-0002.

**LEAPS long**

| # | Rule | Action |
|---|---|---|
| 1 | Data | `BLOCKED` |
| 2 | Broken stock | `CLOSE_BROKEN` |
| 3 | DTE < 180, or long delta < 0.60 | `ROLL` |
| 4 | Default | `HOLD` |

### Qualifying roll

- `rollNet = floor_to_cent(mid(new short combo) − mid(close old combo)) − fees/(100·qty)`
- `fees = f × Σ contracts across every leg closed or opened`
  - `f` is a fixed per-contract constant from the broker's published schedule, rounded up. It is always available.
  - Charging closing legs is deliberately conservative.
- The roll **qualifies** when `rollNet ≥ $0.10/share`, `DTE_new > DTE_old`, and the strike rule for the position is met:
  - Short puts (BPS, CSP): new strike ≤ old strike.
  - Short calls (BCS, CC): new strike ≥ old strike.
- Fee example: an IC roll has 8 legs. With `f = $1` that is 0.08/share, so a 0.17 mid gap gives `rollNet = 0.09`, which does not qualify.

### Data rules

- **Required inputs:** mark, credit, DTE and short or long delta.
  - A missing required input returns `BLOCKED` / `DATA_UNAVAILABLE`, never `HOLD`.
  - An earlier rule that fires on the inputs it has still decides. For example, mark and credit are enough to return the stop.
  - `HOLD` requires every rule to have been evaluated.
- **Stale quote:** refresh once. If it is still stale, return `BLOCKED` / `DATA_UNAVAILABLE`.
- **Expired token:** return `BLOCKED` immediately, without guessing.

**Wide-quote stop.** Applies when the combo `(ask − bid)/mid > 0.25`.

- The stop needs 2 readings past the trigger, with distinct quote timestamps, at least 300 s apart, both in regular trading hours. They may span adjacent sessions.
- `priorReading` is a required, nullable input.
- **First reading:** return `BLOCKED` / `STOP_PENDING_CONFIRMATION`, with `pendingStop` set and the text "Stop triggered on a wide quote; confirming, recheck in 5 min". It is never `HOLD`.
- **Reset:** any reading below the trigger clears the pending state.
- **Narrow quote:** a single narrow-quote reading past the trigger fires the stop immediately.

**Unreachable stop:** when `2·C > width` (that is, `C > width/2`), show the flag "Stop unreachable; max loss $X is the stop".

### Confidence

Checked in this order: null, then LOW, then MEDIUM, then HIGH.

- **null:** only for `BLOCKED`.
- **HIGH, always:** once a mechanical rule fires (the stop, the profit target, 21 DTE, `CLOSE_TIME`).
- **Presentation of confidence:** shown as a small plain label next to the action; never the reason to color the action red or green.
- **Judgment values:** short delta, LEAPS delta, gap size and support-break distance.
  - Margin `m = |x − T|/|T|`. `m < 0.10` gives LOW; otherwise HIGH.
  - A `HOLD` is judged against the nearest threshold it has not reached.
  - Bands:
    - Short delta: [0.50, 0.55) fired; [0.45, 0.50) HOLD.
    - LEAPS delta: [0.54, 0.60) fired; [0.60, 0.66) HOLD.
    - LEAPS DTE: 180 ± 18.
    - Gap: `T` to `1.1·T`.
- **MEDIUM:** another rule points the other way. Relative weakness can lift LOW to MEDIUM only. Signals that aren't built yet, and N/A signals, never lower confidence.

## DECIDE-0001C — AI explains the decision

- Rewrite the prompts in `app/api/advisor/route.ts` and `app/api/leaps-analysis/route.ts`.
  - The AI receives the `PositionDecision` and its evidence.
  - It returns the action as a structured enum field, then plain-language reasons and flip conditions.
  - D8 (no numbers in prose) still applies.
- **Server-side check:** parse `action` and compare it with the input action as an exact enum match (no substring or synonym matching). On a mismatch, discard the AI text, show the code-only reasons, and log it as a dissent.
- **Dissent field:** the AI may disagree only in a separate `dissent` field, which is shown collapsed and logged.
- **Presentation:** the AI text follows the calm-presentation rule in Conventions (reasons, flip conditions, what the position needs; no command language beyond the enum action).
- **Disclaimer:** remove the per-response `disclosure` and show one standing disclaimer in the UI. Before removing the field, grep its consumers and tests.
- **Paul's conditions for amending AI-POLICY D2 and D9:**
  - D2's exception is narrowed to this prompt rewrite; there are no new advisor capabilities.
  - D9 gets a scoped exception: stating an action code has already decided is allowed. There are no other lexicon changes.

## DECIDE-0001D — Recommendation vs. action log

- **Extend `lib/decision-review` (PI-0008C) instead of building a second log.** Its `DecisionReview` already has a trader-action vocabulary, an outcome status and an evidence snapshot. Map `PositionDecision` onto it (add fields, do not fork). The 0001-0 investigation says first why it holds 0 records.
- Record each `PositionDecision` shown, in Redis keyed by user, de-duplicated per position, action and session.
- **Attribution:** a trader action counts against a decision if it happens on the same position within 3 trading sessions after the decision was shown. If there is none, the row is logged as `no_action`; it is never dropped.
- `BLOCKED` / `STOP_PENDING_CONFIRMATION` rows are kept apart from data failures and excluded from agreement-rate stats.
- **Performance page:**
  - agreement rate by rule and by confidence
  - P&L of recommendations followed vs. overridden

## DECIDE-0001E — Finnhub news and analyst-action feed

- **Provider:** Finnhub.
  - The key is `FINNHUB_API_KEY`, a Vercel server-only environment variable. Never use a `NEXT_PUBLIC_` prefix (see SEC-0001).
  - Fetch server-side and cache per symbol.
- **Classification:** classify items as `GUIDANCE_CUT`, `DOWNGRADE`, `UPGRADE` or `OTHER`.
  - Finnhub's structured analyst-rating data is used first.
  - The AI classifies only untagged headlines.
- **Signal input:** only `GUIDANCE_CUT` and `DOWNGRADE` feed the "Fundamental hit" signal.
- **Confidence cap:** an action driven by an AI-classified headline is capped at MEDIUM until 0001D logs at least N classifications with at least X% precision against Ian's manual spot-check sample. Ian sets N and X before 0001E ships.

## Non-goals

- No automated order placement. Recommendations only.
- No change to scan qualification or scoring.
- No change to autopilot scope.
- DECIDE-0002 items (see header).

## Acceptance criteria

1. Alan's golden fixtures pass (list below). Every precedence rule, every adjacent rule-pair conflict, and every threshold boundary is covered.
2. A property test shows the same inputs always give the same `PositionDecision`, and that `action === 'BLOCKED'` if and only if `confidence === null`.
3. A missing required input, a stale quote after one refresh, or an expired token returns `BLOCKED` / `DATA_UNAVAILABLE`, never `HOLD`.
4. The AI route rejects any response whose parsed action is not exactly the input action. Fixtures cover near-miss synonyms such as "close" vs. `CLOSE_PROFIT`.
5. Every `switch` on `action` and `confidence` fails the build if a case is missing.
6. The UI branches on `reasonCode`, not only on `BLOCKED`. The UI follows Diane's approved mock and shows no red command (calm presentation).
7. The log de-duplicates repeats, records `no_action`, and excludes pending-stop rows from agreement stats.
8. **Intent:** an Acquire or Wheel CSP or CC never receives `CLOSE_STOP` or `CLOSE_BROKEN`, and a test proves an Income position at the same numbers does.
9. **Cutover:** each position shows exactly one recommended action; the display it replaces is removed in the same change.
10. **Data:** the chart route serves 201+ completed bars and volume, and the existing chart callers are unchanged.

## Golden fixtures (Alan)

| Area | Cases |
|---|---|
| Stop | mark 1.99·C (no fire) and 2.00·C (fire); `C = 2.51` on a 5-wide (`2·C` = 5.02 > width, unreachable flag) and `C = 2.50` (reachable exactly at width); combo width 0.25 / 0.26 of mid |
| Wide-quote stop | one reading (`BLOCKED` pending); 299 s (still pending); 300 s (`CLOSE_STOP`); a reset in between; narrow quote on the second reading (`CLOSE_STOP`); stale timestamp (`BLOCKED` / `DATA_UNAVAILABLE`) |
| Profit | 49.99% / 50.00% for IC, CSP and CC |
| 21 DTE | 22 / 21; P&L 0.00 (`CLOSE_TIME`); −0.01 with rollNet 0.10 (`ROLL`); −0.01 with rollNet 0.09 (`CLOSE_TIME`); entry DTE ≤ 21 (rule skipped) |
| Short delta | 0.4999 / 0.50; IC with only the call side breaching |
| Trend | one close below ma200 (no fire); two closes (fire); close = ma200 (no fire); 200 bars (NE) |
| Gap | ADM 2.66% / 2.67% around `T = 8%`; gap exactly −10.5% with ADM 3.5%; −7.99% / −8.00%; recovery 94.99 / 95.00; 4 sessions elapsed (pending); 20 prior closes (NE) |
| Support | close = 0.99·S (no fire); 0.99·S − 0.01 (fire); volume 1.49× / 1.50×; a volume that fires only if today is included (must not fire); one missing `v` (NE); no entry record (NE) |
| Relative weakness | −14.99 / −15.00 pts; SPY date misaligned (NE); firing alone gives `broken = false` |
| Applicability | BCS never returns `CLOSE_BROKEN` and falls through to profit; IC with only the call side weak gives not broken; IC broken closes 4 legs; CC broken closes the call only (the shares are a separate note) |
| Intent branch | CSP `acquisition` and `wheel` with mark 5·C (no `CLOSE_STOP`; `HOLD` with the loss shown); the same with delta 0.50 (`ACCEPT_ASSIGNMENT`); `acquisition` at 50% profit (`CLOSE_PROFIT`); `income` at mark 2.00·C (`CLOSE_STOP`); a stock broken with `acquisition` (no `CLOSE_BROKEN`; signal shown as context); a missing intent uses the default; CC with intent on the call |
| CSP/CC assignment | delta 0.4999 (`HOLD`) / 0.50; delta 0.50 with the stock broken (`CLOSE_BROKEN`); CSP `DTE_new` 60 (`ROLL`) / 61 (`ACCEPT_ASSIGNMENT`); `K' = K + 1` (`ACCEPT_ASSIGNMENT`); CC `AR_roll` equal to `AR_entry` (no roll) vs. one cent above |
| Fees | IC roll with rollNet 0.09 (does not qualify); CSP 0.10 before fees and 0.08 after (does not qualify) |
| LEAPS | DTE 180 / 179; delta 0.60 / 0.5999 and 0.54 / 0.5399 |
| Precedence conflicts | stop and broken both true (stop wins); broken and profit both true (broken wins); profit and 21 DTE both true (profit wins); for `acquisition` or `wheel`, stop true and profit false (`HOLD`) |
| Confidence | the delta and gap band edges; mechanical rules always HIGH; relative weakness lifts LOW to MEDIUM only; an unbuilt signal does not lower confidence |
| Data | missing mark (`BLOCKED`); stop decided on mark and credit while delta is missing (`CLOSE_STOP`); expired token (`BLOCKED`) |

## Open items

| # | Item | Owner |
|---|---|---|
| O1 | Recommendation card mock | Diane |
| O2 | Confirm the stop-loss wiring file for the short-premium adapter | Dane, before 0001B |
| O3 | N and X for the news classifier confidence cap | Ian, before 0001E |
| O4 | Record the D2/D9 amendments in the AI-POLICY-0001 epic | Paul |
| O5 | Does any hard loss limit apply to Acquire and Wheel positions? (recommendation: none, state the loss plainly) | Ian |
| O6 | Keep the default of Acquire for every lone short put (it exempts default CSPs from the stop), or change it? | Ian, Dean |
| O7 | Cutover: which existing recommendation display each adapter replaces, and removal of the old one | Paul, Dane |
| O8 | Adjusted versus unadjusted closes for ma200, gaps and support | Alan |
| O9 | Entry support level for positions with no record: reconstructed, write-once, labeled | Alan, Quinn |
| O10 | Diane's calm-presentation mock, including the recommendation beside the intent chip and the extrinsic rows | Diane |

(O2 is answered in "Engines": the stop wiring is `lib/portfolio/stopLossPolicy.ts` with `getRecommendation` in `lib/portfolio-data/acquisition.ts`.)

## Review gates (every lens, then the developer)

Nothing is built until every gate below is recorded here.

| Gate | Reviewer | Focus | Status |
|---|---|---|---|
| G1 | Ian | Rules, the intent branch, O5, O6, the 2x stop | pending |
| G2 | Alan | Formulas, fixtures at 2x, data conventions (O8, O9), confidence bands | pending |
| G3 | Quinn | Testability, three engines, the cutover (O7), the log reuse, regressions | pending |
| G4 | Paul | Scope, sequencing (first slice 0001-0 then 0001A), AI-POLICY amendments | pending |
| G5 | Diane | The calm-presentation mock (O10) before any UI code | pending |
| G6 | Dane (the developer) | Pre-development review: reads the whole ticket and the code it touches, lists ambiguities, missing inputs, estimate and risks, and confirms he can build each phase from the text alone. Runs only after G1 to G5 are done. | pending |

Dean is the sponsor and final decision-maker for every open item.
