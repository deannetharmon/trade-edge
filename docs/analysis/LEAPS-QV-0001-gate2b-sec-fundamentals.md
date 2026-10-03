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

## Concept map `SECMAP-v1.1` (pinned by a fingerprint test)
- Modes: **EQUIVALENT** (several tags mean the same thing; if they disagree for a period → AMBIGUOUS) and **ORDERED** (first tag with any value wins, so a different-meaning fallback tag is never mixed in).
- Per period the **latest-filed** value wins (restatements, 10-K/A). Two different values filed the same day → AMBIGUOUS. Accepted forms: 10-K, 10-K/A, 10-Q, 10-Q/A; units must be exact (USD, USD/shares, shares).
- `fy`/`fp` on a fact describe the filing, not the period, so they are never used. Periods are classified by day length (quarter 80–100, H1 170–195, 9M 260–285, FY 350–380).

## Definitions
- **TTM** = FY(previous) + YTD(current) − YTD(prior year); at a fiscal-year end TTM = FY. 10-Q cash-flow items exist only as YTD, so quarters are never assumed. Works for non-December and 52/53-week years (only day gaps are checked).
- **One anchor**: the latest fiscal-year-to-date period. Every item is evaluated there; there is no fallback to an older period.
- **FCF** = operating cash flow − capex (`PaymentsToAcquirePropertyPlantAndEquipment`, else `PaymentsToAcquireProductiveAssets`).
- **EBITDA-v1** = operating income + depreciation & amortization.
- **Total debt (debt-v1.1)**: tried in order B (noncurrent + current portions + short-term borrowings / commercial paper if reported), C (noncurrent + `DebtCurrent`), A (footnote `LongTermDebt` + same optionals). When A and B can both be computed their long-term parts must agree within 2% (`DEBT_RECIPE_TOLERANCE`), otherwise AMBIGUOUS. Balance-sheet components are preferred because 10-Q footnote `LongTermDebt` is rounded (see live validation).
- **Market cap** = last VALID close × cover-page shares (`dei:EntityCommonStockSharesOutstanding`, dated on or after the period end), cross-checked against weighted diluted shares: more than 25% apart → INVALID (multi-class risk).
- **EV** = market cap + total debt − cash. **ROIC-v1** unchanged from Gate 2 (Ian-approved).
- **5-year metrics** use six consecutive fiscal years (five intervals); gaps → UNAVAILABLE.
- **Per-share basis guard (annual EPS)**: walking back from the newest year, a jump of 1.8x or more (either way) in weighted diluted shares, or a year whose share count cannot be checked, makes every OLDER year's EPS unusable. `annualSeries.dilutedEps` is null for those years (issue `SPLIT_OR_SHARE_STRUCTURE_CHANGE_SUSPECTED` / `EPS_SPLIT_CHECK_NOT_POSSIBLE`); `eps_cagr_5y_pct` is INVALID / UNAVAILABLE when the break falls inside its six-year window. Split-adjusted EPS appears only in filings that restate a year as a comparative, so older years can keep pre-split EPS.
- **P/E history (Section 12)**: one TTM EPS observation per reported period, usable from its first-published date; daily closes over 3y/5y; median, inclusive percentile, discount to median. Needs a VALID current P/E and genuine window coverage (data sufficiency, not an investment threshold): ≥75% of window days valid, first valid day within 90 days of window start. Negative/zero-EPS days excluded.
- **Current-basis guard (TTM EPS)**: the weighted diluted shares of the anchor period (and, for the prior-year TTM, of the prior-year period) must be within 1.8x (either way) of the fiscal year before it. A break (a split after the latest 10-K) makes `pe_ttm`, `eps_growth_yoy_ttm_pct` and the P/E history INVALID; a missing share count makes them UNAVAILABLE (`EPS_SPLIT_CHECK_NOT_POSSIBLE`). `annualSeries` EPS is internally consistent per year but may be on a different basis than TTM when `diagnostics.itemIssues.epsBasis` is set. Do not compare them then.
- **Split guard**: weighted diluted shares moving ≥1.8× between consecutive periods excludes every older observation (fail closed, never rescaled).

## Status semantics
Not covered (ticker absent, no companyfacts, not US-GAAP XBRL) → every metric UNAVAILABLE, coverage `NOT_COVERED` (HTTP 200). Item not reported → UNAVAILABLE (`SEC_ITEM_NOT_REPORTED:<item>`). Ambiguous / inconsistent / non-positive base → INVALID with a reason. Provider failure → HTTP 502, `PROVIDER_FAILURE`. Staleness: > 135 days since the newest filing → STALE (Section 8).

## Not implemented here (stay UNAVAILABLE / catalog-only)
Forward estimates, revisions, guidance, event feeds, PEG (`corporate_event_flags`), EV/EBITDA history (needs historical EV inputs: `HISTORICAL_EV_INPUTS_NOT_SUPPORTED`), and Gate 3 definitions: consistency, stability, FCF trend (inputs are exposed in `annualSeries`).

## Observability
Client counters (requests, cache hits/misses, in-flight joins, spacing waits, errors by code); per-result diagnostics: concept-map version, anchor, unresolved items with reasons, restated pieces, dropped facts by reason, observation count, excluded observations. Provenance per metric: tag, unit, period, value, accession, form, filing date, restated flag.

