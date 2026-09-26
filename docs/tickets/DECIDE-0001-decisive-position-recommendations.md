# DECIDE-0001 — Calm, decisive position recommendations (Epic)

**Status:** REVISION 5 (2026-09-26). **Not approved to build.** Revision 5 adds Ian's complete coverage review: every status the app can show today now has a home in the design or is explicitly dropped, and the mock (revision 3) shows every situation. It also folds in Dean's pasted review points. Approved so far (Paul): Phase 0 and 0001A only; Paul must re-check the wider scope of the screen slice.
**Rendered mock (revision 3 with Dean's pasted points, for Dean to approve):** https://claude.ai/artifact/1mhkVcQUysMBL2vPvrmucA
**Sponsor:** Dean. **Team review record:** `docs/tickets/DECIDE-0001-review-2026-09-25.md`.
**Dean's decisions (2026-09-25):** production's stop stays (a mark of 2x the credit received, a loss of 1x the credit); proceed with this epic now and do CUT-LOSSES-REVIEW-0001 after it; no 21-DTE rule for CSP and CC; Finnhub is the chosen news source (a later ticket); a CSP with an Acquire or Wheel aspect gets no strong recommended action; no loud red commands.
**Approved scope so far (Paul, G4):** Phase 0 and 0001A only. Everything after is approved slice by slice.

## Who reviews what (one table)

| Who | What they still need to do | Blocks | Status |
|---|---|---|---|
| **Dean** | (1) Approve the rendered mock (link above). (2) Decide the broken-stock gate: any loss (`P&L < 0`, as first written and as his pasted note keeps it) or Ian's stricter version (a loss of at least 0.5x the credit, or short delta 0.30 or more) (O17). (3) Yes or no to Ian's fallback stop for an unreachable stop (O14) and to dropping the behaviors listed under "Behavior being dropped". (4) Say when to start; only Phase 0 and 0001A are approved. | The screen slice (S3) and the rules slice (B1) | Waiting |
| **Alan** | Check the new rules and write their fixtures: the fallback stop (O14); the broken-stock gate (O17); the wide-quote timeout (O15); the expires-soon and at-maximum-loss precedence and window (M, N); uncovered-short-call cover detection (V); the CC net P/L figure; "roll cost" (new breakeven and new maximum loss) | B1 | Not started on revision 5 |
| **Ian** | Confirm the new states V, W, U, S, G0 and the rulings in "Coverage of every current status"; O12 (support-break and volume confidence bands, whether a fired gap clears on recovery, whether an unreachable stop needs another protection); approve the S2 disagreement list when it exists | B1, S2 to S3 | Coverage review done; O12 open |
| **Quinn** | Re-review for the wider scope: data each new state needs (working orders, quote age, stop-order status, structure ambiguity, cover detection for V, PMCC pair detection for W); the position-card banners and the priority, mission-control and panel surfaces added to the cutover map; the missing-recommendation fallback | S3 | Revision 2 reviewed; revision 5 pending |
| **Paul** | Re-check scope now that the screen slice is wider (about 20 states plus banner and surface changes); decide what ships in S3 versus later; update the roadmap | S3 scope | Approved Phase 0 and 0001A only |
| **Diane** | Confirm revision 3 of the mock against her spec and the 256px cell (numbers line, stop styling, grouped states); record approval after Dean approves | S3 | Spec approved with changes |
| **Dane (developer)** | Pre-development review of the whole ticket and the code it touches; runs LAST | Any development | Not started |

**Nothing is built until every row above is done.** Phase 0 and 0001A can start once Dean says so.

## Problem

TradeEdge collects most of the data a trader needs to manage a position, but its recommendations are inconsistent and, in places, loud. Two facts found in review:

1. There is **one live recommendation engine**, not three: `scorePortfolioPositionObjective` (`lib/portfolio-data/acquisition.ts:208`) calls `evaluatePositionObjective` and `selectManagementIntent` (`lib/portfolio-intelligence`). Its result is `pos.recommendation`, which feeds every recommendation display in the app (see the cutover map). `getRecommendation` (`acquisition.ts:2221`), which holds the Acquire and Wheel exemption, is **never called by the app** (it is only imported at `app/portfolio/page.tsx:259` and called by tests). So the Acquire and Wheel exemption Dean wants is **not implemented in the live path today**: a default CSP can show "Cut Losses".
2. Dean reported that a loud "Cut Losses" led to panic closes on positions that later recovered (Trade Log: 21 of 28 losses were closed before reaching 2x credit; CSPs net +$2,957 over 13 trades, spreads net -$530 over 52).

## Outcome

For every open position TradeEdge shows **either a calm recommended action or a plain "Hold"**, with its top reason, what would change it, and what the position needs to recover. Positions the trader has set to Acquire or Wheel never show a stop or a close action. The recommendation is guidance only; the trader decides and no order is placed automatically. Code makes the recommendation; an AI (a later ticket) may explain it but cannot change it.

## Architecture

```
facts (market data, broker, entry records)
  → signals (pure: broken stock)
  → PositionDecision (pure evaluators; intent, stop trigger and clock are explicit inputs)
  → replaces pos.recommendation everywhere it is read (one source of truth)
  → log (recommendation vs. what the trader did)
```

- **The live engine is replaced, not joined.** `PositionDecision` becomes the value behind `pos.recommendation` (or the only input to everything that reads it). A position must never display two different actions.
- **Manual actions stay.** The Take Profit / Cut Losses / Close / Roll buttons are manual actions that stay available whatever the recommendation is (`isActionRelevant`, `app/portfolio/page.tsx:1707-1723`). Only the "suggested" markers and the colors change.
- **Stop trigger comes from the trusted stop policy**, not a constant in the evaluator (see Stop rule).
- **LEAPS long-leg decisions are deferred** (see below). There is no engine for them today.
- **Dead code:** `getRecommendation` and its test blocks are deleted only after the cutover, after deciding which of its tests port over. The helper and trust-boundary tests in `lib/portfolio-data/__tests__/stopLossWiring.test.ts` (OCO identity, stop classification, `derivePositionQuoteQuality`, the MU production-incident fixtures) **do not change**.

## Phases and slice order

| Slice | Ticket | What Dean sees | Depends on |
|---|---|---|---|
| S0 | **DECIDE-0001-0** Data prerequisites | Nothing new on screen; a separate history endpoint and stored entry support levels | — |
| S1 | **DECIDE-0001A** Broken-stock signals, **display only** | A calm information line on each position; no action changes | S0 |
| S2 | **DECIDE-0001B1** `PositionDecision` pure module, **shadow mode** | Nothing on screen; a logged list of where it disagrees with today's recommendation | S1, O5, O6 answered, O11 |
| S3 | **DECIDE-0001B2** Cutover and calm UI | One calm action per position; all red and old markers removed in the same change | S2 approved by Ian on the disagreement list; Diane's mock approved by Dean |
| S4 | **DECIDE-0001D** Recommendation vs. action log | Agreement rates on the Performance page | S3 |
| — | DECIDE-0001C AI explanation, DECIDE-0001E Finnhub news | **Separate tickets, not part of this approval** | see below |

CUT-LOSSES-REVIEW-0001 (Dean: do it after this epic) keeps only the MAX_LOSS label question and the close-versus-expiry price capture; calm presentation, the Acquire and Wheel logic and the log are owned here.

## Conventions (all phases)

- `n` is the last **completed** session. A partial intraday bar is never used. A bar is complete when its NY date is before today, or after `meta.currentTradingPeriod.regular.end` + 15 minutes (this handles early closes). Bars are sorted by `t`, de-duplicated, and a bar with any null field is dropped, so the test is on the count of complete bars.
- **Integer math for every threshold test.** Prices and credits in cents; a mid test as `bid_c + ask_c ≥ 4·C_c`; relative bid-ask spread as `8·(ask_c − bid_c) > bid_c + ask_c`; deltas in 1/10000; returns and gaps in basis points; ADM and T in basis points. Where a ratio of floats must be compared it uses a 1e-9 tolerance and says so in the code. (Float traps found by Alan: `92/100 − 1` is not exactly −0.08; `|0.45 − 0.5|/0.5` is 0.09999999999999998.)
- **Prices are per share.** Stop, target and roll math use the combo **mid**; the natural price is shown as the expected fill. `C` is the cumulative net credit per share including all rolls. `P&L = C − mark`. DTE is calendar days, New York time. Short delta is the largest |delta| across the short legs.
- **Every input is explicit**, including `now` (the evaluator never calls `Date`; `evaluatedAt` equals the input `now`), the stored intent, the stop trigger and the prior stop readings.
- **Intent** for a lone short put or short call is the value stored through `/api/position-intent` under the position's key. A missing value uses the default: `acquisition` for a lone short put (existing app default, `acquisition.ts:1977`), `income` for a short call. `neutral` is treated as `income`.
- **Price basis:** split-adjusted, dividend-unadjusted closes (`indicators.quote`), rounded to cents. `adjclose` is never used. (Verified by Alan on live data: NVDA's 2024 split is continuous in `quote.close`; KO's 2-year `quote.close[0]` is 71.40 versus 67.52 in `adjclose`.)
- **Presentation (Dean, 2026-09-25):** no loud red command anywhere. The enum names are internal; visible labels come from Diane's table below and never use "stop", "cut" or "broken" as a command word. Confidence is plain neutral text ("High confidence"), never a color, and BLOCKED shows none.
- The fee constant `f` (per contract, from the broker's published schedule, rounded up) lives in one file with its source and date.

## DECIDE-0001-0 — Data prerequisites

Verified 2026-09-25 (Alan, Quinn):

- `app/api/chart/route.ts` requests `interval=1d&range=6mo` (about 125 bars) and returns bars with only `t, o, h, l, c`. The signals need 201 complete bars and volume.
- **Do not change `GET /api/chart?symbol=X`.** It has ten callers (`app/portfolio/page.tsx:2921` and `:8329`; `app/screener/page.tsx:5261` and `:6114`; `app/rinse-repeat/page.tsx:960`; `app/engine/page.tsx:2675`; `components/RsiLine.tsx:20`; `components/ChartLinkButton.tsx:66`; `lib/scans/trend.ts:10`; `lib/portfolio/trendFetch.ts:45`). Changing 6 months to 2 years would silently change `lib/scans/trend.ts:65-67` (its "200-day average" is today an average of all ~125 bars) and so scan trend classification (a non-goal), RSI values, and would break `components/__tests__/RsiLine.test.tsx`, which asserts the exact URL.
- **Add a separate history endpoint** (or an explicit opt-in such as `range=2y&fields=ohlcv`) used only by `lib/market-intelligence/brokenStock.ts`. It is auth-protected, cached server-side per symbol per NY session date, returns volume `v`, drops the in-progress bar, treats 429 or upstream failure as **not evaluated, never clear**, and has a per-user rate limit.
- SPY bars over the same range and identical timestamps for relative weakness.
- **Entry support level `S`.** Stored in the entry record when a position opens (`lib/leaps-position-intelligence/entryRecords.ts` and the short-premium entry record). For a position with no record: computed on first evaluation as the lowest low of the 20 bars whose NY date is strictly **before** the NY date of the position's original open (bars, not weekdays, so holidays are skipped; an entry-day or after-close entry excludes the entry day itself), stored **write-once** with `source: 'reconstructed'`, `asOf`, and the price basis, and displayed as reconstructed. Unknown entry date, fewer than 20 prior bars, or a split after entry makes support **not evaluated**. A rolled position uses the original open date.
- **Decision log finding (replaces the earlier "investigation"):** `lib/decision-review` holds 0 records because records are created only when the trader opens the section and saves (`DecisionReviewSection.tsx:84` → `app/portfolio/page.tsx:10346` → `/api/decision-reviews`). Nothing auto-writes. There is nothing to investigate.
- **Coordinate with RSI-TURN-0001:** only one of them edits `app/api/chart/route.ts` at a time; RSI's live-bar timestamp fix and this endpoint's completed-session rule should share the helper.

**Acceptance:** a 2-year fixture yields 201+ complete bars with volume; `GET /api/chart?symbol=X` returns the same bars and shape as today (fixture) and `RsiLine.test.tsx` passes unmodified; partial-bar, null-bar, split and dividend fixtures pass (Alan's Phase 0 table).

## DECIDE-0001A — Broken-stock signals (display only)

New pure module `lib/market-intelligence/brokenStock.ts`. It changes **no recommendation and no action**.

`broken = trend ∨ gap ∨ support ∨ fundamental`. Relative weakness is corroborating only.

| Signal | Fires when | Not evaluated (NE) when |
|---|---|---|
| Trend break | `c[n] < ma200(n)` **and** `c[n−1] < ma200(n−1)` **and** `ma50(n) < ma200(n)`; ma is the simple mean of closes including day `n`. **It fires only if it was not already true at the recorded entry date;** if it pre-existed, it is shown as context and does not count toward `broken` (the trader chose that entry). | Fewer than 201 complete bars |
| Failed gap | See formulas | Fewer than 21 closes before `g` |
| Support break | `c[n]_c·100 < 99·S_c` and `40·v[n] ≥ 3·Σ v[n−20..n−1]` (volume ≥ 1.5x the prior-20 average, today excluded) | No support level, or any missing or zero `v` in those 21 bars, or a split after entry |
| Fundamental hit | Guidance cut or ≥ 2 analyst downgrades in 10 days | Always, until the news ticket ships; an unbuilt signal never lowers confidence |

**Failed gap.** `gap = O[g]/C[g−1] − 1`; `ADM20 = mean over i = g−20 … g−1 of |C[i]/C[i−1] − 1|`; `T = max(0.08, 3·ADM20)` (in bps; no fallback to 8% when data is short); `R = O[g] + 0.5·(C[g−1] − O[g])`. `g` is any session in `n−19 … n`; if several qualify, any one is enough. It is **evaluated when `n ≥ g+4`**: the window is the 5 closes `g … g+4` (the gap day is the first). It **fires** when `gap ≤ −T` and every one of those closes is below `R`. If any close from `g` to `n` is already `≥ R` the state is **CLEAR at once**; before `g+4` with no close `≥ R` it is **PENDING**. Prices are rounded to cents first; ex-dividend gaps are not excluded. *(Ian to rule: does a fired gap clear when `c[n]` recovers above `R`? Until ruled, it clears when `c[n] ≥ R`.)*

**Relative weakness (corroborating only).** `r20(stock) − r20(SPY) ≤ −1500 bps`, with `r20` defined **by date**: the close at `t[n]` against the close 20 SPY sessions earlier; both series must contain both timestamps or it is NE. It never marks a stock broken and never changes an action; when another signal fires it is added as a reason and can lift LOW to MEDIUM only; its NE never lowers confidence.

**Applicability.** BCS: N/A (a falling stock helps a BCS). IC: put side only. All others: all signals.

**Output:** `{ broken, signals: [{ code, state: 'FIRED'|'CLEAR'|'PENDING'|'NE'|'NA', value, threshold }] }`. Missing data can never make a signal fire.

## DECIDE-0001B — Decision rules (B1 shadow, then B2 cutover)

```ts
type DecisionAction =
  | 'HOLD' | 'CLOSE_PROFIT' | 'CLOSE_STOP' | 'CLOSE_BROKEN' | 'CLOSE_TIME'
  | 'ROLL' | 'ACCEPT_ASSIGNMENT' | 'BLOCKED';

interface PositionDecision {
  action: DecisionAction;
  reasonCode: string;                          // BLOCKED uses DATA_UNAVAILABLE or STOP_PENDING_CONFIRMATION
  reasons: string[];                           // reason codes; the UI shows the top 1 and collapses the rest
  contextLines: string[];                      // information that is not the action (loss vs credit, broken stock on an Acquire position, delta breach)
  flipConditions: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null; // null if and only if action === 'BLOCKED'
  pendingStop?: { firstReadingAt: string; mark: number } | null;
  evaluatedAt: string;                         // equals the input now
}
```

Every consumer of `action` or `confidence` uses a `Record<DecisionAction, …>` or an `assertNever` helper (compile-time exhaustiveness; see Acceptance for how it is verified).

### Stop rule (all short premium)

`mark ≥ stopTrigger`, where **`stopTrigger` is an explicit input taken from the trusted stop policy** (`pos.stopLossPolicy`, ALIGNED or TOO_LOOSE only; `lib/portfolio/stopLossPolicy.ts:184-260`). The default policy is `2·C` (`DEFAULT_ENTRY_STOP_MULTIPLE = 2`, a loss of 1x the credit). An untrusted or absent policy falls back to `2·C` for display but **never produces `CLOSE_STOP`** (production incident, TE-0002 round 3). The integer test is `bid_c + ask_c ≥ 4·C_c` for the default.

**Confirmation reuses production.** `evaluateStopBreach` (`PENDING_CONFIRMATION` / `CONFIRMED_BREACH`) and `QUOTE_WIDTH_THRESHOLDS` (net width 0.15 of mid, per leg 0.50; `stopLossPolicy.ts:406-412`). This ticket does **not** introduce a second confirmation rule; the earlier 0.25 width, 300-second and two-reading design is dropped unless Ian and Dean choose it as a deliberate change to production semantics. The evaluator is pure: the caller builds `priorReading` from `snapshotHistory` (Redis position-snapshots) and passes it in. A first wide-quote reading returns `BLOCKED` / `STOP_PENDING_CONFIRMATION` (never HOLD).

**Unreachable stop.** Flag when `2·C ≥ width` (for an IC, per wing): "Stop cannot trigger; max loss is $(width − C)×100 per contract." Rule 2 then never fires. **Proposed fallback stop (Ian, 2026-09-26; new rule, Alan to check, O14):** for a spread whose stop is unreachable, use `mark ≥ 0.80·width` as the stop level (reason code `STOP_FALLBACK`, label unchanged: "Stop level reached"). Example: 5-wide with C 2.51: fallback at a mark of 4.00, a loss of $149 against a maximum loss of $249. Until the rule is approved and built, the position shows the amber context line "No stop can trigger on this spread. It was opened for more than half its width. Most you can lose: $249 per contract. Your only exits are 50% profit and 21 DTE." and the mock's state J. Worked cases (Alan): 5-wide C 1.00 reachable; C 1.67 reachable; C 2.50 flagged (2C = 5.00 = width, reachable only at expiry); C 2.51 flagged; 10-wide C 2.51 reachable; IC 5/5 wings C 2.60 both sides flagged; IC 10/10 C 3.50 no flag; IC put 5 / call 10 C 3.00 put side flagged only.

### Precedence (first match wins)

**Spreads and IC (BPS, BCS, IC)**

| # | Rule | Action |
|---|---|---|
| 1 | Data (see Data rules) | `BLOCKED` |
| 2 | Stop: `mark ≥ stopTrigger` | `CLOSE_STOP` |
| 3 | Profit: `(C − mark)/C ≥ 0.50` | `CLOSE_PROFIT` |
| 4 | Broken stock (N/A for BCS; IC put side only) **and** (a loss of at least 0.5x the credit, that is `mark ≥ 1.5·C`, **or** short delta ≥ 0.30) | `CLOSE_BROKEN` (IC: all 4 legs; never roll). Otherwise `HOLD` with the signal as a context line. |
| 5 | Time: DTE ≤ 21 and entry DTE was > 21 | If `P&L ≥ 0` → `CLOSE_TIME`. If `P&L < 0` → `ROLL` if a qualifying roll exists, else `CLOSE_TIME`. Winners never roll. |
| 6 | Short delta ≥ 0.50 | `ROLL` if a qualifying roll exists (losers only), else `HOLD` with a delta-breach context line. **Never `CLOSE_STOP`**; that action requires the stop trigger. A winner at rule 6 follows rule 3 or 5. |
| 7 | Default | `HOLD` |

*Why 3 and 4 are swapped from revision 2 (Ian):* a 70%-profit spread on a stock that just lost its 200-day average should read "profit target reached", not "broken stock". *Why 4 is gated:* a trend break alone on a healthy spread, or one with a tiny loss, would otherwise cause exactly the early-exit pattern behind Dean's losses (21 of 28 losses closed before reaching 2x credit). Ian (2026-09-26): any loss is not enough; it takes at least half the credit or a delta of 0.30. **Alan checks the threshold and its fixtures (O14 companion).**

**Lone short put or short call (CSP, CC): the intent branch (Dean, 2026-09-25) is evaluated first.**

A put or call sold to be assigned (to own the shares, or to start a wheel) has an Acquire or Wheel aspect, so a strong recommended action does not make sense for it.

| Intent | Rules |
|---|---|
| **`income`** (and `neutral`) **CSP** | 1 Data → 2 Stop (`CLOSE_STOP`) → 3 Profit ≥ 50% (`CLOSE_PROFIT`) → 4 Broken stock, gated as above (`CLOSE_BROKEN`) → 5 Assignment (short delta ≥ 0.50): `ROLL` if a qualifying roll exists with `K' ≤ K`, `DTE_new > DTE_old`, `DTE_new ≤ 60`, else `ACCEPT_ASSIGNMENT` → 6 `HOLD`. No 21-DTE rule and no delta-roll rule (Dean). |
| **`acquisition`, `wheel` CSP** | 1 Data → 3 Profit ≥ 50% (`CLOSE_PROFIT`) → 5 short delta ≥ 0.50: `ACCEPT_ASSIGNMENT` (**never `ROLL`**) → 6 `HOLD`. **Rules 2 and 4 never produce an action.** No hard loss limit (Ian, O5). Risk control for these positions is at entry (cash-secured sizing and the 10% symbol and 25% sector caps in `policies/defaults.ts:39-46`). |
| **Any CC, any intent** | **Never `CLOSE_STOP` or `CLOSE_BROKEN`:** the call's loss is opportunity cost offset by the shares, and buying it back strips the income cushion. 1 Data → 3 Profit ≥ 50% on the call leg (`CLOSE_PROFIT`) → 5 short delta ≥ 0.50: `income` uses the roll test below (`ROLL` or `ACCEPT_ASSIGNMENT`); `acquisition` and `wheel` → `ACCEPT_ASSIGNMENT` → 6 `HOLD`. A broken stock is a context line only; the decision about the shares belongs to DECIDE-0002. |

**Context lines for Acquire and Wheel positions (mandatory, never the action, never colored as an action):**
1. The loss in plain multiples of the credit: "Down $X, N times the credit."
2. When the stock is broken **and** the loss is ≥ 2x the credit: "Assignment would be into a broken stock."
3. If the intent was defaulted rather than chosen: "Acquire (default, not chosen)" with a one-tap "Choose intent".

**The live engine must not re-add the loss exit.** Today `MATERIAL_LOSS = 100` (`decisionQualityMatrix.ts:76`, the same point as the 2x stop) beats `ASSIGNMENT_PREFERRED = 90` (`:198`) in `managementIntent.ts` (~line 629), so a default CSP can show "Cut Losses". The adapter suppresses that path for `acquisition` and `wheel`, or the two engines contradict each other. This is **new behavior for the live path**, not preservation of existing behavior; the exemption in `getRecommendation` (`acquisition.ts:2325`, strategy `PUT` only, after the 21-DTE lines) does not run in the app. Tests for the intent branch run against the **live adapter output**.

**Default intent (O6):** every lone short put defaults to `acquisition` (`acquisition.ts:1977`), so as built an unclassified CSP has **no exit rule**, and Dean never chose that. Ian's ruling: keep the no-strong-action behavior for the unclassified default, but show it as "Acquire (default, not chosen)" with a one-tap "Choose intent"; `income` (stop-eligible) is always an explicit choice. **Dean confirmed (2026-09-25): he accepts that an unconfirmed CSP shows "Acquire (default, not chosen)" and has no stop until he chooses Income.**

### Qualifying roll

- `rollNet = floor_to_cent(mid(new short combo) − mid(close old combo)) − fees/(100·qty)` (credit-positive; fees after the floor; compare in mills or round fees up to a whole cent per share).
- `fees = f × Σ contracts across every leg closed or opened`. **An IC roll is the tested side only (4 legs)**, and it must satisfy that side's strike rule; otherwise there is no qualifying roll.
- Qualifies when `rollNet ≥ $0.10/share`, `DTE_new > DTE_old`, and the strike rule is met (short puts: new strike ≤ old; short calls: new strike ≥ old).
- **CC Income roll test (replaces `AR_roll`/`AR_entry`, Alan):** roll when `rollNet_c · DTE0 > c0_c · (DTE_new − DTE_old)`, where `c0` and `DTE0` are the credit and DTE of the **current short call when it was opened** (needs a stored per-leg record). `(K' − K)` is shown as a note, not in the test; no stock price appears in the comparison.

### Data rules

- **Required inputs:** mark, credit, DTE, delta, stop trigger, intent (where it applies). A missing required input, **unsupported entry economics** (`hasSupportedCreditEntryEconomics` false), `structureAmbiguous`, or a `verify-pricing` state returns `BLOCKED` / `DATA_UNAVAILABLE`, never `HOLD`. An earlier rule that fires on the inputs it has still decides (mark and credit are enough for the stop). `HOLD` requires every rule to have been evaluated. A stale quote is refreshed once, then `BLOCKED`. An expired token returns `BLOCKED` immediately.
- **Not modelled here (kept as they are today):** `PLACE_GTC`, "verify pricing or stop" management states, earnings-risk, watch, let-expire.

### Confidence

Checked in order: null, LOW, MEDIUM, HIGH. `null` only for `BLOCKED`. **HIGH, always,** once a mechanical rule fires (the stop, the profit target, 21 DTE, `CLOSE_TIME`), and a `HOLD` near a mechanical threshold (49% profit, 1.95x credit) is not LOW. **Judgment values** use margin `m = |x − T|/|T|` computed in integers; `m < 0.10` is LOW and `m = 0.10` exactly is HIGH:

| Value | LOW when |
|---|---|
| Short delta | [0.50, 0.55) fired; (0.45, 0.50) HOLD |
| LEAPS delta | (0.54, 0.60) fired; [0.60, 0.66) HOLD |
| LEAPS DTE | 163 to 179 fired; 180 to 197 HOLD |
| Failed gap | [T, 1.1T) |
| Support break distance and volume ratio | **Ian to define; until defined they are never LOW** |

**MEDIUM:** a lower-precedence rule would have fired or would give a different action. Relative weakness can lift LOW to MEDIUM only. Unbuilt and N/A signals never lower confidence.

### LEAPS (deferred out of 0001B)

There is no engine for a long LEAPS hold, roll or close decision: `lib/leaps-position-intelligence/evaluate.ts` decides income-call candidates only. The revision-2 LEAPS table (roll at DTE < 180 or delta < 0.60) is **removed from this ticket** and becomes its own ticket needing Ian's sign-off, a delta data source, and intent (Hold versus PMCC). Two safety rules are recorded now so they are not lost: (1) with a short call open against a long LEAP the recommendation is about the short call first and **never to close or roll the long leg alone** (that would leave a naked short call); (2) a low delta means "roll" only for a PMCC, never for a Hold. *(O11, Ian.)*

## DECIDE-0001 cutover map (O7) and B2 rules

Everything below reads `pos.recommendation` and is **replaced in the same change (S3)**:

1. Positions table "Recommendation" column: `PositionsWorkspace.tsx:744-748`, tone via `recommendationTone` (`:562-569`).
2. "← suggested" markers on the action buttons: `PositionsWorkspace.tsx:762`, `:771`, via `canonicalRecommendationToAction` (`lib/portfolio/canonicalRecommendationPresentation.ts:4-17`).
3. Position card: `canonicalRecommendationForCard`, `PositionRecommendationBadge` (`app/portfolio/page.tsx:8145-8146`, `:8365`), and the Position Intelligence panel (`:8994`, `:9050`; `features/portfolio/intelligence/*`).
4. AI explanation panel and the analyze prompt block "RULE ENGINE'S EXISTING CALL" (`page.tsx:5229`, `:2072-2085`) and `projectCanonicalRecommendationForAi` (`canonicalRecommendationPresentation.ts`, `page.tsx:2716-2727`, action union at `:440`).
5. Priority, briefing and sort surfaces: `features/portfolio/priorities/*`, `dashboard/TodaysPrioritiesDashboard.tsx`, `components/DailyPriorityList.tsx`, `briefing/suggestedFocus.ts`, `todaysPriorities/*`, `lib/todaysPriorities/*`, `lib/dailyBriefing/buildDailyBriefing.ts`, `lib/morning-briefing/attentionFeed.ts`, `lib/priorityScore/priorityScore.ts`, `lib/command-center/buildCommandCenterViewModel.ts`, `components/mission-control`; and the position sort `canonicalRecommendationPriority` (`acquisition.ts:371-372`).
6. **Snapshot engine:** `lib/position-snapshot/snapshotEngine.ts:90-99` compares the stored recommendation **label string**; a new label vocabulary would fire a spurious "recommendation changed" snapshot for every position. In the same change it compares a stable reason or action code instead.
7. Decision review: `DecisionReviewSection.tsx:84`, `lib/decision-review/decisionReview.ts:48` (`buildEvidenceSnapshot(PortfolioRecommendation)`), `DecisionHistoryView`.
8. **Not replaced:** the hardcoded manual action buttons and labels (`page.tsx:2982-2983`, batch bar `:3100-3348`, `:9886-9941`, `PositionsWorkspace.tsx:547`); the pricing, verification and GTC states that `PositionDecision` cannot express (`pos.recommendation.kind === 'verify-pricing'` is used as control flow at `acquisition.ts:365` and `VerifyPricingRefreshButton.tsx:98`).
9. Not affected: `app/api/advisor/route.ts`, `app/api/leaps-advisor/route.ts`, `app/api/leaps-analysis/route.ts` (scan candidates and LEAPS contracts, not open positions).

**S2 shadow mode:** compute `PositionDecision` beside `pos.recommendation`, no UI, and record a disagreement list. Ian approves the list before S3. **S3:** switch every reader in one change; remove every red element from the recommendation zone (the red Cut Losses action button at `PositionsWorkspace.tsx` ~line 765 with `border-red-500/50 text-red-300`, the red and orange classes in `PositionRecommendationBadge`, the old "suggested" tags); the manual buttons stay but neutral. No red text, border or fill appears for any action or state.

**Tests that change at S3 (with Ian approval):** `lib/portfolio-intelligence/__tests__/managementIntent.test.ts`, `positionObjective.test.ts`, `decisionQualityMatrix.test.ts`, `recommendationScorecard.test.ts`, `pi0014MarketablePricingFixtures.test.ts`; `PositionsWorkspace.test.tsx` (about 20 label assertions; note it asserts `/api/chart` is not fetched in one state, so do not add chart fetching to the workspace); `canonicalRecommendationPresentation.test.ts`, `RecommendationExplanationPage.test.tsx`, `snapshotEngine.test.ts`, the decision-review, priority, briefing, mission-control and attention-feed tests; `PortfolioPage.test.tsx` if the decision-reviews fetch changes. **Tests that must not change:** the helper and trust-boundary tests in `stopLossWiring.test.ts`, and `RsiLine.test.tsx`.

## Presentation (Diane's spec G5, revised by Ian's mock review 2026-09-26; Dean approves the rendered mock)

**One design for every user.** No experience-level variants. The three trader lenses (novice, intermediate, expert) were used only to test the wording.

**Cell layout (top to bottom):** the "Recommendation" caption; a row with a dot and the label (11px semibold, plain white, never colored text, never all caps, never a filled pill) and, right-aligned, either a plain "Rule met" (mechanical rules), a plain "Medium confidence" or "High confidence" (judgment states only), or nothing (Hold, and BLOCKED); **one** reason; one "Changes if …" line from `flipConditions[0]` (with a dollar or numeric figure where a wait-and-see would otherwise be invited; never a line that teaches switching intent); amber context lines when present; **one line of key numbers**: `Mark · Stop · Δ · DTE · P&L · Quote age` (omit the parts that do not apply); a visible Refresh button when data is stale; a collapsed "Why and what would change" detail; then the Actions zone with neutral borders and one "← suggested" marker that always follows the label.

**A stop is visible without being red:** when a rule the trader set has been met (`CLOSE_STOP`, `STOP_FALLBACK`), the cell gets a thin amber left edge, a larger filled dot and a bolder "← suggested". No red text, border or fill anywhere.

**Confidence (Ian):** "High confidence" on a stop or a Hold reads as "high confidence this is safe". So mechanical rules show "Rule met", Hold and BLOCKED show none, and only judgment states (broken stock, close to assignment) show Medium or High. Confidence is never a color.

**Jargon:** "200-day average", "assignment", "extrinsic value", "ex-dividend", "legs", "delta" and "intent" each have a one-line hover explanation, in one file with a test that every hover term has text.

**Wide-quote stop (Ian):** after 3 readings or 15 minutes still wide, the state becomes "Stop level reached (wide quote)" so it never stays "checking" forever. *(Alan and Quinn check this against `evaluateStopBreach`, O15.)*

**Labels (internal action to visible label, dot):**

| Internal | Visible label | Dot |
|---|---|---|
| `HOLD` | "Hold" | neutral |
| `CLOSE_PROFIT` | "Take profit" | emerald |
| `CLOSE_STOP`, `STOP_FALLBACK` | "Stop level reached" | amber, with the edge and larger dot |
| `CLOSE_BROKEN` | "Stock has weakened" | amber |
| `CLOSE_TIME` with no qualifying roll | "Time to close" | sky |
| `ROLL` | "Consider rolling" | sky |
| `ACCEPT_ASSIGNMENT` (delta ≥ 0.50 on a put) | "Expect assignment" | sky |
| `ACCEPT_ASSIGNMENT` (covered call) | "Close to assignment" | sky |
| `BLOCKED` / `DATA_UNAVAILABLE` | "No recommendation" | hollow neutral ring |
| `BLOCKED` / `STOP_PENDING_CONFIRMATION` | "Checking stop level" | hollow amber ring |

**States in the mock (revision 2), and when each ships:**

| State | Label | Ships in | Data it needs |
|---|---|---|---|
| A Spread at 52% profit | Take profit | S3 | exists |
| B Spread at the stop | Stop level reached | S3 | exists (stop policy, quotes) |
| C Wide quote, first reading | Checking stop level | S3 | exists (`evaluateStopBreach`) |
| D1 Acquire put, stock above the strike | Hold, with the loss as context | S3 | exists |
| D2 Acquire put in the money | Expect assignment, with the assignment cost | S3 | exists |
| E Income put at the stop | Stop level reached | S3 | exists |
| F Iron condor, stock weakened | Stock has weakened | S3 (needs S1 signals) | Phase 0 data |
| G1 Time limit, no roll | Time to close | S3 | exists (roll test) |
| G2 Time limit, a roll exists | Consider rolling | S3 | exists (roll test) |
| H Covered call at the money | Close to assignment | S3 | exists |
| I Data unavailable | No recommendation | S3 | exists (quote age) |
| J Stop can never trigger | Hold with the amber warning; later the fallback stop | S3 (warning), B1 (fallback, after O14) | exists |
| K A closing order is working | Order working | S3 | exists (pending orders); Quinn confirms |
| L Earnings before expiry | Hold with an amber line | S3 | exists (next earnings date) |
| M Expires soon and in the money | Expires soon | S3 | exists |
| N Spread at maximum loss | At maximum loss | S3 | exists |
| Q LEAPS or PMCC | No recommendation | S3 | exists |
| R Acquire put at 50% profit | Take profit, "If you still want the shares, keep the put." | S3 | exists |
| T Sign-in expired | No recommendation | S3 | exists (token state) |
| O Early assignment risk | Early assignment risk | **Later (DECIDE-0002, the ex-dividend assignment guard)** | needs an ex-dividend date source (does not exist) |
| P Assigned | Assigned | **Later** | needs assignment detection from broker transactions (does not exist) |

An unconfirmed intent shows the chip "Acquire (default, not chosen) · Choose intent", a one-tap link, not a separate state.

**Wording table for the mock's states** (Ian's replacement wording is in the rendered mock; the mock is the canonical copy and this table only summarizes the changes): B states the dollar cost to close, the credit, the loss so far and the maximum loss; D never says "so no stop applies" (it says "Acquire positions have no loss stop. Your protection is the size you chose at entry."), never offers "change your intent" as the visible next step, and states the cost of assignment and, when the stock is in a downtrend and the loss is 2x or more, "Assignment would be into a stock in a downtrend."; E says "this position is set to Income"; F names the trend line and the loss and says "Closing both sides (4 legs) is the plan."; G is split into two states; H reads "If it is called away you sell 100 shares at $X"; I states the quote age and "This is not a safety signal"; J states the maximum loss and the only remaining exits.

One standing line at the foot of the Positions workspace and the analysis dialog: "Guidance from TradeEdge rules. You decide; no orders are placed automatically." Each reason code maps to a plain-language sentence with no jargon, in one file, with a test that every code has one. Accessibility: `role="group"` with `aria-label="Recommendation for {symbol}"`; native `<details>`; `aria-live="polite"` on the pending-stop state; the dot is `aria-hidden` and the label carries the meaning; 9 to 10px faint text meets 4.5:1 on `#171717`.

## Coverage of every current status (Ian's complete review, 2026-09-26)

Ian checked every status the app can show today, every strategy from open to expiry, and every other place a status appears. Result: the first 20 states covered the short-premium paths; **14 things had no home**, three of them safety issues. All are addressed below and in the mock (revision 3). The mock is the canonical wording; this section records the rules and the mapping.

### Safety issues fixed

1. **A missing recommendation must never show "Hold".** Today `PositionsWorkspace.tsx:747-748` shows `p.recommendation?.label ?? 'Hold'` with "Continue monitoring". Replace with "No recommendation" and "Recommendation could not be calculated. Refresh." plus a Refresh button.
2. **Bought options (long call, long put, debit spread), LEAPS and short calls with no cover must not fall through.** Long call, long put and debit spread show "Not covered yet" (state U), which **removes today's Take Profit and Cut Losses labels on these positions** (they currently resolve through the 'other-position' context, `managementIntent.ts:119`). A **short call with no shares or long call behind it** (state V) is an amber, stop-styled recommendation: "No shares or long call found behind this call. The loss has no limit. Close it, or confirm the cover is in another account." It must never take the covered-call rules (which never stop). A **PMCC short call** (state W) shows "Not covered by shares: Rolling or closing is the plan. Do not take assignment; that would use your LEAP." and never the covered-call "you sell 100 shares" wording. Cover detection (shares owned, a long call on the same underlying, PMCC pairing via `isPairedPmccLong`) is an input to the evaluator; Alan and Quinn define it.
3. **A working closing order must never replace the recommendation.** A profit-target order is the normal case (`PositionsWorkspace.tsx:741`, "Profit Target Live"). It is a context line ("Closing order working at $0.85.") on whatever state applies, and it never hides a stop, maximum-loss or expires-soon state. "Order working" is not a state.

### New rules from the coverage review

- **Profit target:** the recommendation uses the trader's own target (`hitTarget`, `app/portfolio/page.tsx:8212`, `pos.profitTarget`), not a fixed 50%; the reason and detail read the real target. The "Consider extending" hint (`page.tsx:1736-1750`) contradicts this and is removed.
- **Time limit (21 DTE, spreads and IC):** the label is "Time limit reached (21 days)" for both a loser with no roll (G1) and a winner (G0: "Up $80, 24% of the credit. Closing takes the gain; winners are not rolled."). A roll that qualifies is "Consider rolling" (G2), and its detail states **the new breakeven and the new maximum loss** before the trader clicks Roll (Dean, 2026-09-26: rolling for a small credit can still add dollar risk when the new spread is wider).
- **Expires soon (M) and At maximum loss (N) precedence:** Data, then Stop **or** N, then M, then profit target, then time, then delta, then Hold. **M applies at 7 DTE or less with the short strike in the money or within 2%**, with spread, covered-call and put wordings (an Acquire or Wheel put uses "Expect assignment" instead). **N replaces "Stop level reached" once the mark is 98% of the spread width or more** and adds "Your stop level was passed." M's detail: "It can be assigned any day, and is almost certain at expiry if it stays in the money." Alan sets the exact windows.
- **Delta breach with no roll (S), short-dated entry, let-expire, watch and place-GTC** become plain context lines on Hold, never actions: "Short strike delta is 0.55 and no roll qualifies. The rules will ask you to act at your stop or 21 DTE." "Opened with 12 days left, so the 21-day rule does not apply." "Expires in 2 days, $4.20 out of the money. Letting it expire is fine; close it only if you want to remove the last risk." "The stock is 3.2% from your short strike." "No profit-target order is working." The health-score "watch" is dropped.
- **Other "no recommendation" states, each with its own reason:** stale quote (I), could not be calculated (I0), no entry price (I2: "TradeEdge cannot see what you were paid for this position, so it cannot say how it is doing."), legs do not fit together (I3: "TradeEdge cannot tell how these legs fit together, so nothing is suggested."), verify pricing ("Checking prices", hollow amber ring, Refresh), and sign-in expired (T: one banner; each row keeps a faint "Last shown 10:42: Hold" so the trader is not blind).
- **Dean's pasted review points (2026-09-26):**
  1. **The Acquire-to-Income switch must not be a trap.** When the current mark is already past the Income stop, the detail says so: "Choosing Income now shows Stop level reached; the mark ($4.40) is already past $4.00 (twice the $2.00 credit)." The reverse holds too: choosing Acquire removes the stop, so the recommendation changes to Expect assignment.
  2. **A covered call shows the call's P/L together with the shares:** "Call −$97 · shares +$540 · net +$443", with the call's own number in neutral color, never the warning color. A call loss offset by the shares must not invite a buyback (Ian ruled that a covered call never gets `CLOSE_STOP` or `CLOSE_BROKEN`).
  3. **The unreachable-stop flag is visible:** an amber context line, for example on a 5-wide spread with a $2.55 credit: "Stop cannot trigger; max loss is $245 per contract." (Ian still owes O12: does such a position need another protection?)
  4. **The roll's cost is shown:** new breakeven and new maximum loss in the detail (above).
  5. **Broken-stock says why it fired:** "Why it fired: the stock broke its trend and this position is at a loss. A winning position would show Hold with this as a note." **Open decision O17 (Dean):** the gate is currently "any loss" as first written and as Dean's pasted note keeps it, but Ian's mock review recommended a stricter gate (a loss of at least 0.5x the credit, or short delta 0.30 or more) so a nearly flat trade does not say "close". The mock's wording is true under either gate.

### Behavior being dropped (Dean has not yet seen this list together; all fit earlier decisions)

The weak-health loss exit (`positionObjective.ts:996`, "Cut Losses" at −50% with a low health score); "Reduce Risk" (net-edge decay, trend against, gamma and DTE); the health-score "watch"; earnings-risk ranking above the profit target (it becomes a context line); the 21-DTE roll suggestion for CSP and CC; the CSP 21-DTE banners; "Consider extending"; Take Profit and Cut Losses labels on bought options.

### Mapping of every current status to the new design

| Current status | New state |
|---|---|
| Hold Position | Hold (with context lines: D1, J, K, L, S, X, Y, Z) |
| Take Profit (`close-winner`) | A, R (the trader's own target) |
| Cut Losses (material loss) | B, E (stop); Acquire and Wheel puts become D1 or D2; N at maximum loss |
| Cut Losses (weak-health loss) | Dropped; F (stock has weakened) covers the trend case |
| Roll Position (`roll-soon`, 21 DTE) | G1, G0, G2 (spreads and IC only) |
| Roll Position (explicit roll flag) | G2 only when a roll qualifies |
| Accept Assignment / assignment-risk | D2, D3, H, M1, M2, M3, W |
| Reduce Risk | Dropped (net edge stays on the card) |
| earnings-risk | Context line L1, L2 |
| place-gtc, let-expire, watch | Context lines (Y, X) |
| Verify Pricing and its pending notice | VP "Checking prices" |
| Recommendation Unavailable and the workspace default "Hold" | I0 "No recommendation" |
| Structure ambiguous | I3 |
| Unsupported or incomplete entry economics | I2 |
| Pending stop confirmation | C |
| Bought options, debit spreads | U "Not covered yet" |
| LEAPS and PMCC long legs | Q |
| Short call with no cover | V |
| PMCC short call | W |
| Expired token | T |
| Assigned, called away, early assignment risk | P, P2, O (later: need data that does not exist) |
| Deploy Idle Cash | Not a position state; needs a label rule in the priority lists |
| Replace Working Order | Pending Orders list only |
| Stop-order line (Aligned, Too loose, Too tight, Unverified, Invalid, No stop) | Kept as information, renamed "Stop order: Aligned" so it is not confused with "Stop level reached"; "Invalid" loses its red |

### Added to the cutover map (Ian found these outside it)

Position-card banners in `app/portfolio/page.tsx`: "CLOSE NOW" red and "REVIEW" amber (`:8228-8244`, becomes G0/G1/G2), the CSP 21-DTE banners "ACQUIRE" and "evaluate roll or take assignment" (`:8258-8283`, **deleted**: contradicts Dean's no-21-DTE rule for CSP and CC), the red structure-ambiguous banner (`:8285`, becomes I3), "PROFIT TARGET HIT" (`:8252`, duplicate, removed), "SHORT-DATED ENTRY" (`:8246`, becomes a context line), "Consider extending" (`:1736-1750`, deleted). Red urgency colors in `PositionRecommendationBadge.tsx:5-24`, `PositionIntelligencePanel.tsx:46` and `:178-195` (heading "Suggested Action" versus "Recommendation"), `DailyPriorityList.tsx:7-18`, `TodaysPrioritiesDashboard.tsx:25`, and mission control `SummaryStrip.tsx:22` ("Action Required" is red). The panel vocabulary (`managementChoices.ts:11-21`, `nextLifecycleEvent.ts:17-25`) is rewritten to the new labels. The priority lists need a mapping because `PositionDecision` has no urgency: a rule you set has been met first, then worth a look, then a planned step, then nothing to do (amber at most, no red). `recommendationTone` (`PositionsWorkspace.tsx:562-573`) returns red for any label containing "cut" or "close"; it is replaced by the dot table. The position list sort `canonicalRecommendationPriority` (`presentation.ts:66-77`) and the section order (`page.tsx:296`) are re-ranked on the new states. The raw `CUT_LOSSES` enum text in the AI panel (`PositionsWorkspace.tsx:543`) is removed. The manual Cut Losses button stays, neutral; Ian suggests "Close at a loss" as its label.

## DECIDE-0001D — Recommendation vs. action log

- **Auto-recording every shown decision changes the contract of `lib/decision-review` (PI-0008C: "the trader alone chooses"; `types.ts:1-20`)** and needs Paul's approval. Extend the module with **additive fields only** (`TraderAction` gains CLOSE_TIME and BLOCKED equivalents; the evidence snapshot gains the `PositionDecision`).
- **Do not use the existing single-blob-per-user store** (`app/api/decision-reviews/route.ts:19-21`, read-modify-write, no atomicity, two-tab races) for one row per position, action and session. Specify a new keyed store with retention and an idempotent write.
- Record each decision shown, de-duplicated per position, action and session. **Session calendar** = NYSE trading days in one helper, tested for holidays and half days.
- **Attribution:** a trader action counts against a decision if it happens on the same position within 3 trading sessions after the decision was shown; otherwise the row is `no_action`, never dropped. Matching uses closed-trade and lifecycle data (`outcomeAnalysis.ts`), including rolls that change `Position.key`. `BLOCKED` and `STOP_PENDING_CONFIRMATION` rows are kept apart from data failures and excluded from agreement stats.
- Performance page: agreement rate by rule and by confidence; P&L of recommendations followed versus overridden.
- CUT-LOSSES-REVIEW-0001's capture fields (symbol, DTE, strike distance, P/L %, intent, underlying at close and expiry) become extra fields here; there is one capture path.

## Separate tickets (not part of this approval)

**DECIDE-0001C — AI explains the decision.** `app/api/advisor/route.ts`, `app/api/leaps-advisor/route.ts` and `app/api/leaps-analysis/route.ts` analyze scan candidates and LEAPS contracts, not open positions, and AI-POLICY D2 freezes the advisor routes as-is. So this is a **new open-position explanation route** under the AI-POLICY gateway pattern, not a rewrite of those routes; the position-analysis prompt (`page.tsx:2060-2090`) and `projectCanonicalRecommendationForAi` are the touchpoints. Prerequisites before any code: Paul adds a D2 row in `docs/tickets/AI-POLICY-0001-epic.md`; **Ian** makes a versioned change to the D9 lexicon (`lib/ai-policy/lexicon.ts`, which bans "recommend", "suggest you", "you should") with a test that the exception admits only the enum action; Alan confirms D8 (no numbers in prose) and the exact-match enum check fit the gateway. The AI returns the action as a structured enum, then calm reasons; the server compares it to the input action by exact enum match and on a mismatch discards the AI text and logs a dissent, shown only inside the collapsed detail under "The assistant sees this differently". **The screener's `disclosure` field is not removed** (about ten consumers depend on it: `app/screener/page.tsx`, `lib/screener/advisorCache.ts`, `leapsAdvisorCache.ts`, tests). The LEAP dashboard principle "none recommends an action" changes only for open positions, not for scan or qualification analysis.

**DECIDE-0001E — Finnhub news and analyst actions.** `FINNHUB_API_KEY` as a server-only variable (never `NEXT_PUBLIC_`, SEC-0001), cached per symbol, structured analyst ratings first, an AI classifier only for untagged headlines, capped at MEDIUM confidence until the log has enough classifications checked against Ian's sample (Ian sets N and X). When the feed is down the fundamental signal is NE, never CLEAR. Deferred until the log has data.

## Non-goals

No automated order placement. No change to scan qualification or scoring. No change to autopilot scope. No change to `GET /api/chart` behavior. No change to the LEAP dashboard for scan analysis. DECIDE-0002 items (ex-dividend assignment guard, earnings-before-expiry rule, PMCC short-leg column, CC Growth-mode upside test, the share decision on a broken CC).

## Acceptance criteria

1. Alan's golden fixtures pass (below), covering every precedence rule, every adjacent rule-pair conflict and every threshold boundary in integers.
2. **Property tests (fast-check):** (a) the same inputs give a deep-equal `PositionDecision` and the evaluator never reads the clock; (b) `acquisition` or `wheel` never yields `CLOSE_STOP` or `CLOSE_BROKEN` for any numeric input; (c) raising the mark never moves `CLOSE_STOP` to a less severe action; (d) `action === 'BLOCKED'` if and only if `confidence === null`.
3. A missing required input, unsupported economics, a stale quote after one refresh, or an expired token returns `BLOCKED` / `DATA_UNAVAILABLE`, never `HOLD`.
4. Every consumer of `action` and `confidence` fails the build if a case is missing. This is a compile-time guarantee only; a test cannot prove it. Verification requires `tsc` with `tsconfig.check.json` **and** a real `next build` (Vercel preview), per CLAUDE.md.
5. The UI branches on `reasonCode`, not only on `BLOCKED`, follows Diane's approved mock, shows no red for any action or state, and never shows an enum name.
6. **Intent:** an Acquire or Wheel CSP or CC never receives `CLOSE_STOP` or `CLOSE_BROKEN`, an Income CSP at the same numbers does, and the test runs against the live adapter output.
7. **Cutover:** a position never shows two different actions; S2's disagreement list is approved by Ian; S3 removes every red element and switches every reader in one change; no spurious snapshot "recommendation changed" events fire.
8. **Data:** the history endpoint serves 201+ complete bars and volume; `GET /api/chart?symbol=X` is unchanged and `RsiLine.test.tsx` passes unmodified.
9. The log de-duplicates, records `no_action`, excludes pending-stop rows from agreement stats, and uses a keyed, idempotent store.

## Golden fixtures (Alan; verified in python3)

| Area | Cases |
|---|---|
| Stop (cents) | BPS 5-wide C 1.67: mark 3.33 no fire / 3.34 `CLOSE_STOP`; C 1.00: 1.99 / 2.00; 5-wide C 2.50 flagged (rule 2 dormant); C 2.51 flagged, max loss 2.49 = $249; 10-wide C 2.51 no flag; IC 5/5 C 2.60 both sides flagged; IC 10/10 C 3.50 no flag; IC put 5 / call 10 C 3.00 put side only |
| Wide quote | Relative spread bid 0.70 / ask 0.90 is exactly 0.25, narrow; 0.70 / 0.91 wide; a first wide reading is `STOP_PENDING_CONFIRMATION`; a narrow reading past the trigger fires at once; a reading below the trigger resets (production semantics via `evaluateStopBreach`) |
| Profit | 49.99% / 50.00% for IC, CSP and CC |
| 21 DTE | 22 / 21; P&L 0.00 (`CLOSE_TIME`); −0.01 with rollNet 0.10 (`ROLL`); −0.01 with rollNet 0.09 (`CLOSE_TIME`); entry DTE ≤ 21 (rule skipped) |
| Fees | IC tested side, 4 legs, f = $1: mid gap 0.17 gives rollNet 0.13, qualifies; IC both sides 8 legs: 0.17 gives 0.09, no; 0.18 gives 0.10, yes; CSP 2 legs: 0.10 gives 0.08, no. rollNet values are after fees |
| CC roll | `c0` 90c, DTE0 30, ΔDTE 30: rollNet 90c no roll (equal), 91c roll; rollNet 95c with DTE_old 5, DTE_new 35: roll (ΔDTE 30) |
| Short delta | 0.4999 / 0.50; IC with only the call side breaching; a winner at delta 0.50 follows rule 3 or 5, not 6; a loser at delta 0.50 with no roll is `HOLD` with a delta context line (never `CLOSE_STOP`) |
| Fallback stop (proposed) | 5-wide C 2.51: fallback stop at mark 4.00 fires `STOP_FALLBACK`; mark 3.99 no fire; 10-wide C 5.10: fallback 8.00; a spread with a reachable 2x stop never uses the fallback; the fallback never applies to a CSP |
| New states | Working closing order: label "Order working", no close suggestion; expiry in 2 days and in the money: "Expires soon"; both strikes in the money: "At maximum loss"; earnings before expiry: a context line only, action unchanged; stale quote 22 minutes: "No recommendation" with the quote age; expired token: "No recommendation" |
| Broken gating | BPS at 70% profit on a broken stock: `CLOSE_PROFIT`; a healthy far-OTM BPS with a trend break only: `HOLD` with context; a BPS with a trend break and a loss of 0.4x the credit (mark 1.40·C) and delta 0.20: `HOLD` with context; loss 0.5x the credit (mark 1.50·C): `CLOSE_BROKEN`; short delta 0.30 exactly with a break and any loss: `CLOSE_BROKEN`; the confidence line shows "Rule met" on stop, profit and time rules and nothing on `HOLD` |
| Confidence | Short delta 0.5499 LOW, 0.5500 HIGH, HOLD 0.4501 LOW, 0.4500 HIGH; LEAPS delta 0.5401 LOW, 0.5400 HIGH, HOLD 0.6599 LOW, 0.6600 HIGH; LEAPS DTE 163 / 162 and 197 / 198 |
| Trend | one close below ma200 (no fire); two closes with ma50 ≥ ma200 (no fire); two closes with ma50 < ma200 (fire); already true at entry (context, not counted); 200 bars NE / 201 evaluable |
| Gap | ADM 2.67%: gap −8.00% no fire, −8.01% fires; ADM 3.5%: gap exactly −10.5% (O = 0.895·C) fires; ADM 2.00%: −8.00% fires, −7.99% no; C_prev 100, O 90, R 95, closes 93, 94.99, 92, 91, 90 fires; one close 95.00 no fire; n = g+3 with none ≥ R PENDING, with one ≥ R CLEAR; gap at n−19 evaluated, n−20 out; 20 prior closes NE; two gap days: fire if either qualifies |
| Support | S 37.55: close 37.17 fires / 37.18 no; volume prior sum 2000: v 150 fires / 149 no; a volume that fires only if today is included must not fire; any missing `v` NE; split after entry NE |
| Relative weakness | SPY flat, stock 100 to 85.00 fires / 85.01 no; SPY missing `t[n−20]` NE; SPY offset one day NE; firing alone gives `broken = false` |
| Applicability | BCS never `CLOSE_BROKEN`; IC with only the call side weak is not broken; IC broken closes 4 legs |
| Intent (CSP, C 1.00, delta 0.30 unless stated) | `income` mark 2.00: `CLOSE_STOP`; `acquisition` and `wheel` mark 5.00: `HOLD` with "Down $400, 4.0 times the credit"; delta 0.50: `ACCEPT_ASSIGNMENT` (never `ROLL`); mark 0.50: `CLOSE_PROFIT`; broken stock with delta 0.30: `HOLD` with the broken context; `income` and broken: gated `CLOSE_BROKEN`; missing intent on a lone put: `acquisition` shown "default, not chosen"; missing intent on a CC: `income`; a CC with any intent never `CLOSE_STOP` or `CLOSE_BROKEN` |
| Data | missing mark `BLOCKED`; stop decided on mark and credit while delta is missing (`CLOSE_STOP`); expired token `BLOCKED`; unsupported economics `BLOCKED`; `structureAmbiguous` `BLOCKED` |
| Phase 0 | 2y fixture ≥ 201 complete bars with `v`; partial bar (14:00 NY, last bar dated today) dropped; last bar after `regular.end` + 15 min kept; null-close bar dropped; NVDA 2024-06-10 split shows no gap (−0.43%); KO 2y `c[0] = 71.40`; entry 2026-07-06T14:15Z: S window 2026-06-04 to 2026-07-02; entry 2026-07-07T01:00Z: same window (NY date 07-06); entry 2026-11-27: window ends 2026-11-25; entry-day low excluded; low on the 21st prior session excluded; a second evaluation leaves a reconstructed S unchanged; no entry date NE |

## Open items

| # | Item | Owner | Status |
|---|---|---|---|
| O1, O10 | Diane's calm-presentation mock, rendered for Dean (O1 is superseded by O10) | Diane, then Dean approves | Spec done (G5); **rendered mock pending** |
| O2 | Stop wiring file | Dane | Answered: `lib/portfolio/stopLossPolicy.ts` + the live engine; `getRecommendation` is dead code |
| O3 | N and X for the news classifier confidence cap | Ian | Deferred with 0001E |
| O4 | AI-POLICY D2 row (Paul) and versioned D9 lexicon change (Ian) | Paul, Ian | Deferred with 0001C |
| O5 | Hard loss limit for Acquire and Wheel | Ian | **Resolved: none**; context lines only |
| O6 | Default of Acquire for every lone short put | Ian, Dean | **Resolved.** Ian ruled (keep the no-action behavior, show "default, not chosen", Income is an explicit choice); **Dean confirmed 2026-09-25** |
| O7 | Cutover map | Paul, Dane | Written above; Dane confirms in G6 |
| O8, O9 | Price basis; reconstructed entry support | Alan | **Resolved** (see Conventions and Phase 0) |
| O11 | LEAPS long-leg policy, the short-call guard, delta source | Ian | Deferred to its own ticket |
| O12 | Support-break and volume confidence bands; whether a fired gap clears on recovery; whether an unreachable stop needs another protection | Ian | Open, blocks B1 |
| O17 | Broken-stock gate: any loss (`P&L < 0`, Dean's pasted note) or the stricter 0.5x credit or delta 0.30 (Ian) | **Dean** | Open, blocks B1 |
| O18 | Cover detection for the uncovered-short-call state V and PMCC pairing for W; M and N windows | Alan, Quinn | Open |
| O14 | Fallback stop for a spread whose stop can never trigger: `mark ≥ 0.80·width` (Ian's proposal); and the stricter broken-stock gate (a loss of at least 0.5x the credit or short delta ≥ 0.30) | Alan checks; Ian confirms; **Dean approves** | Open, blocks B1 |
| O15 | Wide-quote timeout (3 readings or 15 minutes still wide becomes "Stop level reached (wide quote)") against `evaluateStopBreach` | Alan, Quinn | Open |
| O16 | Data for the new states: which exist (working orders, quote age, earnings date, token state) and which do not (ex-dividend date, assignment detection, both deferred) | Quinn, Paul | Open |
| O13 | Live-engine fix: build the Acquire and Wheel protection into `pos.recommendation` now as a small change ahead of this epic | Dean, Ian | **Done 2026-09-25** (Dean: fix it now if Ian is aligned; Ian approved with changes, all applied): a lone short put set to Acquire or Wheel gets no loss exit and no 21-DTE roll suggestion in the live engine; earnings-risk is a medium note; the loss is stated plainly as a context line; Income puts, calls, spreads and bought options are unchanged |

## Review gates

The single "Who reviews what" table at the top of this ticket is the current record. History:

| Gate | Reviewer | Result |
|---|---|---|
| G1 | Ian | Revision 2: approve with changes. Mock review 2026-09-26: approve with changes (folded into revision 4) |
| G2 | Alan | Revision 2: approve with changes; revision 4 items pending |
| G3 | Quinn | Revision 2: do not build yet; revision 4 items pending |
| G4 | Paul | Approved Phase 0 and 0001A only |
| G5 | Diane | Spec approved with changes; the rendered mock (revision 2) awaits Dean |
| G6 | Dane (developer) | Pending; runs last |

Dean is the sponsor and final decision-maker for every open item.
