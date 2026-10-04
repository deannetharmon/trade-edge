# LEAPS-QV-0001 Gate 4 — LEAPS Integration (specification and review package)

**Status: SPECIFICATION ONLY — IN REVIEW. Gate 4 IMPLEMENTATION IS BLOCKED.** Baseline: `d25631384611aeaa8ccfce86328ba746bca3bb7f` (Gate 2c CLOSED, Gate 3 CLOSED). No reviewer approval is recorded in this document; every threshold, weight and tie-break below is a **PROPOSAL** marked `[IAN]` where it needs Ian's ruling, `[QUINN]` for architecture/test questions, `[PAUL]` for scope, `[FRANK]` for authorization.

Gate 5 owns Bear/Base/Bull scenarios. This document contains no scenario engine, QV UI, persistence, sizing, execution, rolling or notification design (Section 15 lists the interfaces Gate 4 exposes so those gates can consume it without rework).

Sources read for this draft: ticket Sections 2, 3, 23-27, 33-37, 41, 45 and the ledger; `lib/discovery/` (Gate 2 `normalized/optionMetrics.ts`, `catalog.ts`; Gate 3 `qv/`); existing Find LEAPS (`app/screener/page.tsx` `runLeapsScan`, `lib/scans/pmccChainClient.ts`, `pmccChainAdapter.ts`, `leapsScore.ts`, `leapsEntryQualification.ts`, `lib/leaps-analysis/criteria.ts`, `serverTradeReview.ts`, `lib/scans/tastytrade-client.ts`).

---

## 1. Boundaries

