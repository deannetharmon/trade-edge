# CSP-CARD-0001 — CSP Surfaces: Single Premium Basis and De-duplicated Card Layout

**Status:** Review round 1 complete — awaiting Dean's approval to build. Gate risk: **full** (the order modal pre-fill is an order path).
**Mock:** `docs/tickets/mockups/csp-card-0001-mock.html` (Diane)
**Scope:** Every on-screen CSP premium/breakeven surface, plus the CSP order modal's pre-filled limit. No change to scoring, ranking, qualification, or order math.

## Review log (round 1)

| Lens | Verdict | Key changes folded in |
|---|---|---|
| Ian (independent second opinion) | Approve with changes | Move expanded section and audit card to bid; make order pre-fill a hard criterion; state the scoring/display divergence; keep the intrinsic threshold at 50%; label Breakeven as the assignment basis |
| Alan | Approve with changes | Units wording (total vs per share); zero-bid, DTE and missing-underlying rules; golden fixtures |
| Quinn | Approve with changes | Sibling surfaces found (expanded section, best-opportunity rows, PDF, CSV, order modal); extract logic out of `page.tsx`; named tests to update; full suite |
| Paul | Approve with scope changes | In-scope surface list below; CSV handled additively; scoring basis stays a dated follow-up |
| Diane | Mock delivered | Ann. Yield becomes neutral (uncolored) for CSP |

Reports from Ian are advice, not approval. Dean is the final decision-maker.

Mock review (inline lenses, not independent): Ian approve; Quinn approve with changes, now folded in (edge states, expanded section and order-modal pre-fill added to the mock). Diane's mock still needs Dean's approval before any UI goes to code.

## Problem

1. **Two premium bases on one card.** `csp-finder.ts` builds `credit`, `roc`, `annualizedRoc` and `breakeven` from the option **mid** (`c.mid * 100`, `strike - mid`). `calculateCspReturnThisCycle` builds "Return by expiration" and "30-day comparison" from the executable **bid**. Example (AVL 52P, bid 17.20, mid 17.80): Return by expiration 33.08% (17.20 / 52) beside ROC 34.2% (17.80 / 52); Breakeven $34.20 where the bid-based figure is $34.80. A seller fills near the bid, so the mid figures overstate.
2. **The mid basis reaches beyond the card.** The same mid-based `credit`, `breakeven` and `annualizedRoc` are read by the expanded "CSP — Wheel Entry" section (`app/screener/page.tsx` ~6436-6443), best-opportunity rows (`features/screener/lib/bestOpportunityRows.ts`, `creditDebitLabel`), the PDF report (`printScanPdfReport.ts`), the CSV export (`cspCsv.ts`), and the CSP order modal.
3. **The order modal pre-fills the mid figure.** `CspTradeModal` initializes `entryLimit` from `c.credit` (mid-based, e.g. $1,780) but its quote validation compares against the live **bid** (e.g. $17.20 per share). What the card shows, what the modal pre-fills, and what the modal validates against are three different numbers.
4. **Duplicated metrics.** The line under the Research button (`CspFundamentalsRow`) repeats Δ, POP, OTM, OI and Credit, all in the table columns.
5. **Decision values outside the table.** Breakeven and Cash Required are decision-weight for a CSP but sit only in the ambient line.
6. **Misleading yield on deep in-the-money puts.** AVL 52P at a $34.56 stock: $17.44 intrinsic of a $17.80 mid. "Ann. Yield 833%" reads as premium income and is nearly all intrinsic value.
7. History: CSP-0002 added the long line so Bid/Ask, Credit, Cash Required and Breakeven are visible without expanding the card. That visibility is preserved, only relocated.

## Product decisions

