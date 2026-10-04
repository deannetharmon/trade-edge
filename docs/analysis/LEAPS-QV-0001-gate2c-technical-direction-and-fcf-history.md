# LEAPS-QV-0001 Gate 2c — Technical Direction Metrics and FCF History (data amendment)

**Status: IMPLEMENTED — PENDING REVIEW (baseline 2b36080; see section 11 for implementation decisions).** Gate 2c remains separate from Gate 3 algorithm acceptance. Gate 4 stays BLOCKED. Ratified QV-v1.0 decisions (round 4): relative strength Option A (change >= 0 STABILIZING, > 0 RECOVERING; described as "relative strength no longer deteriorating"); NO second-difference/acceleration metric in QV-v1.0 (Option B is rejected); split-adjusted, dividend-unadjusted price returns for both stock and SPY as the explicit QV-v1.0 price-return convention. Gate 2c data enablement is implemented per this specification; Gate 3 methodology is unchanged.

## 1. Why this amendment exists
Gate 3 implements a strict, fail-closed reading of Section 45.8 (the relative-strength first-difference rule is stricter than the spec wording; see 6.1), so STABILIZING and RECOVERING need direction evidence the normalized layer does not produce, and a negative-FCF company needs annual FCF history. Until this amendment (or an equivalent) is built, the Gate 3 strategy fails closed and **no candidate can reach SETUP or UNDERLYING ACTIONABLE in production**.

Audit of the production path (read from the repository at `76dee26`):

| # | Finding | Evidence |
|---|---|---|
| 1 | Three direction metrics are not produced. | `TECHNICAL_METRIC_IDS` in `normalized/technicals.ts` has no slope, SMA50-gap change or relative-strength change. |
| 2 | **The existing relative-strength LEVEL is also UNAVAILABLE in production.** The loader calls `buildTechnicalMetrics(deps.closes, …)` with no benchmark argument, and no SPY bars are fetched anywhere. | `lib/fundamentals/secFundamentals.ts:86`; `lib/fundamentals/handler.ts` fetches only the requested symbol. Gate 3 requires this metric, so the Technical domain is INSUFFICIENT_DATA for every symbol today. |
| 3 | **Technical metrics never leave the loader.** They are computed only to read `price_last_close` for the P/E; `LoadedFundamentals.metrics` carries SEC metrics only. | `secFundamentals.ts:86-97`. |
| 4 | The completed-bar rule is not enforced at the fetch boundary. `technicals.ts` states its input must be COMPLETED daily bars and "the caller drops the still-forming bar", but `fetchYahooPriceHistory` keeps whatever Yahoo returns (a partial current-session bar during market hours). | `handler.ts` fetch/parse loop; no `completedBars` call. |
| 5 | `fcf_annual_history_5y` is not produced; the SEC adapter already computes the per-year values it needs (section 8). | `normalized/sec/secFundamentals.ts` `AnnualPoint`, `buildAnnualSeries`. |
| 6 | No production code assembles a `StrategyInput` from SEC + technical + risk metrics. `days_to_next_earnings` is catalogued, `corporate_event_flags` is not. | Out of Gate 2c scope; listed so the blocker list is complete (Gate 7 / separate ticket). |

Findings 2–4 widen the original ask: three metrics alone would not unblock SETUP. They are in scope below because the direction metrics depend on the same bars and the benchmark.

## 2. Scope
In: the three technical direction metrics; SPY benchmark acquisition and alignment; returning technical metrics from the loader/endpoint; enforcing the completed-bar rule at the fetch boundary; the `fcf_annual_history_5y` metric derived from the existing SEC `annualSeries`.
Out: any threshold, classification, state, scoring or ranking (the normalizer stays investment-logic free; `noInvestmentLogic.test.ts` keeps guarding it); new data providers; UI; Gate 4 or later work; changing Gate 3 rules.

