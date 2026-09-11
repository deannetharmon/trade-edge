# PMCC-0003 Package A — Implementation Report

**Status:** Implemented in shadow; cross-functional review requested

**Date:** 2026-09-11

**Scope:** Package A only; Packages B–F remain gated

## Outcome

Package A introduces pure, versioned contracts for the three approved finder
workflows and their shared policy boundaries. Nothing in this package is wired
into a launcher, live scanner, order review, broker route, or production ranking
consumer. Existing user behavior is unchanged.

## Files changed

| File | Purpose |
|---|---|
| `lib/scans/pmccFinderPolicy.ts` | Workflow identities; short-call cadence, LEAPS window, PMCC cushion, and held-runway policies |
| `lib/scans/pmccEarningsPolicy.ts` | Earnings evidence taxonomy and expiration-relative trading-session evaluation |
| `lib/scans/pmccRankingPolicy.ts` | Qualified-only normalized ranking weights and deterministic tie-break contract |
| `lib/screener/pmccFinderSessionSchema.ts` | V2 workflow-specific cache keys and fail-closed envelope validation |
| `lib/scans/__tests__/pmccFinderPolicy.test.ts` | Cadence, LEAPS, cushion, and runway unit/boundary tests |
| `lib/scans/__tests__/pmccEarningsPolicy.test.ts` | Confirmed, pending, unknown, stale, not-scheduled, and not-applicable earnings tests |
| `lib/scans/__tests__/pmccRankingPolicy.test.ts` | Weight, qualification, completeness, normalization, and tie-break tests |
| `lib/screener/__tests__/pmccFinderSessionSchema.test.ts` | Workflow isolation, version mismatch, payload, and legacy rejection tests |
| `docs/reviews/PMCC-0003-Package-A-Data-Availability.md` | Repository data audit and explicit gaps |
| `PMCC_SPECIFICATION.md` | Marks the conflicting historical specification superseded |
| `docs/tickets/PMCC-0003-qualified-ranked-finders.md` | Records Package A return-for-review status |

## Architecture and reuse

The new modules are pure and dependency-light so later packages can compose
them around existing acquisition and safety services without duplicating those
services. The planned integration reuses:

- Tastytrade/OCC contract identity and current quote acquisition.
- `pmccPairing.ts` conservative long-ask/short-bid economics, exact pairing,
  net debit, width, cushion, and net delta.
- `pmccHeldLeaps.ts` account, position, OCC, quantity, and held-foundation
  identity.
- Existing lifecycle, reconciliation, trade-review, and coverage safeguards.

No workflow/session migration is active. Package A defines three future-safe
identities—`leaps`, `new-pmcc`, and `leaps-short-call`—plus distinct V2 cache
keys. A wrong-workflow, wrong-policy, malformed, or ambiguous legacy `pmcc`
finder record requires a rescan. Campaign, Trade Log, position, broker, and
historical records are not deleted or rewritten.

## Policies introduced

| Policy | Version | Contract |
|---|---|---|
| Workflows | `pmcc-workflows-v2-shadow` | Three distinct discovery/order intents |
| Cadence | `short-call-cadence-v1-shadow` | 5–9, 10–18, and 25–45 DTE profiles; Auto may inspect 19–24 DTE; global delta 0.10–0.35 |
| LEAPS | `leaps-entry-v2-shadow` | Supported 180–900 DTE / 0.65–0.90 delta; primary 365–900 / 0.70–0.90; preferred 540–900 / 0.75–0.85 |
| Cushion | `pmcc-cushion-v1-shadow` | Structural net debit below width; recommendation floor `max($1.00, 3% of net debit)` per share |
| Held runway | `held-leaps-runway-v1-shadow` | Under 30 days fail; 30–89 caution; 90+ preferred |
| Earnings | `pmcc-earnings-v1-shadow` | Confirmed event boundaries; pending range uses earliest date and fails closed inside 10-session buffer; unknown/stale unavailable |
| Ranking | `pmcc-ranking-v1-shadow` | Safety 30, liquidity 20, LEAPS quality 15, capital efficiency 15, premium quality 10, upside 10 |

Ranking is available only when the candidate is qualified and all six
normalized dimensions are present. Exact ties resolve by greater cushion,
better worst-leg liquidity, lower modeled slippage, lower LEAPS extrinsic
burden, lower capital, then stable OCC order.

Held contracts are not retroactively judged as new purchases. A held long that
falls outside new-entry LEAPS bands retains that variance as disclosure; later
packages must still apply exact identity, deliverable, coverage, runway, quote,
earnings, and short-call safety gates.

## Calculations and explanations

Package A calculates and returns explainable policy facts only:

- Cadence support/preference and the matched profile.
- LEAPS supported, primary, and preferred band status.
- Strike width, net debit, dollar cushion, cushion percentage, and the dynamic
  recommendation minimum.
- Calendar-day runway beyond the proposed short expiration.
- Trading sessions strictly between short expiration and the earliest relevant
  earnings date. The predicate is injectable so a market-calendar service can
  replace the weekday-only test default in a later package.
- Weighted score components, incomplete dimensions, total score, and stable
  tie-breaking.

## Data availability and limitations

Current data is sufficient for exact option identity, bid/ask, delta, open
interest, quote metadata where supplied, underlying price, conservative natural
execution, pair economics, held identity/account context, and existing market
context.

Canonical confirmed earnings provenance, bounded estimate ranges, provider
coverage horizons, option volume, dividends/ex-dividend dates, fees, aggregate
Greeks beyond delta, future LEAPS valuation, and modeled price improvement are
not currently complete. They remain unavailable rather than inferred. See
`PMCC-0003-Package-A-Data-Availability.md` for the field-level audit.

## UX and activation

No UX was changed. The approved future launchers remain `FIND LEAPS`, `FIND NEW
PMCC`, and `LEAPS SHORT CALLS`; Package A only freezes their internal identities.
No order shape or transmission authority changed.

## Validation results

- Package A tests: **65 passed / 65** across four files.
- TypeScript: **passed** with `npx tsc --noEmit`.
- Existing targeted PMCC/LEAPS regression: **113 passed / 114** across 17 files.
  The one failure is an untouched pre-existing mismatch in
  `pmccDecision.test.ts`: stale held-leg evidence expects `WAIT_MONITOR/BLOCKED`,
  while the current implementation returns `READY/HELD_PMCC_REVIEW_ONLY`.
- Full repository test run: **3,141 passed / 3,153**; **12 failed** across six
  untouched test files. Package A modules were not imported by those failing
  suites. The failures are recorded as baseline debt, not changed under this
  package's authority.
- Production build: **passed**. Local Redis connection-refused warnings occurred
  during static page collection, but the build completed successfully.
- `git diff --check`: **passed**.

## Deferred work and gate disposition

- Active cache migration, workflow renaming, and held-flow preservation are
  Package B.
- New complete-pair discovery is Package C.
- Old/new shadow fixtures and ranking-distribution comparison are Package D.
- Recommendation UX is Package E.
- Submission-time revalidation and final handoff are Package F.
- Earnings acquisition/provider selection, exchange-holiday calendar wiring,
  dividend evidence, and any valuation model remain explicit integration risks.

Package A is ready for Ian, Diane, Quinn, Dane, Paul, and Frank to review. It
does not authorize Package B or any user-visible activation.
