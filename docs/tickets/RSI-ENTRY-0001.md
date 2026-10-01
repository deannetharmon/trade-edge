# RSI-ENTRY-0001 — Daily RSI "turn up off a dip" entry gate, override, and watch

Status: v6 (2026-10-01). Reconciled with RSI-TURN-0001 after the v5 push. Approved by Ian, Alan, and Quinn. Paul to re-confirm the changes from v5 (gate ships default Off, sequencing after LEV-0001 Gate 10). NOT ready to hand to Dane until Paul re-confirms.
Owner: Dane (build) | Reviewers: Ian (rules), Paul (scope and sequencing), Alan (RSI math), Quinn (QA), Diane (receipt and confirm-line copy)
Supersedes: v1 to v5 of this ticket (v5 was committed as 91e97ce).

## Problem
Dean wants to enter premium-selling trades as RSI starts to rise off a dip: not while the stock is still falling, and not after the bounce has run. The app already classifies RSI turns (RSI-TURN-0001, information only, in the chart popups and order windows), but scan results do not use it, so the screener cannot tell a good-timing trade from a poor-timing one and cannot wait for a better entry. TastyTrade order calls are browser-side only (Vercel server IPs blocked, token ~15 min), so the app cannot send orders unattended.

## Relationship to RSI-TURN-0001 (reconciliation)
- `lib/indicators/rsi.ts` (`rsiSeries`, Wilder RSI) and `lib/indicators/rsiTurn.ts` (`rsiState`, `RSI_TURN_PARAMS`) already exist, are live in the quick-chart popup and order windows, and carry Alan's validated spec and fixtures. This ticket REUSES them. It adds no second RSI implementation.
- RSI-TURN-0001 is information only ("never a gate") with provisional thresholds. This ticket adds a gate on Best Opportunity eligibility, which Ian must rule on, and ships it default Off until the thresholds have evidence behind them.
- `RSI_TURN_PARAMS` and every existing RSI consumer (popups, order windows, `lib/wheel/candidateRank.ts` if it uses the helpers) stay unchanged. The gate gets its own parameter constants.

## Approach
RSI is a timing gate on Best Opportunity eligibility, not a score component. A trade that fails the gate stays visible, tradeable, and labelled "Wait", with its score and order unchanged. The gate can be switched off, and any Wait trade can be taken anyway. Wait trades can be armed: the server watches daily RSI after the close and alerts Dean when the trade becomes a good entry. Dean opens TradeEdge, the scan re-runs on the live chain, and Dean places the order himself. The server never touches TastyTrade and never places orders.

## Gate rule (reuses the existing state function; values adjustable in scan controls)
Indicator: `rsiSeries(closes)` then `rsiState(series, params)` from the existing modules, daily bars. A new file `lib/indicators/rsiEntryGate.ts` holds only the gate parameters and the Pass/Wait mapping with reasons.

CSP (sell puts) params: `{ low: 40, high: 70, window: 8, lift: 3, mid: 50 }`.
- PASS = state is TURNING_UP, which means all of: the lowest RSI in the last 8 values is at or below 40 (the dip); the latest RSI is at least 3 points above that low (the lift); the latest RSI is below 50 (not chased); and the latest RSI is higher than the prior bar, which is higher than the bar before (two consecutive rises).
- Otherwise WAIT, with the reason computed from the same 8-value window:
  - "No dip": the window low is above 40.
  - "Still falling": a dip, but the latest RSI is less than 3 points above the window low (the existing OVERSOLD_NO_TURN state).
  - "Turn not confirmed": a dip and a lift of 3 or more, below 50, but not two consecutive rises.
  - "Bounced": a dip, but the latest RSI is already 50 or higher.

CC (sell calls) mirror, params: `{ low: 30, high: 60, window: 8, lift: 3, mid: 50 }`.
- PASS = state is TURNING_DOWN: the highest RSI in the window is at or above 60, the latest is at least 3 points below that high, the latest is above 50, and there are two consecutive falls.
- WAIT reasons: "No peak", "Still rising", "Turn not confirmed", "Faded".

Boundaries follow the existing code exactly: a window low of exactly 40 counts as a dip (at or below); a lift of exactly 3 counts; a latest RSI of exactly 50 fails the ceiling (strictly below 50); rises and falls are strict (a flat bar breaks the run). Boundary tests must pin all of these.

Dip level (40) and the CC peak level (60) are scan controls. Window, lift, and ceiling are advanced controls with the defaults above.

Missing data: fewer closes than `rsiSeries` and the 8-value window require, or any non-finite value, fails closed. The candidate stays visible, labelled "RSI unavailable", and cannot be Best Opportunity while the gate is On (consistent with CSP-IVR-0001).