## 3. Conventions reused (no new conventions)
- **Bars:** `DailyBar {t: unix seconds of session open, c: close}`, strictly ascending, finite and positive, completed sessions only. Anything else makes every technical metric INVALID (`barsProblem`).
- **Price basis:** Yahoo `quote` series — split-adjusted, dividend-UNADJUSTED (never `adjclose`). All metrics are price-return measures.
- **Observation date (`asOf`):** the timestamp of the last bar, as every existing technical metric. Weekly values come from completed Monday-based weeks (`periodCloses`): the in-progress week is dropped unless the evaluation time is in a later week.
- **Freshness:** `normalizeNumberMetric` with `TECHNICAL_MAX_BAR_AGE_MS` (7 days) ⇒ older than that is STALE. A STALE metric exposes no value to the strategy (`readNumber` reads it as missing).
- **Provenance:** `{ provider: 'yahoo', field: 'daily_close' }`; benchmark-derived metrics add `benchmark: 'SPY'`.
- **Lookbacks are bar counts, not calendar days** (as existing: SMA slope 20 bars, relative return 126 bars). "4 weeks" is 20 completed sessions; "1 week" is one completed week in the weekly series.
- **Every id is always present** in the metric set; absence is UNAVAILABLE, never omission.

## 4. `rsi_weekly_slope_1w`
- **Definition:** weekly RSI(14) of the last completed week minus weekly RSI(14) of the previous completed week.
- **Formula:** `W = wilderRsiSeries(periodCloses(bars, 'WEEK', now))`; `value = W[last] − W[last−1]`. RSI points; positive = rising.
- **Min history:** 16 completed weekly closes (15 for the first RSI value, plus one more). Otherwise UNAVAILABLE `INSUFFICIENT_HISTORY`.
- **Relationship to `rsi_weekly_change_4w`:** computed from the same `W`, so the two are consistent by construction. They are different measurements: slope is the most recent weekly step, the 4-week change spans `W[last] − W[last−4]`. Example: `W = 40, 36, 33, 36, 38` has 4-week change −2 (falling) and slope +2 (turning up); `W = 40, 44, 47, 43, 41` has change +1 and slope −2. Gate 3 uses both and does not substitute one for the other.
- **Unavailable / stale / invalid:** no bars ⇒ UNAVAILABLE `NO_PRICE_HISTORY`; bad bars ⇒ INVALID with the `barsProblem` reason; non-finite ⇒ INVALID `NON_FINITE_RESULT`; older than max age ⇒ STALE.

## 5. `price_vs_sma50_gap_change_4w_pp`
- **Definition:** change over 20 sessions in the percentage gap between the close and its own 50-session SMA. Positive = the price moved closer to or further above SMA50 (improving relationship); negative = it moved further below or fell back.
- **Formula:** `gap(i) = (c[i] / SMA50(c[i−49..i]) − 1) × 100`; `value = gap(n−1) − gap(n−21)`. Percentage points.
- **Min history:** 70 bars (50 for the SMA plus 20). Otherwise UNAVAILABLE `INSUFFICIENT_HISTORY`.
- **Not the same as "price above SMA50":** price may sit above SMA50 while the gap is shrinking (value < 0, relationship worsening) or sit below while the gap closes (value > 0). Example: gap +8% → +3% is −5 pp even though price is still above SMA50.
- Unavailable / stale / invalid: as section 4.

## 6. `relative_return_126d_change_4w_pp`
- **Definition:** change over 20 sessions in the 126-session return of the stock minus the 126-session return of SPY.
- **Formula:** `R(i) = (c[i]/c[i−126] − b[i]/b[i−126]) × 100` (the existing `relative_return_126d_vs_benchmark_pct` evaluated at bar `i`); `value = R(n−1) − R(n−21)`. Percentage points; positive = relative strength improving.
- **Min history:** 147 bars for both series (`n−1−20−126 ≥ 0`).
- **Benchmark:** SPY (Ian methodology ruling recorded in the ticket before Gate 2b), fetched through the same Yahoo route and parameters as the stock, so basis and session calendar are identical.
- **SPY alignment (strict, no repair, lookup by required timestamp, never by array position):** the benchmark's last bar timestamp must equal the stock's last bar timestamp, and SPY must contain a bar with exactly the same timestamp at each of the four indexes `n−1`, `n−21`, `n−127`, `n−147`. A missing timestamp ⇒ INVALID `BENCHMARK_NOT_ALIGNED_TO_LOOKBACK_BAR`; last-bar mismatch ⇒ INVALID `BENCHMARK_NOT_ALIGNED_TO_LAST_BAR` (existing reason); invalid benchmark bars ⇒ INVALID with the `barsProblem` reason; no benchmark ⇒ UNAVAILABLE `NO_BENCHMARK_HISTORY`.
- **Adjusted-price consistency:** both series must be split-adjusted, dividend-unadjusted. Dividends are therefore excluded from both legs. This is an explicit v1 convention (price return, not total return), **not** a claim that dividends are immaterial: an ex-dividend step inside either 20-session window can move a stock/SPY difference and can flip a decision whose boundary is zero. Whether total-return series are required is a decision for Ian. The loader asserts both fetches used the `quote` series; any mismatch ⇒ INVALID `ADJUSTMENT_BASIS_MISMATCH`.

