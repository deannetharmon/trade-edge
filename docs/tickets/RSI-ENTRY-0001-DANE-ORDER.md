# RSI-ENTRY-0001: Implementation order for Dane

Issued by: Frank (facilitator), 2026-10-01. Ticket: `docs/tickets/RSI-ENTRY-0001.md` (v8). Mock: `docs/tickets/mockups/rsi-entry-0001-mock.html` (published copy: https://claude.ai/artifact/W2FwugQcwbFXruUN6FhgRq).
Approved by Ian, Alan, Quinn, Paul, Diane (copy). Dean approves the mock before slice A2.

## Start triggers (nothing starts before its trigger)
- Slice P and A0: LEV-0001 Gate 10 corrective round is closed (docs/ROADMAP.md, current status). Paul confirms the go.
- Slice A1: after P. Alan supplies the golden fixtures; do not invent fixture values.
- Slice A2 (UI wiring): after A1 and after Dean approves Diane's rendered mock.
- Slice B: after A2 ships and Ian has reviewed the pass-rate check.

## Rules for every slice
- Read `docs/ROADMAP.md` first. Run `git status; git branch -vv; git stash list` and flag issues in 1 or 2 lines.
- Read only the ranges you need. Do not read `app/screener/page.tsx` in full (about 12.6k lines); grep for the symbol. No new named exports from any `page.tsx`; logic lives in `lib/`.
- Do not change `RSI_TURN_PARAMS` or any existing RSI consumer's behavior (popups, order-window `RsiLine`, `lib/wheel/candidateRank.ts`). Do not change `getTrend`'s own `calcRsi` (a simple 14-change average returned as `rsi14` in `TrendResult` and consumed downstream; it is a different number from Wilder RSI).
- No TastyTrade call and no change to the order submission path in any slice. The gate never blocks an order.
- One batched push per slice (one CI run, one Vercel preview). Before the first push: finish the code, tests, sibling-defect search, targeted tests, and the `tsconfig.check.json` type check. This shared-module, eligibility-adjacent work needs the full suite (Dean asked to be asked before running the full suite: ask first).
- Before handing off state (a) which sibling paths you checked for the same class of bug and (b) that tsc and tests were actually run, with results. Never claim verification you did not run.
- Frank closes a slice only after required GitHub CI is green and the current head's Vercel preview is Ready.

## Slice P: completed-bar helper (prerequisite)
- New `lib/indicators/completedBars.ts`: `completedDailyCloses(bars, now)` takes the `/api/chart` bars (each has `t`, `c`), drops a bar whose New York date is today while the US market is open, and returns finite closes oldest first. Fail closed (return null) on bad input.
- Tests: market open with today's bar (dropped), market closed (kept), holiday, half-day, weekend, timestamps in seconds, bars with null or non-finite close.
- Adoption by the existing RSI consumers (`RsiLine`, `RsiStrip`/`ChartLinkButton`) belongs to RSI-TURN-0001 and is a separate push. This ticket's gate adopts it first.

## Slice A0: step 0 check and seam design (no gate code)
Step 0, Alan's open check (could not be run from the planning environment because Yahoo is blocked there): on the Vercel preview, call `/api/chart?symbol=AAPL`, pick 5 dates, and compare each bar's `c` with TradingView's daily close (dividend adjustment off). Equal to the cent means not dividend-adjusted. For the split half, check closes from before a known split through `/api/chart-history` (same Yahoo source, confirmed in its route; confirm which close field it reads). Record the result in the A0 doc.
Seam design, deliver `docs/tickets/RSI-ENTRY-0001-A0-fetch-design.md`:
- Scans already fetch `/api/chart` once per symbol inside `getTrend` (`lib/scans/trend.ts`, requires at least 90 closes), so the gate adds no Yahoo call if it reads the same closes. Design how the closes (or the gate result) reach the scan without altering `TrendResult` scoring inputs. `getTrend` is "mechanically extracted, verbatim", so prefer an additive seam (for example a per-symbol closes memo with a short TTL) over editing its body.
- Identify which `getTrend` call sites belong to CSP and CC: `lib/scans/ranked-scan-runner.ts:115` and `app/screener/page.tsx` lines near 7711, 9892 (Spreads: out of scope), 10248, 10573, 10846. This list is unverified; confirm each. `app/portfolio/page.tsx` has its own `getTrend`; out of scope.
- Index symbols already map through `YAHOO_INDEX_CHART_MAP` in `getTrend`; reuse it.
- Failure handling: one failed fetch marks that row "RSI n/a" and never breaks the scan (Quinn).
- Alan sizes the design; Quinn reviews failure handling.

## Slice A1: gate logic (pure, in lib/)
- New `lib/indicators/rsiEntryGate.ts`: gate parameter constants (CSP `{ low: 40, high: 70, window: 8, lift: 3, mid: 50 }`, CC `{ low: 30, high: 60, window: 8, lift: 3, mid: 50 }`) and a mapping from `rsiSeries` + `rsiState` to PASS or WAIT with a reason computed from the same 8-value window (CSP: "no dip", "still falling", "turn not confirmed", "bounced"; CC: "no peak", "still rising", "turn not confirmed", "faded"; unavailable: "RSI n/a"). Chip text uses `describeRsiTurn` for Pass.
- Tests (Alan's fixtures): truth table for CSP and CC; exact boundaries (window low exactly 40, lift exactly 3, latest RSI exactly 50, a flat bar in the rise run); fail closed on short, non-finite, or empty closes; `RSI_TURN_PARAMS` and its existing tests unchanged and green.

## Slice A2: wiring (after Dean approves the mock)
- Scan controls: "Entry timing (RSI)" On/Off, dip level (CSP), peak level (CC), advanced window, lift, ceiling. Default Off at first release. Persist the last-used setting the same way the other scan controls persist (match the existing pattern; do not invent a store).
- Receipt: add the RSI rule and "N of M pass" to the existing "Active CSP rules" and "Active CC rules" lines.
- Row chips and the empty Best Opportunity message, exactly as the mock. Wait rows keep score and order; only Best Opportunity eligibility changes, and only while the gate is On. "RSI n/a" fails closed while On.
- Order screen: one neutral line for a Wait trade ("RSI timing: Wait (no dip, RSI 58). Placing anyway."); audit entry "Entered with RSI gate = Wait (reason)". The order payload is byte-identical with the gate On and Off (test).
- Tests: gate Off snapshot equals today's scan results and Best Opportunity; Wait keeps score and order; Best Opportunity skips Wait while On; empty-slot message; line and audit entry; payload identical.
- Verify on the preview: FIND CSPs and FIND CCs. Frank does not close A2 without that preview check.

## Slice B: watch and alert (after A2 and Ian's pass-rate check)
As specified in the ticket: manual Watch, Redis rules per user, once-daily post-close cron (late enough for 4:00pm ET in both DST states, for example 22:30 UTC), idempotent, skips holidays and stale data, one email per transition, never touches TastyTrade. Dane confirms existing notification plumbing before building.

## Pre-ship check (before the default flips to On)
Dane runs the historical pass-rate check on AAPL, MRVL, and several of Dean's usual tickers, comparing a dip level of 30 against 40, and shares it with Ian.

## Done when
Each slice: CI green, current-head Vercel preview Ready, the sibling-path statement and the verification statement delivered, Frank closes it, Paul updates `docs/ROADMAP.md`.
