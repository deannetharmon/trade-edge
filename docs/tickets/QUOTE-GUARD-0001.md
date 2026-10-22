# QUOTE-GUARD-0001 — The Ranked scan must not rank a credit that only exists at mid

Status: v1, 2026-10-22. Slice A (lib logic, gate, tests) IMPLEMENTED. Width scan control and IC ratio display are follow-ups (below).
Approvals: Ian approve with changes (reuse the existing width limit; disqualify with a visible reason, never a silent warning).
Alan approve with changes (every displayed number recomputed from the executable credit; golden fixtures). Quinn approve with changes
(additive fields, one credit definition, siblings listed). Paul approved scope. An independent read-only review agreed with
"build with changes" and corrected the original diagnosis (see "Corrections"). Dean said go (2026-10-22).

## Problem
SOXL iron condor 63/58 puts + 175/180 calls, exp 2026-11-20, ranked #1: Credit $2.99, Cr Ratio 45%, POP 83%, ROC 149%.
TastyTrade showed $2.98 at mid, so the arithmetic was right, but the market was 63P 1.45 x 5.00, 58P 0.46 x 1.50,
175C 0.85 x 2.27, 180C 0.70 x 0.95. Selling at the bid and buying at the ask is a $0.15 debit.

Cause: the Ranked iron condor used `findBestICUnfiltered`, which prices each wing at `shortLeg.mid - longLeg.mid`
(`lib/scans/spread-finder.ts`) with no bid/ask-width check and no natural-price check. The Ranked liquidity label
(`getOiLiquidityLabel`) is open interest only, so the 63P (OI 261) showed "Good liquidity".

## What changed (slice A)
- `lib/scans/quoteQuality.ts` (new): one definition of a usable quote and a wide market. Short leg needs bid > 0, long leg needs
  ask > 0, ask >= bid, finite numbers, and ask - bid <= `getBidAskMax(price)` (the limit the rules-based finders already use).
- `findBestRankedIC` (new, `spread-finder.ts`): the Ranked iron condor now uses the executable credit (natural price blended 25%
  toward mid, the convention of the Ranked BPS/BCS rows, the filtered finders and the order ticket). It prefers a wing with usable
  quotes over a wider-market wing, so a wide inner wing never hides a tight outer one, and it keeps (does not drop) a wide candidate
  so the row can be shown as Disqualified with the numbers. `findBestICUnfiltered` is unchanged (Targeted mode and the checklist).
- Ranked BPS/BCS rows (`rank-scoring.ts`): already used the executable credit; they now also carry the market assessment, and a
  width with usable quotes wins over a wider-market width.
- A `market` check (`rankChecks.ts`) is a gate only when a row has one (`rankedGateKeysFor`). Targeted rows and rows saved before
  this change keep their previous state. A failing market check disqualifies the row, removes it from Best Opportunities (which
  requires `qualified`), and adds a `failReasons` entry. The badge reads, for example, "Disqualified: wide market (63P 1.45 x 5.00)".
- Additive fields on `SpreadCandidate`: `marketAssessment`, `shortCallBid/Ask`, `longCallBid/Ask`. Reused: `midCredit`,
  `naturalCredit`, `spreadFriction`.
- Ranked iron condor `credit`, `callCredit`, `totalCredit`, ROC and capital are now executable, as `findBestIC` already defines them,
  so the order ticket (default limit = `totalCredit ?? credit`) pre-fills a price that can be filled. `creditRatio` stays put-side,
  now from the executable credit.

## Effect on ranking (Ian, Alan)
Ranked iron condors now score on the executable credit, the same convention as Ranked BPS/BCS rows, so condor credit, ROC and
credit ratio come out lower than before whenever the market has any friction (mid minus 75% of the friction). This is intended.
SOXL example: credit 0.63 (was 2.99), ROC 14.4% (was 149%), POP unchanged at 83% (delta based).

## Verification
- Golden fixture: the SOXL chain above (`lib/scans/__tests__/quoteGuard.test.ts`); tight-chain case; 0-bid, no-ask, crossed and
  non-finite cases; call short above put short; BPS width preference; gate wiring is additive.
- Mutation check: removing the tradable-wing preference fails exactly the two tests that cover it.
- `tsc --noEmit -p tsconfig.check.json` clean; full Vitest suite 545 files / 7783 tests green locally. CI and the Vercel preview are
  authoritative for the pushed head.

## Corrections to the first diagnosis
- The mid bug is iron-condor-only on the Ranked path. Ranked BPS/BCS already used the executable credit and lacked only the width gate.
- The "0/0 quotes inflate the credit" theory was wrong for this row; the cause was mid-based pricing on wide markets.

## Out of scope, follow-ups
1. SCREENER-QUOTE-WIDTH-0001: a "Market width" scan control (default = `getBidAskMax`) so a trader can loosen the limit, per "trust
   the qualified realm". Needs Diane's mock first. Ian's concern: the fixed $0.10 cap under $100 will disqualify some legitimate
   far-out wings until the control exists.
2. SCREENER-IC-RATIO-0001: show the combined iron condor credit ratio (`totalCredit / widest spread`) in the row; needs a `page.tsx` edit.
3. Targeted mode with no credit-ratio floor (`app/screener/page.tsx` ~7924) and `checklist.ts` ~135 still use `findBestICUnfiltered`
   (mid pricing). Needs its own ticket.
4. `buildRankChecks` applies `ROC_MIN_SPREAD` to iron condors (`rankChecks.ts`) instead of `ROC_MIN_IC`. Pre-existing, separate bug.
5. Ranked CSP and CC paths were not changed; `csp-finder.ts` has its own bid/ask-width logic. Not audited in this ticket.
6. After-hours banner (scans run with the market closed carry stale or empty quotes).
