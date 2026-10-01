# RSI-ENTRY-0001 — Daily RSI "turn up off a dip" entry gate, override, and watch

Status: APPROVED for build (2026-10-01) by Ian, Paul, Alan, Quinn, with the conditions recorded in Sign-off below. Ready to hand to Dane.
Owner: Dane (build) | Reviewers: Ian (rules), Paul (scoring sign-off), Alan (RSI math), Quinn (QA), Diane (receipt and confirm-line copy)

## Problem
Dean wants to enter premium-selling trades as RSI starts to rise off a dip: not while the stock is still falling, and not after the bounce has run. Today TradeEdge shows no RSI, cannot tell good timing from poor timing, and cannot wait for a better entry. TastyTrade order calls are browser-side only (Vercel server IPs blocked, token ~15 min), so the app cannot send orders unattended.

## Approach
RSI is a timing gate on Best Opportunity eligibility, not a score component. A trade that fails the gate stays visible, tradeable, and labelled "Wait", with its score and order unchanged. The gate can be switched off, and any Wait trade can be taken anyway. Wait trades can be armed: the server watches daily RSI after the close and alerts Dean when the trade becomes a good entry. Dean opens TradeEdge, the scan re-runs on the live chain, and Dean places the order himself. The server never touches TastyTrade and never places orders.

## Gate rule (defaults, all adjustable in scan controls)
Indicator: daily RSI(14), Wilder smoothing (seed with the simple average of the first 14 gains and losses, then recursive smoothing), COMPLETED daily bars only (no intraday repaint).

Data (Alan): fetch about one year of daily bars and use split-adjusted CLOSE, not dividend-adjusted close (matches TradingView's default so Dean's charts and the app agree). Require at least 100 closes; Wilder smoothing needs warm-up before it matches a chart.

CSP (sell puts) — PASS requires all three:
1. Dip: RSI closed below 40 at least once in the last 5 completed daily bars (window includes the latest bar).
2. Turn: latest RSI is higher than the prior day's RSI by more than the tolerance (default 1 point), confirmed over 1 day (confirmation days is a scan control; 2 days available).
3. Not chased: latest RSI is at or below 50.

Otherwise WAIT, with the reason shown:
- "No dip": RSI has not been below 40 in the lookback window.
- "Still falling": a dip is in progress; wait for the turn.
- "Bounced": RSI is already above 50.

CC (sell calls) — mirror image (adopted by the team as the default; tunable):
- Peak: RSI closed above 60 at least once in the last 5 bars; latest RSI lower than prior day's by more than the tolerance; latest RSI at or above 50.
- WAIT reasons: "No peak", "Still rising", "Faded".

Missing data (fewer than 100 daily closes): fails closed. Shown as a visible candidate labelled "RSI unavailable", cannot be Best Opportunity while the gate is On (consistent with CSP-IVR-0001).

Boundaries are explicit: RSI exactly 40 is NOT a dip (strictly below), RSI exactly 50 passes the ceiling (at or below), and a change exactly equal to the tolerance is NOT a turn (strictly greater).

## Override (Ian approved)
Two layers; neither touches the order path.
1. Scan-level switch: "RSI timing gate: On / Off" in the scan controls beside the thresholds. Default On for CSP and CC (Paul). Off means no Wait labels and no RSI restriction on Best Opportunity, so the scan behaves exactly as it does today. Consistent with "trust the qualified realm": criteria change through scan controls.
2. Per-trade "Trade anyway": the gate never blocks placing an order. A Wait trade stays tradeable, like a short put outside the delta band. When Dean takes a Wait trade, the order screen shows one confirm line with the RSI state (for example "Wait: RSI 58, no dip"); it is a visible note, not a second hurdle.

Rules for the override:
- The last-used setting persists, and the "Active rules" receipt always shows whether the gate is On or Off, so a stale Off cannot hide.
- Taking a Wait trade writes an audit trail entry: "Entered with RSI gate = Wait (reason)", so the effect of bypassing the gate can be reviewed later.
- An override does not disarm or alter any watch on that ticker.

## Scope

### Phase A — Gate, override, and receipt
- lib/indicators/rsi.ts: Wilder RSI(14) series from daily closes (Yahoo, same source family as getTrend), plus the dip/turn/not-chased evaluation.
- Gate applies to CSP and CC results ONLY (both already on the scan registry). PMCC, LEAPS, and Spreads are not gated in this ticket; PMCC picks the gate up in its registry migration. Spreads last.
- WAIT trades remain in the list, keep their score and order, show the reason label, and cannot be Best Opportunity while the gate is On.
- Scan controls: gate On/Off, dip threshold (40), ceiling (50), CC peak (60), lookback (5 bars), tolerance (1 point), confirmation days (1).
- "Active rules" receipt shows the applied RSI rule, gate On/Off, and the pass count ("N of M pass"), so an empty Best Opportunity slot is not mistaken for a bug.
- Confirm line on the order screen for Wait trades, and the audit trail entry.
- No named exports added to page.tsx files; logic stays in lib/.

