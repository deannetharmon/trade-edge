# WHEEL-SYSTEM-0003 — Own-history check and a per-name drop setting

**Status:** DRAFT 1. **Ian ruled on all 5 decisions 2026-09-27: all approved, one with a change** (the warning-chip threshold moves from a flat −40% to a margin over the row's own effective drop — see below). Mock published 2026-09-27. Not yet approved to build — awaiting Dean's sign-off on the mock and Ian's corrected threshold.
**Parents:** WHEEL-SYSTEM-0001 (W1, live) and WHEEL-SYSTEM-0002 (W2, live). **Roadmap:** item 14.
**Mock:** https://claude.ai/artifact/2tHjMxgDDzSWtfRZbB4KmX

## Why

Dean pulled eleven tickers from a video (GGLL, SOXL, TQQQ, TSLL, CRWV, NAIL, TEM, SQQQ, CONL, AMZU, BITX). Nine are leveraged or inverse funds; two (CRWV, TEM) are volatile single stocks with short histories. Checking them by hand took price history from a public feed, which showed the worst month for these names ran from −32% to −71% (CONL −71%, TSLL −68%, SOXL −61%, CRWV −48%, TEM −49%; last 5 years, daily prices, unverified). The plan sizes every name with one assumed drop (default 30%), so a volatile name that clears the Checks can still be sized as if it were an ordinary ETF, and a hand-kept list of leveraged funds missed three of the eleven (NAIL, CONL, BITX). Two gaps:

1. There is no way in the UI to tell the plan that one name can fall further than 30% (the per-name drop is stored in the plan's schema, `wheelList[].dropBps`, and used by the sizing math, but no box sets it).
2. Nothing tells Dean how far a name has actually fallen in its own history, so an idea from a video can be screened in about a minute.

## Decisions for Dean — Ian's ruling 2026-09-27 (all 5 approved; the threshold changes)

1. **History is information, not a gate, in v1 — APPROVED (Ian).** "Info-only is right for v1 — this data is an unverified public feed over a window that misses 2020, and I'm not gating a name's eligibility off a number I can't stand behind. The whole point of CSP sizing is that the trader owns the drop assumption; a line, a chip, and a one-click 'Use 50%' keeps the human in the loop where the human belongs. Revisit a hard gate only once the history data's been checked against the broker for a stretch." It shows a line and an amber chip, and offers a "Use 50%" button; it never changes a verdict or blocks a name.
2. **Window: 5 years of daily closes — APPROVED (Ian).** "5 years with an explicit years-covered readout and a sub-3-year flag is the honest way to show this — hiding the 2020 gap would be worse than disclosing it. CRWV and TEM getting 'short history' tags is exactly the behavior I want; don't let anyone read those two the same as a 5-year-clean name." Longer windows include the 2020 crash, which the 5-year window misses (TQQQ's worst month is −44% over 5 years and −69% counting 2020), so the screen says how many years it covers and warns when there are fewer than 3.
3. **Suggested drop rounds UP to the next 5% and is never below the plan-wide drop — APPROVED (Ian).** "Rounding up to the next 5% and flooring at the plan default is the conservative direction on both ends — never suggests less protection than the plan already assumes, never pretends more precision than the data supports."
4. **The new price-history route requires a signed-in session — APPROVED (Ian).** "Session-required on new surface is correct, full stop. The existing chart route being open is a separate pre-existing hole — don't let this ticket get held hostage to fixing that, but it goes on the backlog, not forgotten." (The existing chart route does not require a session; unrelated to this ticket, not proposed to change here — noted as a real, separate item.)
5. **Slice C (catching leveraged funds by their broker description) is optional — APPROVED, skip it (Ian).** "Building a detector on a field name you admit you haven't verified against a real broker payload is exactly the kind of thing that ships broken and gives false confidence. The hand-kept list already caught 8 of 11 and got patched for the other 3 today — good enough for v1. Spin C into its own ticket once someone's actually looked at a live instrument payload." Rests on a field name not yet verified; skip it, keep it as its own later ticket.

**The −40% warning threshold — APPROVED WITH CHANGES (Ian), this is his actual gate per this ticket's Review Gates line.** "Flat −40% for every name is the wrong shape. The number that matters is how far a name's own worst month clears the *plan's* assumed drop, not an absolute constant — a plan running a 20% drop should flag a −35% name, and a plan running 40% shouldn't necessarily flag a −42% name that's barely worse than what's already assumed. Make `historyWarnBps` a margin over `planDropBps` (or per-row `dropBps ?? planDropBps`), not a fixed floor. Ship the fixed default only as a fallback if the relative version doesn't make the v1 cut — don't ship it as the permanent design." **This changes the "Where it shows" spec below** — build the relative-margin version, not the flat −4000bps constant as originally written.

## Scope

### Slice A — per-name drop in the UI (small)

- A "Drop" box on each ladder row. Blank means the plan-wide assumed drop (default 30%); typing a percent stores `wheelList[].dropBps` (whole percent, 1 to 95). A small "custom" tag shows when it differs, and clearing the box returns to the plan-wide value. Same defaults-and-overrides behavior as every other parameter: warn, never block.
- It already changes sizing: `maxCashPerName = lossBudget x account / drop` and "fits at" use `entry.dropBps ?? params.dropBps` (`features/wheel/WheelPlanTab.tsx` rows memo). No change to the stress test, which stays a whole-portfolio fall.
- The "Not yet" and "Fits plan" text follow the new limit automatically.

### Slice B — own-history check

- **New route** `GET /api/chart-history?symbol=&years=5` (default 5, at most 10), server-side Yahoo, daily bars, session-checked. It returns `{ closes: [{ t, c }] }` in date order, split-adjusted and dividend-unadjusted (the `quote` closes, never `adjclose`; Alan's ruling O8 in DECIDE-0001). The existing `/api/chart` route is not changed (it has ten callers and a fixed 6-month range).
- **Pure module** `lib/wheel/priceHistory.ts` from the closes, in integer arithmetic:
  - `worstMonthBps`: the lowest 21-trading-day return, `min over i of floor(c[i+21] x 10000 / c[i]) - 10000`, with closes first converted to whole mills (`round(c x 10000)`). Floor makes the reported drop slightly larger, never smaller.
  - `maxDrawdownBps`: the lowest `floor(c[t] x 10000 / runningPeak) - 10000`.
  - `share30Bps`: the share of 21-day windows at or below −30%, in basis points.
  - `years` = number of closes / 251 (one decimal); `shortHistory` = fewer than 3 years; needs at least 22 closes or the result is unavailable.
  - `suggestedDropBps = clamp(ceil(|worstMonthBps| / 500) x 500, planDropBps, 9500)`.
- **Where it shows:** under the symbol on each ladder row and in the Checks column of the Next candidate table: "History: worst month −48%, peak-to-trough −67%, 1.5 years" with a "short history" tag under 3 years, and a **"Use 50%"** button that fills the Drop box. Nothing is applied automatically. **Warning chip threshold, corrected per Ian's ruling above:** amber when the name's own worst month clears the *row's effective drop* (`entry.dropBps ?? params.dropBps`) by a margin — not a flat −40% for every name regardless of the plan's own assumption. `historyWarnMarginBps` (editable default, e.g. 1000 = 10 percentage points) is the margin over the effective drop; a name whose worst month is within that margin of (or better than) the effective drop shows no chip. Ship the flat −4000bps constant only as a documented fallback if the relative version doesn't make the v1 cut.
- One fetch per symbol, one at a time, same failure handling as W2: a symbol whose history cannot be read shows "history unavailable" and never blocks or passes anything; Retry loads it again.

### Slice C — catch leveraged funds by description (optional, separate)

Read the fund's description from the broker's instrument record and treat a description containing "2X", "3X", "Bull", "Bear", "Ultra" or "Short" as leveraged or inverse, in addition to the hand-kept list. The field name (`description`) is recalled, not verified, so this slice starts with a live check of the payload. Until then the hand-kept list is the only detector; NAIL, CONL, BITX and others were added on 2026-09-26.

## Fixtures for Alan

Closes: index 0 to 20 all 100.00, index 21 = 52.30, index 22 = 60.00 (23 closes, 2 windows of 21 days).

| Measure | Value |
|---|---|
| Window from index 0 | floor(523,000 x 10000 / 1,000,000) − 10000 = −4,770 bps |
| Window from index 1 | floor(600,000 x 10000 / 1,000,000) − 10000 = −4,000 bps |
| `worstMonthBps` | −4,770 |
| `maxDrawdownBps` | −4,770 (peak 100.00 to 52.30) |
| `share30Bps` | 10,000 (both windows at or below −30%) |
| `suggestedDropBps` (plan 3,000) | 5,000 |
| Fewer than 22 closes | unavailable |

Edge cases to pin: exactly −30.00% counts in the share; a flat series is 0 bps and suggests the plan-wide drop; a single bad close (a data error) is still reported, with the years and the "short history" tag, and never used automatically; a reverse split is handled by using the split-adjusted closes.

## Files (proposed)

New: `lib/wheel/priceHistory.ts`, `lib/wheel/__tests__/priceHistory.test.ts`, `app/api/chart-history/route.ts` and a route test (session required, bad symbol, years bounds, Yahoo failure), `lib/wheel/historyData.ts` (fetch adapter, injectable). Edit: `lib/wheel/capitalPlan.ts` (`historyWarnBps`), `lib/wheel/planSchema.ts` (drop bounds already validated; add the parameter), `features/wheel/WheelPlanTab.tsx` (Drop box, history line, Use button), `features/wheel/NextCandidateTable.tsx` (history chip), a hook like `useCandidateData` for the histories, tests, `docs/ROADMAP.md`.

## Acceptance criteria

1. Typing a percent in a row's Drop box changes that name's "Most cash on one name" limit, its contracts that fit and its "fits at" account size, saves with the plan, and shows a "custom" tag; clearing it restores the plan-wide value.
2. A symbol's history line shows the worst month, worst peak-to-trough, and years covered; under 3 years shows "short history".
3. "Use 50%" (or the computed value) fills the Drop box and nothing else; no value is ever applied without a click.
4. History never changes a verdict, never fails a name, and an unavailable history shows "history unavailable".
5. The fixtures above pass exactly; the route rejects a missing session and out-of-range years; the existing `/api/chart` route and its tests are untouched.
6. Leveraged and inverse funds on the hand-kept list still show "Not a wheel candidate" and trigger no history call.
7. No order, position or recommendation changes. Standing line: "Guidance from TradeEdge rules. You decide; no orders are placed automatically."

## Known limits, stated on screen

- Price history is not a limit: a name can fall further than it ever has, and a 5-year window can miss an event (the 2020 crash sits outside it).
- Short histories (CRWV about 1.5 years, TEM about 2.3) understate risk.
- Data comes from a public feed and is not verified against the broker.

## Open items

- **O1** Ian: whether a worst month worse than about −50% should ever become a check (v1: no, information only).
- **O2** Alan: confirm split-adjusted, dividend-unadjusted closes are right for reverse-split funds (SQQQ's adjusted series starts at a very large number).
- **O3** Quinn: rate limits and caching for the history route (one call per symbol per session is enough; nothing is stored).
- **O4** Whether the plan-wide stress test should also use each name's own drop (v1: no).

## Review gates

Ian: what to show and the warning threshold. Alan: the arithmetic, fixtures and data adjustments. Quinn: route security, failure states, tests. Diane: a mock of the ladder row and the Checks chip before code. Dane: developer review last. Paul: scope (A and B together are a small slice; C is separate).