### 6.1 Relative-strength change is not acceleration (decision for Ian) — CORRECTED
Let `d = R(n−1) − R(n−21)` (this metric, a first difference) and `dp = R(n−21) − R(n−41)`. Section 45.8 says relative-strength deterioration is "no longer accelerating", a statement about the **second difference** `a = d − dp ≥ 0`.

**The two predicates are incomparable.** `d ≥ 0` does NOT imply `a ≥ 0`, and `a ≥ 0` does not imply `d ≥ 0`:
- `R = 0, 10, 12`: `dp = 10`, `d = 2` (`d ≥ 0` true) but `a = −8` (accelerating deterioration of the gain: `a ≥ 0` false).
- `R = 0, −10, −18`: `dp = −10`, `d = −8` (`d ≥ 0` false) but `a = +2` (`a ≥ 0` true).
(An earlier draft of this section said `d ≥ 0` implies "not accelerating". That was wrong and is withdrawn.)

Gate 3 currently implements `d ≥ 0` (STABILIZING) and `d > 0` (RECOVERING) because it needs only this metric and fails safe. It is a review-time policy choice (A5), not a faithful reading of "no longer accelerating".

Options:
- **A (RATIFIED for QV-v1.0, no extra data):** keep `d ≥ 0` (STABILIZING) / `d > 0` (RECOVERING), described as "relative strength no longer deteriorating".
- **B (REJECTED for QV-v1.0; not to be added):** add `relative_return_126d_acceleration_4w_pp = d − dp` (min 167 bars; SPY aligned at six timestamps). Option B's `d ≥ 0 OR a ≥ 0` is a **union** of incomparable predicates: it admits `R = 0,−10,−18` (still falling) and is not a refinement of A. Choosing B needs an explicit Ian decision on whether a still-falling-but-decelerating case is stabilization.

## 6.2 Exchange calendar and completed-session contract (no guessed closing time)
- Sessions are defined by the exchange calendar for the listing exchange (US equities: NYSE/Nasdaq, `America/New_York`), including early closes (13:00), holidays and DST. No fixed UTC close, "after 21:00 UTC" or similar shortcut is allowed.
- A bar is **completed** only if its session close time (from the calendar) is at or before the evaluation instant. The still-forming bar is excluded from both series.
- If the calendar or the evaluation instant is unavailable, or the latest completed session cannot be determined, every direction metric is UNAVAILABLE `SESSION_CALENDAR_UNAVAILABLE`; the loader never guesses.
- If the series lacks the latest completed session, the metric is UNAVAILABLE `LATEST_COMPLETED_SESSION_MISSING`.
- Weekly bars use Monday-based exchange weeks (a week containing a holiday is still one week; Friday close, or the last session of the week when Friday is closed). The last weekly observation used must be a completed week.
- **Evidence time vs evaluation time:** a weekly metric's `asOf` is the date of the last completed weekly observation, not the evaluation instant. Freshness is judged on evidence time.