### Phase B — Watch and alert (starts after Phase A ships and the pass-rate check is reviewed)
- One-tap "Watch" on a WAIT row arms the ticker with strategy, thresholds, and any price or IV rank guards from the scan. Manual arming only in this ticket.
- Armed rules stored in Redis keyed by Google OAuth user ID, with the last evaluated state per rule.
- A Vercel Cron route runs once per weekday after the close, scheduled in UTC late enough to be after 4:00pm ET in both daylight and standard time (for example 22:30 UTC). It evaluates armed rules on completed daily bars, skips if the newest bar is not the latest completed session (holidays, half-days, data lag), and is idempotent (a double fire the same day sends one alert).
- It alerts Dean when a rule newly turns PASS. One alert per transition; re-arms after the rule returns to WAIT.
- Alert channel: email first (Dane confirms existing notification plumbing before building; if none exists, email is still the smallest build). Push and SMS are later tickets.
- Alert contains ticker, RSI and direction, last close, and a deep link that opens the screener on that ticker and re-runs the scan on the live chain, so strikes and credit are fresh when Dean decides.
- The cron route never calls TastyTrade and never places orders. Vercel Hobby cron timing is imprecise within the hour, which is fine for a post-close check; verify the current plan.

## Pre-ship check (Ian's condition)
Dane runs a historical pass-rate check on a handful of tickers (AAPL, MRVL, plus several from Dean's usual universe) showing how often the gate passes and what RSI did next, and shares it before the gate ships with the default On.

## Known gap, separate ticket (not in this scope)
The earnings check passes when no earnings date is on file (CC and CSP). An RSI dip is often earnings-driven, so a trade can show PASS on RSI with earnings close by when the date is missing. Until that is fixed, check earnings manually on trades with no date on file.

## Out of scope (separate future tickets)
- Armed auto-entry or auto-adjustment of resting orders from the browser tab (needs heartbeat indicator, price and credit floor, size cap, confirm step; unreliable on iPad Safari).
- Moving order submission off Vercel to an unblocked host (architecture and security review).
- RSI as a score component.
- Gating PMCC, LEAPS, and Spreads.
- Push and SMS alerts; portfolio-candidate auto-arming.

## Decisions made by the team (Dean can veto)
1. Thresholds and window: dip below 40, ceiling 50, CC peak 60, 5-bar lookback, 1-point tolerance.
2. Confirmation: 1 day by default (daily RSI already lags; a second day costs most of the premium advantage), 2 days available as a scan control.
3. Gate default On for CSP and CC.
4. Alert channel: email first.
5. Watch sources: manual arming only.
6. Cron: once daily after the close.

## Acceptance criteria
- RSI(14) matches a published reference series to two decimals for at least one fixture, and matches TradingView's daily RSI for a real ticker on a sample date.
- Gate truth table verified for CSP and CC across no dip, dip in progress, turn, and bounced cases, including the exact boundaries (40, 50, tolerance equal to change, flat RSI).
- WAIT trades keep their score and order; only Best Opportunity eligibility changes (test proves it).
- With the gate Off, scan results and Best Opportunity are identical to today (snapshot test proves it).
- A Wait trade can always be placed; the order payload is byte-identical with the gate On and Off (test proves it); the order screen shows the confirm line, and the audit entry is written.
- Fewer than 100 closes yields "RSI unavailable" and fails closed while the gate is On.
- Receipt shows the applied RSI rule, gate On/Off, and the pass count.
- An armed rule alerts exactly once per transition to PASS and re-arms after returning to WAIT; a double cron fire sends one alert; a holiday or stale-data day sends none.
- No TastyTrade call and no change to the order submission path by any code in this ticket.
- Vercel preview build passes (next build); CI runs the type check and full suite. Because this touches eligibility and sits next to order paths, run the full suite and verify the preview of FIND CSPs and FIND CCs.

## Tests
- Unit: RSI calculation (reference fixture, flat series, short series, warm-up length), gate truth table with boundaries, gate Off equivalence, override leaves order payload unchanged, watch transition and re-arm state machine, cron idempotency and holiday skip.
- Existing screener tests unchanged and green.

## Risks
- Yahoo daily data gaps or symbol mapping (see YAHOO_INDEX_MAP for indices).
- Daily RSI lags: a fast gap (like AAPL on Oct 1) can move price well before the next completed bar updates the gate. The gate improves entry timing but does not replace the protective stop.
- A one-day RSI uptick can reverse; see decision 2.
- On a strong tape few tickers pass; the pass count in the receipt makes this visible.
- A forgotten Off switch hides the gate; mitigated by the receipt always showing its state.

## Sign-off (2026-10-01)
- Ian (rules): APPROVED. Gate not score; override two-layer; CC mirror adopted. Condition: pass-rate check shared before default-On ships.
- Paul (product and scoring): APPROVED. Eligibility change and override accepted. Conditions: gate default On for CSP and CC; Phase A ships first, Phase B after; PMCC, LEAPS, Spreads not gated in this ticket.
- Alan (math and architecture): APPROVED. Conditions: Wilder seeding as specified; at least 100 closes; split-adjusted close, not dividend-adjusted; completed bars only; cron in UTC after the close in both DST states, idempotent, skips holidays.
- Quinn (QA): APPROVED. Conditions: explicit boundary tests; gate Off snapshot equivalence; byte-identical order payload on and off; cron idempotency and holiday tests; full suite plus preview check of FIND CSPs and FIND CCs.
