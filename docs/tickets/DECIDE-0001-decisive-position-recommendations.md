# DECIDE-0001 — Calm, decisive position recommendations (Epic)

**Status:** REVISION 6 (2026-09-26). **Not approved to build.** Every lens has now reviewed the design at least once (Ian, Alan, Quinn, Paul, Diane), and their required changes are folded in here; the mock (revision 5, link below) shows the result. What remains before any development: Dean's decisions (see "Decisions Dean owes"), Ian's remaining rulings, Alan's fixtures, and the developer's (Dane's) pre-development review (G6). **Approved so far (Paul): Phase 0 and 0001A, and the display-only safety slice S3-0.** Everything else is approved slice by slice.
**Sponsor:** Dean. **Team review record:** `docs/tickets/DECIDE-0001-review-2026-09-25.md`.
**Rendered mock (revision 5):** https://claude.ai/artifact/1mhkVcQUysMBL2vPvrmucA . **The mock's `S` array is the canonical wording and the single label table**; this ticket records rules, not copy. A test asserts that every visible label appears in it.
**Dean's decisions so far (2026-09-25 and 26):** production's stop stays (a mark of 2x the credit received, a loss of 1x); proceed with this epic now and do CUT-LOSSES-REVIEW-0001 after; no 21-DTE rule for CSP and CC; Finnhub is the news source (a later ticket); a CSP with an Acquire or Wheel aspect gets no strong action; an unconfirmed lone short put defaults to Acquire and has no stop until Dean chooses Income; no loud red commands; one design for everyone.

## Decisions Dean owes (shortest list)

1. **Approve the mock**: the core states now, the rest later.
2. **Approve dropping these behaviors** (each is something the app says today): the weak-health "Cut Losses" at −50%; "Reduce Risk"; the health-score "watch"; earnings ranked above the profit target (it becomes a note); the 21-DTE roll suggestion and banners for CSPs and covered calls; "Consider extending"; and Take Profit and Cut Losses labels on **bought options** (long calls, long puts, debit spreads). *Do you use those labels on your LEAPS and long-put hedges?*
3. **Broken-stock exit gate (O17):** Ian and Alan recommend "a loss at all, **and** a loss of at least half the credit or a short delta of 0.30" (fewer premature exits); the alternative is any loss.
4. **Fallback stop for a spread whose 2x stop can never trigger (O14):** Paul recommends **defer** (keep the amber warning line). Yes or no?
5. **A spread at twice the credit with no TradeEdge stop order working (O19):** show it calmly as "Loss limit reached" with a note that no stop order is working (recommended), or say nothing (as the ticket's first draft implied)?
6. **Covered-call net line (O20):** measure the shares' gain **since the call was sold** (recommended) or since bought?
7. **Go ahead with the small safety slice S3-0 first** (no false "Hold", contradicting banners removed, red removed from existing labels), before the big cutover?

## Who reviews what (one table)

| Who | What they still need to do | Blocks | Status |
|---|---|---|---|
| **Dean** | The seven decisions above | Everything past Phase 0, 0001A and S3-0 | Waiting |
| **Alan** | Write fixtures for the rules in this revision (gate B′, stop confirmation semantics, M and N, cover detection, roll cost); reconcile Ian's and Alan's fallback-stop formulas **only if Dean asks for the fallback**; the stop-confirmation source for readings (O15) | S2 | Reviewed revision 5; changes folded in |
| **Ian** | Confirm the stop-order-absent behavior (O19); support-break and volume bands are ruled (O12 done except the fallback question); approve the S2 disagreement list later; confirm "expires soon" at 7 DTE beats a roll; confirm cross-day stop confirmation is intended | S2, S3-1 | Reviewed revision 5; two questions open |
| **Quinn** | Confirm the data adapter for S2 (coverage, readings, order state); the disagreement-log home; each slice's test list | S2, S3-A | Reviewed revision 5; changes folded in |
| **Paul** | Confirm the slice plan below and the "no red" scope (portfolio-level health and priority lists are in S3-D); roadmap updated | Any slice | Approved Phase 0, 0001A, S3-0; re-approves the rest slice by slice |
| **Diane** | Confirm mock revision 5 (line caps, tiers, terms as buttons, accessibility) and the wording for "Not judged yet" | S3-B | Reviewed revision 4; revision 5 follows her changes |
| **Dane (developer)** | Pre-development review of the whole ticket and the code it touches. **Runs last.** | Any development | In progress (started after this revision) |

**Nothing past Phase 0, 0001A and S3-0 is built until every row above is done.**

## Problem

1. **One live recommendation engine drives everything the app shows:** `scorePortfolioPositionObjective` (`lib/portfolio-data/acquisition.ts:208`) calls `evaluatePositionObjective` and `selectManagementIntent` (`lib/portfolio-intelligence`); its result is `pos.recommendation` (and `pos.portfolioObjective`). **A second call to the same engine** feeds Today's Priorities, the briefing and the command center (`portfolioIntelligenceAdapter.ts:154-172`, `dashboardComposition.ts:194-218`). `getRecommendation` (`acquisition.ts:2221`) is dead code (only tests call it). *History:* on 2026-09-25 (ACQUIRE-WHEEL-LIVE-0001) the live engine began honoring Acquire and Wheel for a lone short put (no loss exit, no 21-DTE roll suggestion, a plain context line), with 14 tests in `assignmentPlannedRecommendation.test.ts`; S2's shadow comparison starts from that behavior.
2. Dean reported that a loud "Cut Losses" led to panic closes on positions that later recovered (Trade Log: 21 of 28 losses were closed before reaching 2x credit; CSPs net +$2,957 over 13 trades, spreads net −$530 over 52).
3. Ian's complete coverage review found the app shows statuses the design had no home for, and three safety problems (a missing recommendation shows "Hold"; bought options are classified by label, not direction; a working profit-target order could swallow a stop). All are handled below.

## Outcome

For every open position TradeEdge shows **either a calm recommended action or a plain "Hold"**, with its top reason, what would change it, and what the position needs to recover. Positions the trader has set to Acquire or Wheel never show a stop or a close action. The recommendation is guidance only; the trader decides and no order is placed automatically. Code makes the recommendation; an AI (a later ticket) may explain it but cannot change it.

## Architecture

```
facts (market data, broker, entry records)
  → signals (pure: broken stock)
  → PositionDecision (pure evaluator; intent, stop trigger, cover, prior readings and the clock are explicit inputs)
  → replaces the engine call behind pos.recommendation, pos.portfolioObjective AND the priority/briefing path (one source of truth)
  → log (recommendation vs. what the trader did)
```

- **The live engine is replaced, not joined.** A position must never display two different actions, on the card or in any list. Test: for every fixture position, the action in the priority queue equals the action on the card.
- **Manual actions stay** (Take Profit / Cut Losses / Close / Roll buttons; `isActionRelevant`, `app/portfolio/page.tsx:1707-1723`), neutral in color, only the "suggested" marker changes.
- **The stop trigger comes from the trusted stop policy**, not a constant (see Stop rule).
- **Dead code:** `getRecommendation` and its test blocks are deleted only after the cutover. In `stopLossWiring.test.ts` the unchanged blocks are `:99`, `:214`, `:314`, `:328`, `:367`; the blocks that call `getRecommendation` (`:191-213`, `:387`, `:519`, `:704`, and the MU production-incident fixture `:780-970`) are **ported to `PositionDecision` with the same numbers, never deleted** (the trust-boundary guard from TE-0002 round 3).
- **Decision actions (internal; visible labels come from the mock):** `HOLD`, `CLOSE_PROFIT`, `CLOSE_STOP`, `CLOSE_BROKEN`, `CLOSE_TIME`, `ROLL`, `ACCEPT_ASSIGNMENT`, `EXPIRES_SOON`, `MAX_LOSS`, `NOT_JUDGED` (bought options), `BLOCKED`; later: `NO_COVER`, `STOP_FALLBACK`. Every consumer uses a `Record<DecisionAction, …>` or `assertNever`.

## Slice plan (each slice ships alone, each needs its own approval)

| Slice | What Dean sees | Depends on |
|---|---|---|
| **S0** Data prerequisites | Nothing on screen: a separate history endpoint and stored entry support levels | — |
| **S1** Broken-stock signals, display only | A calm information line per position; no action changes | S0 |
| **S3-0** Safety and no-red (display only; **independent of S0 to S2**) | No false "Hold" (`PositionsWorkspace.tsx:747-748` shows "No recommendation, refresh"); the banners that contradict Dean's rules are deleted (CSP 21-DTE banners `page.tsx:8258-8283`, duplicate "PROFIT TARGET HIT" `:8252`, "Consider extending" `:1736-1750`); red removed from the existing badge, panel, priority lists, mission control, health badges, the red card border, `dteColor` and the Cut Losses buttons (labels and ranking unchanged) | Dean's decisions 2 and 7 |
| **S3-1** Bought options and `needsClose` (live-engine logic; **Ian approves first; full suite**) | Bought options show "Not judged yet" instead of Take Profit or Cut Losses; `needsClose` is redefined for spreads and iron condors only, so covered calls, CSPs and bought options no longer show the red CLOSE NOW banner | S3-0, Dean's decision 2 |
| **S2** `PositionDecision` pure module, shadow mode | Nothing on screen; a disagreement list produced by a console script Dean runs and pastes (like `docs/analysis/entry-distribution-console.md`) that Ian approves | S1, Dean's decisions 3, 5 |
| **S3-A** One source | `pos.recommendation`, `pos.portfolioObjective` and the priority/briefing engine call all read one `PositionDecision`; the drops; urgency capped at medium; snapshot comparison by stable code; tests ported | S2 approved by Ian |
| **S3-B** The workspace cell | The calm cell: labels, numbers line, "changes if", "Rule met", stop styling; context lines; standing line; `recommendationTone` replaced | S3-A, Dean approves the mock |
| **S3-C** Card, panel, AI prompt | Position card, Position Intelligence panel, the AI prompt block; decision review | S3-B |
| **S3-D** Priorities and dashboards | `TodaysPriorities*`, `DailyPriorityList`, briefing, mission control, health badges; four-tier mapping, no red | S3-B |
| **Later** | Uncovered and PMCC short calls (V, W), the covered-call net line, roll cost in the cell, sign-in expiry, the fallback stop (if Dean asks), the wide-quote "unclear" state, states O, P, P2 | own reviews |
| **S4** Recommendation vs. action log | Agreement rates on the Performance page | S3-B |
| — | DECIDE-0001C (AI explanation) and DECIDE-0001E (Finnhub news) | **Separate tickets, not part of this approval** |

CUT-LOSSES-REVIEW-0001 (after this epic) keeps only the MAX_LOSS label question (a read-only check that can be answered now). The price-at-close and price-at-expiry capture moves to DECIDE-0001D (one capture path). The POSITION-INTENT-0001 ticket owns the "Acquire (default, not chosen)" chip and the "Choose intent" link (and a defaulted-or-chosen flag in the store); S3-B only renders it. RSI-TURN-0001's live-bar timestamp fix goes before S0 (shared `app/api/chart/route.ts` helper). `app/portfolio/page.tsx` changes are sequenced one at a time under the working-file rule.

## Conventions (all phases)

- `n` is the last **completed** session. A partial intraday bar is never used. A bar is complete when its NY date is before today, or after `meta.currentTradingPeriod.regular.end` + 15 minutes. Bars are sorted by `t`, de-duplicated, and a bar with any null field is dropped, so the test is on the count of complete bars.
- **Integer math for every threshold test.** Prices and credits in cents; a mid test as `bid_c + ask_c ≥ 4·C_c`; relative bid-ask spread as `8·(ask_c − bid_c) > bid_c + ask_c`; deltas in 1/10000; returns and gaps in basis points. Where a ratio of floats must be compared it uses a 1e-9 tolerance and says so in the code.
- **Prices are per share.** Stop, target and roll math use the combo **mid**. `C` is the cumulative net credit per share including all rolls. `P&L = C − mark`. DTE is calendar days, New York time. Short delta is the largest |delta| across the short legs.
- **Every input is explicit**, including `now` (the evaluator never calls `Date`; `evaluatedAt` equals `now`; `buildStopBreachObservations`, which today reads `new Date()`, must take `now`), the stored intent, the stop trigger, the cover, and prior readings.
- **The trader's own profit target** (`pos.profitTarget`, `hitTarget`, `app/portfolio/page.tsx:8212`) is what every "profit" rule reads; 50% is the default when none is set. Fixtures run at 50% and at one non-default target.
- **Intent** for a lone short put or call is the stored value (`/api/position-intent`); a missing value uses the default: `acquisition` for a lone short put (`acquisition.ts:1984`), `income` for a short call; `neutral` is treated as `income`.
- **Price basis:** split-adjusted, dividend-unadjusted closes (`indicators.quote`), rounded to cents; `adjclose` is never used.
- **Strategy is decided by leg direction and `entryPriceEffect`, not by the label.** `strategyLabelForStructure` (`lib/portfolio/closeOrderSafety.ts:196-200`) labels a lone put "PUT" and a lone call "CALL" whether bought or sold, and a spread "BPS" or "BCS" by its first leg only, so a debit spread gets a credit-spread label. Today `classifyIntentContext` and `isShortPremiumStrategy` (`positionObjective.ts:250-262`, `:313-321`) read only the label.
- **Presentation:** see the Presentation section. The enum names are internal and never appear in the UI.
- The fee constant `f` (per contract, from the broker's published schedule, rounded up) lives in one file with its source and date.

## DECIDE-0001-0 — Data prerequisites

- `app/api/chart/route.ts` requests `interval=1d&range=6mo` (about 125 bars) and returns bars with only `t, o, h, l, c`. The signals need 201 complete bars and volume.
- **Do not change `GET /api/chart?symbol=X`.** It has ten callers (`app/portfolio/page.tsx:2921` and `:8329`; `app/screener/page.tsx:5261` and `:6114`; `app/rinse-repeat/page.tsx:960`; `app/engine/page.tsx:2675`; `components/RsiLine.tsx:20`; `components/ChartLinkButton.tsx:66`; `lib/scans/trend.ts:10`; `lib/portfolio/trendFetch.ts:45`). A 2-year range would silently change `lib/scans/trend.ts:65-67` (its "200-day average" is today an average of all ~125 bars), the scan trend classification (a non-goal), RSI values, and break `RsiLine.test.tsx`.
- **Add a separate history endpoint** (or an explicit opt-in such as `range=2y&fields=ohlcv`) used only by `lib/market-intelligence/brokenStock.ts`: auth-protected, cached server-side per symbol per NY session date, returns volume, drops the in-progress bar, treats 429 or upstream failure as **not evaluated, never clear**, with a per-user rate limit. SPY over the same range and timestamps for relative weakness.
- **Entry support level `S`:** stored in the entry record when a position opens. For a position with no record: the lowest low of the 20 bars whose NY date is strictly **before** the NY date of the original open (bars, not weekdays; an entry-day or after-close entry excludes the entry day), stored **write-once**, `source: 'reconstructed'`, with `asOf` and price basis, displayed as reconstructed. Unknown entry date, fewer than 20 prior bars, or a split after entry makes support **not evaluated**. A rolled position uses the original open date.
- **Decision log finding:** `lib/decision-review` holds 0 records because records are created only when the trader opens the section and saves (`DecisionReviewSection.tsx:84` → `app/portfolio/page.tsx:10346` → `/api/decision-reviews`). Nothing auto-writes. There is nothing to investigate.
- Coordinate with RSI-TURN-0001: only one of them edits `app/api/chart/route.ts` at a time; they share the completed-bar helper.
- **Acceptance:** a 2-year fixture yields 201+ complete bars with volume; `GET /api/chart?symbol=X` returns the same bars and shape as today and `RsiLine.test.tsx` passes unmodified; partial-bar, null-bar, split and dividend fixtures pass (Alan's Phase 0 table).

## DECIDE-0001A — Broken-stock signals (display only)

New pure module `lib/market-intelligence/brokenStock.ts`. It changes **no recommendation and no action**.

`broken = trend ∨ gap ∨ support ∨ fundamental`. Relative weakness is corroborating only.

| Signal | Fires when | Not evaluated (NE) when |
|---|---|---|
| Trend break | `c[n] < ma200(n)` **and** `c[n−1] < ma200(n−1)` **and** `ma50(n) < ma200(n)` (simple means including day `n`). **Fires only if it was not already true at the recorded entry date;** if it pre-existed it is shown as context and does not count toward `broken` (the trader chose that entry). | Fewer than 201 complete bars |
| Failed gap | See formulas | Fewer than 21 closes before `g` |
| Support break | `c[n]_c·100 < 99·S_c` and `40·v[n] ≥ 3·Σ v[n−20..n−1]` (volume ≥ 1.5x the prior-20 average, today excluded) | No support level, or any missing or zero `v` in those 21 bars, or a split after entry |
| Fundamental hit | Guidance cut or ≥ 2 analyst downgrades in 10 days | Always, until the news ticket ships; an unbuilt signal never lowers confidence |

**Failed gap.** `gap = O[g]/C[g−1] − 1`; `ADM20 = mean over i = g−20 … g−1 of |C[i]/C[i−1] − 1|`; `T = max(0.08, 3·ADM20)` (in bps; no fallback to 8% when data is short); `R = O[g] + 0.5·(C[g−1] − O[g])`; prices rounded to cents first; ex-dividend gaps are not excluded. `g` is any session in `n−19 … n`; if several qualify, any one is enough. **Evaluated when `n ≥ g+4`:** the window is the 5 closes `g … g+4` (the gap day is the first); it **fires** when `gap ≤ −T` and every one of those closes is below `R`. Before `g+4` with no close `≥ R` it is **PENDING**; a close `≥ R` inside the window means it **can no longer fire** (CLEAR). **A fired gap clears (Ian, 2026-09-26) only when two consecutive closes, `c[n]` and `c[n−1]`, are both `≥ R`;** one close `≥ R` keeps it FIRED but forces LOW confidence; a cleared gap does not re-fire for the same `g`, and ages out when `g` leaves `n−19 … n`.

**Relative weakness (corroborating only).** `r20(stock) − r20(SPY) ≤ −1500 bps`, `r20` defined **by date** (the close at `t[n]` against the close 20 SPY sessions earlier; both series must contain both timestamps or NE). It never marks a stock broken and never changes an action; when another signal fires it is added as a reason and can lift LOW to MEDIUM only.

**Applicability.** BCS: N/A (a falling stock helps a BCS). IC: put side only. All others: all signals.

**Output:** `{ broken, signals: [{ code, state: 'FIRED'|'CLEAR'|'PENDING'|'NE'|'NA', value, threshold }] }`. Missing data can never make a signal fire.

## DECIDE-0001B — Decision rules (B1 shadow, then cutover)

```ts
type DecisionAction =
  | 'HOLD' | 'CLOSE_PROFIT' | 'CLOSE_STOP' | 'CLOSE_BROKEN' | 'CLOSE_TIME'
  | 'ROLL' | 'ACCEPT_ASSIGNMENT' | 'EXPIRES_SOON' | 'MAX_LOSS' | 'NOT_JUDGED' | 'BLOCKED';

interface PositionDecision {
  action: DecisionAction;
  reasonCode: string;                          // BLOCKED uses DATA_UNAVAILABLE, STOP_PENDING_CONFIRMATION, NO_COVER_DATA, UNSUPPORTED_ECONOMICS, STRUCTURE_AMBIGUOUS, VERIFY_PRICING
  reasons: string[];                           // reason codes; the UI shows the top 1
  contextLines: string[];                      // information that is not the action
  flipConditions: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null; // null if and only if action === 'BLOCKED'; NOT_JUDGED and mechanical rules show "Rule met" or nothing
  pendingStop?: { firstReadingAt: string; mark: number } | null;
  evaluatedAt: string;                         // equals the input now
}
```

### Stop rule (all short premium)

`mark ≥ stopTrigger`, where **`stopTrigger` is an explicit input from the trusted stop policy** (`pos.stopLossPolicy`, ALIGNED or TOO_LOOSE only; `lib/portfolio/stopLossPolicy.ts:184-260`). The default policy is `2·C` (`DEFAULT_ENTRY_STOP_MULTIPLE = 2`). An untrusted or absent policy never produces `CLOSE_STOP` (production incident, TE-0002 round 3). **Open decision O19 (Dean, Ian):** today a position at twice the credit with **no TradeEdge stop order** shows "Cut Losses" (`positionObjective.ts` material-loss path). Recommended: show it calmly as **"Loss limit reached"** (same reason, plus the note "No TradeEdge stop order is working.") and suggest Close, without "Rule met". The mock's states B and E need a stop order to be "Stop level reached".

**Confirmation reuses production; the ticket's earlier design is dropped.** `evaluateStopBreach` needs **2 precisely timed midpoint readings at least 5 minutes apart** (`requiredConfirmations = 2`, 300,000 ms counts as separate; a reading at or below 98% of the trigger resets the streak, a reading within 2% below neither counts nor resets), or a broker TRIGGERED status; a lone current reading returns VERIFY_STOP, which maps to `BLOCKED` / `STOP_PENDING_CONFIRMATION` (state "Checking stop level"). Width enters only through quote quality (`QUOTE_WIDTH_THRESHOLDS`: net width 0.15 of mid, per leg $0.50): only a RELIABLE quote lets an ask-side breach count. Yesterday's precise breach plus today's current reading can confirm (*Ian to confirm cross-day confirmation is intended*). **Intraday readings are not persisted** (`/api/position-snapshots` stores one snapshot per position per calendar day). The pure evaluator receives `priorReadings: {at, mid, quality}[]` and `now`; **S2 must name where intraday readings are stored**, or a stop first crossed mid-morning stays "checking" until the next day. **O15 (deferred, Paul):** a "Stop level unclear (wide quote)" state (Alan): after 15 minutes from the first reading, if only the ask-side cost to close is past the stop and the midpoint is not, show a hollow amber ring with "The cost at the ask is past your stop; the midpoint is not. Check the price before acting." — never a rule-met or a `CLOSE_STOP` from an ask-side spike (TE-0002). The earlier "3 readings or 15 minutes becomes Stop level reached (wide quote)" is **removed**.

**Unreachable stop.** Flag when `stopTrigger ≥ width` (for an IC, per wing, using that wing's own width; a spread opened for more than half its width with the 2x default): the amber note "Stop cannot trigger; the most you can lose is $(width − C)×100 per contract." Rule 2 then never fires; the rules that remain (profit, time, expires soon, at maximum loss, delta) still apply and the trader can always close. **The fallback stop is DEFERRED (Paul; not built unless Dean asks, O14).** If Dean asks, the candidate rules are: Ian's `fallback = max(0.80·width, C + 0.5·(width − C))` or Alan's `0.80·width` with the guard `5·C_c < 4·W_c` (no stop when the credit is 0.8·width or more); the test uses `stopTrigger`, not `2·C` (a 3x policy makes a 5-wide with C 1.70 unreachable); it fires when `5·(bid_c + ask_c) ≥ 8·W_c`; it passes through the same confirmation with a synthetic policy and its own honest wording ("Protective level reached", not "a rule you set"); never for a CSP or CC; it has a discontinuity at `C = width/2` (`min(2C, 0.8·width)` removes it but changes Dean's rule for `0.4·width < C < 0.5·width`). Worked cases: 5-wide C 2.50, 2.51, 2.55, 3.00, 4.00: fallback level 4.00, loss $150, $149, $145, $100, **$0** (the guard is needed); 10-wide C 2.50 to 4.00 is reachable, so no fallback.

### Precedence (first match wins)

**Spreads and IC (BPS, BCS, IC)**

| # | Rule | Action |
|---|---|---|
| 1 | Data (see Data rules) | `BLOCKED` |
| 2 | Stop: `mark ≥ stopTrigger`; **or maximum loss:** both strikes of the tested wing in the money and `mark ≥ 0.98·wing width` (integer `25·(bid_c + ask_c) ≥ 49·W_c`), using the wing's own width and the **same confirmation as the stop** (2 readings; refuses crossed or stale quotes); "Your stop level was passed" is added **only if `mark ≥ stopTrigger`** | `CLOSE_STOP` / `MAX_LOSS` |
| 3 | Expires soon: DTE ≤ 7 and the short strike in the money or within 2% (put: `50·(S_c − K_c) ≤ K_c`; call: `100·S_c ≥ 98·K_c`; each side of an IC) | `EXPIRES_SOON` (spreads and Income puts: suggest Close; a covered call, an Acquire or Wheel put use "Close to assignment" or "Expect assignment" instead, see below) |
| 4 | Profit: `(C − mark)/C ≥ ` the position's own profit target (default 0.50) | `CLOSE_PROFIT` |
| 5 | Broken stock (N/A for BCS; IC put side only) **and** `P&L < 0` **and** (`mark ≥ 1.5·C`, integer `bid_c + ask_c ≥ 3·C_c`, **or** short delta ≥ 0.30) (**gate B′, O17, Dean decides; variant A is "any loss"**) | `CLOSE_BROKEN` (IC: all 4 legs; never roll). Otherwise `HOLD` with the signal as a context line. |
| 6 | Time: DTE ≤ 21 and entry DTE was > 21 | If `P&L ≥ 0` → `CLOSE_TIME` (winners are not rolled). If `P&L < 0` → `ROLL` if a qualifying roll exists, else `CLOSE_TIME`. |
| 7 | Short delta ≥ 0.50 | `ROLL` if a qualifying roll exists (losers only), else `HOLD` with a delta context line. **Never `CLOSE_STOP`.** |
| 8 | Default | `HOLD` |

*Why 3 (expires soon) is above profit (Ian, Alan):* both say Close and "Expires soon" carries more information; Alan's low-severity alternative (profit first) is noted. *Why 5 is gated:* a trend break with a trivial loss would cause the early-exit pattern behind Dean's 21 of 28 early closes. Under gate B′ (Alan's fixtures): C 1.65, mark 1.66 or 2.47, delta 0.20: `HOLD` with context; mark 2.475 (exactly 1.5·C): `CLOSE_BROKEN`; mark 1.66 with delta 0.30: `CLOSE_BROKEN`; a winner with delta 0.35: `HOLD`. B′ is a strict subset of "any loss". For an IC, P&L uses the whole condor mark against total credit; delta uses the put side.

**Lone short put or short call (CSP, CC): the intent branch (Dean, 2026-09-25) is evaluated first.**

| Intent | Rules |
|---|---|
| **`income`** (and `neutral`) **CSP** | Data → Stop (`CLOSE_STOP`; O19 for no stop order) → Expires soon (Income puts: "Expires soon", Close) → Profit (own target) → Broken stock, gated as above → Assignment (short delta ≥ 0.50): `ROLL` if a qualifying roll exists with `K' ≤ K`, `DTE_new > DTE_old`, `DTE_new ≤ 60`, else `ACCEPT_ASSIGNMENT` ("Expect assignment") → `HOLD`. **No 21-DTE rule and no delta-roll-at-21 rule (Dean).** |
| **`acquisition`, `wheel` CSP** | Data → Expires soon **reads "Expect assignment"** → Profit (own target) → short delta ≥ 0.50: `ACCEPT_ASSIGNMENT` (**never `ROLL`**) → `HOLD`. **Stop and broken-stock never produce an action.** No hard loss limit (Ian, O5); risk control is at entry (cash-secured sizing, the 10% symbol and 25% sector caps, `policies/defaults.ts:39-46`). |
| **Any CC, any intent** | **Never `CLOSE_STOP` or `CLOSE_BROKEN`** (the shares offset the call; buying it back strips the cushion). Data → Profit on the call leg → short delta ≥ 0.50: `income` uses the roll test (`ROLL` or `ACCEPT_ASSIGNMENT`), `acquisition` and `wheel` → `ACCEPT_ASSIGNMENT` → `HOLD`. **Expires soon reads "Close to assignment"** (never a close-at-a-loss suggestion). Broken stock is a context line only. **Exceptions:** the uncovered part (state V, later) and none other. |
| **PMCC short call** | Never `CLOSE_STOP` or `CLOSE_BROKEN`. Delta ≥ 0.50 (mock uses 0.55 at 18 DTE): "Consider rolling" for a net credit ≥ $0.10 with the new strike ≥ old and above the LEAP strike plus its net debit; if no roll qualifies: "Close the call and keep your LEAP." Never exercise the LEAP to deliver. At 21 DTE no time rule; OTM: `HOLD` with take profit at the target; ITM with little extrinsic or ≤ 7 DTE: expires soon. The line "Assignment would mean exercising your LEAP and giving up its remaining time value." (state W; later slice) |

**Context lines for Acquire and Wheel positions (mandatory, never the action):** the loss in plain multiples of the credit ("Down $240; that is 1.2 times the $200 you collected."), and when the stock is broken **and** the loss is ≥ 2x the credit "Assignment would be into a stock in a downtrend." A defaulted (not chosen) intent shows the chip "Acquire (default, not chosen) · Choose intent" and the reason says "treated as Acquire (you have not chosen)", never "You set this put to Acquire". The detail states the switch consequence: "If you set this put to Income instead, the stop would be $4.00 (twice the $2.00 credit). The mark is $4.40, so it would show Stop level reached at once." (Dean's pasted point: choosing Income must not be a trap.)

**Live-engine behavior and the ported tests.** ACQUIRE-WHEEL-LIVE-0001 (shipped 2026-09-25) already implements the Acquire and Wheel put behavior in `evaluatePositionObjective` via `assignmentPlanned`; its 14 tests are **ported to the `PositionDecision` adapter, not deleted**. Its context line ("Down 150% of credit (1.5x the credit received)") is reconciled with this ticket's wording. At cutover, its test `:70` (an Income put at 20 DTE still gets roll-soon) changes, because this ticket has no 21-DTE rule for CSP or CC.

**Default intent (O6, resolved):** every lone short put defaults to `acquisition` (`acquisition.ts:1984`), so an unclassified CSP has no exit rule; **Dean confirmed (2026-09-25).** The intent chip and "Choose intent" link belong to POSITION-INTENT-0001.

### Qualifying roll and roll cost

- `rollNet = floor_to_cent(mid(new short combo) − mid(close old combo)) − fees/(100·qty)` (credit-positive; fees after the floor; compare in mills or round fees up to a whole cent per share). `fees = f × Σ contracts across every leg closed or opened`; **an IC roll is the tested side only (4 legs)** and must satisfy that side's strike rule.
- Qualifies when `rollNet ≥ $0.10/share`, `DTE_new > DTE_old`, and the strike rule is met (short puts: new strike ≤ old; short calls: new strike ≥ old).
- **CC Income roll test:** roll when `rollNet_c · DTE0 > c0_c · (DTE_new − DTE_old)`, where `c0` and `DTE0` are the credit and DTE of the current short call when opened (needs a stored per-leg record). `(K' − K)` is a note, not in the test.
- **Roll cost shown before the trader clicks Roll (Dean, 2026-09-26).** With `W` the old width, `W'` the new width, `C` the cumulative credit and `r` the roll net credit per share after fees: new credit `C' = C + r`; new maximum loss `(W' − C')·100` per contract; change in maximum loss `((W' − W) − r)·100`; new breakeven, put spread `K_s' − C'`, call spread `K_s' + C'`; new stop `2·C'`. At the same width the maximum loss falls by `r`; a wider new spread raises it unless `r ≥ W' − W`. **After every roll the stop resets to `2·C'`, so unreachability is re-tested.** Fee treatment: use the fee-inclusive number for maximum loss and say so. Example (put spread, C 1.65, 570/565, r 0.14): roll to 568/563: `C'` 1.79, breakeven 566.21 (was 568.35), maximum loss $321 (was $335); roll to 568/558 (10-wide): maximum loss $821 (**+$486**). Roll cost in the cell is a **later slice** (it needs live roll quotes).

### Data rules

- **Required inputs:** mark, credit, DTE, delta, stop trigger, intent (where it applies), cover (for short calls, later). A missing required input, unsupported entry economics (split by `entryPriceEffect`: Credit, Debit, Unknown), `structureAmbiguous`, a `verify-pricing` state, or unavailable cover data returns `BLOCKED` with a reason code, never `HOLD`. An earlier rule that fires on the inputs it has still decides. `HOLD` requires every rule to have been evaluated. A stale quote is refreshed once, then `BLOCKED`. An expired token continues to redirect to sign-in (see Later).
- **Not modelled here (kept as today):** `PLACE_GTC`, "verify pricing or stop" management states, watch.

### Confidence

Checked in order: null, LOW, MEDIUM, HIGH. `null` for `BLOCKED`. **Mechanical rules** (the stop, maximum loss, profit target, time limit, expires soon) show **"Rule met"** in neutral gray, never a confidence, and never a color; `HOLD` shows none. **Judgment states** (broken stock, close to assignment) show plain "Low", "Medium" or "High confidence" and **LOW is displayed** (hiding it is the wrong kind of calm). Judgment values use margin `m = |x − T|/|T|` in integers; `m < 0.10` is LOW and `m = 0.10` exactly is HIGH:

| Value | LOW when |
|---|---|
| Short delta | [0.50, 0.55) fired; (0.45, 0.50) HOLD |
| LEAPS delta | (0.54, 0.60) fired; [0.60, 0.66) HOLD |
| LEAPS DTE | 163 to 179 fired; 180 to 197 HOLD |
| Failed gap | [T, 1.1T); also LOW while one close ≥ R (not yet cleared) |
| Support break distance | close less than 2% below support: `c[n] > 0.98·S` (integer `c_c·100 > 98·S_c`) (Ian) |
| Volume ratio | `1.5 ≤ ratio < 1.65` (integer `400·v < 33·Σv`) (Ian); the signal is LOW if either term is LOW; not fired means no confidence is computed |

**MEDIUM:** a lower-precedence rule would have fired or would give a different action. Relative weakness can lift LOW to MEDIUM only. Unbuilt and N/A signals never lower confidence.

### LEAPS and bought options (deferred; the safety fix is S3-1)

There is no engine for a long LEAPS hold, roll or close decision (`evaluate.ts` decides income-call candidates only); that policy is its own ticket needing Ian's sign-off (O11). Two safety rules are recorded now: with a short call open against a long LEAP the recommendation is about the short call first and **never to close or roll the long leg alone**; a low delta means "roll" only for a PMCC, never for a Hold.

**State U (bought call, bought put, debit spread; S3-1):** keyed on leg direction and `entryPriceEffect`. Label "Not judged yet"; reason "TradeEdge does not judge bought options yet. Use your own profit target and exit plan." Two things stay (Ian): "Your profit target was reached" as a note from `hitTarget`; and "Expires in N days" at ≤ 7 DTE with the automatic-exercise warning (an option in the money by $0.01 or more is exercised automatically and needs cash or margin). This removes today's Take Profit and Cut Losses labels on these positions (Dean's decision 2). Today a long call resolves to `covered-call`, a long put to `wheel-csp`, a debit spread to `credit-spread`; U replaces that. *Diane to confirm the wording "Not judged yet".*

## Coverage of every current status (Ian's complete review, 2026-09-26)

Ian checked every status the app can show today, every strategy from open to expiry, and every other place a status appears. The mock (revision 5) shows each situation; this section records the rules and the mapping.

### Safety issues fixed

1. **A missing recommendation must never show "Hold".** `PositionsWorkspace.tsx:747-748` shows `p.recommendation?.label ?? 'Hold'` with "Continue monitoring", and `recommendationTone` (`:569`) also defaults to `'Hold'`. Replace both: "No recommendation" and "Recommendation could not be calculated. Refresh." with a Refresh button (S3-0).
2. **Bought options** (state U, S3-1). **A short call with nothing behind it (V) and a PMCC short call (W) are a later slice** (below): they need cover detection first, and a false V would tell the trader "the loss has no limit" when the shares are simply in another account (the app reads one broker account at a time).
3. **A working profit-target order never replaces the recommendation.** It is a note ("Profit-target order working at $0.85.") on whatever state applies and never hides a stop, maximum-loss or expires-soon state. "Order working" is not a state. It covers only a GTC profit-target limit on the short leg (`hasGtc`, `gtcOrderId`, `gtcOrderPrice`; `findProfitGtcOrder`, `acquisition.ts:741-753`); other closing orders are not visible yet.

### New rules from the coverage review

- **Time limit (21 DTE, spreads and IC only):** "Time limit reached (21 days)" for both a loser with no roll and a winner (winners are not rolled). A roll that qualifies is "Consider rolling". `needsClose` is redefined: **true only for spreads and iron condors** (entry DTE above 21, DTE 21 or less); covered calls, CSPs and bought options never show the CLOSE NOW banner or the red card border. Its readers are updated (`acquisition.ts:2099-2104`, `:2199-2200`, `:2325-2326`; `score.ts:48`; `buildPositionsWorkspaceModel.ts:123`; `page.tsx:296`, `:2057`, `:2251`, `:2387`, `:8218-8221`; `pmccStopGtcPrompt.ts`), including the AI-prompt lines that still say "must close/roll".
- **Expires soon and at maximum loss:** precedence and integer tests above. M's detail: "It can be assigned any day, and is almost certain at expiry if it stays in the money." The 2% window is not volatility-aware (at 7 DTE it is about 0.6σ at IV 25%). *Ian to confirm "expires soon" at 7 DTE or less beats a qualifying roll.*
- **Delta breach with no roll (S), short-dated entry, let-expire, watch, place-GTC** become plain notes on Hold, never actions. The delta note's tail "act at your stop or 21 DTE" appears **only for spreads and condors**, never for a CSP or CC. The health-score "watch" is dropped.
- **No-recommendation states, each with its own reason:** stale quote (I), could not be calculated (I0), no entry price (I2, split from debit entries on `entryPriceEffect`), legs do not fit together (I3), verify pricing ("Checking prices", hollow amber ring, Refresh).
- **Covered-call net line (Ian, O20; a later slice; needs data that does not exist):** "Call −$97 · shares since sold +$540 · net +$443", the call's number in neutral color. Shares are measured **since the call was sold** (from the stock price when the call was opened; if that is missing, since bought, labeled as such), counting only shares in the matched account. No combined figure exists today (only per-symbol `symbolUnrealizedPnl` and `optionCloseNowPnl`, and share cost basis may be incomplete).
- **Dean's pasted review points (2026-09-26), all in the mock:** the Acquire-to-Income switch is not a trap; the covered-call number is shown with its shares in neutral color; the unreachable-stop note is visible ("Stop cannot trigger; the most you can lose is $245 per contract."); the roll detail shows the new breakeven and new maximum loss; the broken-stock detail says why it fired.

### Later slice: cover detection for V and W (Alan's spec)

Derived in a pure `deriveCoverage(position, allPositions, equityHoldings)` and stored on `Position`, reusing `computeCoveredCallCapacity` (`lib/scans/covered-call-capacity.ts:320-345`). **Data gate first:** capacity `unavailable`, a non-current snapshot, a missing or mismatched account, a missing quantity or a multiplier other than 100 gives **UNKNOWN** (`BLOCKED` / `NO_COVER_DATA`), never V and never "covered". `Q` = contracts of existing short calls on the underlying in the account. Shares pool = `floor(sharesOwned/100)` (not `availableContracts`: a pending order must not un-cover an existing call). Long-call pool = single-leg long calls on the underlying with strike ≤ the short strike and expiry ≥ the short's (a long inside a multi-leg Position is excluded; the long must have a later expiry when it is a separate Position). Allocation: earliest expiry first, then lowest strike; shares first (covered-call rules), then the long-call or PMCC pool (W), then V. `nakedContracts = max(0, Q − sharesPool − longPool)`; partial cover flags only the uncovered contracts ("1 of 2 contracts has no cover"; 150 shares for 2 contracts is 1 covered, 1 uncovered). Shares or a long call in another account are **not cover** at the broker; the wording is "No cover found in this account. If it is covered elsewhere, no action is needed; if not, the loss is unlimited." **A "covered elsewhere" record does not exist and must be designed before V can use stop styling** (O21). PMCC pairing today (`findPairedShortCall`, `pmccPairDetection.ts:83-104`) returns only the soonest short call, works from the long leg, and requires the long DTE > 120, the short DTE < 60 and a strictly higher short strike, so W needs an inverse lookup and a rule for several shorts against one long. Structure detection (BCS) runs before V. Alan's cover fixtures are in the fixtures table.

### Behavior being dropped (Dean's decision 2)

The weak-health loss exit (`positionObjective.ts:996`, "Cut Losses" at −50% with a low health score); "Reduce Risk" (net-edge decay stays on the card; trend against goes to "Stock has weakened"; gamma and DTE go to expires soon and the time limit); the health-score "watch"; earnings-risk ranking above the profit target (it becomes a note; closing a winner before earnings stays available); the 21-DTE roll suggestion for CSP and CC and their banners; "Consider extending"; Take Profit and Cut Losses labels on bought options. Ian approved dropping all of these provided expires soon, at maximum loss, stock has weakened and the bought-option expiry note ship together.

### Mapping of every current status to the new design

| Current status | New state |
|---|---|
| Hold Position | Hold (with notes: D1, J, K, L, S, Y, Z) |
| Take Profit (`close-winner`) | A, R, X (the trader's own target) |
| Cut Losses (material loss) | B, E (stop; O19 when no stop order); Acquire and Wheel puts become D1 or D2; N at maximum loss |
| Cut Losses (weak-health loss) | Dropped; F covers the trend case |
| Roll Position (`roll-soon`, 21 DTE) | G1, G0, G2 (spreads and IC only) |
| Roll Position (explicit roll flag) | G2 only when a roll qualifies |
| Accept Assignment / assignment-risk | D2, D3, H, M1, M2, M3 (W later) |
| Reduce Risk | Dropped |
| earnings-risk | Notes L1, L2 |
| place-gtc, let-expire, watch | Notes (Y, X) |
| Verify Pricing and its pending notice | VP "Checking prices" |
| Recommendation Unavailable and the workspace default "Hold" | I0 "No recommendation" |
| Structure ambiguous / unsupported economics | I3 / I2 |
| Pending stop confirmation | C |
| Bought options, debit spreads | U "Not judged yet" |
| LEAPS and PMCC long legs | Q |
| Short call with no cover / PMCC short call | V / W (later) |
| Expired token | Continues to redirect to sign-in (later ticket) |
| Assigned, called away, early assignment risk | P, P2, O (later; need data that does not exist) |
| Deploy Idle Cash | Not a position state; label rule in the priority lists |
| Replace Working Order | Pending Orders list only |
| Stop-order line (Aligned, Too loose, Too tight, Unverified, Invalid, No stop) | Kept as information, renamed "Stop order: Aligned" so it is not confused with "Stop level reached"; "Invalid" loses its red |

## Cutover map (O7)

**The cutover replaces `evaluatePositionObjective`'s consumers everywhere.** Everything below is switched in S3-A (one source), then restyled in S3-B to S3-D:

1. Positions table "Recommendation" column (`PositionsWorkspace.tsx:744-748`; tone `:562-573`, defaulting to 'Hold' at `:569`).
2. "← suggested" markers (`PositionsWorkspace.tsx:762`, `:771`, via `canonicalRecommendationToAction`, `lib/portfolio/canonicalRecommendationPresentation.ts:4-17`).
3. Position card: `canonicalRecommendationForCard`, `PositionRecommendationBadge` (`page.tsx:8145-8146`, `:8365`; `PositionRecommendationBadge.tsx:5-24`), the Position Intelligence panel (`page.tsx:8994`, `:9050`; `PositionIntelligencePanel.tsx:46`, `:178-195`), its vocabulary (`managementChoices.ts:11-21`, `nextLifecycleEvent.ts:17-25`), `pos.portfolioObjective` (`types.ts` ~309) and `PositionRiskBadges` (`page.tsx:8931`).
4. **The second engine call:** `computeCanonicalPortfolioPriorities` (`portfolioIntelligenceAdapter.ts:154-172`) and `dashboardComposition.ts:194-218` call `evaluatePositionObjective` on raw positions (and skip the credit-economics zeroing that `scorePortfolioPositionObjective` does at `acquisition.ts:227-238`, so a debit trade can be scored as a credit trade there). Test: the action in the priority queue equals the action on the card for every fixture.
5. AI explanation panel and prompt block "RULE ENGINE'S EXISTING CALL" (`page.tsx:5229`, `:2072-2085`), `projectCanonicalRecommendationForAi` (`canonicalRecommendationPresentation.ts`, `page.tsx:2716-2727`, action union `:440`), and the raw `CUT_LOSSES` text (`PositionsWorkspace.tsx:543`).
6. Priority, briefing and sort surfaces: `features/portfolio/priorities/*`, `TodaysPrioritiesDashboard.tsx:25`, `DailyPriorityList.tsx:7-18`, `TodaysPriorities.tsx:43`, `:85`, `TodaysPrioritiesWorkflow.tsx`, `briefing/suggestedFocus.ts`, `lib/todaysPriorities/*`, `lib/dailyBriefing/buildDailyBriefing.ts`, `lib/morning-briefing/attentionFeed.ts`, `lib/priorityScore/priorityScore.ts`, `lib/command-center/buildCommandCenterViewModel.ts`, `components/mission-control`; the position sort `canonicalRecommendationPriority` (`canonicalRecommendationPresentation.ts:87`, table `:77`, used at `acquisition.ts:378-379`) and the section order (`page.tsx:296`) are re-ranked on the new states. The priority lists need a four-tier mapping (a rule you set has been met; worth a look; a planned step; nothing to do), amber at most, no red, because `PositionDecision` has no urgency.
7. **Red urgency that sits beside the recommendation and is in scope (Paul: "no red on position recommendations and their surfaces"):** the health-vocabulary "Action Required" red (`SummaryStrip.tsx:22`, `DailyPortfolioBriefing.tsx:76` with its red-circle emoji, `components/command-center/PortfolioHealthCard.tsx:14`), `PositionHealthBadge.tsx:11`, the red card border (`page.tsx:8221`), the red `dteColor` at 7 DTE or less (`page.tsx:2976`), the red "✕ None" profit-target order (`page.tsx:8849`), the red Cut Losses buttons (`PositionsWorkspace.tsx:770`, `page.tsx:2983`, the batch bar `:3100-3348`, `:9886-9941`; the label becomes "Close at a loss", a separate small copy change), and `recommendationTone` returning red for any label containing "cut" or "close". Portfolio-level objectives (concentration, drawdown, pending order) that set `'critical'` (`evaluatePortfolioObjectives.ts:217`, `:225`, `:267`, `:327`, `:650`) map to amber in S3-D.
8. **Position-card banners (`app/portfolio/page.tsx`):** CLOSE NOW red and REVIEW amber (`:8228-8244`, become G0/G1/G2), the CSP 21-DTE banners (`:8258-8283`, **deleted**), the red structure-ambiguous banner (`:8285`, becomes I3), "PROFIT TARGET HIT" (`:8252`, removed), "SHORT-DATED ENTRY" (`:8246`, becomes a note), "Consider extending" (`:1736-1750`, deleted).
9. **Snapshot engine:** `lib/position-snapshot/snapshotEngine.ts:90-99` compares the stored label string; a new vocabulary would fire a "recommendation changed" event for every position. In S3-A it compares a stable action or reason code, and old label strings already in Redis snapshots and decision reviews are mapped once and shown with their stored label.
10. Decision review: `DecisionReviewSection.tsx:84`, `lib/decision-review/decisionReview.ts:48`, `DecisionHistoryView`.
11. **Not replaced:** the manual action buttons; the pricing, verification and GTC states `PositionDecision` cannot express (`pos.recommendation.kind === 'verify-pricing'` is control flow at `acquisition.ts:365` and `VerifyPricingRefreshButton.tsx:98`).
12. Not affected: `app/api/advisor/route.ts`, `leaps-advisor/route.ts`, `leaps-analysis/route.ts`.

**S2 shadow mode:** compute `PositionDecision` beside the existing engine, no UI, and produce the disagreement list with a **console script Dean runs and pastes** (Dean has no local Node); Ian approves it. Ian's required classes: old Cut Losses, Accept Assignment or Roll where new says Hold (Acquire and Wheel puts, weak-health exits, CSP and CC 21-DTE rolls); new stop, broken, expires soon, maximum loss where old said Hold; every trader-target versus 50% difference; every bought-option position.

**Tests that change at S3 (with Ian approval):** `managementIntent.test.ts` (Reduce Risk `:99`, Cut Losses `:75`, `:146`, `:182`, `:246`, `:255`); `positionObjective.test.ts` (weak-health `:67`, earnings-risk `:80`, roll-soon `:109`, `:119`, let-expire `:139`, watch `:156`, "Continue monitoring" `:230-272`); `decisionQualityMatrix.test.ts`; `recommendationScorecard.test.ts`; `pi0014MarketablePricingFixtures.test.ts`; `evaluatePortfolioObjectives.test.ts:37`; `assignmentPlannedRecommendation.test.ts` (ported; `:70` changes); `PositionsWorkspace.test.tsx` (`:96`, `:507-530`; it asserts `/api/chart` is not fetched, so do not add chart fetching to the workspace); `PositionRecommendationBadge.test.tsx`, `PositionIntelligencePanel.test.tsx`, `managementChoices.test.tsx`, `nextLifecycleEvent.test.tsx`, `TodaysPriorities*.test.tsx`, `DailyPortfolioBriefing*.test.tsx`, `buildDailyBriefing.test.ts`, `attentionFeed.test.ts`, `priorityScore.test.ts`, `buildCommandCenterViewModel.test.ts`, `CommandCenter.test.tsx`, `snapshotEngine.test.ts`, `canonicalRecommendationPresentation.test.ts`, `RecommendationExplanationPage.test.tsx`, decision-review tests, `PortfolioPage.test.tsx`. **Must not change:** `RsiLine.test.tsx`; `gtcScoping.test.ts`; `pmccPairDetection.test.ts`; the helper and trust-boundary tests in `stopLossWiring.test.ts`.

## Presentation (Diane's spec G5 and Ian's reviews; Dean approves the rendered mock)

**One design for every user.** No experience-level variants.

**Cell layout (top to bottom):** the "Recommendation" caption with the **quote age at its right** (neutral, amber only when older than 5 minutes, which is when a visible Refresh button appears); a row with the dot and the label (11px semibold, plain white, never colored text, never all caps, never a filled pill) and right-aligned either "Rule met" (neutral gray), a plain "Low, Medium or High confidence" (judgment states only) or nothing; **one reason**; one "Changes if …" line (with a dollar figure where a wait-and-see would otherwise be invited; never a line that teaches switching intent); notes; **one numbers line**; a visible Refresh button when data is stale; a collapsed "Why and what would change" detail with a "Words used here" list; then the Actions zone with neutral borders (min height 32px) and one "← suggested" marker that always follows the label (the arrow is `aria-hidden`).

**Length caps (Diane), enforced by a test on every state's text:** reason ≤ 110 characters (3 lines), "changes if" ≤ 72 (2 lines), notes ≤ 72 in total (2 lines), numbers ≤ 90 (2 lines). Anything longer is in the fold-out.

**Numbers line:** 10px, dim gray (not faint 9px), each part unbreakable, at most two lines; parts drop from the end of this priority list: Mark (or "Call −$97 · shares since sold +$540 · net +$443" on covered calls), P&L, Stop or trigger, DTE, Δ. Credit and width appear only in the fold-out.

**Visual tiers (no red anywhere):**

| Tier | States | Dot | Edge | Label |
|---|---|---|---|---|
| Act now | Stop level reached, At maximum loss, Expires soon (spread or Income put in the money), later Uncovered short call | filled amber 10px | 3px amber edge, faint amber tint on the cell | 12px bold, "← suggested" bold |
| Good news or a planned step | Take profit, Time limit reached, Consider rolling, Expect assignment, Close to assignment | filled 8px (emerald or sky) | none | 11px semibold |
| Risk context | Stock has weakened, early assignment risk | filled amber 8px | none | 11px semibold |
| Pending | Checking stop level, Checking prices | hollow amber ring 8px | 2px dashed amber | 11px semibold |
| Ambient | Hold | small filled gray 5px | none | 11px |
| No answer | No recommendation, Not judged yet | hollow neutral ring | none | 11px |

*Legend wording: "Amber edge: act now". Ian to sign off that in-the-money expires soon is an act-now state.* **Amber budget:** amber text appears only on true warnings (a loss stated on an Acquire position, "stop cannot trigger", earnings, buffer under 5%); neutral information (working order, let-it-expire, short-dated entry, delta note) is dim gray; "Rule met" is always gray.

**Jargon (Diane):** each term (Δ, DTE, Mark, P&L, credit, breakeven, roll, maximum loss, in and out of the money, width, short strike, cost basis, legs, LEAP, PMCC, wide bid and ask, 200-day average, extrinsic value, ex-dividend, assignment) is a **tap-or-focus button** that inserts a one-line meaning inline below the line (no positioned popup, so it never conflicts with the fixed chart-popup spec); Escape closes it; the fold-out also lists every term used ("Words used here"), so it works with no interaction. One file holds the terms, with a test that every term has text.

**Accessibility:** the group is `role="group"` with `aria-label="Recommendation for {symbol} {strategy}"` (two MU rows differ); one visually hidden page-level `role="status"` region announces state changes ("MU put spread: Checking stop level"), present from first render, no per-second countdown; the Refresh button is named per row and uses `aria-disabled` while refreshing; the fold-out summary has a hidden " for {symbol}" suffix; `.btn` and Refresh have visible focus and a 32px minimum height; faint text tokens are verified against `#171717` (the mock's tokens pass; verify the app's real `th.textFaint`).

**Labels:** the mock's `S` array is the single label table. Internal action to visible label: `HOLD` "Hold"; `CLOSE_PROFIT` "Take profit"; `CLOSE_STOP` "Stop level reached" (with O19: "Loss limit reached" when no stop order is working); `MAX_LOSS` "At maximum loss"; `EXPIRES_SOON` "Expires soon"; `CLOSE_BROKEN` "Stock has weakened"; `CLOSE_TIME` "Time limit reached (21 days)"; `ROLL` "Consider rolling"; `ACCEPT_ASSIGNMENT` "Expect assignment" (put) or "Close to assignment" (covered call); `NOT_JUDGED` "Not judged yet"; `BLOCKED` "No recommendation" (`STOP_PENDING_CONFIRMATION` "Checking stop level"; `VERIFY_PRICING` "Checking prices"). One standing line at the foot of the Positions workspace and the analysis dialog: "Guidance from TradeEdge rules. You decide; no orders are placed automatically." Each reason code maps to a plain-language sentence, in one file with a test that every code has one.

## DECIDE-0001D — Recommendation vs. action log

- Auto-recording every shown decision changes the contract of `lib/decision-review` (PI-0008C: "the trader alone chooses"; `types.ts:1-20`) and needs Paul's approval. Extend it with **additive fields only** (`TraderAction` gains CLOSE_TIME and BLOCKED equivalents; the evidence snapshot gains the `PositionDecision`).
- **Do not use the single-blob-per-user store** (`app/api/decision-reviews/route.ts:19-21`, read-modify-write, two-tab races) for one row per position, action and session; specify a new keyed store with retention and an idempotent write. Session calendar = NYSE trading days in one helper, tested for holidays and half days.
- **Attribution:** an action counts against a decision if it happens on the same position within 3 trading sessions after it was shown, else `no_action`, never dropped; matching uses closed-trade and lifecycle data (`outcomeAnalysis.ts`), including rolls that change `Position.key`. `BLOCKED` rows are kept apart and excluded from agreement stats.
- **The price-at-close and price-at-expiry capture lives here** (and the CUT-LOSSES-REVIEW-0001 capture fields: symbol, DTE, strike distance, P/L %, intent), one capture path.
- Performance page: agreement rate by rule and by confidence; P&L of recommendations followed versus overridden.

## Separate tickets (not part of this approval)

**DECIDE-0001C — AI explains the decision.** The three advisor routes analyze scan candidates and LEAPS contracts, not open positions, and AI-POLICY D2 freezes them as-is. So this is a **new open-position explanation route** under the AI-POLICY gateway pattern; the position-analysis prompt (`page.tsx:2060-2090`) and `projectCanonicalRecommendationForAi` are the touchpoints. Prerequisites before any code: Paul adds a D2 row in `docs/tickets/AI-POLICY-0001-epic.md`; **Ian** makes a versioned change to the D9 lexicon (`lib/ai-policy/lexicon.ts`) with a test that the exception admits only the enum action; Alan confirms D8 (no numbers in prose) and the exact-match enum check fit the gateway. The server compares the AI's action to the input by exact enum match and on a mismatch discards the AI text and logs a dissent, shown only inside the collapsed detail under "The assistant sees this differently". **The screener's `disclosure` field is not removed** (about ten consumers depend on it).

**DECIDE-0001E — Finnhub news and analyst actions.** `FINNHUB_API_KEY` as a server-only variable (never `NEXT_PUBLIC_`, SEC-0001), cached per symbol; structured analyst ratings first; an AI classifier only for untagged headlines, capped at MEDIUM confidence until the log has enough classifications checked against Ian's sample; when the feed is down the fundamental signal is NE, never CLEAR. Deferred until the log has data.

**Sign-in expiry ("Later").** An expired session redirects to the sign-in page today (`PortfolioDataProvider.tsx:272-274`). Keeping the last view on screen needs the redirect stopped and the last recommendations stored; it is its own change, and "Last shown 10:42: Hold" is cut (it would show a stale Hold).

## Non-goals

No automated order placement. No change to scan qualification or scoring. No change to autopilot scope. No change to `GET /api/chart` behavior. No change to the LEAP dashboard for scan analysis. DECIDE-0002 items (ex-dividend assignment guard, earnings-before-expiry rule, PMCC short-leg column, CC Growth-mode upside test, the share decision on a broken CC).

## Acceptance criteria

1. Alan's golden fixtures pass (below), in integers.
2. **Property tests (fast-check):** (a) the same inputs give a deep-equal `PositionDecision` and the evaluator never reads the clock; (b) `acquisition` or `wheel` never yields `CLOSE_STOP` or `CLOSE_BROKEN` for any numeric input; (c) raising the mark never moves `CLOSE_STOP` to a less severe action; (d) `action === 'BLOCKED'` if and only if `confidence === null`.
3. A missing required input, unsupported economics, a stale quote after one refresh, or unavailable cover data returns `BLOCKED`, never `HOLD`.
4. Every consumer of `action` and `confidence` fails the build if a case is missing. This is a compile-time guarantee only. Verification requires `tsc` with `tsconfig.check.json` **and** a real `next build`.
5. The UI branches on `reasonCode`, follows the approved mock, shows no red for any action or state, never shows an enum name, and every visible label appears in the mock's `S` array.
6. **Intent:** an Acquire or Wheel CSP or CC never receives `CLOSE_STOP` or `CLOSE_BROKEN`, an Income CSP at the same numbers does, and the test runs against the live adapter output.
7. **Cutover:** a position never shows two different actions (card and priority queue agree); S2's disagreement list is approved by Ian; no spurious snapshot "recommendation changed" events fire.
8. **Data:** the history endpoint serves 201+ complete bars and volume; `GET /api/chart?symbol=X` is unchanged and `RsiLine.test.tsx` passes unmodified.
9. The log de-duplicates, records `no_action`, excludes pending-stop rows from agreement stats, and uses a keyed, idempotent store.
10. **A missing recommendation never shows "Hold".**
11. **A bought option never shows Take Profit or Cut Losses** (long call, long put and debit spread each get "Not judged yet").
12. **A working profit-target order never hides a stop, maximum-loss or expires-soon state.**
13. **Text limits (reason 110, changes-if 72, notes 72, numbers 90) hold for every state.**
14. Each slice passes `tsc` with `tsconfig.check.json`, its affected tests, and a real `next build`; S3-1, S3-A, S3-B and S3-C also need the full suite.

## Golden fixtures (Alan; verified in python3)

| Area | Cases |
|---|---|
| Stop (cents) | BPS 5-wide C 1.67: mark 3.33 no fire / 3.34 `CLOSE_STOP`; C 1.00: 1.99 / 2.00; 5-wide C 2.50 and 2.51 flagged (rule 2 dormant), max loss $250 and $249; 10-wide C 2.51 no flag; IC 5/5 C 2.60 both wings flagged; IC 10/10 C 3.50 no flag; IC put 5 / call 10 C 3.00 put wing only; a 3x policy on a 5-wide with C 1.70 is unreachable (S 5.10), with C 1.60 reachable (4.80) |
| Stop confirmation (production semantics, RELIABLE quote unless stated) | Mid ≥ trigger at 09:40 and 09:50: CONFIRMED; at 09:40 and 09:45:00 (300,000 ms): CONFIRMED; at 09:40 and 09:44:59: one reading, VERIFY_STOP; only the current reading: `BLOCKED` / `STOP_PENDING_CONFIRMATION` (does not fire at once); DEGRADED with mid ≥ trigger at two readings 5 minutes apart: CONFIRMED; DEGRADED with ask ≥ trigger but mid < trigger at t0, t0+5, t0+10, t0+15: never confirmed (at t0+15 the deferred "unclear" state); mid at 99% of trigger between two breaches: streak survives; 97.9%: streak resets; yesterday's precise breach plus today's: CONFIRMED (Ian to confirm); date-only snapshots never count |
| Relative spread (quote quality) | Production thresholds: net width 0.15 of mid, per leg $0.50 (`classifyQuoteQuality`); fixtures come from there. The earlier 0.25-of-mid fixtures are removed. |
| Maximum loss and expires soon | Put spread 7 DTE, S = 1.02·K: expires soon; 8 DTE no; S = 1.03·K no; call `100·S_c ≥ 98·K_c` at K 85.00: S 83.30 fires, 83.29 no; both strikes in the money, 5-wide, mark 4.90 with stop passed: `MAX_LOSS` "stop passed"; mark 4.89: stop only; mark 4.90 with a 3x policy and C 1.80 (S 5.40): `MAX_LOSS` **without** "stop passed"; mark 5.00 at 6 DTE: `MAX_LOSS` beats expires soon; IC 5 / 10 with a 5.5 mark from the 10-wide wing: no `MAX_LOSS`; trusted policy absent, mark 4.90: `MAX_LOSS` only after 2 readings; covered call at 2 DTE ITM: "Close to assignment", never a close suggestion; Acquire or Wheel put at 4 DTE $0.40 from the strike: "Expect assignment" |
| Profit | 49.99% / 50.00% for IC, CSP and CC; and at one non-default target (for example 30%) |
| 21 DTE | 22 / 21; P&L 0.00 (`CLOSE_TIME`); −0.01 with rollNet 0.10 (`ROLL`); −0.01 with rollNet 0.09 (`CLOSE_TIME`); entry DTE ≤ 21 (rule skipped); CSP and CC: no 21-DTE rule |
| Fees and roll cost | IC tested side, 4 legs, f = $1: mid gap 0.17 gives rollNet 0.13, qualifies; IC both sides 8 legs: 0.17 gives 0.09, no; 0.18 gives 0.10, yes; CSP 2 legs: 0.10 gives 0.08, no. Put spread C 1.65, 570/565, r 0.14: 570/565 roll C' 1.79, BE 568.21, max loss $321; 568/563: BE 566.21, $321; 568/558 (10-wide): $821 (+$486); r 0.10: C' 1.75, BE 568.25, $325; call spread 580/585 to 582/587: BE 583.79, $321; 2 contracts ×2 |
| CC roll | `c0` 90c, DTE0 30, ΔDTE 30: rollNet 90c no roll (equal), 91c roll; rollNet 95c with DTE_old 5, DTE_new 35: roll (ΔDTE 30) |
| Short delta | 0.4999 / 0.50; IC with only the call side breaching; a winner at delta 0.50 follows profit or time, not delta; a loser at delta 0.50 with no roll is `HOLD` with a delta note (never `CLOSE_STOP`) |
| Broken gate B′ (BPS, C 1.65, delta 0.20, 30 DTE, stop 3.30, broken stock) | mark 1.65 (P&L 0): `HOLD` under both; mark 1.66: any-loss `CLOSE_BROKEN`, B′ `HOLD`; mark 2.47: any-loss `CLOSE_BROKEN`, B′ `HOLD` (bid+ask 494 < 495); mark 2.475 (bid 2.45, ask 2.50, exactly 1.5·C): both `CLOSE_BROKEN`; mark 2.48: both; mark 1.66 with delta 0.30: both `CLOSE_BROKEN`; mark 1.60 with delta 0.35 and a 3% winner: `HOLD` under both; mark 3.30: `CLOSE_STOP` first |
| Confidence | Short delta 0.5499 LOW, 0.5500 HIGH, HOLD 0.4501 LOW, 0.4500 HIGH; LEAPS delta 0.5401 LOW, 0.5400 HIGH, HOLD 0.6599 LOW, 0.6600 HIGH; LEAPS DTE 163 / 162 and 197 / 198; support close at 0.979·S LOW vs 0.98·S; volume 1.64x LOW, 1.65x not LOW; the mechanical rules show "Rule met" and `HOLD` shows none |
| Trend | one close below ma200 (no fire); two closes with ma50 ≥ ma200 (no fire); two closes with ma50 < ma200 (fire); already true at entry (context, not counted); 200 bars NE / 201 evaluable |
| Gap | ADM 2.67%: gap −8.00% no fire, −8.01% fires; ADM 3.5%: gap exactly −10.5% (O = 0.895·C) fires; ADM 2.00%: −8.00% fires, −7.99% no; C_prev 100, O 90, R 95, closes 93, 94.99, 92, 91, 90 fires; one close 95.00 no fire; n = g+3 with none ≥ R PENDING, with one ≥ R CLEAR (cannot fire); a fired gap: one close ≥ R keeps it FIRED at LOW, two consecutive closes ≥ R clears it, it does not re-fire; gap at n−19 evaluated, n−20 out; 20 prior closes NE; two gap days: fire if either qualifies |
| Support | S 37.55: close 37.17 fires / 37.18 no; volume prior sum 2000: v 150 fires / 149 no; a volume that fires only if today is included must not fire; any missing `v` NE; split after entry NE |
| Relative weakness | SPY flat, stock 100 to 85.00 fires / 85.01 no; SPY missing `t[n−20]` NE; SPY offset one day NE; firing alone gives `broken = false` |
| Applicability | BCS never `CLOSE_BROKEN`; IC with only the call side weak is not broken; IC broken closes 4 legs |
| Intent (CSP, C 1.00, delta 0.30 unless stated) | `income` mark 2.00: `CLOSE_STOP`; `acquisition` and `wheel` mark 5.00: `HOLD` with "Down $400; that is 4.0 times the $100 you collected"; delta 0.50: `ACCEPT_ASSIGNMENT` (never `ROLL`); mark 0.50: `CLOSE_PROFIT`; broken stock with delta 0.30: `HOLD` with the broken note; `income` and broken: gated `CLOSE_BROKEN`; missing intent on a lone put: `acquisition`, shown "default, not chosen", reason "treated as Acquire"; missing intent on a CC: `income`; a CC with any intent never `CLOSE_STOP` or `CLOSE_BROKEN`; a PMCC short call never either |
| Bought options (U) | long call, long put, debit spread each `NOT_JUDGED`; a short call is never classified as bought; ≤ 7 DTE and in the money by $0.01: the automatic-exercise note; `hitTarget` true: "Your profit target was reached" |
| Data | missing mark `BLOCKED`; stop decided on mark and credit while delta is missing (`CLOSE_STOP`); unsupported economics `BLOCKED`; `structureAmbiguous` `BLOCKED`; missing recommendation shows "No recommendation" |
| Working order | a working profit-target GTC: note only, action unchanged; a stop met with a working order: stop still shows |
| Cover detection (later) | 200 shares, 2 contracts: covered; 150 shares, 2 contracts: 1 of 2 uncovered; 100 shares in another account only: uncovered here (with the wording note); capacity unavailable: `BLOCKED` `NO_COVER_DATA`; long call K 200 later expiry, short K 210: cover; long K 210 = short K 210, later expiry: cover, not a PMCC pair; long K 220 > short K 210: not cover; a long that is a leg of a debit spread in the same Position: not eligible; 2 shorts (different expiries), 1 long: first covered by allocation order, second uncovered; a pending sell-call order reserving 100 shares: the existing call stays covered |
| Fallback stop (only if Dean asks) | 5-wide C 2.49 mark 4.97: normal stop not fired, fires at 4.98; C 2.50 mark 3.99 / 4.00 fallback no / yes ($150 loss); C 2.51 ($149); C 3.00 ($100); C 3.99 mark 4.00 ($1: Ian to say whether silly); C 4.00 and C 4.50: flag only; 10-wide C 4.00: normal stop at 8.00, fallback never used; 10-wide C 5.10: fallback at 8.00 ($290); never for a CSP or CC; IC per wing |
| Phase 0 | 2y fixture ≥ 201 complete bars with `v`; partial bar (14:00 NY, last bar dated today) dropped; last bar after `regular.end` + 15 min kept; null-close bar dropped; NVDA 2024-06-10 split shows no gap (−0.43%); KO 2y `c[0] = 71.40`; entry 2026-07-06T14:15Z: S window 2026-06-04 to 2026-07-02; entry 2026-07-07T01:00Z: same (NY date 07-06); entry 2026-11-27: window ends 2026-11-25; entry-day low excluded; low on the 21st prior session excluded; a second evaluation leaves a reconstructed S unchanged; no entry date NE |

## Open items

| # | Item | Owner | Status |
|---|---|---|---|
| O1, O10 | Diane's calm-presentation mock, rendered for Dean | Diane, then Dean approves | Mock revision 5 published; Dean to approve |
| O2 | Stop wiring file | Dane | Answered: `lib/portfolio/stopLossPolicy.ts` + the live engine |
| O3 | N and X for the news classifier cap | Ian | Deferred with 0001E |
| O4 | AI-POLICY D2 row (Paul), D9 lexicon change (Ian) | Paul, Ian | Deferred with 0001C |
| O5, O6 | Hard loss limit for Acquire and Wheel; default Acquire | Ian, Dean | **Resolved** |
| O7 | Cutover map | Paul, Dane | Written above; Dane confirms in G6 |
| O8, O9 | Price basis; reconstructed entry support | Alan | **Resolved** |
| O11 | LEAPS long-leg policy, the short-call guard, delta source | Ian | Deferred to its own ticket |
| O12 | Support-break and volume bands; gap clearing; whether an unreachable stop needs more | Ian | **Resolved** (bands and clearing above); the fallback is deferred (O14) |
| O13 | Acquire and Wheel protection in the live engine | Dean, Ian | **Done 2026-09-25** |
| O14 | Fallback stop for an unreachable stop | Alan, Ian, **Dean** | **Deferred by Paul; not built unless Dean asks** |
| O15 | Wide-quote "unclear" state and where intraday readings are stored | Alan, Quinn | Deferred; production semantics stay |
| O16 | Data for the new states | Quinn, Paul | Answered in the coverage section; adapter details in S2 |
| O17 | Broken-stock gate: any loss versus B′ | **Dean** | Ian and Alan recommend B′; **Dean decides** |
| O18 | Cover detection for V and W | Alan, Quinn | Spec written; later slice |
| O19 | A position at twice the credit with no TradeEdge stop order | **Dean**, Ian | Recommended: "Loss limit reached" with a note |
| O20 | Covered-call net line: shares since the call was sold | **Dean** | Recommended: since sold; later slice |
| O21 | A "covered elsewhere" record for V | Quinn, Ian | Open; later slice |
| O22 | Cross-day stop confirmation intended? "Expires soon" beats a roll at 7 DTE or less? | Ian | Open |

## Review gates

| Gate | Reviewer | Result |
|---|---|---|
| G1 | Ian | Revision 2 and the mock reviews (three passes): approve with changes, folded in; revision 5 re-review done, folded in; O19 and O22 open |
| G2 | Alan | Revision 2 and revision 5: approve with changes, folded in; fixtures for revision 6 to write |
| G3 | Quinn | Revision 2: do not build yet; revision 5: do not build S3 yet (five problems), folded in |
| G4 | Paul | Approved Phase 0, 0001A, S3-0; slice plan adopted here; the rest slice by slice |
| G5 | Diane | Spec, then the revision 4 mock review: approve with changes, folded into mock revision 5 |
| G6 | Dane (developer) | Started after this revision; runs last |

Dean is the sponsor and final decision-maker for every open item.