## 6.3 Required fixtures independent of the implementation
- 70 closes, first 50 = 100, last 20 = 110: SMA50 at the last bar = (30×100 + 20×110)/50 = 104; gap(n−1) = (110/104 − 1)×100 = 5.7692307…; gap(n−21) = 0 (all 100); `price_vs_sma50_gap_change_4w_pp` = **5.769230769… pp**.
- 147 stock bars and 147 SPY bars all at 100, final stock close 120: `R(n−1) = 20`, `R(n−21) = 0`, `relative_return_126d_change_4w_pp` = **20 pp**.
- Weekly-slope and 16-weekly-close vectors are to be computed independently (script outside the code under test) and committed as literals before Gate 2c implementation.

## 7. Wiring changes required (finding 2–4)
0. **Failure isolation (Quinn):** a SPY fetch failure makes only the benchmark-derived metrics (`relative_return_126d_vs_benchmark_pct`, `relative_return_126d_change_4w_pp`) UNAVAILABLE; SEC metrics and stock-only technical metrics are still returned. The additive `technicals` contract is returned consistently on success, NOT_COVERED and provider-failure paths (empty/UNAVAILABLE, never absent).
0b. **Contract tests** must prove real completed-bar wiring through the loader and handler (a forming bar in the fixture must not reach `buildTechnicalMetrics`), not only the pure functions.
1. `handler.ts`: fetch SPY once per request with the same function and years; drop the still-forming bar from both series (completed-bar rule); assert both came from the `quote` series.
2. `loadSecFundamentals`: pass the benchmark to `buildTechnicalMetrics`; include the technical metric set in the loader result (new `technicals` field) instead of discarding it. The SEC metrics and their response shape are unchanged.
3. `buildTechnicalMetrics`: add the three ids (and `TECHNICAL_METRIC_IDS`), reuse `wilderRsiSeries`, `periodCloses`, `simpleMovingAverage`; add catalog entries (DERIVABLE, YAHOO) and `IMPLEMENTED_METRIC_IDS`.
4. Cache/rate: one extra Yahoo request per symbol (SPY); SPY may be memoized per request batch. No new provider.

## 8. `fcf_annual_history_5y` from the existing SEC `annualSeries`
**Can the existing SEC adapter supply it without a new provider? Yes**, with limitations.
- **Source:** `SecFundamentalsResult.annualSeries` (up to the last 10 fiscal years) already contains `operatingCashFlow`, `capitalExpenditure` and `freeCashFlow = operatingCashFlow − capitalExpenditure` per fiscal year, resolved by the same concept map, period and ambiguity rules as `fcf_ttm`, with per-year `issues`. `fcf_ttm` uses the identical formula, so the two are definitionally consistent.
- **Mapping (suffix rule):** the usable history is the **latest contiguous suffix** of fiscal years ending at the latest FY; an older gap does not invalidate a contiguous suffix of at least 3 years, and a gap inside the last 3 years does. If FCF for the newest fiscal year is missing (e.g. capex not yet reported) the metric is UNAVAILABLE — an older year is never substituted. 52/53-week fiscal years are consecutive when year ends are 357–378 days apart; restated values use the latest filing for that period and record the restatement in provenance; ambiguous or conflicting items are INVALID. Detail: take the most recent run of up to 5 fiscal years that are consecutive (`consecutiveFiscalYears` gap rule, ~365 days between year ends) and end at the latest fiscal year; require `freeCashFlow !== null` for every year in the run; emit them oldest first as a JSON array `number[]`. Minimum 3 points (`fcfHistoryYears`); fewer ⇒ UNAVAILABLE `INSUFFICIENT_HISTORY`. Any year in the run with an `issues` entry for `operatingCashFlow` or `capex` ⇒ UNAVAILABLE `SEC_ITEM_NOT_REPORTED:<item>` (a gap is never bridged or interpolated). `AMBIGUOUS` ⇒ INVALID with the diagnostic reason.
- **`asOf`:** the latest filing date used (`filedMax`, as other SEC metrics). Freshness: reuse the SEC metrics' staleness rule.
- **Provenance:** one `SecProvenance` entry per fiscal year used (already recorded in `itemProv`).
- **Limitations (report to Ian):**
  1. Annual points are fiscal years; the latest may be up to a year older than the TTM figure, and the fiscal year and the TTM window overlap. Gate 3 reads "the latest year" as the last fiscal year.
  2. Companies that report capex under tags outside `PaymentsToAcquirePropertyPlantAndEquipment` / `PaymentsToAcquireProductiveAssets` get null FCF for those years (also true for `fcf_ttm`), so history is UNAVAILABLE for them rather than wrong.
  3. A single missing year breaks the consecutive run; with fewer than 3 usable years the metric is UNAVAILABLE and negative-FCF names stay INSUFFICIENT_DATA.
  4. The metric id says `5y`; Gate 3 reads only the last 3 points. The id is kept as the contract name.