## Limitations
- Cache and request spacing are per serverless instance (Vercel does not share memory); a shared Redis cache is a follow-up. Spacing ~6 requests/s per instance. **Per-instance throttling does not guarantee that aggregate SEC traffic stays below the SEC fair-access ceiling (10 requests/s total) under horizontally concurrent serverless execution.** Acceptable for QV-v1.0 because issuer facts are cached and change rarely; do not intentionally parallelize large numbers of uncached SEC requests. A shared cache / global limiter becomes required if real scan load shows it.
- Debt-free issuers that tag no debt are UNAVAILABLE, not zero.
- **Known gaps pinned by tests (for Ian):** the 1.8x split threshold does not flag a 3:2 split (1.5x) or a 2:1 split offset by a large same-year buyback; real share issuance of 1.8x or more is labelled like a split (conservative). Debt: only the first computable recipe is used (B, then C, then A); only A vs B is cross-checked (A vs C and B vs C are not); a rounded footnote on debt below about $2.5B can exceed the 2% tolerance and fails closed.
- Data-quality constants added in v1.1: `DEBT_RECIPE_TOLERANCE` 2% (needs Ian's ruling). The EPS-growth (TTM vs prior TTM) metric is not separately split-guarded; its pieces come from the same or adjacent filings.
- P/E history uses latest-filed (restated) EPS, so restatements are visible to older observations.
- Data-sufficiency constants (0.75, 90 days, 1.8×, 25%) need Ian's review.
- Built and tested against synthetic fixtures; the build sandbox cannot reach SEC. A live payload check needs `SEC_USER_AGENT` in a deployed environment.

## Live validation (exit condition)
- **Symbol / environment / time:** AAPL, production (`/api/fundamentals?symbol=AAPL`, signed in), 2026-10-03 ~17:41 UTC, commit `02a9e9c`, concept map `SECMAP-v1.0`.
- **Coverage:** `COVERED`, CIK `0000320193`, `priceIssue: null`. Fiscal calendar (52/53-week, September year end) and M9 (nine-month) anchor ending 2026-06-27 resolved correctly.
- **VALID:** operating margin TTM (33.17%), FCF TTM, FCF margin, FCF yield, P/E TTM, revenue CAGR 5y, EPS CAGR 5y, EPS and revenue growth YoY, operating-margin trend and change, current ratio, price/FCF, all six P/E history metrics (3y and 5y; the split guard excluded the pre-2020-split observation at 2019-06-29, as designed).
- **Hand check:** TTM operating income = 133,050 + 122,432 - 100,623 = 154,859 (million USD); TTM revenue = 466,823; margin 33.17% matches. TTM FCF = (111,482 + 116,996 - 81,754) - (12,715 + 6,799 - 9,473) = 136,683 matches. Provenance cites accession, form and filing date for every piece.
- **UNAVAILABLE (expected):** `interest_coverage` - Apple's latest fiscal year has no `InterestExpense` fact.
- **Defects found and fixed (SECMAP-v1.1 / DEBT-v1.1):**
  1. `total_debt`, `net_debt`, `net_debt_to_ebitda`, `roic_v1_pct`, `ev_to_ebitda_ttm` were INVALID (`AMBIGUOUS_CONCEPT:totalDebt`): footnote `LongTermDebt` in 10-Qs is rounded to $0.1bn (e.g. 91,800 vs balance-sheet components 82,430 + 9,345 = 91,775), so exact A/B agreement was wrong. Fix: balance-sheet recipes first; A/B tolerance 2%. Regression tests added.
  2. `sector_classification` was INVALID (`SUBMISSIONS_AS_OF_INVALID`): the evaluation clock was read before the SEC fetches, so the submissions fetch time was later than "now". Fix: clock read after all I/O. Regression test added.
  3. `annualSeries` carried pre-split EPS for FY2016-17 (EPS 8.31, 9.21 next to split-adjusted 2.98). Fix: per-share basis guard above. Regression tests added. (The 5-year CAGR window FY2020-25 was already on one basis.)
- **Re-verified live (production, `a803512`, `SECMAP-v1.1`, 2026-10-03 ~17:53 UTC), AAPL:** `COVERED`, `priceIssue: null`.
  - Debt now resolves by recipe B: 71,340 + 11,007 + 1,997 (commercial paper) = 84,344 million USD total debt; net debt 44,800 (cash 39,544). `net_debt_to_ebitda` 0.267, `roic_v1_pct` 90.3, `ev_to_ebitda_ttm` 29.26 are VALID. Hand check: TTM EBITDA = 154,859 + 13,100 = 167,959; EV = market cap + 44,800.
  - `sector_classification` VALID (SIC 3571).
  - `annualSeries` FY2016-17 `dilutedEps` null with issue `SPLIT_OR_SHARE_STRUCTURE_CHANGE_SUSPECTED:dilutedEps`; FY2018-25 EPS on one split-adjusted basis.
  - Every other metric unchanged from the first run; only `interest_coverage` remains UNAVAILABLE (no `InterestExpense` fact in Apple's latest fiscal year).
  - No unexpected tag-resolution behavior remaining. `FORM_NOT_USED` dropped facts: 119 (non-10-K/10-Q forms), as designed.
- No environment values are recorded here.