1. **One basis: executable bid.** Every CSP surface in scope derives Premium, Breakeven and annualized return from the short put bid. Premium (total, matches `credit`) = bid x 100 x contracts. Breakeven (per share) = strike - bid, labeled as the assignment basis. Cycle and annualized returns come from the existing `calculateCspReturnThisCycle` (`cycleReturnPct`, `bidBasedAnnualizedReturnPct`); do not re-derive them.
2. **Remove the card's ROC row for CSP.** With a single basis it equals "Return by expiration". One name per concept.
3. **Relocate, do not delete, decision values.** Cash Required: second line of the strike cell. Breakeven: second line of the OTM cell, labeled `BE` with a tooltip "Assignment basis: strike minus bid".
4. **Trim the ambient line to `Bid $x · Ask $y`.** Bid/ask width stays visible so a trader can judge whether a mid fill is realistic. Remove the repeated Δ, POP, OTM, OI and Credit, and the inline OI warning text when the table already shows the OI floor flag. The quality-warning banner stays.
5. **Mostly intrinsic label.** When bid > 0 and intrinsic >= 50% of the bid, show a `Mostly intrinsic` chip beside Return by expiration and show intrinsic and extrinsic dollars in its tooltip. Intrinsic = max(0, strike - underlying price). If the bid is below intrinsic, the tooltip says so (a stale or illiquid quote signal). The figure stays visible; the chip carries the warning. No row is hidden or demoted by this label.
6. **Ann. Yield is neutral for CSP.** It renders uncolored; the 30-day comparison status keeps the decision-weight color. Annualizing a short cycle overstates, so it must not outweigh the cycle return.
7. **Order modal pre-fill uses the bid basis.** `CspTradeModal` initializes `entryLimit` from the bid-based premium per contract (bid x 100). If no bid is available the field starts empty and must be entered; it never falls back to mid. The modal's existing live-quote validation is unchanged. This is an order-path change and carries the full gate.
8. **Other surfaces follow the card.** Expanded section, audit card table cells, best-opportunity rows and PDF use the bid-based fields. The CSV keeps its existing mid columns unchanged (downstream and audit-trail safety) and **adds** `bidCredit` and `bidBreakeven` columns; existing headers are relabeled `...Mid` where they are mid-based.
9. **Scoring stays on mid in this ticket.** `roc`, `annualizedRoc`, `extrinsicRoc` and the score dimensions keep their current inputs, so for this ticket the card's displayed basis (bid) and the ranking basis (mid) differ. Mid is somewhat generous on wide spreads, so wide-spread names can rank slightly higher than their bid-basis yield justifies; the existing extrinsic scoring limits the deep-in-the-money distortion. The scoring change is a separate ticket, CSP-SCORE-BASIS-0001 (Ian, Alan), which Paul schedules on `docs/ROADMAP.md` when this ticket is approved.

## Rules for missing or edge inputs (Alan)

- Bid missing: Premium, BE and yields show `—`; Mostly intrinsic chip absent; no fallback to mid.
- Bid = 0: Premium shows $0.00 and Return 0.00%; chip absent (no division by zero).
- DTE <= 0 or non-integer: cycle and annualized returns show `—` (existing `calculateCspReturnThisCycle` behavior).
- Underlying price missing: chip absent; nothing else changes.
- Rounding: dollars to 2 decimals, percentages to the card's existing precision (Return 2 decimals, Ann. Yield 0 decimals).
- Units: Premium is total dollars (bid x 100 x contracts); BE and bid/ask are per share; Cash Required is strike x 100 x contracts (existing `requiredCash`).

## Required changes

- New pure helper `lib/scans/cspBidDisplay.ts`: `bidCredit`, `bidBreakeven`, intrinsic/extrinsic split and the Mostly intrinsic decision, all null-safe. `app/screener/page.tsx` stays free of new logic and non-page exports.
- New component `features/screener/components/CspCardCells.tsx` for the Premium/Ann. Yield, strike-cell Cash line, OTM-cell BE line and the chip.
- `lib/scans/csp-finder.ts` (`buildSpreadCandidate`): add display fields `bidCredit` and `bidBreakeven` (null when no bid) and the types in `lib/scans/types.ts`. Do not alter `credit`, `roc`, `annualizedRoc` or `breakeven` used by scoring and order guards.
- `app/screener/page.tsx`: card table cells, ROC row hidden for CSP, expanded section (Credit, Breakeven Price, Annualized Return) on bid fields, `CspTradeModal` `entryLimit` initialization.
- `features/screener/components/CspFundamentalsRow.tsx`: reduce to Bid / Ask (shared with the disqualified audit card, which gets the same trim and the same relocated cells).
- `features/screener/lib/bestOpportunityRows.ts`, `features/screener/lib/printScanPdfReport.ts`: read the bid-based fields.
- `features/screener/lib/cspCsv.ts`: add bid columns; relabel mid columns.

## Non-goals

- No change to CSP score, ranking, qualification, IVR, liquidity, capital or earnings logic.
- No change to `cspOrderMath.ts`, `guardCspOrder`, or the modal's live-quote validation.
- No change to spread, CC, PMCC or LEAPS cards.
- Portfolio tab: unchanged. Its premium math was reviewed and is correct (entry credit = sum of broker `average-open-price` x quantity x 100; breakeven = strike - entry credit per share).

