# KEEP-CREDIT-0002 — Hindsight review of closed spreads

**Status:** DRAFT 1, 2026-09-27. Made a real ticket per Dean's approval of KEEP-CREDIT-0001's decision 5. Not approved to build. Blocked on data (see below), not on a decision.

## Why

KEEP-CREDIT-0001 (built) shows the odds a spread finishes worthless while you're deciding whether to close. This ticket answers the question that comes after: **looking back at spreads you already closed, would the odds line have told you anything useful, and were your panic closes actually panics?**

Dean's own Trade Log (65 closed trades, Apr 29 to Sep 21 2026) already shows 21 of 28 losses were closed before the position reached 2x credit — before his own stop rule said to. This ticket would show, for each of those, what the odds line would have said at the moment of closing, using the same `calcPositionPopVsStrike` formula KEEP-CREDIT-0001 uses live.

## The real blocker: data, not a decision

The Trade Log has no price-at-expiry capture. For a closed trade, we know the close price and date; we do not know what the underlying did between the close and the original expiration, so we cannot compute "would this have expired worthless if held." That capture is DECIDE-0001D's job (part of the decision-log/S4 work in `docs/tickets/DECIDE-0001-decisive-position-recommendations.md`), which itself is not built yet. This ticket cannot start until that capture exists and has run for a while.

**Minimum data needed before this can be meaningfully reviewed:** at least 100 closed trades total, with at least 30 in any bucket being compared (e.g., "closed under 25% loss, above stop" vs. "closed above 25% loss"), per KEEP-CREDIT-0001's own calibration bar. Dean's current log (65 trades) is short of that, and doesn't yet have the price-at-expiry field even for the trades it does have.

## Scope, once unblocked

1. For every closed spread with a captured price-at-expiry, compute what `calcPositionPopVsStrike` would have shown at the moment of closing (same formula, same IV source as KEEP-CREDIT-0001, so the comparison is apples to apples).
2. Show, in aggregate: of the trades closed early (before 2x credit), what share would the odds line have called "more likely than not to keep the credit," and did those actually expire worthless (from the captured price-at-expiry)?
3. No new UI beyond a simple table/summary (Trade Log page, a new tab or section) — this is a review tool, not a live recommendation surface.
4. Feeds back into KEEP-CREDIT-0001 and DECIDE-0001 only as evidence; no threshold or rule changes without Dean and Ian reviewing what the data actually shows.

## Non-goals

- No automatic conclusion that the odds line is "right" or "wrong" from a small sample.
- No change to any live recommendation, stop, or hurdle as a result of this ticket alone.

## Review gates

Paul: confirm scope stays a review tool. Alan: confirm the formula reuse and the calibration bar (100+/30+ per bucket) before any conclusion is treated as meaningful. Quinn: confirm the price-at-expiry capture (DECIDE-0001D) actually produces usable data before this ticket's build starts.
