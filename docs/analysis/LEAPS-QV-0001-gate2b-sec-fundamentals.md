# LEAPS-QV-0001 Gate 2b — SEC Fundamentals Adapter

Free data path: SEC EDGAR XBRL `companyfacts` (no key, no paid dependency). Metrics only: no thresholds, scores, classifications, rankings or lifecycle logic (Gate 3). Find LEAPS is untouched.

## Operating requirement
`SEC_USER_AGENT` must be set (Vercel, server-only), e.g. `TradeEdge Dean Harmon <email>`. SEC fair-access policy requires a name and contact email. There is no default: without it every SEC call fails closed (`PROVIDER_FAILURE`, reason `SEC_USER_AGENT_MISSING`, metrics UNAVAILABLE).

## Layout
| Path | Role |
| --- | --- |
| `lib/discovery/normalized/sec/` | Pure: concept map, fact compaction/resolution, fiscal periods and TTM, valuation history, builder. No I/O, no clock. |
| `lib/fundamentals/sec/client.ts` | SEC HTTP client: User-Agent, request spacing, TTL cache, in-flight dedupe, negative cache, typed errors, counters. |
| `lib/fundamentals/secFundamentals.ts` | Loader: ticker → CIK → facts → metrics; coverage semantics. |
| `lib/fundamentals/handler.ts`, `app/api/fundamentals/route.ts` | `GET /api/fundamentals?symbol=` — session required; server-side Yahoo closes (~6 years, `quote` series, never `adjclose`). Nothing calls it yet. |

## Concept map `SECMAP-v1.0` (pinned by a fingerprint test)
- Modes: **EQUIVALENT** (several tags mean the same thing; if they disagree for a period → AMBIGUOUS) and **ORDERED** (first tag with any value wins, so a different-meaning fallback tag is never mixed in).
- Per period the **latest-filed** value wins (restatements, 10-K/A). Two different values filed the same day → AMBIGUOUS. Accepted forms: 10-K, 10-K/A, 10-Q, 10-Q/A; units must be exact (USD, USD/shares, shares).
- `fy`/`fp` on a fact describe the filing, not the period, so they are never used. Periods are classified by day length (quarter 80–100, H1 170–195, 9M 260–285, FY 350–380).

## Definitions
- **TTM** = FY(previous) + YTD(current) − YTD(prior year); at a fiscal-year end TTM = FY. 10-Q cash-flow items exist only as YTD, so quarters are never assumed. Works for non-December and 52/53-week years (only day gaps are checked).
- **One anchor**: the latest fiscal-year-to-date period. Every item is evaluated there; there is no fallback to an older period.
- **FCF** = operating cash flow − capex (`PaymentsToAcquirePropertyPlantAndEquipment`, else `PaymentsToAcquireProductiveAssets`).
- **EBITDA-v1** = operating income + depreciation & amortization.
- **Total debt (debt-v1)**: recipe A `LongTermDebt` (+ short-term borrowings, commercial paper if reported); B noncurrent + current portions (+ same optionals); C noncurrent + `DebtCurrent`. If A and B can both be computed and disagree → AMBIGUOUS.
- **Market cap** = last VALID close × cover-page shares (`dei:EntityCommonStockSharesOutstanding`, dated on or after the period end), cross-checked against weighted diluted shares: more than 25% apart → INVALID (multi-class risk).
- **EV** = market cap + total debt − cash. **ROIC-v1** unchanged from Gate 2 (Ian-approved).
- **5-year metrics** use six consecutive fiscal years (five intervals); gaps → UNAVAILABLE.
- **P/E history (Section 12)**: one TTM EPS observation per reported period, usable from its first-published date; daily closes over 3y/5y; median, inclusive percentile, discount to median. Needs a VALID current P/E and genuine window coverage (data sufficiency, not an investment threshold): ≥75% of window days valid, first valid day within 90 days of window start. Negative/zero-EPS days excluded.
- **Split guard**: weighted diluted shares moving ≥1.8× between consecutive periods excludes every older observation (fail closed, never rescaled).

## Status semantics
Not covered (ticker absent, no companyfacts, not US-GAAP XBRL) → every metric UNAVAILABLE, coverage `NOT_COVERED` (HTTP 200). Item not reported → UNAVAILABLE (`SEC_ITEM_NOT_REPORTED:<item>`). Ambiguous / inconsistent / non-positive base → INVALID with a reason. Provider failure → HTTP 502, `PROVIDER_FAILURE`. Staleness: > 135 days since the newest filing → STALE (Section 8).

## Not implemented here (stay UNAVAILABLE / catalog-only)
Forward estimates, revisions, guidance, event feeds, PEG (`corporate_event_flags`), EV/EBITDA history (needs historical EV inputs: `HISTORICAL_EV_INPUTS_NOT_SUPPORTED`), and Gate 3 definitions: consistency, stability, FCF trend (inputs are exposed in `annualSeries`).

## Observability
Client counters (requests, cache hits/misses, in-flight joins, spacing waits, errors by code); per-result diagnostics: concept-map version, anchor, unresolved items with reasons, restated pieces, dropped facts by reason, observation count, excluded observations. Provenance per metric: tag, unit, period, value, accession, form, filing date, restated flag.

## Limitations
- Cache and request spacing are per serverless instance (Vercel does not share memory); a shared Redis cache is a follow-up. Spacing ~6 requests/s per instance.
- Debt-free issuers that tag no debt are UNAVAILABLE, not zero.
- P/E history uses latest-filed (restated) EPS, so restatements are visible to older observations.
- Data-sufficiency constants (0.75, 90 days, 1.8×, 25%) need Ian's review.
- Built and tested against synthetic fixtures; the build sandbox cannot reach SEC. A live payload check needs `SEC_USER_AGENT` in a deployed environment.
