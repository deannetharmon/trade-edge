# CSP-CARD-0001 — CSP Result Card: Single Premium Basis and De-duplicated Layout

**Status:** Draft — needs Paul (scope), Ian (display basis, intrinsic label threshold), Alan (formula fixtures)
**Mock:** `docs/tickets/mockups/csp-card-0001-mock.html` (Diane)
**Scope:** CSP result card display only (qualified `ResultCard` and the disqualified audit card, which share `CspFundamentalsRow`). No change to scoring, ranking, qualification, or order paths.

## Problem

1. **Two premium bases on one card.** `csp-finder.ts` builds `credit`, `roc`, `annualizedRoc` and `breakeven` from the option **mid** (`c.mid * 100`, `strike - mid`). `calculateCspReturnThisCycle` builds "Return by expiration" and "30-day comparison" from the executable **bid**. Example (AVL 52P): Return by expiration 33.08% (17.20 / 52) beside ROC 34.2% (17.80 / 52); Breakeven $34.20 (mid) where the bid-based figure is $34.80. A seller realistically fills near the bid, so the mid figures overstate.
2. **Duplicated metrics.** The line under the Research button (`CspFundamentalsRow`) repeats Δ, POP, OTM, OI and Credit, all already in the table columns.
3. **Decision values below the fold of the table.** Breakeven and Cash Required are decision-weight for a CSP but sit only in the ambient line.
4. **Misleading yield on deep in-the-money puts.** AVL 52P at a $34.56 stock: $17.44 intrinsic of a $17.80 mid. "Ann. Yield 833%" reads as premium income and is nearly all intrinsic value.
5. Related history: CSP-0002 added the long line so Bid/Ask, Credit, Cash Required and Breakeven would be visible without expanding the card. That visibility must be preserved, only relocated.

## Product decisions

1. **One basis: executable bid.** On the CSP card, Premium, Breakeven, Ann. Yield and the cycle return all derive from the short put bid. Premium per contract = bid x 100 x contracts; Breakeven = strike - bid. Source the cycle and annualized return from the existing `calculateCspReturnThisCycle` (`cycleReturnPct`, `bidBasedAnnualizedReturnPct`); do not re-derive them.
2. **Remove the card's ROC row for CSP.** With a single basis it equals "Return by expiration" (identical value, different name). One name per concept: keep "Return by expiration" and "30-day comparison".
3. **Relocate, do not delete, decision values.**
   - Cash Required: second line of the strike cell, under `Put 52`.
   - Breakeven: second line of the OTM cell, labeled `BE`.
4. **Trim the ambient line to `Bid $x · Ask $y`.** Remove the repeated Δ, POP, OTM, OI and Credit. Remove the inline OI warning text when the table already shows the OI floor flag; keep the quality-warning banner.
5. **Mostly-intrinsic label.** When intrinsic value is at least 50% of the bid, show a `Mostly intrinsic` chip beside Return by expiration, show intrinsic and extrinsic dollars in its tooltip, and render Ann. Yield without the green/yellow/red yield coloring. Intrinsic = max(0, strike - underlying price). If the bid is below intrinsic (negative extrinsic), say so in the tooltip; it signals a stale or illiquid quote. The 50% threshold is Ian's to confirm.
6. **Scoring stays on mid in this ticket.** `roc`, `annualizedRoc`, `extrinsicRoc` and the score dimensions keep their current inputs. Add display-only bid fields to the candidate; changing the scoring basis is a separate ticket (CSP-SCORE-BASIS-0001, Ian and Alan) because it moves rankings.

## Required changes

- `lib/scans/csp-finder.ts` (`buildSpreadCandidate`): add display fields `bidCredit` (bid x 100 x contracts) and `bidBreakeven` (strike - bid), null when the bid is unavailable. Do not alter `credit`, `roc`, `annualizedRoc`, `breakeven` used by scoring and order paths until the follow-up ticket.
- `app/screener/page.tsx` (card table, around the Premium, ROC, OTM and strike cells): CSP reads the bid fields for Premium and Ann. Yield; the ROC row is hidden for CSP; add the Cash Required and BE second lines; add the Mostly intrinsic chip.
- `features/screener/components/CspFundamentalsRow.tsx`: reduce to Bid / Ask. It is shared by the disqualified audit card, so the audit card gets the same trim and keeps Cash Required and BE in its own table cells.
- Unavailable bid: show `—` and an honest reason; never fall back silently to mid.
- Order path: confirm during implementation that the CSP order ticket pre-fills the limit price it displays and states which price it uses. Not changed here.

## Non-goals

- No change to CSP score, ranking, qualification, IVR, liquidity, capital or earnings logic.
- No change to spread, CC, PMCC or LEAPS cards.
- No change to max loss or order math (`cspOrderMath.ts`).

## Acceptance criteria

1. **Single basis.** Given a CSP with bid 17.20, ask 18.40, mid 17.80, strike 52, one contract, the card shows Premium $1,720.00, BE $34.80, Return by expiration 33.08%, and no mid-derived $1,780 or $34.20.
2. **No ROC duplicate.** The CSP card shows no ROC row; Return by expiration and 30-day comparison remain.
3. **Relocated values.** Cash Required ($5,200) appears under the strike and BE under OTM, in the table, without expanding the card.
4. **Trimmed ambient line.** The line under Research shows only Bid · Ask and contains no Δ, POP, OTM, OI or Credit.
5. **Intrinsic label.** For the 52P example (intrinsic 17.44 of bid 17.20), the card shows `Mostly intrinsic`, notes the bid is below intrinsic, and Ann. Yield has no green yield coloring. For a 35P near the money (intrinsic 0.44 of bid ~1.70) there is no chip.
6. **Unavailable bid.** With no bid, Premium, BE and yields show `—`; they do not fall back to mid.
7. **Scoring unchanged.** Existing score, rank and qualification tests pass unmodified.
8. **Audit card parity.** The disqualified audit card shows the same trimmed line and the same relocated values.

## Validation

- Unit tests for `bidCredit` and `bidBreakeven` (including null bid) and golden fixtures from the AVL examples above (Alan).
- Component tests for the trimmed `CspFundamentalsRow`, the relocated cells, the Mostly intrinsic chip with both examples, and the unavailable-bid state.
- Regression: `calculateCspReturnThisCycle`, `csp-finder`, `cspScore`, `cspExtrinsicRoc` and `cspOrderMath` tests unmodified and green.
- Risk is low-to-moderate (display only, shared component). Targeted tests plus the configured TypeScript check before push; Vercel preview Ready on the current head before closing the gate.

## Open items

- Ian: confirm the 50% intrinsic threshold and that scoring stays on mid until CSP-SCORE-BASIS-0001.
- Paul: confirm the follow-up ticket for the scoring basis.
