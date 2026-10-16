# CSP-SCORE-REVIEW-0001 — CSP Score badge, band color and breakdown (slice A)

Status: slice A IMPLEMENTED 2026-10-15; slice B (csp-score-v3 weights) IMPLEMENTED 2026-10-16. B2 and C open (below).

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

## Slice B (csp-score-v3) — IMPLEMENTED 2026-10-16 (Ian, Alan, Quinn; Dean approved "go")

- Weights: POP 10 → 15, OTM 10 → 15, period ROC 10 → 5, annualized ROC 15 → 10. Cushion 20 → 30, premium efficiency 25 → 15; total stays 100. Technical, IVR, liquidity and event weights unchanged. `CSP_SCORE_VERSION` is now `csp-score-v3`.
- No separate delta penalty (Ian): the preferred delta band is already a hard Best Opportunities gate set by the trader, so a penalty would count the same risk twice.
- Band floors stay 75 / 55 / 35 (Ian). Lowering them to 72 / 52 / 32 would turn 15 far-OTM, low-premium puts green.
- Golden fixtures (Alan): `lib/scans/__tests__/cspScoreGolden.test.ts`, real TQQQ 11/13 puts. 63P 72.63, 66P 70.92, 67P 70.79, 70P 68.23 (were 71.36, 72.45, 73.56, 73.89). The 70P no longer ties the 67P.
- Effect on a 2,409-row Rank export, in-band qualified (49 rows): mean −3.6 points, top 10 keeps 7 of 10, average delta of the top 10 .287 → .241. Green (75+) is 4 of 49, down from about 9.
- Known side effect (follow-up B2): puts below delta .15 (outside the preferred band, so never Best Opportunities) gain points and can reach 75+ with only 1.4–2.1% period ROC (about 17–22% annualized), for example TQQQ 55P at delta .12 scores 75.2. A minimum-return cap on the green band is the candidate fix. Needs Ian and Alan.

## Open

- B2: minimum-return cap so far-OTM, low-premium puts cannot read Strong (Ian, Alan).
- C: same badge and panel for PMCC (already has a score breakdown) and LEAPS; CC and Spreads label only until their scores have components.
- Recheck the $72.72 vs 73.82 underlying price at market open.
- Label "Pre-market" shows midnight to 4 AM Eastern (`derivePmccMarketSession`); fix in a later push.