## Data (Alan)
- Use the same daily closes the chart popups use (about 90 bars). Alan's validated spec: 90 closes is enough (seed influence 0.39%, last-bar difference at most 0.15 RSI points), so the screener and the popup agree. The v5 requirement of 100 closes is withdrawn.
- OPEN, Alan to verify before build: whether the chart endpoint returns split-adjusted closes and not dividend-adjusted closes (to match TradingView's default). Do not assume.
- Completed bars only. The popups do not keep bar timestamps today (RSI-TURN-0001 open item, "live-bar timestamp fix"). That fix is a PREREQUISITE. Interim rule if the gate must run before it lands: drop a bar dated today while the market is open, so the gate does not flicker intraday.

## Override (Ian approved)
Two layers; neither touches the order path.
1. Scan-level switch: "RSI timing gate: On / Off" in the scan controls beside the thresholds. First release ships default OFF for CSP and CC. After Ian's pass-rate check is shared and Paul confirms, the default flips to On (a one-line default change, not a new release of logic). Off means no Wait labels and no RSI restriction on Best Opportunity, so the scan behaves exactly as it does today. Consistent with "trust the qualified realm": criteria change through scan controls.
2. Per-trade "Trade anyway": the gate never blocks placing an order. A Wait trade stays tradeable, like a short put outside the delta band. When Dean takes a Wait trade, the order screen shows one confirm line with the RSI state (for example "Wait: RSI 58, no dip"); it is a visible note, not a second hurdle.

Rules for the override:
- The last-used setting persists, and the "Active rules" receipt always shows whether the gate is On or Off, so a stale setting cannot hide.
- Taking a Wait trade writes an audit trail entry: "Entered with RSI gate = Wait (reason)", so the effect of bypassing the gate can be reviewed later.
- An override does not disarm or alter any watch on that ticker.

## Prerequisites and sequencing
1. LEV-0001 Gate 10 corrective round closes first (active work per docs/ROADMAP.md, 2026-10-01). This ticket does not start before that.
2. RSI-TURN-0001 live-bar timestamp fix (completed-bar rule above).
3. Phase A0 spike result (below).

## Scope

### Phase A0 — Fetch design spike (before any gate code)
- RSI was kept off scan result cards because it needs about 90 daily bars per candidate. Measure the real cost on a typical CSP and CC scan, and design a batched, cached, deduplicated bar fetch (Alan sizes it; Dane implements the measurement). Output is a short doc, no gate code. Quinn reviews failure handling: one failed fetch marks that row "RSI unavailable" and never breaks the scan.
- Dane has not yet confirmed the scan's data path for bars; the spike names the endpoint.

### Phase A — Gate, override, and receipt (needs Paul re-confirmation; Ian ruling recorded below)
- `lib/indicators/rsiEntryGate.ts`: parameters and the Pass/Wait mapping with reasons, built on the existing `rsiSeries` and `rsiState`. No named exports added to page.tsx files; logic stays in `lib/`.
- Gate applies to CSP and CC results ONLY (both already on the scan registry). PMCC, LEAPS, and Spreads are not gated in this ticket; PMCC picks the gate up in its registry migration. Spreads last.
- WAIT trades remain in the list, keep their score and order, show the reason label, and cannot be Best Opportunity while the gate is On.
- Scan controls: gate On/Off, dip level (40), CC peak level (60), and advanced window, lift, and ceiling.
- "Active rules" receipt shows the applied RSI rule, gate On/Off, and the pass count ("N of M pass"), so an empty Best Opportunity slot is not mistaken for a bug.
- Confirm line on the order screen for Wait trades, and the audit trail entry.

### Phase B — Watch and alert (starts after Phase A ships and the pass-rate check is reviewed)
- One-tap "Watch" on a WAIT row arms the ticker with strategy, thresholds, and any price or IV rank guards from the scan. Manual arming only in this ticket.
- Armed rules stored in Redis keyed by Google OAuth user ID, with the last evaluated state per rule.
- A Vercel Cron route runs once per weekday after the close, scheduled in UTC late enough to be after 4:00pm ET in both daylight and standard time (for example 22:30 UTC). It evaluates armed rules on completed daily bars using the same RSI modules, skips if the newest bar is not the latest completed session (holidays, half-days, data lag), and is idempotent (a double fire the same day sends one alert).
- It alerts Dean when a rule newly turns PASS. One alert per transition; re-arms after the rule returns to WAIT.
- Alert channel: email first (Dane confirms existing notification plumbing before building). Push and SMS are later tickets.
- Alert contains ticker, RSI and direction, last close, and a deep link that opens the screener on that ticker and re-runs the scan on the live chain, so strikes and credit are fresh when Dean decides.
- The cron route never calls TastyTrade and never places orders. Vercel Hobby cron timing is imprecise within the hour, which is fine for a post-close check; verify the current plan.

## Pre-ship check (Ian's condition for flipping the default to On)
Dane runs a historical pass-rate check on a handful of tickers (AAPL, MRVL, plus several from Dean's usual universe), comparing a dip level of 30 against 40, showing how often the gate passes and what RSI and price did next. Ian reviews it before the default flips to On. Thresholds remain provisional per RSI-TURN-0001 until calibrated against Dean's Trade Log (about 30 to 40 entries per strategy).

## Earnings (clarification, replaces the v5 "known gap")
A missing earnings date passing the earnings check is Ian's ruling of 2026-09-24 (EARNINGS-NO-DATE-0001, draft, covers the ambient caution tag). This ticket does not change any earnings check. An RSI Pass does not imply earnings safety; the existing earnings gates still apply as they do today.

## Out of scope (separate future tickets)
- Armed auto-entry or auto-adjustment of resting orders from the browser tab (needs heartbeat indicator, price and credit floor, size cap, confirm step; unreliable on iPad Safari).
- Moving order submission off Vercel to an unblocked host (architecture and security review).
- RSI as a score component.
- Gating PMCC, LEAPS, and Spreads.
- Changing `RSI_TURN_PARAMS`, the popups, the order-window RSI lines, or any other existing RSI consumer.
- Push and SMS alerts; portfolio-candidate auto-arming.

## Decisions made by the team (Dean can veto)
1. Reuse the RSI-TURN-0001 modules; gate parameters: dip level 40, CC peak 60, window 8, lift 3, ceiling 50, two consecutive rises.
2. Gate ships default Off, flips to On after Ian's pass-rate check and Paul's confirmation.
3. Alert channel: email first.
4. Watch sources: manual arming only.
5. Cron: once daily after the close.

## Acceptance criteria
- The gate calls the existing `rsiSeries` and `rsiState`; there is no second RSI implementation. `RSI_TURN_PARAMS` and its existing tests are unchanged and green (test proves popup and order-window behavior is unchanged).
- Gate truth table verified for CSP and CC with golden fixtures from Alan, including the exact boundaries: window low exactly 40, lift exactly 3, latest RSI exactly 50, a flat bar in the rise run.
- Each WAIT reason ("No dip", "Still falling", "Turn not confirmed", "Bounced" and the CC mirrors) is produced by a fixture.
- WAIT trades keep their score and order; only Best Opportunity eligibility changes (test proves it).
- With the gate Off, scan results and Best Opportunity are identical to today (snapshot test proves it). The default at first release is Off.
- A Wait trade can always be placed; the order payload is byte-identical with the gate On and Off (test proves it); the order screen shows the confirm line, and the audit entry is written.
- Insufficient or invalid closes yield "RSI unavailable" for that candidate only, fail closed while the gate is On, and never break the scan (test with one failed fetch among several).
- Bar fetches are cached and deduplicated per the Phase A0 design.
- Receipt shows the applied RSI rule, gate On/Off, and the pass count.
- An armed rule alerts exactly once per transition to PASS and re-arms after returning to WAIT; a double cron fire sends one alert; a holiday or stale-data day sends none.
- No TastyTrade call and no change to the order submission path by any code in this ticket.
- Vercel preview build passes (`next build`); CI runs the type check and full suite. Because this touches eligibility, a shared module, and sits next to order paths, run the full suite and verify the preview of FIND CSPs and FIND CCs.

## Tests
- Unit: gate mapping and reasons, boundary cases, gate Off equivalence, override leaves the order payload unchanged, watch transition and re-arm state machine, cron idempotency and holiday skip, fail-closed per candidate.
- Existing screener and RSI tests unchanged and green.

## Risks
- Provisional thresholds: Alan's values were set for an information display, and moving the dip level from 30 to 40 widens the pass set. Mitigated by default Off and the pass-rate check.
- Fetch cost and rate limits at roughly 90 bars per candidate (Phase A0).
- Intraday flicker if the completed-bar fix is skipped.
- Daily RSI lags: a fast gap (like AAPL on Oct 1) can move price well before the next completed bar updates the gate. The gate improves entry timing but does not replace the protective stop.
- On a strong tape few tickers pass; the pass count in the receipt makes this visible.
- A forgotten Off or On setting hides or applies the gate silently; mitigated by the receipt always showing its state.
- Yahoo daily data gaps or symbol mapping (see YAHOO_INDEX_MAP for indices).

## Sign-off
v5 sign-offs (2026-10-01) are superseded by the v6 review below.

v6 review (2026-10-01):
- Alan (math and architecture): APPROVED with changes. Reuse `rsiSeries` and `rsiState`; boundaries follow the existing code; 90 closes, withdrawing the v5 figure of 100; golden fixtures at a dip level of 40; verify close adjustment before build; completed-bar prerequisite, with the interim drop-today's-bar rule.
- Ian (rules): APPROVED with changes. Gate on Best Opportunity eligibility is a qualification change and is approved, shipping default Off until the pass-rate check (30 versus 40) is shared; keep Alan's two-rise and lift-of-3 confirmation; CC mirror at 60; earnings wording corrected to his 2026-09-24 ruling.
- Quinn (QA): APPROVED with changes. Gate has its own parameter constants and existing consumers stay unchanged (test); boundary, gate-Off snapshot, and byte-identical order payload tests; per-candidate fail-closed with cached, deduplicated fetches; Phase A0 spike before gate code; full suite plus FIND CSPs and FIND CCs preview check.
- Paul (scope and sequencing): RE-CONFIRMATION PENDING for default Off at first release, sequencing after LEV-0001 Gate 10, and the Phase A0 spike. His v5 approval covered default On and no spike.
- Diane: receipt and confirm-line copy still to be reviewed before Phase A build.