- Implementation size: a pure function over `annualSeries` in `normalized/sec/`, one new metric id in the SEC result set, catalog entry, and tests; no loader or provider change.

## 9. Test plan (for Alan's golden fixtures)
Hand-computed vectors for each metric; consistency (slope equals the last two entries of the same `W` that feeds the 4-week change); boundary history (15/16 weekly closes, 69/70 bars, 146/147 bars) below/at/above; SPY alignment failure at each of the four indexes and at the last bar; benchmark absent / invalid bars; non-finite result; stale (older than 7 days) and fresh; a still-forming bar is excluded; adjusted-basis mismatch; FCF history: consecutive run, gap in years, missing capex, ambiguous, fewer than 3 years, ordering oldest first; determinism; the data layer still passes `noInvestmentLogic.test.ts`. The Gate 3 contract-only assertion in `policy.test.ts` flips to "produced" when this lands.

## 10. Reviews required (none recorded)
- **Ian:** lookbacks (1 week slope, 20-session changes, 126-session window), SPY as benchmark, strict-versus-acceleration choice (6.1), dividend-unadjusted price-return basis.
- **Alan:** formulas and golden fixtures.
- **Quinn:** loader/endpoint response change, completed-bar enforcement, cache behavior.
- **Paul:** scope (this is a Gate 2-style data change, not Gate 3 or Gate 4).

## 11. Implementation record (Gate 2c, baseline 2b36080)
- **Calendar** (`normalized/exchangeCalendar.ts`): pure rules per 6.2, 2007-2040, explicit special-closure list; a bar on a calendar-closed day or an out-of-range date makes the calendar UNAVAILABLE (fail closed). `dropFormingBars` removes trailing bars whose session close is after now; when the calendar cannot decide, bars are returned unchanged and the three direction metrics become UNAVAILABLE `SESSION_CALENDAR_UNAVAILABLE`. Existing metrics are unchanged in that case (pre-existing behavior).
- **Direction metrics** (`normalized/technicals.ts`): definitions, history requirements (16 weekly closes, 70 bars, 147 bars) and reason codes exactly as sections 4-6. Order of checks for the relative-strength change: session guard, no benchmark, basis, benchmark bar validity, last-bar alignment, history, per-index timestamp lookup. Weekly completion rule unchanged (conservative): on a Saturday the current week is not complete, so the slope needs the next Monday.
- **Freshness**: slope uses the last completed weekly observation with a 14-day window; the other two use the last bar and the existing technical bar-age limit.
- **Benchmark**: SPY fetched once per request through the same function and years (6y, `quote` series: split-adjusted, dividend-unadjusted), reused when the requested symbol is SPY. Basis labels travel with both series; a mismatch is INVALID `ADJUSTMENT_BASIS_MISMATCH`. SPY failure affects only `relative_return_126d_vs_benchmark_pct` and `relative_return_126d_change_4w_pp` (reason `BENCHMARK_<issue>`).
- **Loader/handler**: handler drops forming bars from both series before the loader; `LoadedFundamentals` gains `technicals` (always present on COVERED, NOT_COVERED, PROVIDER_FAILURE), `benchmarkIssue`, `calendarIssue`. Additive; existing fields unchanged.
- **FCF history** (`normalized/sec/fcfHistory.ts`): latest contiguous suffix ending at the newest fiscal year, 3-5 points, oldest first, 357-378 day year-end gaps, restatements use the latest filing and are flagged. Newest FCF missing, or a missing item or gap inside the newest 3 years: UNAVAILABLE; ambiguity or negative capex: INVALID; older problems only end the suffix. asOf is the dataset filedMax.
- SPY memoization is per request only. No investment thresholds were added to the normalized layer.
