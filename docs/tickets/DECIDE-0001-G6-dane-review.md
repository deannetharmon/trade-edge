# DECIDE-0001 — G6 pre-development review (Dane)

> **SUPERSEDED (2026-09-27).** This record came from a parallel session and conflicts with the ticket on `main` (revision 7). Revision 7 is the only source of truth. Do not build from this file. Anything it had that revision 7 lacked was carried into the ticket (Phase 0 entry-date finding, and open item O25).

**Reviewed 2026-09-27** against revision 3 on `main` (`29db9b3`), plus the O10 approval and the O12 rulings.

**Verdict: approve S0 now.**
- **S1** can start once the three text fixes below (B2 to B4) are made and Diane places the S1 line.
- **S2** needs B1 fixed first.

No code has been written.

## References checked against the code

| Ticket says | Code on `main` | Result |
|---|---|---|
| `/api/chart` uses 6 months, no volume | `app/api/chart/route.ts:14` `range=6mo`; bars are `{t,o,h,l,c}` at `:51` | ✓ |
| Default stop multiple 2 | `lib/portfolio/stopLossPolicy.ts:184` | ✓ |
| Quote width thresholds: net 0.15 of mid, per leg 0.50 | `stopLossPolicy.ts:406-412` | ✓ (see note N1) |
| `evaluateStopBreach` reused | `stopLossPolicy.ts:516`, called at `acquisition.ts:2271` and `:2296` | ✓ |
| Position entry date | `Position.entryDate` (`lib/portfolio-data/types.ts:131`, `YYYY-MM-DD`) | ✓, but see B4 |
| Short-premium entry record | `lib/entry-context/capture.ts` (entry snapshots, live since 2026-09-25) | ✓, so use this rather than a new store |
| Prior stop readings | `snapshotHistory` (`types.ts`, `acquisition.ts`) | ✓ |
| NYSE session calendar | `lib/scans/nyseCalendar.ts` (`isNyseBusinessDay`, `addNyseBusinessDays`, `countNyseBusinessDaysAfter`) | ✓, so reuse it for S0 and S4 |
| Cutover lines in `PositionsWorkspace.tsx` | tone `:562`, label `:747`, "← suggested" `:762` and `:771`, red Cut Losses button `:770` | ✓ (line numbers shifted by 1 to 3) |
| Property tests use fast-check | not in `package.json` | ✗, a devDependency must be added (Paul to OK) |

## Blocking text fixes

**B1. The wide-quote fixture contradicts production (blocks S2).**
- The ticket says to reuse `evaluateStopBreach`, but its fixture calls bid 0.70 / ask 0.90 (25% of mid) "narrow". Production treats anything over 15% of mid as wide, so that quote is wide. The Conventions formula `8·(ask − bid) > bid + ask` also encodes the dropped 25% rule.
- **Fix:** delete both. The fixtures call `evaluateStopBreach` with production's thresholds, for example 0.70/0.80 (13.3%) narrow and 0.70/0.90 wide. No second width formula lives in DECIDE code.

**B2. Gap clearing conflicts with O12 (blocks S1).**
- The ticket says "If any close from `g` to `n` is already ≥ R the state is CLEAR at once." Ian's O12 ruling says a fired gap clears only after 2 closes in a row at or above R, or a full fill.
- **Fix:**
  - **Before it fires** (window `g … g+4`): any close ≥ R means CLEAR.
  - **After it fires:** the O12 rule applies.
- Add fixtures:
  - fires at `g+4`, then one close ≥ R: still fired
  - then a second close ≥ R: clear

**B3. Support confidence is now defined (blocks S1 display of confidence).** Replace "Ian to define; until defined they are never LOW" with the O12 bands:
- distance: `c_c·10000 ≥ 9801·S_c` is LOW
- volume: `400·v < 33·Σ` is LOW
- LOW if either is LOW

**B4. Original open date on rolled positions (blocks S0's support reconstruction).**
- The ticket says "a rolled position uses the original open date", but `Position.entryDate` is not documented as surviving a roll.
- **Fix:** S0's first task is to confirm the source of `entryDate`, whether the broker's open date or when the app first saw the position, and whether a roll resets it.
- If it resets, support is **not evaluated** for rolled positions until the lifecycle data (`outcomeAnalysis.ts`) can supply the original date. Never reconstruct from the roll date.

## Non-blocking notes

- **N1. Units.** `QUOTE_WIDTH_THRESHOLDS.maxNarrowLegWidthDollars` is commented "dollars per contract", but 0.50 and the MU example read as per share. Confirm the unit before writing any fixture that uses it.
- **N2. Where the S1 line goes.** S1 ships before the S3 cell exists. Proposal: one line in the existing Recommendation cell, under the reason (`PositionsWorkspace.tsx:748`), using the approved mock's amber context-line style, for example "Stock has weakened: closed below entry support." It carries no action. Diane to confirm; this is a small change.
- **N3. Shared completed-bar helper.** Put the "last completed session" rule in `lib/market-intelligence/completedBars.ts` so RSI-TURN-0001's live-bar fix uses it too, as the ticket asks. S0 builds it.
- **N4. Data volume.** Two years of daily bars for each held symbol plus SPY, cached per NY session date: about 20 symbols, one fetch each per day. There is no rate-limit concern. The endpoint is server-side (Yahoo), so the TastyTrade browser-only rule does not apply.
- **N5. S3 is the risky slice.** About 10 surfaces switch together, and about 25 test files change with Ian's approval. Build it on a branch with a Vercel preview, and run the full suite before merging.

## Estimate (working sessions)

| Slice | Work | Estimate |
|---|---|---|
| S0 | history endpoint, completed-bar helper, support store and reconstruction, B4 check | 1.5 to 2 |
| S1 | `brokenStock.ts`, fixtures, display line | 1.5 |
| S2 | evaluator, adapters, shadow disagreement log | 3 to 4 |
| S3 | cutover of about 10 surfaces, calm cell, test updates | 3 to 5 |
| S4 | keyed decision log, attribution, Performance view | 2 to 3 |

## Checks before each hand-off (per CLAUDE.md)

- Run `tsc -p tsconfig.check.json`, the affected tests, and a Vercel preview build. S3 and S4 also run the full suite.
- State which sibling code paths were checked each time.
