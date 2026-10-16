# CSP-SCORE-REVIEW-0001 — CSP Score badge, band color and breakdown (slice A)

Status: slice A IMPLEMENTED 2026-10-15. Slices B and C open (below).

## Why

Dean compared TradeEdge with Prosper Trading, Guac and TastyTrade on TQQQ 11/13 puts. Two scores sat side by side on the same CSP card: the CSP Score (74) and the legacy Rank score ("34 — Avoid"). The strategy badge was colored by strategy (CSP amber), so nothing on the card said whether 74 was good. Rebuilding why the 70P and 67P tie took an hour of hand calculation.

## Findings (read-only investigation)

- The CSP Score is `lib/scans/cspScore.ts` (nine components, 100 points). The legacy 34/51/53 is the older Rank score (credit, ROC, POP, DTE), still shown on CSP cards.
- Reproduced exactly with the real function: TQQQ 70P 73.9, 67P 73.7, 68P (36 DTE) 75.0. Technical fit was 9 (trend "UNKNOWN, conflicting signals"), worth about −6 points on every TQQQ strike.
- The 70P (delta .38) ties the 67P (delta .29) because it loses about 3 cushion points (POP + OTM, 20 of 100) and gains about 3 return points (period + annualized ROC, 25 of 100; annualized ROC caps at 50%).
- From a 2,409-row Rank export (14 symbols, delta .15–.45, DTE 21–60): in-band qualified candidates (49 rows) have a median CSP Score of 72, range about 66–82.7. Floors 75/55/35 put about 18% in green and the rest in yellow.
- 632 of 704 "Overall Qualified" rows have delta above .45. By design (CSP-BESTOPP-GATE-0001, `cspRegistry.ts`): the band sets a flag and the ranking; out-of-band puts cannot be Best Opportunities. Not a defect.
- Scan underlying price for TQQQ read $72.72 against 73.82 on TastyTrade and Prosper. Option quotes matched exactly. Not yet explained; recheck at the open.

## Slice A (this change) — presentation only

- CSP card: one primary badge "CSP Score N | Details", colored by score band, never by strategy.
- Bands use the live Rank floors (default 75 Strong, 55 Acceptable, 35 Marginal, below 35 Avoid), computed on the displayed rounded score. The band name is in the badge hover text and on the panel's total row. There is no legend on cards.
- The badge opens a panel with the nine components: value, points earned out of points possible, bar, note. Rows earning under 40% of their points are amber. Total row matches the badge.
- The legacy Rank badge is no longer drawn on CSP cards. The card's left border follows the CSP band. Spreads keep their traffic light.
- New: `lib/scans/scoreBands.ts`, `lib/scans/cspScoreBreakdown.ts`, `features/screener/components/CspScoreBreakdown.tsx`. No weight, cap, formula, gate or default changed.
- Diane mock: https://claude.ai/artifact/WZnPckPbvRsFQN4fCtNBTa

## Open

- B (Ian, Alan): delta penalty above the preferred band and a cushion reweight (cushion 20 → about 30, return 25 → about 15). Changes every CSP score. Needs golden fixtures rebuilt first.
- C: same badge and panel for PMCC (already has a score breakdown) and LEAPS; CC and Spreads label only until their scores have components.
- Recheck the $72.72 vs 73.82 underlying price at market open.
- Label "Pre-market" shows midnight to 4 AM Eastern (`derivePmccMarketSession`); fix in a later push.
