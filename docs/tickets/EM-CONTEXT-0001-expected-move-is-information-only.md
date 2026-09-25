# EM-CONTEXT-0001 — Expected move is information, not a gate

## Status

**Approved by Dean 2026-09-25 after a five-way review (Ian, Paul, Alan, Quinn, Diane, each independent). Built and pushed to `main` (full suite 376 files / 5501 tests, real `next build`).** The optional scan control and "find next best outside EM" were NOT built; Dean chose the small change first.

## Problem

Dean saw "Expected-move clearance -3.7% vs EM" in red in the order window ("Advisory: the short strike sits inside the modelled expected move") and asked to be guided earlier, toward the next best option outside the expected move. His worry with any fix: everything would be disqualified and he would not trade. He also said he steers by OTM% and does not factor in the expected move.

## What the numbers show

The app's expected move is one standard deviation: price x IVx x sqrt(DTE/365). A short put clears it only at about 0.11-0.13 delta (Black-Scholes, r=4%, IV 25-60%, 21-45 DTE; Alan re-derived the same figures). At IV 45% and 35 DTE, clearance vs EM is +1.3% at delta 0.10, 0.0% at 0.12, -2.2% at 0.16, -4.1% at 0.20, -6.2% at 0.25. Dean's normal band (CSP preferred delta 0.15-0.25, spread shorts 0.16-0.25, PMCC short calls 0.20-0.35) is 100% inside the expected move, so a gate, or even a warning, would flag or remove essentially every normal trade. The order-window sample (delta 0.19, 34 DTE) is inside by 3.7% as a matter of course.

The old text was also wrong: "strike is within the expected move, POP below 68%". 68% is the two-sided chance of finishing within +/-1 SD. A short put exactly at the 1-SD boundary has about 85% probability of expiring worthless (Alan: 0.849-0.854), and about 80% at 0.20 delta.

## Review outcome (all five agree)

Do not gate; do not make inside-EM Disqualified or a Caution; keep it out of `qualified` and the three-state model; fix the 68% text; show it as neutral context; put the number where Dean sees it at the scan; add a build-failing survival test. Ian reversed his own first proposal (inside = Disqualified, default on). Differences: Paul and Diane would add an opt-in control (default off); Ian would prefer display and sort; Diane would skip the sort; Paul would defer "find next best outside EM". Alan and Ian note the 15%/5%-of-price bands are scale-blind and a multiple-of-EM measure would be sounder; Ian notes a 50% profit exit and 21-DTE management make the full-expiry 1-SD move overstate this trader's risk.

## What was built

- `lib/scans/checklist.ts` `evaluateEmClearance` (extracted, pure): outside the expected move = `pass`; inside = `pending` (a neutral dash, never a fail or warn); missing, zero or negative expected move or missing price = `pending` "IVx unavailable". The old 0-5% and 5-15% warnings on strikes that were outside the expected move are gone too. Text corrected: "inside the 1-SD expected move, which is normal at 0.15-0.25 delta (probability of profit is under about 85%, not 68%). Information only".
- Result card: the EM shows as `EM +-$94.05 (+-14.9%)` in a neutral color, so the move can be compared with the OTM% in the same row; the red or green clearance number is gone (its tooltip gives the distance).
- Checklist tooltip rewritten (no "POP below 68% by definition", no colored bands).
- Order window: the red "Expected-move clearance" row and the red advisory paragraph are replaced by one neutral line, "Expected move (1 SD): +-14.9% · strike 3.7% inside". The earnings advisory is unchanged.
- Removed the unused `getEmClearanceColor`.
- Tests: `expectedMoveClearance.test.ts` (outside, inside, exact boundary, BCS mirror, missing data; the whole 0.05-0.60 delta ladder at IV 20-60% and DTE 21-45 yields only pass or neutral; the 0.15-0.25 band stays Qualified with every other gate passing; expected move is not a gate key). If a future change makes inside-EM a warning, failure or gate, this suite fails the build.

## Not built (candidates, only if Dean misses them)

- An opt-in scan control "Outside expected move" (default off) with a live count, and a sort chip (Diane doubts the sort adds anything beyond delta).
- "Find next best outside EM" on the card (reuse the Find Better finder; show the delta and credit change; Back to original), and Ian's "next strike out" hint that shows what the safer trade costs in credit and ROC against the 20% floors.
- Ranked 15-point EM score dimension: it has a cliff at 0% (delta 0.12 and 0.16 score almost the same); a gradual score by distance, and a multiple-of-EM measure, are a separate ticket for Ian and Alan with data.
- Whether the delta bands themselves should move is a methodology decision, not a UI change.
- Alan's note: the app's clearance (-3.7%) differs from a flat-vol model (-4.6%) because EM uses the expiration IVx while delta comes from the strike's own IV.

## Follow-up: calibrating an amber highlight (2026-09-25)

Dean asked whether amber should mark strikes near the expected move, and questioned a proposed 0.70x line (it was chosen to split his delta band, not derived from evidence). Findings:

- His OTM% coloring is already type-aware (`getOtmColor`: 4% target for index/ETF, 7% for stocks, plus 1-2 points at high IVR). In expected-move terms those flat targets mean different distances (illustrative: SPY 0.72x, QQQ 0.54x, AAPL 0.81x, NVDA 0.50-0.65x, AMD 0.41-0.53x at 35 DTE), so one multiple for everything is wrong: 0.70x fits SPY but would flag AMD and NVDA trades that pass his own OTM% targets. Any amber should be set per underlying type.
- Moving averages: the app has the 20-, 50- and 200-day averages (`lib/scans/trend.ts`), no 30-day. Structural support is a different question from the statistical expected move; a compound rule (well inside the expected move and above the 50-day average) is a later ticket for Ian and Alan.
- Calibration from his own entries was attempted with a console query of entry snapshots: 1 snapshot (BPS AAPL, 35 DTE, score only), every measurement blank. Cause: snapshot evidence is recorded only when the candidate carries a quote time (`quoteFetchedAt`), which only `spread-finder` sets; Ranked and Targeted candidates never do, so those entries recorded score and DTE only. Fixed 2026-09-25 (`lib/entry-context/evidenceAsOf.ts`): the scan's completion time is the fallback, so new entries record OTM%, expected move, delta, IVR and quotes. Earlier entries cannot be back-filled. CSPs have no snapshots (notes only). Decision: hold the amber and calibrate after roughly 20-30 new entries (per type), then set the threshold where a candidate is more aggressive than what he actually enters.