## Acceptance criteria

1. **Single basis, card.** Given strike 52, bid 17.20, ask 18.40, mid 17.80, one contract, the card shows Premium $1,720.00, BE $34.80, Return by expiration 33.08%, Ann. Yield 805%, and no $1,780, $34.20, 34.2% ROC or 833%.
2. **No ROC duplicate.** The CSP card has no ROC row.
3. **Relocated values.** Cash Required ($5,200) under the strike and BE under OTM, visible without expanding.
4. **Trimmed ambient line.** Only Bid · Ask; no Δ, POP, OTM, OI or Credit.
5. **Intrinsic label.** For the 52P example (intrinsic 17.44, bid 17.20) the chip shows and its tooltip notes the bid is below intrinsic; for a 35P with bid 1.70 at a $34.56 stock (intrinsic 0.44 = 26% of the bid) there is no chip. Ann. Yield is uncolored in both.
6. **Edge inputs.** Missing bid, zero bid, DTE 0 and missing underlying behave as specified above.
7. **Other surfaces agree.** Expanded section, audit card, best-opportunity rows and PDF show the same Premium and BE as the card. The CSV retains its existing mid columns and gains bid columns.
8. **Order pre-fill (hard).** Opening the CSP order modal for the 52P example pre-fills a limit equal to the card's bid-based Premium per contract ($1,720.00, not $1,780.00); with no bid the field is empty and Place stays disabled until a value is entered.
9. **Scoring unchanged.** Existing score, rank, qualification and order-math tests pass unmodified.
10. **Divergence stated.** The ticket and the CSP-SCORE-BASIS-0001 stub on the roadmap record that scoring uses mid until that ticket ships.

## Golden fixtures (Alan)

| Case | Strike | Bid | Contracts | DTE | Premium | BE | Return | 30-day | Ann. |
|---|---|---|---|---|---|---|---|---|---|
| AVL 52P | 52 | 17.20 | 1 | 15 | $1,720.00 | 34.80 | 33.08% | 66.15% | 805% |
| AVL 35P example | 35 | 1.70 | 1 | 15 | $170.00 | 33.30 | 4.86% | 9.71% | 118% |
| Two contracts | 35 | 1.70 | 2 | 15 | $340.00 | 33.30 | 4.86% | 9.71% | 118% |
| Zero bid | 35 | 0.00 | 1 | 15 | $0.00 | 35.00 | 0.00% | 0.00% | 0% |
| No bid | 35 | null | 1 | 15 | — | — | — | — | — |
| DTE 0 | 35 | 1.70 | 1 | 0 | $170.00 | 33.30 | — | — | — |

Cash Required: 52P $5,200; 35P $3,500 (two contracts $7,000).

## Validation (Quinn)

- Unit tests for `cspBidDisplay` against the fixture table, including null bid, zero bid, missing underlying, and bid below intrinsic.
- Component tests for `CspFundamentalsRow`, `CspCardCells` (relocated lines, chip with both examples, neutral Ann. Yield, unavailable-bid state), the audit card parity, the expanded section, best-opportunity rows and the PDF row.
- `CspTradeModal` test: pre-filled limit equals the bid-based premium; empty with no bid; live-quote validation unchanged.
- CSV test: existing columns retained, bid columns added, mid columns relabeled.
- Update `app/screener/__tests__/CspCandidateDiscovery.test.tsx`, which asserts the current fundamentals-row contents; it is the only existing test found asserting the old text, and the grep should be re-run at implementation time.
- Regression: `calculateCspReturnThisCycle`, `csp-finder`, `cspScore`, `cspExtrinsicRoc`, `cspOrderMath` and `cspOrderSubmission` tests unmodified and green.
- Verification: full Vitest suite (order path), `tsc` with `tsconfig.check.json`, then Vercel preview Ready on the current pushed head with required CI green before Frank closes the gate. `tsc` alone is not sufficient; `next build` via the preview is authoritative.
- Sibling check at implementation: grep every read of `credit`, `breakeven`, `annualizedRoc` and `cspMid` for CSP candidates and record each as moved, intentionally left on mid, or not a CSP path.

## Open items

- Dean: approve the ticket and the scope above (includes the order-modal pre-fill, which makes this a full-gate ticket).
- Paul: add CSP-SCORE-BASIS-0001 to `docs/ROADMAP.md` and assign its priority when this ticket is approved.