1. **Gate 3 is the only authority on the underlying.** Gate 4 consumes Gate 3's `StrategyEvaluation` (state, reasons) and never changes it. A contract failure cannot demote, invalidate or re-classify an underlying; a contract success cannot promote one.
2. **Contract evaluation runs only for underlyings Gate 3 classified `SETUP` or `ACTIONABLE`** (ticket Sections 2.B and 33). `DISCOVERED`, `WATCH`, `INVALIDATED`, `INSUFFICIENT_DATA` and any non-evaluated state never trigger an option-chain call (`LEAPS_NOT_EVALUATED_UNDERLYING_NOT_QUALIFIED`, no network). `[PAUL]` confirm SETUP is in scope for chain retrieval (ticket Section 25 requires "SETUP — No Suitable LEAPS Structure", which implies yes).
3. **Underlying ranking and contract ranking are separate.** Contract ranking orders contracts *within one underlying*. Gate 4 computes no blended "overall" score and does not feed contract scores into the underlying ranking. Cross-underlying display of "best contract score" is a Gate 6 presentation choice, shown as its own column.
4. **A qualifying underlying with no suitable contract keeps its Gate 3 state** and gains an explicit contract status `NO_SUITABLE_CONTRACT` with reasons (the ticket's "SETUP — No Suitable LEAPS Structure"). "No suitable contract" is only produced when contracts were actually evaluated; it is never used when data was missing (Section 6).
5. **Observable metrics are separate from policy.** Section 3 (metrics) has no thresholds. Sections 7-8 hold the proposed eligibility thresholds and ranking, all versioned in one policy object (`QV_LEAPS_POLICY_V1`, frozen and fingerprint-pinned like `QV_V1_0_POLICY`).
6. **Existing Find LEAPS is unchanged** (ticket Section 3). Gate 4 adds modules; it does not modify, re-point or migrate any file Find LEAPS uses (Section 12).
7. Discovery is not an order (ticket Section 34). Nothing here creates, previews or prices an order.

## 2. Inputs and outputs (contracts)

```ts
// Input to the pure evaluator (no clock, no network)
interface LeapsEvaluationInput {
  symbol: string;
  underlying: { price: number; quoteAsOf: string };          // timestamped; see 4.3
  underlyingState: 'SETUP' | 'ACTIONABLE';                    // from Gate 3, read-only
  now: string;                                                // ISO; passed in
  chain: LeapsChainSnapshot;                                  // see below
  policy: QvLeapsPolicy;                                      // QV_LEAPS_POLICY_V1
}
interface LeapsChainSnapshot {
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED';
  failure?: string;                                           // provider reason code, Section 6
  provider: string;
  expirationsConsidered: string[];                            // YYYY-MM-DD
  contracts: RawLeapsContract[];                              // calls only; raw provider rows with timestamps
}
// Output
interface LeapsEvaluation {
  symbol: string;
  policyVersion: string;
  contractStatus: 'EVALUATED' | 'NOT_EVALUATED' | 'DATA_UNAVAILABLE' | 'NO_SUITABLE_CONTRACT';
  reasons: LeapsReason[];                                     // deterministic codes + explanation (Section 6.3)
  contracts: ContractEvaluation[];                            // ALL evaluated contracts, ranked first, then rejected
  counts: { fetched: number; evaluated: number; eligible: number; rejected: number; unavailable: number };
}
interface ContractEvaluation {
  occSymbol: string; expiration: string; strike: number;
  metrics: MetricSet;                                         // Gate 2 contract_* metrics (+ Gate 4 additions, Section 3)
  eligibility: 'ELIGIBLE' | 'INELIGIBLE' | 'DATA_UNAVAILABLE';
  gates: Array<{ id: string; status: 'pass' | 'fail' | 'unavailable'; reason?: string }>;
  rank: number | null;                                        // 1..n among ELIGIBLE only
  score: number | null; scoreComponents: Record<string, number> | null; scoreIncomplete: boolean;
}
```

The underlying's own `StrategyEvaluation` is carried alongside, unmodified: `QvLeapsResult = { underlying: StrategyEvaluation; leaps: LeapsEvaluation }`. Gate 7 (persistence) and Gate 6 (UI) read this shape; neither is built here.

## 3. Observable metrics (no thresholds)

Gate 2 already implements the contract metrics in `lib/discovery/normalized/optionMetrics.ts` (`buildContractMetrics`, `CONTRACT_METRIC_IDS`). Gate 4 **reuses it** and makes the following *additive* changes only: an explicit multiplier input (4.4), the additions in the last two rows, and a quote-skew check (4.3).

All prices are dollars **per share**; volatilities are decimal fractions (0.35 = 35%); percentages are in percent units (5.0 = 5%); `S` = underlying price, `K` = strike, `bid`/`ask`/`mid = (bid+ask)/2`, `M` = contract multiplier, `Δ` = delta, `Θ` = theta per share per calendar day (negative for a long call), `V` = vega per share per 1.00 (100 vol points) as the provider reports it `[verify unit in 11.1]`.

| Metric id | Formula | Unit | Notes |
|---|---|---|---|
| `contract_dte` | `expirationDay - nowDay` (calendar days) | days | Gate 2 |
| `contract_strike` | provider strike | $ | Gate 2 |
| `contract_bid`, `contract_ask` | provider | $/share | missing = UNAVAILABLE, never 0 |
| `contract_mid` | `(bid + ask) / 2` | $/share | crossed market (`ask < bid`) = INVALID |
| `contract_spread_pct_of_mid` | `(ask - bid) / mid × 100` | % | Gate 2 |
| `contract_delta` | provider `Δ`, must be in [-1, 1] | — | Gate 2 |
| `contract_dollar_delta` | `Δ × S × M` | $ of stock exposure per contract | Gate 2 hard-codes M = 100; Gate 4 passes M (4.4) |
| `contract_intrinsic_value` | `max(0, S - K)` | $/share | call only |
| `contract_extrinsic_value` | `mid - intrinsic`; `mid < intrinsic` = INVALID | $/share | Gate 2 |
| `contract_extrinsic_pct_of_mid` | `extrinsic / mid × 100` | % | matches the existing Find LEAPS extrinsic-% concept (`evaluateLeapsEntry`) |
| `contract_debit_per_contract` | `mid × M` | $ | entry assumption in 4.2 |
| `contract_effective_leverage` | `Δ × S / mid` | × (multiplier cancels) | "capital efficiency": stock exposure per option dollar |
| `contract_breakeven_price` | `K + mid` (expiration breakeven for a long call bought at `mid`) | $/share | |
| `contract_breakeven_move_pct` | `(breakeven / S - 1) × 100` | % | |
| `contract_theta` | provider `Θ` | $/share/day | CONDITIONAL on provider data (11.1) |
| `contract_vega`, `contract_implied_volatility` | provider | see units | CONDITIONAL |
| `contract_open_interest`, `contract_volume` | provider counts (non-negative integers) | contracts | volume CONDITIONAL |
| **new** `contract_extrinsic_annualized_pct` | `extrinsic_pct_of_mid × 365 / dte` | %/year | time-value carry; undefined for `dte ≤ 0` (INVALID) |
| **new** `contract_theta_pct_of_mid_per_day` | `abs(Θ) / mid × 100` | %/day | UNAVAILABLE when Θ unavailable; informational |
| **new** `contract_breakeven_at_ask_price` | `K + ask` | $/share | executable-entry sensitivity (4.2) |

Underlying/IV context metrics from Gate 2 that remain observable: `iv_rank_provider` (source-labelled, informational), `iv_rank_internal` / `iv_percentile_internal` (UNAVAILABLE). Section 5.3 states the IV rule.

## 4. Quote timestamps, entry price, multiplier

### 4.1 Evaluation time
`now` is an injected ISO instant read once after all provider I/O (same rule as `loadSecFundamentals`). DTE uses calendar dates; the exchange calendar of Gate 2c is not needed (no bar series).

### 4.2 Entry-price assumption
Observable metrics use **mid** as the entry price (Gate 2 convention; matches Find LEAPS). Because a retail fill at mid on a wide market is not guaranteed, the executable sensitivity `contract_breakeven_at_ask_price` is also produced and displayed with the spread, but is not scored. `[IAN]` confirm mid-for-metrics plus ask-sensitivity (alternative: ask-based breakeven as the primary).

### 4.3 Timestamps and freshness
- Each contract row must carry its own quote timestamp (`quote-time` / `updated-at`); each underlying price must carry a quote timestamp. The existing `getQuote` returns a bare number, so Gate 4 needs an additive timestamped underlying quote (11.2).
- `contract_*` metrics are VALID only when the option quote age `≤ OPTION_QUOTE_MAX_AGE_MS` (existing Gate 2 constant, 15 min). Missing timestamp = UNAVAILABLE (`CONTRACT_QUOTE_TIMESTAMP_MISSING`); older = STALE (`CONTRACT_QUOTE_STALE`).
- **Quote skew:** `|optionQuoteTime - underlyingQuoteTime| ≤ 60 s` is required for any metric that combines both (delta-dollar, intrinsic, extrinsic, leverage, breakeven). Exceeding it = `CONTRACT_QUOTE_SKEW_EXCEEDED`, those metrics UNAVAILABLE. `[IAN]` 60 s proposed.
- **Outside regular hours / delayed quotes:** a quote the provider flags delayed (`delayed`/`is-delayed`) or whose session is `last_session` (as in `serverTradeReview`) is flagged `CONTRACT_DELAYED_QUOTE`. Proposal: allowed for *discovery ranking* with the flag shown, but never reported as an executable price. `[IAN]` allow-with-flag vs exclude.

### 4.4 Multiplier
Standard US equity option multiplier is 100. Gate 4 reads the multiplier per contract from the instrument record (`serverTradeReview` already carries `contract.multiplier`) and passes it into `buildContractMetrics` as a new optional parameter (default 100 preserves Gate 2 behavior). A multiplier ≠ 100, a missing multiplier on the instrument, or an adjusted/non-standard deliverable flag makes the contract `INELIGIBLE` with `CONTRACT_NON_STANDARD_MULTIPLIER` (an adjusted contract's deliverable is not "100 shares of the underlying", so dollar delta and intrinsic would be wrong). `[verify provider field names in 11.1]`.

## 5. Missing, stale, invalid, unavailable, provider failure

### 5.1 Rules
1. A metric is usable only if VALID (Gate 2 contract). Nothing is defaulted to 0 or imputed; a missing bid/ask/delta/OI is UNAVAILABLE (the existing screener coercion `Number(x || 0)` is not reused).
2. **Required to be evaluable** (else the contract is `DATA_UNAVAILABLE`, never silently ineligible): strike, DTE, bid, ask, mid, delta, open interest, option quote timestamp, underlying price + timestamp, multiplier, intrinsic/extrinsic (derived).
3. **Optional** (contract stays eligible; flagged `INCOMPLETE_OPTIONAL_METRICS:<ids>`; shown as unavailable): theta, vega, implied volatility, volume, provider IV Rank. (`contract_extrinsic_annualized_pct` needs only required inputs, so it is not optional.)
4. A **crossed market** is INVALID (`CONTRACT_CROSSED_MARKET`); a **zero bid** is allowed by Gate 2 but is `INELIGIBLE` via the spread gate (spread = 200% of mid with bid 0), not hidden.
5. Duplicate OCC symbols in one snapshot: keep none and emit `CHAIN_DUPLICATE_CONTRACT` for the symbol (fail closed, no "first one wins").

### 5.2 Provider failure and partial data
- Chain fetch failed (HTTP, timeout, auth): `contractStatus = DATA_UNAVAILABLE`, reason `LEAPS_CHAIN_PROVIDER_FAILURE:<code>`. The underlying's state is untouched. This is shown as a technical failure, **not** as "no suitable LEAPS structure" (project design principle: technical failures block before a modal; verified empty results show the in-modal banner).
- Chunk-level failure (the chain client fetches market data in 100-symbol chunks and today **skips a failed chunk silently** — `try { ... } catch { continue; }`): Gate 4's acquisition must surface it, so the snapshot is `PARTIAL` and the result carries `LEAPS_PARTIAL_CHAIN`. A `PARTIAL` snapshot may produce `EVALUATED` with ranked contracts **but never** `NO_SUITABLE_CONTRACT`, because missing chunks could hold the suitable contract. `[QUINN]` confirm.
- Token expiry (TastyTrade access tokens last about 15 minutes; all calls browser-side): `LEAPS_AUTH_EXPIRED`, treated as provider failure for that underlying, other underlyings continue after a single token refresh retry.
- No expirations in the LEAPS window: `LEAPS_NO_LEAPS_EXPIRATIONS` (verified empty: a real result, status `NO_SUITABLE_CONTRACT` with this reason).
- Expirations exist but all strikes outside the stage-2 band or zero quoted rows: `LEAPS_NO_CONTRACTS_IN_WINDOW` (verified empty).
- Every contract `DATA_UNAVAILABLE`: `LEAPS_ALL_CONTRACTS_DATA_UNAVAILABLE` → `contractStatus = DATA_UNAVAILABLE` (not unsuitable).
- Underlying quote unavailable: `LEAPS_UNDERLYING_QUOTE_UNAVAILABLE` → `DATA_UNAVAILABLE` (no contract can be priced against it).
- Failure isolation: a failure for one underlying never affects another, the Gate 3 evaluation, or Find LEAPS.

### 5.3 IV Rank / IV Percentile
TradeEdge stores no historical IV series (Gate 2 finding), so `iv_rank_internal` and `iv_percentile_internal` stay UNAVAILABLE; Gate 4 must not compute, approximate or back-fill them (ticket Section 26). The provider IV Rank stays `iv_rank_provider`, source-labelled, informational, and **excluded from eligibility and ranking** (consistent with the Gate 2b ruling that provider IV Rank remains source-labelled informational). Current contract IV is shown as an observable when its unit is verified (11.1) and is not ranked. `[IAN]` confirm IV is observable-only in v1.0.

### 5.4 Deterministic reason codes (proposed registry)
Underlying/result level: `LEAPS_NOT_EVALUATED_UNDERLYING_NOT_QUALIFIED`, `LEAPS_UNDERLYING_QUOTE_UNAVAILABLE`, `LEAPS_CHAIN_PROVIDER_FAILURE:<code>`, `LEAPS_AUTH_EXPIRED`, `LEAPS_PARTIAL_CHAIN`, `LEAPS_NO_LEAPS_EXPIRATIONS`, `LEAPS_NO_CONTRACTS_IN_WINDOW`, `LEAPS_ALL_CONTRACTS_DATA_UNAVAILABLE`, `LEAPS_NO_SUITABLE_CONTRACT`, `LEAPS_CAPPED_BY_PERFORMANCE_LIMIT`.
Contract level (gates): `CONTRACT_DTE_BELOW_MIN`, `CONTRACT_DTE_ABOVE_MAX`, `CONTRACT_DELTA_BELOW_MIN`, `CONTRACT_DELTA_ABOVE_MAX`, `CONTRACT_OI_BELOW_MIN`, `CONTRACT_SPREAD_ABOVE_MAX`, `CONTRACT_EXTRINSIC_ABOVE_MAX`, `CONTRACT_NON_STANDARD_MULTIPLIER`, `CONTRACT_CROSSED_MARKET`, `CONTRACT_QUOTE_STALE`, `CONTRACT_QUOTE_TIMESTAMP_MISSING`, `CONTRACT_QUOTE_SKEW_EXCEEDED`, `CONTRACT_DELAYED_QUOTE` (flag), `CONTRACT_METRIC_UNAVAILABLE:<id>`, `CONTRACT_METRIC_INVALID:<id>`, `INCOMPLETE_OPTIONAL_METRICS:<ids>` (flag), `CHAIN_DUPLICATE_CONTRACT`.
Each reason carries a fixed template explanation, the observed value and the threshold from the same comparison that produced it (the pattern used by Gate 3 `reasons.ts`), so wording cannot diverge from logic.

## 6. Contract status derivation (order is fixed)
1. Underlying not SETUP/ACTIONABLE → `NOT_EVALUATED`.
2. Underlying quote unavailable or chain `FAILED` → `DATA_UNAVAILABLE`.
3. Evaluate every fetched contract (gates, Section 7).
4. If any contract `ELIGIBLE` → `EVALUATED` (ranked list; `PARTIAL` snapshot keeps a `LEAPS_PARTIAL_CHAIN` reason).
5. Else if the snapshot was `PARTIAL`, or any contract is `DATA_UNAVAILABLE` and none is `ELIGIBLE`: if every contract is unavailable → `DATA_UNAVAILABLE`; if some were verified `INELIGIBLE` and the rest unavailable → `DATA_UNAVAILABLE` with the counts (cannot prove no suitable contract).
6. Else (all contracts verified, none eligible, snapshot complete) → `NO_SUITABLE_CONTRACT` with the dominant failing gates (counts per gate) as reasons.

## 7. Proposed eligibility thresholds — ALL UNAPPROVED `[IAN]`

One frozen policy object. Where an existing TradeEdge LEAPS number exists it is reused as the default and cited, so the proposal is "no new opinion unless stated". Comparisons are inclusive (`≤`/`≥`) after rounding both sides to 1e-9 to remove binary floating-point noise.

| Gate | Proposed | Basis | Status |
|---|---|---|---|
| DTE minimum | 365 | LEAPS = more than one year; Find LEAPS server policy uses 180, modal defaults vary | `[IAN]` new; 180 would match Find LEAPS |
| DTE maximum | 900 | caps theta/capital lock-up; Find LEAPS has no max by default | `[IAN]` new |
| Delta | 0.70 – 0.85 | `SERVER_LEAPS_POLICY` (deltaMin .70, deltaMax .85) | reuse |
| Open interest | ≥ 100 | `SERVER_LEAPS_POLICY.oiMin` | reuse |
| Spread % of mid | ≤ 10 | `SERVER_LEAPS_POLICY.spreadPctMax` | reuse |
| Extrinsic % of mid | ≤ 20 | `SERVER_LEAPS_POLICY.extrinsicPctMax` (alternative 25) | reuse; `[IAN]` whether 20 is realistic for 2-year, 0.70-0.85 delta contracts |
| Volume | **no gate** (observable) | LEAPS often trade 0 contracts/day; OI + spread cover liquidity | `[IAN]` |
| Debit | **no gate** | position sizing is out of scope | `[PAUL]` |
| Effective leverage, theta, vega, IV | **no gate** (observable) | not investment-significant gates in the ticket | `[IAN]` |
| Quote freshness / skew | 15 min / 60 s | Section 4.3 | data-integrity, not investment |

Rationale for "no gate" on leverage: effective leverage is mechanically determined by delta and extrinsic (already gated); a separate floor would double-count (the same reasoning behind `leapsScore.ts` excluding delta and DTE from the score).

## 8. Proposed ranking — `[IAN]` on every weight

Only `ELIGIBLE` contracts are ranked, within one underlying. Score is 0-100, the sum of four components, each a clamped linear ramp `clamp01(x) = min(1, max(0, x))`:

| Component | Weight | Sub-score (0..1) | Existing basis |
|---|---|---|---|
| Cost efficiency | 35 | `clamp01(1 - extrinsic_pct_of_mid / 30)` | `leapsScore.ts` ceiling 30 (provisional there too) |
| Time-value carry | 15 | `clamp01(1 - extrinsic_annualized_pct / 20)` | new: penalises paying for time on a long-dated contract |
| Breakeven distance | 20 | `clamp01(1 - breakeven_move_pct / 15)` | new |
| Liquidity | 30 | `0.5·clamp01(1 - spread_pct/10) + 0.5·clamp01(OI/500)` | `leapsScore.ts` liquidity shape (same 10% / 500 ceilings) |

Delta and DTE are filter-only (not scored). Effective leverage, theta, vega, IV and volume are observable-only in v1.0. A missing required input makes the contract `DATA_UNAVAILABLE` (not ranked). A missing *optional* input does not affect the score because none of the scored components uses an optional input, so no renormalisation or penalty is needed (this avoids the existing "missing scores 0" ambiguity). Score is carried at full double precision for ordering and displayed to one decimal.

**Tie-breakers (strict total order, fully deterministic):** score descending; then lower extrinsic %; then lower spread %; then higher open interest; then longer DTE; then lower strike; then expiration ascending; then OCC symbol ascending (code-unit comparison). Equal scores within 1e-9 are treated as equal before the tie-breakers apply.

## 9. Worked examples (independent hand arithmetic; used as test fixtures)
Evaluation date 2026-10-05, underlying `S = 100`, multiplier 100, policy of Section 7.

**A** — K 80, bid 24.50 / ask 25.50, Δ 0.80, OI 400, DTE 540, fresh, skew 0 s.
mid 25.00; intrinsic 20; extrinsic 5.00 → **20.0000%** of mid (boundary: passes `≤ 20`); spread 1.00/25 = **4.0%**; dollar delta 0.80×100×100 = **8,000**; debit **$2,500**; effective leverage 0.80×100/25 = **3.2**; breakeven 105.00, move **5.0%**; annualized extrinsic 20×365/540 = **13.518519%**; ask-breakeven 105.50.
Score: cost 35×(1−20/30)=11.666667; carry 15×(1−13.518519/20)=4.861111; breakeven 20×(1−5/15)=13.333333; liquidity 30×(0.5×0.6+0.5×0.8)=21.000000 → **50.861111**.

**E** — K 75, bid 28.60 / ask 29.40, Δ 0.84, OI 250, DTE 730.
mid 29.00; intrinsic 25; extrinsic 4.00 → **13.793103%**; spread 0.80/29 = **2.758621%**; dollar delta **8,400**; debit **$2,900**; leverage 0.84×100/29 = **2.896552**; breakeven 104.00, move **4.0%**; annualized 13.793103×365/730 = **6.896552%**.
Score: cost 35×(1−13.793103/30)=18.908046; carry 15×(1−6.896552/20)=9.827586; breakeven 20×(1−4/15)=14.666667; liquidity 30×(0.5×0.724138+0.5×0.5)=18.362069 → **61.764368**. Ranks 1; A ranks 2.

**B** — K 90, bid 17.00 / ask 18.00, Δ 0.68, OI 400, DTE 540: mid 17.50, intrinsic 10, extrinsic **42.857143%** > 20 → `CONTRACT_EXTRINSIC_ABOVE_MAX`; Δ 0.68 < 0.70 → `CONTRACT_DELTA_BELOW_MIN`. INELIGIBLE, two reasons, unranked (its would-be score 28.428571 is not computed).

**C** — K 75, bid 29.00 / ask 29.50, Δ 0.85 (boundary, passes), OI 99, DTE 400: mid 29.25, extrinsic 14.529915%, spread 1.709402%; OI 99 < 100 → `CONTRACT_OI_BELOW_MIN`. INELIGIBLE (all other gates pass), would-be score 52.843754 is not ranked.

**Result for the A/B/C/E snapshot:** `EVALUATED`; ranked E (61.764368), A (50.861111); B and C INELIGIBLE with the codes above. **No-contract example:** if only B and C were fetched with a complete snapshot, `NO_SUITABLE_CONTRACT` with reason counts `{CONTRACT_EXTRINSIC_ABOVE_MAX:1, CONTRACT_DELTA_BELOW_MIN:1, CONTRACT_OI_BELOW_MIN:1}`; the same B and C with a `PARTIAL` snapshot give `DATA_UNAVAILABLE` (Section 6.5).

## 10. Architecture and provider mapping

- **Pure core** `lib/discovery/leaps/` (new): `policy.ts` (`QV_LEAPS_POLICY_V1`, frozen, fingerprint-tested), `evaluate.ts` (gates, status derivation, reasons), `rank.ts` (scoring, tie-breakers), `reasons.ts` (registry), `index.ts`. No network, clock, UI or app imports (the existing `noInvestmentLogic` and isolation tests are extended to cover this directory; investment thresholds live only in `policy.ts`).
- **Reuse:** Gate 2 `buildContractMetrics` (contract metrics), `providerNumber`, `MetricSet`/validity model, Gate 3 `StrategyEvaluation`. Not reused: `computeLeapsScore` / `evaluateLeapsEntry` (they stay Find LEAPS's own; their numbers are cited as defaults, never imported, so changing one cannot move the other).
- **Acquisition (browser-side, TastyTrade rule):** new additive module (proposed `lib/scans/leapsQvChainClient.ts`), because `getPmccChain` drops theta, vega, volume and IV, hides chunk failures, and cannot be changed without touching Find LEAPS. It uses the same endpoints the repo already uses: `/option-chains/{symbol}/nested` (expirations, strikes, OCC symbols) and `/market-data/by-type` (quotes/greeks/OI) in chunks of 100, plus the timestamped underlying quote. Orchestration injects `fetch`/token functions so the evaluator and the stage logic are testable without a network.
- **Staged retrieval (ticket Section 33):**
  1. *Eligible underlyings:* only Gate 3 `SETUP`/`ACTIONABLE` (cap, 11.3).
  2. *Expirations:* `nested` call; keep expirations with `dteMin ≤ DTE ≤ dteMax`; no market-data call yet. Zero → `LEAPS_NO_LEAPS_EXPIRATIONS`.
  3. *Strike pre-selection (no quotes needed):* keep calls with `0.55·S ≤ K ≤ 1.00·S` (in-the-money region that can reach delta 0.70-0.85), then the `N` strikes per expiration nearest a target moneyness `K ≈ 0.80·S`. The band and `N` are acquisition-cost controls, **not investment gates**, and are reported when they bind (`LEAPS_CAPPED_BY_PERFORMANCE_LIMIT`). `[IAN]` that the band does not exclude a suitable contract; `[QUINN]` on the cap values.
  4. *Quotes:* `market-data/by-type` for the selected OCC symbols only; underlying quote fetched concurrently.
  5. *Evaluate and rank* (pure).
- **Gate 3 → Gate 4 handoff:** an orchestrator takes `{symbol, StrategyEvaluation}` pairs and calls the acquisition + evaluator per qualifying underlying, returning `QvLeapsResult`. It never mutates the evaluation or lifecycle state.
- **Persistence/UI/sizing/scenarios:** none in Gate 4.

## 11. Dependencies, data audit, limits

### 11.1 Provider data audit (Gate 4a — must precede coding) `[QUINN]` `[IAN]`
Gate 2 classified theta, vega, IV and volume CONDITIONAL on the chain. This document did not call TastyTrade (browser-side only, and the sandbox cannot reach it). Before coding, capture real `market-data/by-type` rows for a handful of LEAPS and record, as committed fixtures: field names and presence of `theta`, `vega`, `volatility`/IV and `volume`; the **unit of per-contract IV** (fraction vs percent — `getMarketMetrics` uses a `≤ 1 ⇒ ×100` heuristic for expiration IV, which Gate 4 must **not** copy), the **vega scaling**, the `quote-time`/`updated-at` semantics, the delayed flag, and the multiplier / shares-per-contract / adjusted-contract indicators. Any unit that cannot be established from real rows stays UNAVAILABLE.

### 11.2 Additive acquisition changes
Timestamped underlying quote (today a bare number); multiplier input to `buildContractMetrics` (default 100); surfaced chunk failure; a call-only filter at the source. No existing function signature changes.

### 11.3 Performance limits (proposed) `[QUINN]`
Max qualifying underlyings per run 25; max expirations per underlying 6; max OCC symbols per underlying 200 (two chunks); concurrency 3 underlyings; per-underlying budget 20 s with a `LEAPS_CHAIN_PROVIDER_FAILURE:TIMEOUT` result; no options call for any non-SETUP/ACTIONABLE underlying. Limits that bind are reported in `counts` and reasons, never silent.

### 11.4 Dependencies
Gate 3 `StrategyEvaluation` (closed), Gate 2 `buildContractMetrics` (closed), Gate 2c timestamped underlying price path (the price used for contract math is the option-chain-time underlying quote, not the daily close). Production has no `StrategyInput` assembler yet (ticket Gate 7 / separate); until one exists the orchestrator is exercised through tests and a documented harness only, which is a **scope question for Paul**.

## 12. Regression protection for existing Find LEAPS
1. Gate 4 modifies none of: `app/screener/page.tsx`, `lib/scans/pmccChainClient.ts`, `pmccChainAdapter.ts`, `leapsScore.ts`, `leapsEntryQualification.ts`, `lib/leaps-analysis/*`, `tastytrade-client.ts`. A repository test fails if any of these imports `lib/discovery/leaps` (one-way dependency), and a file-hash/exports characterization pins their public surface.
2. **Characterization tests first:** before any shared extraction is even considered, add tests that freeze `computeLeapsScore` and `evaluateLeapsEntry` outputs for a numeric fixture table (including the worked examples above run through the *existing* functions, whose results will legitimately differ from the QV score — documenting that the two rankings are independent by design).
3. **Existing-finder equivalence test:** a fixed raw chain fixture run through `adaptPmccChain` + the in-page candidate math (extracted into the test as a copy of the current formulas) must match recorded golden rows; the test fails if either side drifts.
4. Full suite on every push (CI already does this) plus the targeted Find LEAPS suites listed in the gate report.

## 13. Acceptance tests (Gate 4 implementation, for Alan/Quinn)
1. **Independent numeric fixtures:** Section 9 values (A, E, B, C) computed by an independent script and embedded as literals; every metric in Section 3 for A and E; scores to 6 decimals.
2. **Boundaries:** each gate at, just below and just above its threshold (DTE 364/365/366 and 899/900/901; delta 0.6999/0.70, 0.85/0.8501; OI 99/100; spread 10.0/10.0001; extrinsic 20.0/20.0001; quote age 15:00/15:01; skew 60 s/61 s); floating-point rounding cases (`5/25×100`).
3. **No-contract / unsuitable:** complete snapshot all ineligible → `NO_SUITABLE_CONTRACT` with correct per-gate counts; underlying state unchanged; `LEAPS_NO_LEAPS_EXPIRATIONS`; `LEAPS_NO_CONTRACTS_IN_WINDOW`.
4. **Data failures:** chain provider failure, auth expiry, partial chunk failure (never `NO_SUITABLE_CONTRACT`), missing/stale/skewed timestamps, crossed market, zero bid, missing delta/OI/bid/ask (UNAVAILABLE not 0), non-standard multiplier, duplicate OCC, put in a call-only chain (INVALID), underlying quote missing; per-underlying failure isolation.
5. **State discipline:** non-SETUP/ACTIONABLE underlyings make zero acquisition calls (spy); a contract result never changes the `StrategyEvaluation` object (deep-equal); no scenario/sizing/UI imports.
6. **IV:** `iv_rank_internal`/`iv_percentile_internal` stay UNAVAILABLE; provider rank never enters eligibility or score; IV unit handling covered by the real-row fixtures of 11.1.
7. **Ranking determinism:** identical input in different array orders yields identical output (order-independence); every tie-breaker rung exercised; equal-score-within-epsilon; stable across repeated runs.
8. **Existing-finder equivalence** (Section 12) and the isolation/`noInvestmentLogic` guards extended to `lib/discovery/leaps/`.
9. **Policy pinning:** `QV_LEAPS_POLICY_V1` fingerprint test, versioned; changing any threshold or weight requires a new policy version.
10. Gate completion verification as in earlier gates: tsc with `tsconfig.check.json`, targeted + full suite, exact-head CI and Vercel.

## 14. Explicit exclusions
No Bear/Base/Bull scenarios (Gate 5), no scenario engine, QV UI (Gate 6), snapshot persistence (Gate 7), sizing or allocation, order construction/execution, rolling, notifications, pre-expiration theoretical option pricing, historical IV storage, or any change to Gate 3 methodology.

## 15. Interfaces left for later gates (not built here)
Gate 5 consumes `{ occSymbol, expiration, strike, debitPerContract (= mid × M), breakevenPrice, multiplier }` from a `ContractEvaluation`; the entry-price assumption (mid) is part of that contract so scenarios use the same debit. Gate 6 reads `QvLeapsResult` and reason codes. Gate 7 serialises `QvLeapsResult` with `policyVersion`.

## 16. Review package

**Decisions requiring Ian:** (1) DTE window 365-900 (vs 180 floor of Find LEAPS); (2) extrinsic ceiling 20 vs 25 for 2-year contracts; (3) mid-with-ask-sensitivity entry assumption; (4) volume, debit, leverage, theta, vega, IV observable-only; (5) ranking weights 35/15/20/30 and the 30/20/15/10%/500 ramps, tie-breaker order; (6) delayed / last-session quotes allowed-with-flag; (7) 60 s quote skew; (8) stage-3 moneyness band 0.55-1.00 S does not drop suitable contracts; (9) missing optional metrics do not affect score; (10) IV observable-only, provider IV Rank informational.

**Questions for Quinn:** (1) additive acquisition module vs extending `getPmccChain` (this draft says additive to protect Find LEAPS); (2) surfacing chunk failure and the PARTIAL ⇒ never-"no suitable" rule; (3) performance caps (25 underlyings / 6 expirations / 200 symbols / concurrency 3 / 20 s); (4) characterization-test design for Find LEAPS equivalence; (5) policy-object fingerprint and extending the isolation guards; (6) whether Gate 4 should be split into 4a (provider audit + acquisition), 4b (pure evaluator/ranking), 4c (orchestration + equivalence).

**Scope questions for Paul:** (1) SETUP included in chain retrieval; (2) no production caller of the orchestrator until a `StrategyInput` assembler exists — acceptable for Gate 4 exit?; (3) debit/capital shown but no sizing; (4) cross-underlying "best contract" presentation deferred to Gate 6; (5) whether the 4a provider audit is in Gate 4 or a Gate 2d data amendment.

**For Frank (authorization):** implementation stays BLOCKED until Ian's rulings, Quinn's architecture/test answers, and Paul's scope confirmation are recorded in the ledger; no approvals are recorded here.

**Implementation readiness:** NOT READY. Blocking: Ian rulings (Section 7-8), provider data audit 11.1 (theta/vega/IV/volume units and multiplier fields), Quinn's acquisition and limit decisions. Non-blocking dependencies are closed (Gate 2 contract metrics, Gate 3 evaluation, Gate 2c data).
