# LEAPS-QV-0001 Gate 4 — LEAPS Integration (specification and review package)

**Status: SPECIFICATION ONLY — REVISION 2 IN REVIEW (review round 1 returned CHANGES REQUIRED at `6d7858c687470b7798f694771b64bb13720fcefb`; revision 1 at `1fd91b220afc7672ee8e6aea0c236dcdd18c5872` returned narrow corrections; revision 2 response in Section 17). Gate 4 IMPLEMENTATION IS BLOCKED.** Baseline: `d25631384611aeaa8ccfce86328ba746bca3bb7f` (Gate 2c CLOSED, Gate 3 CLOSED). No reviewer approval is recorded in this document; every threshold, weight and tie-break below is a **PROPOSAL** marked `[IAN]` where it needs Ian's ruling, `[QUINN]` for architecture/test questions, `[PAUL]` for scope, `[FRANK]` for authorization.

Gate 5 owns Bear/Base/Bull scenarios. This document contains no scenario engine, QV UI, persistence, sizing, execution, rolling or notification design (Section 15 lists the interfaces Gate 4 exposes so those gates can consume it without rework).

Sources read for this draft: ticket Sections 2, 3, 23-27, 33-37, 41, 45 and the ledger; `lib/discovery/` (Gate 2 `normalized/optionMetrics.ts`, `catalog.ts`; Gate 3 `qv/`); existing Find LEAPS (`app/screener/page.tsx` `runLeapsScan`, `lib/scans/pmccChainClient.ts`, `pmccChainAdapter.ts`, `leapsScore.ts`, `leapsEntryQualification.ts`, `lib/leaps-analysis/criteria.ts`, `serverTradeReview.ts`, `lib/scans/tastytrade-client.ts`).

---

## 1. Boundaries

1. **Gate 3 is the only authority on the underlying.** Gate 4 consumes Gate 3's `StrategyEvaluation` (state, reasons) and never changes it. A contract failure cannot demote, invalidate or re-classify an underlying; a contract success cannot promote one.
2. **Contract evaluation runs only for underlyings Gate 3 classified `SETUP` or `ACTIONABLE`** (ticket Sections 2.B and 33). `DISCOVERED`, `WATCH`, `INVALIDATED`, `INSUFFICIENT_DATA` and any non-evaluated state never trigger an option-chain call (`LEAPS_NOT_EVALUATED_UNDERLYING_NOT_QUALIFIED`, no network). `[PAUL]` confirm SETUP is in scope for chain retrieval (ticket Section 25 requires "SETUP — No Suitable LEAPS Structure", which implies yes).
3. **Underlying ranking and contract ranking are separate.** Contract ranking orders contracts *within one underlying*. Gate 4 computes no blended "overall" score and does not feed contract scores into the underlying ranking. Cross-underlying display of "best contract score" is a Gate 6 presentation choice, shown as its own column.
4. **A qualifying underlying with no suitable contract keeps its Gate 3 state** and gains an explicit contract status `NO_SUITABLE_CONTRACT` with reasons (the ticket's "SETUP — No Suitable LEAPS Structure"). `NO_SUITABLE_CONTRACT` is produced **only** when acquisition coverage was `COMPLETE` **and** every candidate has a definitive eligibility result, none eligible (or the complete search is verified empty). It is never produced from a restricted, partial or data-deficient search (Sections 6 and 10); those yield `NO_ELIGIBLE_IN_SUBSET` or `DATA_UNAVAILABLE`.
5. **Observable metrics are separate from policy.** Section 3 (metrics) has no thresholds. Sections 7-8 hold the proposed eligibility thresholds and ranking, all versioned in one policy object (`QV_LEAPS_POLICY_V1`, frozen and fingerprint-pinned like `QV_V1_0_POLICY`).
6. **Existing Find LEAPS is unchanged** (ticket Section 3). Gate 4 adds modules; it does not modify, re-point or migrate any file Find LEAPS uses (Section 12).
7. Discovery is not an order (ticket Section 34). Nothing here creates, previews or prices an order.

## 2. Inputs and outputs (contracts)

```ts
// Input to the pure evaluator (no clock, no network)
interface LeapsEvaluationInput {
  symbol: string;
  underlying: { price: number; quoteAsOf: string };          // timestamped chain-time quote; see 4.3 and 11.4
  underlyingState: 'SETUP' | 'ACTIONABLE';                    // from Gate 3, read-only
  now: string;                                                // ISO; passed in
  chain: LeapsChainSnapshot;
  policy: QvLeapsPolicy;                                      // QV_LEAPS_POLICY_V1
}
interface LeapsChainSnapshot {
  provider: string;
  acquisition: AcquisitionReport;                             // Section 10
  contracts: RawLeapsContract[];                              // calls only; raw provider rows incl. timestamps + instrument evidence
}
interface AcquisitionReport {
  coverage: 'COMPLETE' | 'RESTRICTED' | 'FAILED';             // COMPLETE only when no restriction below bound
  failure?: string;                                           // provider reason code when FAILED
  expirations: { inWindow: number; selected: number; omittedByCap: number };
  contracts: {
    considered: number;                                       // all calls in the selected-window expirations (from the nested chain)
    excludedProvablyIneligible: number;                       // strike >= spot (10, stage 3a); NOT a restriction
    selectedForQuote: number; omittedByStrikeCap: number; omittedBySymbolCap: number;
    quoteChunksFailed: number; contractsInFailedChunks: number; quotedOk: number;
  };
  restrictions: Array<{ kind: 'EXPIRATION_CAP' | 'STRIKE_CAP' | 'SYMBOL_CAP' | 'CHUNK_FAILURE'; limit?: number; omitted: number }>;
}
// Output
interface LeapsEvaluation {
  symbol: string;
  policyVersion: string;
  contractStatus: 'EVALUATED' | 'NOT_EVALUATED' | 'DATA_UNAVAILABLE' | 'NO_SUITABLE_CONTRACT' | 'NO_ELIGIBLE_IN_SUBSET';
  rankingScope: 'COMPLETE_CHAIN' | 'EVALUATED_SUBSET' | null; // COMPLETE_CHAIN only if coverage COMPLETE AND notEvaluable = 0 (every candidate has a definitive result)
  acquisition: AcquisitionReport;                             // always echoed: considered / selected / omitted
  reasons: LeapsReason[];                                     // deterministic codes + explanation (Section 5.4)
  contracts: ContractEvaluation[];                            // ALL evaluated contracts, ranked first, then rejected
  counts: {
    candidates: number;       // considered minus excludedProvablyIneligible
    notAcquired: number;      // omittedByCap (expiration/strike/symbol) + contracts in failed chunks
    quoted: number;           // acquired with a quote row
    eligible: number; ineligible: number;
    notEvaluable: number;     // acquired but DATA_UNAVAILABLE (required data unresolved)
  };
}
interface ContractEvaluation {
  occSymbol: string; expiration: string; strike: number;
  quoteMode: 'LIVE' | 'DELAYED' | 'LAST_SESSION';             // 4.3
  metrics: MetricSet;                                         // Gate 2 contract_* metrics (+ Gate 4 additions, Section 3)
  eligibility: 'ELIGIBLE' | 'INELIGIBLE' | 'DATA_UNAVAILABLE';
  gates: Array<{ id: string; status: 'pass' | 'fail' | 'unavailable'; reason?: string }>;
  rank: number | null;                                        // 1..n among ELIGIBLE only, within rankingScope
  score: number | null; scoreComponents: Record<string, number> | null;
}
```

The underlying's own `StrategyEvaluation` is carried alongside, unmodified: `QvLeapsResult = { underlying: StrategyEvaluation; leaps: LeapsEvaluation }`. Gate 7 (persistence) and Gate 6 (UI) read this shape; neither is built here. **Any displayed ranking must carry `rankingScope` and both gap counts.** `COMPLETE_CHAIN` means the ranking is exhaustive: acquisition was complete **and** no candidate is `DATA_UNAVAILABLE`. Otherwise it is `EVALUATED_SUBSET` and the explanation template is: "Ranked among the N contracts that could be evaluated. A contracts were not acquired (reasons) and B contracts were acquired but could not be evaluated (missing or invalid required data). A better contract may exist among them." Eligible results are always preserved and shown; the scope label only prevents them from implying an exhaustive ranking. "Contracts not acquired" (A) and "acquired but not evaluable" (B) are always reported separately.

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
| `contract_dollar_delta` | `Δ × S × M` | $ of stock exposure per contract | Gate 2 defaults M = 100 for existing callers; the QV path passes a **verified** M and never the default (4.4) |
| `contract_intrinsic_value` | `max(0, S - K)` | $/share | call only |
| `contract_extrinsic_value` | `mid - intrinsic`; `mid < intrinsic` = INVALID | $/share | Gate 2 |
| `contract_extrinsic_pct_of_mid` | `extrinsic / mid × 100` | % | matches the existing Find LEAPS extrinsic-% concept (`evaluateLeapsEntry`) |
| `contract_debit_per_contract` | `mid × M` | $ | entry assumption in 4.2 |
| `contract_effective_leverage` | `Δ × S / mid` | × (multiplier cancels) | "capital efficiency": stock exposure per option dollar. It depends on strike relative to spot, not only on delta and extrinsic % (see 8.4) |
| `contract_breakeven_price` | `K + mid` (expiration breakeven for a long call bought at `mid`) | $/share | |
| `contract_breakeven_move_pct` | `(breakeven / S - 1) × 100` | % | |
| `contract_theta` | provider `Θ` | $/share/day | CONDITIONAL on provider data (11.1) |
| `contract_vega`, `contract_implied_volatility` | provider | see units | CONDITIONAL |
| `contract_open_interest`, `contract_volume` | provider counts (non-negative integers) | contracts | volume CONDITIONAL |
| **new** `contract_extrinsic_annualized_pct` | `extrinsic_pct_of_mid × 365 / dte` | %/year | a **straight-line normalization of the premium fraction** over the contract's life. It is not actual annual theta decay (decay is non-linear and accelerates near expiry) and not an expected return or cost-of-carry forecast. Undefined for `dte ≤ 0` (INVALID) |
| **new** `contract_theta_pct_of_mid_per_day` | `abs(Θ) / mid × 100` | %/day | UNAVAILABLE when Θ unavailable; informational |
| **new** `contract_breakeven_at_indicative_ask_price` | `K + ask` | $/share | indicative ask-based sensitivity; not an executable price (4.2) |

Underlying/IV context metrics from Gate 2 that remain observable: `iv_rank_provider` (source-labelled, informational), `iv_rank_internal` / `iv_percentile_internal` (UNAVAILABLE). Section 5.3 states the IV rule.

**Identity worth knowing (used in 8.2):** for an in-the-money call with `mid = intrinsic + extrinsic`, `breakeven_price = K + mid = S + extrinsic`, so `contract_breakeven_move_pct = extrinsic / S × 100`. It is the extrinsic dollars expressed as a percentage of spot, not an independent observable.

## 4. Quote timestamps, entry price, instrument metadata

### 4.1 Evaluation time
`now` is an injected ISO instant read once after all provider I/O (same rule as `loadSecFundamentals`). DTE uses calendar dates. Session classification (4.3) uses the Gate 2c exchange calendar, which needs one additive helper (the regular-session open, 09:30 America/New_York; Gate 2c only exposes closes). That helper is a Gate 4 implementation item, not built here.

### 4.2 Entry-price assumption
Observable metrics use **mid** as the entry price (Gate 2 convention; matches Find LEAPS). `contract_breakeven_at_indicative_ask_price` is also produced as a sensitivity. **Gate 4 labels no price as executable.** Calling an ask executable would require a LIVE-mode quote that passes the freshness rules of 4.3 *and* a displayed ask size at least equal to the intended quantity; neither bid/ask size nor intended quantity exists in Gate 4's data or scope, so mid and ask are described only as "indicative". Executability validation belongs to the order path / a later gate. `[IAN]` confirm mid-for-metrics plus an indicative ask sensitivity (alternative: ask-based breakeven as the primary).

### 4.3 Timestamp semantics and snapshot modes
**Semantics.** `quoteAsOf` is the provider's last-update time for that instrument's quote (e.g. `quote-time` / `updated-at`), parsed to an instant. It is not the fetch time and not the last-trade time. The format and unit (ISO string vs epoch seconds vs epoch milliseconds) must be fixed per field by the provider audit (11.1); an unparseable or unit-ambiguous value is UNAVAILABLE (`QUOTE_TIMESTAMP_UNPARSEABLE`) and is never replaced by the fetch time. **Future timestamps:** `quoteAsOf > now + 5 s` is INVALID (`QUOTE_TIMESTAMP_IN_FUTURE`; the 5 s tolerance is clock-skew allowance `[QUINN]`).

**Two separate dimensions (feed delay is not session mode).**
1. *Session state*, derived by the evaluator from `now` and the Gate 2c calendar: `REGULAR_HOURS` (a session day, open <= now < close) or `MARKET_CLOSED` (everything else: before the open, after the close, weekends, holidays).
2. *Feed delay*, a provider label (`delayed` / `is-delayed`): a boolean. It never selects a session state and never relaxes a freshness test; it only chooses between the LIVE and DELAYED age rules **while the market is open**, and adds a flag when the market is closed.

**Precedence (first match governs):**
| Session state | Feed label | Rule that governs | Flag |
|---|---|---|---|
| REGULAR_HOURS | not delayed | **LIVE** age rule | none |
| REGULAR_HOURS | delayed | **DELAYED** age rule | `CONTRACT_DELAYED_QUOTE` |
| MARKET_CLOSED | any (delayed or not) | **LAST_SESSION** rule; a delay label does *not* switch to the DELAYED age rule (that would reject every after-hours quote) | `CONTRACT_LAST_SESSION_QUOTE`, plus `CONTRACT_DELAYED_QUOTE` if labelled |
A provider label `last_session` during REGULAR_HOURS is a mismatch and yields STALE, not an exemption. Provider labels can only make a snapshot stricter, never relax it.

| Rule | Option and underlying freshness | Skew | Use |
|---|---|---|---|
| LIVE | each `quoteAsOf` age <= 15 min (existing `OPTION_QUOTE_MAX_AGE_MS`) | `|t_option - t_underlying| <= 60 s` | discovery |
| DELAYED | age of the delayed observation timestamp <= 30 min (15 min feed delay + the 15 min live allowance) `[IAN]` | <= 60 s | discovery only |
| LAST_SESSION | **both** timestamps inside the **evidence window** of the latest completed regular session (Gate 2c `latestCompletedSession` and `sessionCloseEpochSeconds`): `[close - W, close]`; the 15-minute rule does not apply because the market is closed | <= 60 s | discovery only |

**LAST_SESSION evidence window `W` (explicit investment-review item `[IAN]`).** A last-session ranking is read over a weekend, so the question is how close to the close the evidence must be. Options: (A) anywhere in the session (accepts an opening-minutes quote that is up to ~6.5 hours stale at the close); (B) **final 60 minutes** (proposed default, `W = 60 min`; on an early-close day the window is 12:00-13:00 ET); (C) final 30 minutes. Trade-off: a tighter window rejects stale intraday evidence but also rejects thinly-quoted LEAPS whose quote was last updated earlier in the day, which would turn into `DATA_UNAVAILABLE` rather than a ranked result. Until Ian rules, B is the proposal and `W` lives in the policy object. The underlying must be the **regular-session** last price: an extended-hours print after the close fails the window (and normally the skew rule), and which price the provider returns is a 11.1 audit item.

**Worked precedence cases (these become fixtures; times America/New_York, normal 16:00 close, `W = 60`):**
| Now | Quote evidence | Outcome |
|---|---|---|
| Friday 17:00 (closed), not delayed | option 15:57, underlying 15:58 | LAST_SESSION: accepted (in window, skew 60 s) |
| Friday 17:00, labelled **delayed** | option 15:50, underlying 15:51 | LAST_SESSION governs; accepted with `CONTRACT_DELAYED_QUOTE` flag; no 30-minute age test |
| Friday 17:00 | option 09:40 (Friday opening minutes) | rejected under B: `CONTRACT_QUOTE_STALE` (accepted under A) |
| Saturday 10:00 | option 15:58 Friday, underlying 15:59 Friday | accepted (latest completed session = Friday, in window) |
| Saturday 10:00 | option 15:58 **Thursday** | STALE (not the latest completed session) |
| Monday 08:00 (pre-open, closed) | Friday 15:58 | accepted (latest completed session = Friday) |
| Monday 09:35 (open), not delayed | Friday 15:58 | LIVE: STALE (age far over 15 min) |
| Monday 09:35, delayed | Monday 09:12 observation | DELAYED: accepted with flag (age 23 min <= 30) |
| Monday 09:35, delayed | Friday 15:58 | DELAYED: STALE |
| Monday after a Friday holiday (e.g., Good Friday closed) | Thursday 15:58 | accepted (latest completed session = Thursday, by the calendar) |

Rules that hold in every rule: a delay or last-session flag **never overrides freshness** (each rule has its own explicit age or session test); a quote from an earlier session than the latest completed one is STALE (`CONTRACT_QUOTE_STALE`); the underlying quote is held to the same rule as the option (failure -> `LEAPS_UNDERLYING_QUOTE_UNAVAILABLE` or stale); metrics that combine option and underlying (dollar delta, intrinsic, extrinsic, leverage, breakeven) require the skew rule to pass. Because the underlying quote is fetched once before strike selection and reused as `S` for both selection and evaluation (Section 10), the spot used for contract math is a single, timestamped value. `[IAN]` on the DELAYED allowance, the LAST_SESSION window `W` and the 60 s skew; `[QUINN]` on the 5 s future tolerance.

### 4.4 Instrument metadata (multiplier and deliverable)
A multiplier of 100 alone does **not** prove a standard 100-share deliverable (adjusted contracts after splits, mergers or special dividends can keep 100 while delivering a different basket or a different root).

Positive instrument evidence required for a contract to be treated as standard (all from the provider's instrument or chain record, none from defaults):
1. a present, numeric shares-per-contract value (the repo already reads `shares-per-contract` from the nested chain, `lib/leaps-analysis/serverTradeReview.ts`); and
2. deliverable evidence: a provider deliverable/root record, or at minimum an OCC symbol root (the space-padded root in the OCC symbol) equal to the underlying symbol; and
3. no adjusted-contract indicator.
Which of these fields the provider actually returns is established by the audit (11.1); if the provider cannot supply (2), whether OCC-root equality plus shares-per-contract = 100 is sufficient evidence is an explicit decision `[IAN]` `[QUINN]`, otherwise QV eligibility is DATA_UNAVAILABLE for all contracts.

Outcomes: **any evidence missing -> `DATA_UNAVAILABLE`** (`INSTRUMENT_METADATA_UNAVAILABLE`), never an investment failure; **verified non-standard** (shares-per-contract != 100, OCC root != underlying, an adjusted indicator, or a deliverable other than exactly 100 shares of the underlying) -> `INELIGIBLE` (`CONTRACT_NON_STANDARD_DELIVERABLE`); verified standard -> `M` = the verified shares-per-contract.

**Compatibility is kept out of the QV path.** Gate 2's `buildContractMetrics` keeps its default `M = 100` for existing callers (unchanged), and `serverTradeReview`'s `?? 100` fallback stays Find LEAPS's own. The QV path uses a wrapper (`buildQvContractMetrics(raw, S, instrumentEvidence, ctx)`) that takes the verified multiplier as a **required** argument and returns every multiplier-dependent metric UNAVAILABLE (`INSTRUMENT_MULTIPLIER_UNAVAILABLE`) when it is absent. A test asserts the QV path can never produce a VALID multiplier-dependent metric from the default.

## 5. Missing, stale, invalid, unavailable, provider failure

### 5.1 Rules
1. A metric is usable only if VALID (Gate 2 contract). Nothing is defaulted to 0 or imputed; a missing bid/ask/delta/OI is UNAVAILABLE (the existing screener coercion `Number(x || 0)` is not reused).
2. **Required to be evaluable** (else the contract is `DATA_UNAVAILABLE`, never silently ineligible): strike, DTE, bid, ask, mid, delta, open interest, option quote timestamp and underlying price + timestamp (4.3), verified instrument evidence (4.4), intrinsic/extrinsic (derived).
3. **Optional** (contract stays eligible; flagged `INCOMPLETE_OPTIONAL_METRICS:<ids>`; shown as unavailable): theta, vega, implied volatility, volume, provider IV Rank. (`contract_extrinsic_annualized_pct` needs only required inputs, so it is not optional.)
4. A **crossed market** is INVALID (`CONTRACT_CROSSED_MARKET`); a **zero bid** is allowed by Gate 2 but is `INELIGIBLE` through the spread gate (spread = 200% of mid with bid 0), not hidden.
5. Duplicate OCC symbols in one snapshot: keep none and emit `CHAIN_DUPLICATE_CONTRACT` for the symbol (fail closed, no "first one wins").

### 5.2 Provider failure and incomplete acquisition
- Chain fetch failed (HTTP, timeout, auth): `coverage = FAILED`, `contractStatus = DATA_UNAVAILABLE`, reason `LEAPS_CHAIN_PROVIDER_FAILURE:<code>`. The underlying's state is untouched. This is shown as a technical failure, **not** as "no suitable LEAPS structure" (project design principle: technical failures block before a modal; verified empty results show the in-modal banner).
- **Incomplete acquisition** (a cap binds, or a market-data chunk fails): `coverage = RESTRICTED`. The chain client today skips a failed 100-symbol chunk silently (`try { ... } catch { continue; }`); Gate 4 acquisition must count it (`CHUNK_FAILURE`). A RESTRICTED result can be `EVALUATED` with `rankingScope = EVALUATED_SUBSET`, `NO_ELIGIBLE_IN_SUBSET` (only when nothing selected is unresolved), or `DATA_UNAVAILABLE` (Section 6 precedence); it is **never `NO_SUITABLE_CONTRACT`**, because omitted contracts might include an eligible one. Data failures are never relabelled as "none eligible".
- Token expiry (TastyTrade access tokens last about 15 minutes; all calls browser-side): `LEAPS_AUTH_EXPIRED`, a provider failure for that underlying; other underlyings continue after one token-refresh retry.
- **Verified-empty results** (only under `COMPLETE` coverage): no expirations in the DTE window `LEAPS_NO_LEAPS_EXPIRATIONS`; expirations exist but no call below spot `LEAPS_NO_CONTRACTS_IN_WINDOW`. Status `NO_SUITABLE_CONTRACT` with that reason.
- Every selected contract unresolved (quote rows missing, failed chunks, or all `DATA_UNAVAILABLE`), including a restricted search with **zero usable quotes**: `LEAPS_ALL_QUOTES_UNAVAILABLE` (or `LEAPS_ALL_CONTRACTS_DATA_UNAVAILABLE` when rows arrived but none were evaluable) -> `DATA_UNAVAILABLE`.
- Underlying quote unavailable, unparseable, future-dated or stale: `LEAPS_UNDERLYING_QUOTE_UNAVAILABLE` -> `DATA_UNAVAILABLE`.
- Failure isolation: a failure for one underlying never affects another, the Gate 3 evaluation, or Find LEAPS.

### 5.3 IV Rank / IV Percentile
TradeEdge stores no historical IV series (Gate 2 finding), so `iv_rank_internal` and `iv_percentile_internal` stay UNAVAILABLE; Gate 4 must not compute, approximate or back-fill them (ticket Section 26). The provider IV Rank stays `iv_rank_provider`, source-labelled, informational, and **excluded from eligibility and ranking** (consistent with the Gate 2b ruling that provider IV Rank remains source-labelled informational). Current contract IV is shown as an observable when its unit is verified (11.1) and is not ranked. `[IAN]` confirm IV is observable-only in v1.0.

### 5.4 Deterministic reason codes (proposed registry)
Result level: `LEAPS_NOT_EVALUATED_UNDERLYING_NOT_QUALIFIED`, `LEAPS_UNDERLYING_QUOTE_UNAVAILABLE`, `LEAPS_CHAIN_PROVIDER_FAILURE:<code>`, `LEAPS_AUTH_EXPIRED`, `LEAPS_ACQUISITION_RESTRICTED:<EXPIRATION_CAP|STRIKE_CAP|SYMBOL_CAP|CHUNK_FAILURE>` (carries omitted count), `LEAPS_RANKING_IS_EVALUATED_SUBSET`, `LEAPS_NO_LEAPS_EXPIRATIONS`, `LEAPS_NO_CONTRACTS_IN_WINDOW`, `LEAPS_ALL_CONTRACTS_DATA_UNAVAILABLE`, `LEAPS_ALL_QUOTES_UNAVAILABLE`, `LEAPS_NO_SUITABLE_CONTRACT`, `LEAPS_NO_ELIGIBLE_IN_SUBSET`.
Contract level (gates): `CONTRACT_DTE_BELOW_MIN`, `CONTRACT_DTE_ABOVE_MAX`, `CONTRACT_DELTA_BELOW_MIN`, `CONTRACT_DELTA_ABOVE_MAX`, `CONTRACT_OI_BELOW_MIN`, `CONTRACT_SPREAD_ABOVE_MAX`, `CONTRACT_EXTRINSIC_ABOVE_MAX`, `CONTRACT_NON_STANDARD_DELIVERABLE`, `INSTRUMENT_METADATA_UNAVAILABLE`, `INSTRUMENT_MULTIPLIER_UNAVAILABLE`, `CONTRACT_CROSSED_MARKET`, `CONTRACT_QUOTE_STALE`, `CONTRACT_QUOTE_TIMESTAMP_MISSING`, `QUOTE_TIMESTAMP_UNPARSEABLE`, `QUOTE_TIMESTAMP_IN_FUTURE`, `CONTRACT_QUOTE_SKEW_EXCEEDED`, `CONTRACT_DELAYED_QUOTE` (flag), `CONTRACT_LAST_SESSION_QUOTE` (flag), `CONTRACT_METRIC_UNAVAILABLE:<id>`, `CONTRACT_METRIC_INVALID:<id>`, `INCOMPLETE_OPTIONAL_METRICS:<ids>` (flag), `CHAIN_DUPLICATE_CONTRACT`.
Each reason carries a fixed template explanation, the observed value and the threshold from the same comparison that produced it (the pattern used by Gate 3 `reasons.ts`), so wording cannot diverge from logic.

## 6. Contract status derivation (explicit precedence; order is fixed)

**Definitions.** *Candidate* = a call in the selected-window expirations that is not provably excluded (strike >= spot, Section 10 stage 3a). *Not acquired by design* = candidates omitted by an expiration, strike or symbol cap. *Selected* = candidates chosen for quoting. *Unresolved* = selected contracts without a definitive eligibility result: the quote row is missing (including contracts in a failed chunk), or a required input is `DATA_UNAVAILABLE`/STALE/INVALID (Section 5.1). *Definitively ineligible* = evaluated with a verified gate failure. Acquisition coverage is `COMPLETE` only when nothing is omitted by design and no chunk failed; it says nothing about evaluation.

**Precedence:**
1. Underlying not `SETUP`/`ACTIONABLE` -> `NOT_EVALUATED` (no acquisition).
2. Underlying quote unavailable/invalid/stale, or coverage `FAILED` -> `DATA_UNAVAILABLE`.
3. **Any contract `ELIGIBLE` -> `EVALUATED`.** All eligible contracts are preserved and ranked. `rankingScope = COMPLETE_CHAIN` only if coverage is `COMPLETE` **and** unresolved = 0; otherwise `EVALUATED_SUBSET`, with reasons `LEAPS_RANKING_IS_EVALUATED_SUBSET` and the two separate counts: `notAcquired` (omitted by design + contracts in failed chunks) and `notEvaluable` (acquired but unresolved). An unresolved or unacquired contract might be eligible and outrank the returned ones, and the label says so.
4. **No eligible contract and unresolved > 0 -> `DATA_UNAVAILABLE`** (reasons by unresolved cause, with counts of definitive ineligible, unresolved and not-acquired). This holds whether or not the search was restricted.
5. No eligible contract, unresolved = 0, coverage `RESTRICTED` (contracts omitted by design) -> `NO_ELIGIBLE_IN_SUBSET`, with considered/selected/omitted counts and the dominant failing gates of the evaluated subset (the subset may be empty when omitted expirations remain).
6. No eligible contract, unresolved = 0, coverage `COMPLETE` -> `NO_SUITABLE_CONTRACT` with the dominant failing gates (counts per gate) as reasons; or, for a verified-empty complete search, `NO_SUITABLE_CONTRACT` with the specific reason `LEAPS_NO_LEAPS_EXPIRATIONS` (no expiration in the DTE window) or `LEAPS_NO_CONTRACTS_IN_WINDOW` (every call is at or above spot).

**Decision table (fixtures for acceptance test 3; `elig`/`inel`/`unres` are counts among selected contracts, `omit` = omitted by design, `fail` = contracts in failed chunks, counted as unresolved):**
| # | Coverage | elig | inel | unres | omit | fail | contractStatus | rankingScope | Notes |
|---|---|---|---|---|---|---|---|---|---|
| D1 | COMPLETE | 2 | 1 | 0 | 0 | 0 | EVALUATED | COMPLETE_CHAIN | exhaustive |
| D2 | COMPLETE | 1 | 1 | 1 | 0 | 0 | EVALUATED | EVALUATED_SUBSET | unresolved one may outrank; counts A=0, B=1 |
| D3 | RESTRICTED | 1 | 2 | 0 | 5 | 0 | EVALUATED | EVALUATED_SUBSET | A=5, B=0 |
| D4 | RESTRICTED | 1 | 0 | 2 | 3 | 0 | EVALUATED | EVALUATED_SUBSET | A=3, B=2 reported separately |
| D5 | COMPLETE | 0 | 2 | 1 | 0 | 0 | DATA_UNAVAILABLE | null | precedence 4 over 6 |
| D6 | COMPLETE | 0 | 3 | 0 | 0 | 0 | NO_SUITABLE_CONTRACT | null | gate counts as reasons |
| D7 | RESTRICTED | 0 | 3 | 0 | 4 | 0 | NO_ELIGIBLE_IN_SUBSET | null | never NO_SUITABLE_CONTRACT |
| D8 | RESTRICTED | 0 | 2 | 1 | 4 | 0 | DATA_UNAVAILABLE | null | data failure not relabelled (5 not reached) |
| D9 | RESTRICTED | 0 | 0 | 0 | 0 | 100 | DATA_UNAVAILABLE | null | all selected in failed chunks, **zero usable quotes**; `LEAPS_ALL_QUOTES_UNAVAILABLE` |
| D10 | RESTRICTED | 0 | 0 | 40 | 60 | 0 | DATA_UNAVAILABLE | null | rows arrived, none evaluable, **zero usable**; cap also omitted 60 |
| D11 | COMPLETE | 0 | 0 | 0 | 0 | 0 | NO_SUITABLE_CONTRACT | null | no expiration in window: `LEAPS_NO_LEAPS_EXPIRATIONS` |
| D12 | COMPLETE | 0 | 0 | 0 | 0 | 0 | NO_SUITABLE_CONTRACT | null | every call >= spot: `LEAPS_NO_CONTRACTS_IN_WINDOW` |
| D13 | RESTRICTED | 0 | 0 | 0 | 2 expirations | 0 | NO_ELIGIBLE_IN_SUBSET | null | selected expirations held only calls >= spot; omitted expirations remain |
| D14 | FAILED | - | - | - | - | - | DATA_UNAVAILABLE | null | `LEAPS_CHAIN_PROVIDER_FAILURE:<code>` |
| D15 | (underlying `WATCH`) | - | - | - | - | - | NOT_EVALUATED | null | zero provider calls |
| D16 | COMPLETE | 1 | 0 | 0 | 0 | 0 | EVALUATED | COMPLETE_CHAIN | single eligible contract, ranked 1 |

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

**Leverage "no gate" is an explicit investment proposal requiring review `[IAN]`, not a mathematical consequence.** Effective leverage `Δ·S/mid` is constrained by the delta band and the extrinsic ceiling but is *not* determined by them: for the same delta and the same extrinsic %, a deeper in-the-money strike has a larger intrinsic share, a larger mid and therefore lower leverage (matched example in 8.4: leverage 3.4 vs 1.7). The proposal not to gate it rests on a judgment (the delta band already expresses the desired exposure; leverage is shown for the trader), which Ian may reject by adding a floor.

**Policy invariants (tested):** `extrinsicPctMax < 100` (the strike >= spot exclusion in Section 10, stage 3a, is only provably eligibility-preserving while this holds; if it were ever >= 100 that exclusion is disabled); `deltaMin <= deltaMax`; `dteMin <= dteMax`; all thresholds finite.

## 8. Proposed ranking — `[IAN]` on every weight

Only `ELIGIBLE` contracts are ranked, within one underlying, and only within the stated `rankingScope`. Score is 0-100, the sum of four components, each a clamped linear ramp `clamp01(x) = min(1, max(0, x))`:

| Component | Weight | Sub-score (0..1) | Existing basis |
|---|---|---|---|
| Cost efficiency | 35 | `clamp01(1 - extrinsic_pct_of_mid / 30)` | `leapsScore.ts` ceiling 30 (provisional there too) |
| Time-value carry | 15 | `clamp01(1 - extrinsic_annualized_pct / 20)` | new |
| Breakeven distance | 20 | `clamp01(1 - breakeven_move_pct / 15)` | new |
| Liquidity | 30 | `0.5·clamp01(1 - spread_pct/10) + 0.5·clamp01(OI/500)` | `leapsScore.ts` liquidity shape (same 10% / 500 ceilings) |

Delta and DTE are filter-only (not scored). Effective leverage, theta, vega, IV and volume are observable-only in v1.0. None of the scored components uses an optional input, so missing optional data needs no renormalisation or penalty.

### 8.1 Canonical comparator (replaces the epsilon comparison)
Pairwise "within 1e-9 means equal" is not transitive (A~B and B~C can hold while A and C differ), so sorting by it can depend on input order. Replace it with **quantized integer keys** and a lexicographic comparison:

`scoreQ = Math.round(score × 1e6)`, `extQ = Math.round(extrinsic_pct × 1e6)`, `spreadQ = Math.round(spread_pct × 1e6)`.

Sort key, ascending, compared left to right: `(-scoreQ, extQ, spreadQ, -openInterest, -dte, strike, expiration, occSymbol)`. Every component is an integer, an exact decimal strike, a date string or the OCC string (compared by code unit), so the relation is a total order over distinct contracts (OCC symbols are unique after duplicate rejection) and equal `scoreQ` is an exact integer tie, which is transitive. Quantization at 1e-6 means two scores that differ by less than the quantum may sort by tie-breakers; that is a stated policy property, and the output remains a pure function of the *set* of inputs regardless of their order. Gate thresholds (Section 7) are compared after the same kind of quantization (`Math.round(x × 1e9)` on both sides), which is a single-value comparison and has no transitivity issue.

Fixture `T` (acceptance test 7): three contracts with `score` X = 50.0000000018, Y = 50.0000000009, Z = 50.0000000000 (adjacent differences 9e-10 < 1e-9 but X-Z = 1.8e-9 > 1e-9, the intransitive case). `scoreQ` is 50000000 for all three. Tie-break fields: X `ext 14.0, spread 1.0`; Y `ext 13.0, spread 2.0`; Z `ext 13.0, spread 1.5`. Expected order: **Z, Y, X** (equal key; lowest extrinsic first, then lowest spread; X is last even though its raw score is highest, which exact comparison would not give). The test sorts all 6 permutations of the input and requires identical output; the old epsilon comparator would not satisfy it.

### 8.2 Ranking overlap (for Ian's assessment)
Three of the four components are functions of the same quantity, extrinsic value, so 70 of the 100 points follow one variable:
- cost efficiency uses `extrinsic / mid`; carry uses `extrinsic / mid × 365/dte`; breakeven distance is `extrinsic / S` (identity in Section 3). Holding DTE fixed, carry is a rescaling of cost efficiency and breakeven distance differs only by dividing by `S` instead of `mid`.
- Matched example (same underlying `S = 100`, `dte = 730`, `K = 80`): contract P has extrinsic 10% of mid (mid 22.22, extrinsic $2.22); contract Q has extrinsic 20% of mid (mid 25.00, extrinsic $5.00). Cost 23.333 vs 11.667; carry 11.250 vs 7.500; breakeven 17.037 vs 13.333; the three-component subtotal is **51.620 vs 32.500**. Every one of the three moves the same direction for the same reason; only liquidity (30 points) is independent evidence.
- Consequence for review: a contract's first-order rank is essentially "least extrinsic first". If that is intended, the three components could be merged (simpler, honest weights); if not, a component that measures something different (for example delta/exposure efficiency) is needed. `[IAN]`

### 8.3 Maturity bias (for Ian's assessment)
The carry component divides by DTE, so for the same premium fraction a longer-dated contract scores higher. Matched example (`S = 100`, `K = 80`, extrinsic exactly 15% of mid, mid 23.5294 in both): at `dte = 400` carry is 13.6875 %/yr -> 4.734 points; at `dte = 730` it is 7.5 %/yr -> **9.375 points**. The 730-day contract earns **+4.64 points** for an identical premium fraction, although it ties up capital for longer and the extra time is not "cheaper" in total dollars. The effect is partly offset because longer contracts normally carry more extrinsic: matched example `K = 70`: `dte 400`, mid 34 (extrinsic 11.765%) scores cost 21.275 + carry 6.949 + breakeven 14.667 = **42.890**, while `dte 730`, mid 36 (extrinsic 16.667%) scores 15.556 + 8.750 + 12.000 = **36.306**, so here the shorter contract still wins even though the longer one has the lower annualized carry (8.33 vs 10.74 %/yr). The annualized figure is a straight-line normalization (Section 3), not true annual decay; whether the ranking should reward it at all, or use a DTE-neutral measure, is an investment question `[IAN]`. The proposed DTE window (365-900) already bounds the effect.

### 8.4 Effective leverage is not fixed by delta and extrinsic % alone
`leverage = Δ·S/mid` and `mid = (S - K) + extrinsic` for an in-the-money call. With the same delta (0.80) and the same extrinsic % (15% of mid) at `S = 100`: `K = 80` -> mid 23.529 -> leverage **3.40**; `K = 60` -> mid 47.059 -> leverage **1.70**. The strike relative to spot sets the intrinsic share and therefore the capital required. This is why "no leverage gate" is presented as a review item, not a derived fact (Section 7).

## 9. Worked examples (independent hand arithmetic; used as test fixtures)
Evaluation date 2026-10-05, underlying `S = 100`, multiplier 100, policy of Section 7.

**A** — K 80, bid 24.50 / ask 25.50, Δ 0.80, OI 400, DTE 540, fresh, skew 0 s.
mid 25.00; intrinsic 20; extrinsic 5.00 → **20.0000%** of mid (boundary: passes `≤ 20`); spread 1.00/25 = **4.0%**; dollar delta 0.80×100×100 = **8,000**; debit **$2,500**; effective leverage 0.80×100/25 = **3.2**; breakeven 105.00, move **5.0%**; annualized extrinsic 20×365/540 = **13.518519%**; indicative ask-based breakeven 105.50.
Score: cost 35×(1−20/30)=11.666667; carry 15×(1−13.518519/20)=4.861111; breakeven 20×(1−5/15)=13.333333; liquidity 30×(0.5×0.6+0.5×0.8)=21.000000 → **50.861111**.

**E** — K 75, bid 28.60 / ask 29.40, Δ 0.84, OI 250, DTE 730.
mid 29.00; intrinsic 25; extrinsic 4.00 → **13.793103%**; spread 0.80/29 = **2.758621%**; dollar delta **8,400**; debit **$2,900**; leverage 0.84×100/29 = **2.896552**; breakeven 104.00, move **4.0%**; annualized 13.793103×365/730 = **6.896552%**.
Score: cost 35×(1−13.793103/30)=18.908046; carry 15×(1−6.896552/20)=9.827586; breakeven 20×(1−4/15)=14.666667; liquidity 30×(0.5×0.724138+0.5×0.5)=18.362069 → **61.764368**. Ranks 1; A ranks 2.

**B** — K 90, bid 17.00 / ask 18.00, Δ 0.68, OI 400, DTE 540: mid 17.50, intrinsic 10, extrinsic **42.857143%** > 20 → `CONTRACT_EXTRINSIC_ABOVE_MAX`; Δ 0.68 < 0.70 → `CONTRACT_DELTA_BELOW_MIN`. INELIGIBLE, two reasons, unranked (its would-be score 28.428571 is not computed).

**C** — K 75, bid 29.00 / ask 29.50, Δ 0.85 (boundary, passes), OI 99, DTE 400: mid 29.25, extrinsic 14.529915%, spread 1.709402%; OI 99 < 100 → `CONTRACT_OI_BELOW_MIN`. INELIGIBLE (all other gates pass), would-be score 52.843754 is not ranked.

**Result for the A/B/C/E snapshot (coverage `COMPLETE`):** `EVALUATED`; ranked E (61.764368), A (50.861111); B and C INELIGIBLE with the codes above. **No-contract example:** if only B and C were fetched with a complete snapshot, `NO_SUITABLE_CONTRACT` with reason counts `{CONTRACT_EXTRINSIC_ABOVE_MAX:1, CONTRACT_DELTA_BELOW_MIN:1, CONTRACT_OI_BELOW_MIN:1}`; the same B and C with coverage `RESTRICTED` give `NO_ELIGIBLE_IN_SUBSET` (never `NO_SUITABLE_CONTRACT`), and with coverage `COMPLETE` but one contract `DATA_UNAVAILABLE` give `DATA_UNAVAILABLE` (Section 6). The comparator fixture `T` is in 8.1.

## 10. Architecture, provider mapping and staged retrieval

- **Pure core** `lib/discovery/leaps/` (new): `policy.ts` (`QV_LEAPS_POLICY_V1`, frozen, fingerprint-tested), `evaluate.ts` (instrument evidence, quote policy, gates, status derivation, reasons), `rank.ts` (scoring, canonical comparator), `reasons.ts` (registry), `index.ts`. No network, clock, UI or app imports (the existing `noInvestmentLogic` and isolation tests are extended to this directory; investment thresholds live only in `policy.ts`).
- **Reuse:** Gate 2 contract-metric formulas through the QV wrapper (4.4), `providerNumber`, the `MetricSet` validity model, Gate 3 `StrategyEvaluation`, Gate 2c exchange calendar. Not reused: `computeLeapsScore` / `evaluateLeapsEntry` (Find LEAPS's own; their numbers are cited as defaults, never imported, so changing one cannot move the other).
- **Acquisition (browser-side, TastyTrade rule):** a new additive module (proposed `lib/scans/leapsQvChainClient.ts`), because `getPmccChain` drops theta, vega, volume, IV and instrument evidence, hides chunk failures, and cannot be changed without touching Find LEAPS. Endpoints already used by the repo: `/option-chains/{symbol}/nested` (expirations, strikes, OCC symbols, shares-per-contract) and `/market-data/by-type` (quotes/greeks/OI) in chunks of 100, plus a timestamped underlying quote (11.4). Dependencies are injected so staging and the evaluator are testable without a network.

### Staged retrieval (ticket Section 33), deterministic and completeness-reporting
0. **Eligible underlyings:** only Gate 3 `SETUP`/`ACTIONABLE`; no options call otherwise.
1. **Underlying quote, once, first:** price plus its provider timestamp. This single value is `S` for stage 3 selection and for all evaluation, so selection and evaluation cannot disagree about spot.
2. **Expirations:** one `nested` call; window `E` = expirations with `dteMin <= DTE <= dteMax`. Zero -> verified-empty `LEAPS_NO_LEAPS_EXPIRATIONS` (coverage `COMPLETE`). If `|E| > 6` (`EXPIRATION_CAP` = 6), select 6 by priority: `|DTE - 730|` ascending, ties earlier expiration first; the rest are omitted and counted (`EXPIRATION_CAP`, coverage `RESTRICTED`). Not provable ineligible, so omission is always a restriction.
3. **Strikes, per selected expiration, calls only:**
   a. `K >= S`: **provably ineligible** — intrinsic is 0, so extrinsic is 100% of mid, which fails the extrinsic gate whenever `extrinsicPctMax < 100` (policy invariant, Section 7). Excluded, counted in `excludedProvablyIneligible`, **not** a restriction. (A zero mid cannot pass the spread/required-metric rules either.)
   b. `K < S`: every strike is a candidate. **There is no lower moneyness band**, because delta cannot be bounded from strike and spot alone, so no deep-in-the-money strike can be proven ineligible without quotes. If an expiration has `<= N` such strikes, all are selected. `N = 40` per expiration (`STRIKE_CAP`); if more, select 40 by priority `|K - 0.80·S|` ascending, ties lower strike first; the rest are omitted and counted (coverage `RESTRICTED`). The 0.80·S priority target and `N = 40` are acquisition-cost controls **not investment gates**; they never produce a "no suitable" verdict.
4. **Symbol cap:** total selected symbols per underlying are capped at 240 (`SYMBOL_CAP` = 6 expirations x 40 strikes, three 100-symbol chunks), ordered by (expiration priority, strike priority); it is a safety net that cannot bind before the two caps above, and it is reported if it ever does.
5. **Quotes:** `market-data/by-type` in chunks of 100. A failed chunk is counted (`CHUNK_FAILURE`, contracts in it omitted) -> coverage `RESTRICTED`.
6. **Evaluate and rank** (pure).

**Coverage rule:** `COMPLETE` only if no restriction applied (no expiration cap, strike cap, symbol cap or chunk failure) and the chain parsed. Acquisition completeness is **not** evaluation completeness: `rankingScope = COMPLETE_CHAIN` additionally requires that no candidate be unresolved (Section 6). Otherwise `RESTRICTED`; a failed chain is `FAILED`. Eligibility-preserving coverage is claimed **only** for exclusion 3a (proven above); every other omission is a restriction. The acquisition report always carries `considered`, `selected` and `omitted` counts per reason (Section 2), and any returned ranking states its `rankingScope`. Typical LEAPS ladders are expected to be small (a few expirations in a 365-900 day window), so the caps should rarely bind; the audit (11.1) must measure real ladder sizes and Ian/Quinn may raise the caps, but a binding cap is always visible.
- **Gate 3 -> Gate 4 handoff:** an orchestrator takes `{symbol, StrategyEvaluation}` pairs and calls acquisition + evaluator per qualifying underlying, returning `QvLeapsResult`. It never mutates the evaluation or lifecycle state.
- **Persistence/UI/sizing/scenarios:** none in Gate 4.

## 11. Dependencies, data audit, limits

### 11.1 Provider data audit (Gate 4a — required before coding) `[QUINN]` `[IAN]`
**Status: NOT PERFORMED.** TastyTrade is reached browser-side with the user's own token; this session has no authorized read-only provider access and the sandbox cannot reach the provider, and credentials must never be committed. The audit therefore needs a person with authorized access (or a session linked to Dean's browser) to run a read-only capture, with responses sanitized (no tokens, headers, account numbers; only instrument and market-data fields) and committed as fixtures under `lib/discovery/leaps/__fixtures__/`.

**Specific missing evidence:**
1. `/option-chains/{symbol}/nested`: which per-expiration / per-strike fields exist (`shares-per-contract`, root symbol, expiration type, settlement type) and their values for a standard and, if obtainable, an adjusted/non-standard contract.
2. Instrument records for equity options (deliverables, shares-per-contract, root symbol) — to decide whether positive deliverable evidence (4.4) is available.
3. `/market-data/by-type` option rows: presence and format of `bid`, `ask`, bid/ask **size**, `delta`, `theta`, `vega`, implied volatility (**unit**: fraction vs percent; do not copy the `<= 1 => x100` heuristic in `getMarketMetrics`), `volume`, `open-interest`, the quote timestamp field(s) (`quote-time` / `updated-at`: format, unit, semantics), and the delayed flag.
4. Underlying equity quote fields including its timestamp.
5. The same calls after hours (to confirm last-session behavior and timestamps) and during regular hours.
6. Observed behavior of a failed or partial `market-data/by-type` chunk.
7. Real ladder sizes (expirations in the 365-900 day window; strikes below spot per expiration) for about five liquid and illiquid underlyings, to size `N`, the expiration cap and the symbol cap.
Any value whose unit or meaning cannot be established from real rows stays UNAVAILABLE in the QV path.

### 11.2 Additive acquisition changes
Timestamped underlying quote (today `getQuote` returns a bare number); the QV metric wrapper with a required verified multiplier (4.4); counted chunk failures; call-only source filter; a session-open helper on the Gate 2c calendar (4.1). No existing function signature changes.

### 11.3 Performance limits (proposed) `[QUINN]`
Per underlying: <= 6 expirations, <= 40 strikes per expiration, <= 240 symbols (<= 3 market-data requests). Per run: max 25 qualifying underlyings (excess underlyings are reported as `LEAPS_NOT_EVALUATED_RUN_CAP`, not as unsuitable), concurrency 3, per-underlying budget 20 s with a `LEAPS_CHAIN_PROVIDER_FAILURE:TIMEOUT` result. No options call for any non-SETUP/ACTIONABLE underlying. Every limit that binds is reported in the acquisition report and reasons; none is silent and none yields a "no suitable contract" verdict.

### 11.4 Dependencies: completed-bar timestamps vs the underlying quote still required
- **Exists (Gate 2c):** completed daily-bar timestamps for the underlying's *price history*, built from the Yahoo daily series with the exchange calendar, forming bars dropped. They have session-level granularity (a session's bar time), were built for technical state, and are not a valid spot for option math at chain time.
- **Does not exist yet:** a **timestamped underlying quote at chain time** (price plus the provider's quote timestamp). Today `getQuote` returns a bare number, and the only timestamped underlying quote in the repo is the server-side `serverTradeReview` path. Gate 4 requires a new additive browser-side quote function returning `{ price, quoteAsOf }`, used both as `S` and for the skew and freshness rules (4.3).
- Other dependencies, closed and available: Gate 3 `StrategyEvaluation`, Gate 2 contract-metric formulas, Gate 2c exchange calendar. Production has no `StrategyInput` assembler yet (ticket Gate 7 / separate), so until one exists the orchestrator is exercised through tests and a documented harness only: a scope question for Paul.

## 12. Regression protection for existing Find LEAPS
The Find LEAPS scan is implemented inline in `app/screener/page.tsx` (`runLeapsScan`, not exported). A test that re-implements its formulas proves nothing about production, so verification must run the **real path**.

1. **Production-path integration harness (primary).** Render the actual `ScreenerPage` with React Testing Library under jsdom (the repo already does this in `app/screener/__tests__/UnifiedStrategyLauncher.test.tsx` and `ScreenerPage.test.tsx`, which mock `@/lib/scans/tastytrade-client`). Mock at the network boundary only: the tastytrade-client functions (`getPmccChain` source responses, `getQuote`, `getMarketMetrics`) return a sanitized recorded fixture (nested chain + market-data rows from the 11.1 capture). Drive the real flow (supply a ticker, press FIND LEAPS, submit the scan modal) and compare the produced rows (symbol, expiration, DTE, strike, delta, OI, bid, ask, spread %, extrinsic, score, IVR/IVx) to goldens. If the rendered page does not expose a field, read the persisted LEAPS session payload (`persistLeapsSession`) instead; no production code change either way. `[QUINN]` which observable surface.
2. **Goldens are recorded before Gate 4 code lands**, from the unchanged baseline, in a separate characterization commit; they are never regenerated in the same change as Gate 4 code, so a drift cannot be "fixed" by re-recording.
3. **Pure-function characterization tests (retained, secondary):** freeze `computeLeapsScore`, `evaluateLeapsEntry`, `adaptPmccChain` and `resolveLeapsCriteria` for numeric tables (including the Section 9 contracts run through the *existing* functions, whose scores differ from the QV score by design, documenting that the two rankings are independent).
4. **One-way dependency and untouched-files guard:** a test fails if any Find LEAPS file imports `lib/discovery/leaps` or the new acquisition module; Gate 4 changes to `app/screener/page.tsx`, `lib/scans/pmccChainClient.ts`, `pmccChainAdapter.ts`, `leapsScore.ts`, `leapsEntryQualification.ts`, `lib/leaps-analysis/*` and `tastytrade-client.ts` are a review blocker (checked against the diff at gate review).
5. Full suite on every push (CI already runs it) plus the targeted Find LEAPS suites in the gate report.

## 13. Acceptance tests (Gate 4 implementation, for Alan/Quinn)
1. **Independent numeric fixtures:** Section 9 values (A, E, B, C) and the Section 8 matched examples (overlap, maturity bias, leverage 3.4 vs 1.7) computed by an independent script and embedded as literals; every Section 3 metric for A and E; scores to 6 decimals.
2. **Boundaries:** each gate at, just below and just above its threshold (DTE 364/365/366 and 899/900/901; delta 0.6999/0.70, 0.85/0.8501; OI 99/100; spread 10.0/10.0001; extrinsic 20.0/20.0001; LIVE age 15:00/15:01; skew 60 s/61 s; future timestamp 5 s/6 s); floating-point cases (`5/25 x 100`).
3. **Acquisition and evaluation completeness (decision table):** every row D1-D16 of Section 6 as a fixture asserting status, `rankingScope`, the separate `notAcquired` and `notEvaluable` counts and the reason codes, including restricted acquisition with zero usable quotes (D9, D10), the precedence cases (D5, D8), and a complete search with one unresolved contract keeping its eligible results as `EVALUATED_SUBSET` (D2). Also: a strike cap, expiration cap, symbol cap and a failed chunk each make coverage `RESTRICTED` with correct considered/selected/omitted counts; a restricted search with no eligible contract returns `NO_ELIGIBLE_IN_SUBSET`, never `NO_SUITABLE_CONTRACT`; a restricted search with an eligible contract states `rankingScope = EVALUATED_SUBSET`; selection order is deterministic (permuted chain input gives identical selection); strikes `>= S` are excluded as provably ineligible without restricting coverage, and an invariant test fails if `extrinsicPctMax >= 100`; coverage `COMPLETE` with all contracts verified ineligible -> `NO_SUITABLE_CONTRACT`; verified-empty chains.
4. **Unsuitable / data failures:** chain failure, auth expiry, missing/stale/skewed/future/unparseable timestamps, crossed market, zero bid, missing delta/OI/bid/ask (UNAVAILABLE, not 0), duplicate OCC, a put in a call-only chain (INVALID), underlying quote missing, per-underlying failure isolation, `COMPLETE` coverage with one `DATA_UNAVAILABLE` contract -> `DATA_UNAVAILABLE`.
5. **Quote modes and precedence:** the ten worked cases of 4.3 as fixtures (Friday evening delayed-labelled, Saturday, Monday pre-open, Monday open delayed and not delayed, holiday weekend), the evidence-window cases under `W` = 60 (near-open Friday quote rejected, near-close accepted, early-close window 12:00-13:00); LIVE, DELAYED and LAST_SESSION each with fresh, stale, future and mismatched-label cases; a delayed label never relaxes freshness; a last-session quote during regular hours is STALE; a delay label never switches a closed-market snapshot to the 30-minute rule; a quote from a session earlier than the latest completed one is STALE; the underlying quote is held to the same rule; no price is ever labelled executable.
6. **Instrument metadata:** missing multiplier or deliverable evidence -> `DATA_UNAVAILABLE`; shares-per-contract 100 with an adjusted indicator or mismatched OCC root -> `INELIGIBLE` `CONTRACT_NON_STANDARD_DELIVERABLE`; verified non-100 -> `INELIGIBLE`; the QV wrapper never yields a VALID multiplier-dependent metric from the default 100.
7. **Ranking determinism:** fixture `T` (8.1): all 6 permutations give Z, Y, X; every tie-breaker rung exercised; order-independence over shuffled inputs; stable across repeated runs.
8. **State discipline:** non-SETUP/ACTIONABLE underlyings make zero acquisition calls (spy); a contract result never changes the `StrategyEvaluation` object (deep-equal); no scenario/sizing/UI imports.
9. **IV:** `iv_rank_internal`/`iv_percentile_internal` stay UNAVAILABLE; provider rank never enters eligibility or score; IV unit handling covered by the real-row fixtures of 11.1.
10. **Existing-finder verification** (Section 12): production-path harness against pre-recorded goldens, pure-function characterization, and the isolation/`noInvestmentLogic` guards extended to `lib/discovery/leaps/`.
11. **Policy pinning:** `QV_LEAPS_POLICY_V1` fingerprint test, versioned; changing any threshold, weight, cap or `N` requires a new policy version.
12. Gate completion verification as in earlier gates: tsc with `tsconfig.check.json`, targeted + full suite, exact-head CI and Vercel.

## 14. Explicit exclusions
No Bear/Base/Bull scenarios (Gate 5), no scenario engine, QV UI (Gate 6), snapshot persistence (Gate 7), sizing or allocation, order construction/execution, rolling, notifications, pre-expiration theoretical option pricing, historical IV storage, or any change to Gate 3 methodology.

## 15. Interfaces left for later gates (not built here)
Gate 5 consumes `{ occSymbol, expiration, strike, debitPerContract (= mid × M), breakevenPrice, multiplier }` from a `ContractEvaluation`; the entry-price assumption (mid) is part of that contract so scenarios use the same debit. Gate 6 reads `QvLeapsResult` and reason codes. Gate 7 serialises `QvLeapsResult` with `policyVersion`.

## 16. Review package

**Decisions requiring Ian:** (1) DTE window 365-900 (vs the 180 floor of Find LEAPS); (2) extrinsic ceiling 20 vs 25 for 2-year contracts; (3) mid-with-indicative-ask entry assumption; (4) volume, debit, leverage, theta, vega, IV observable-only, **including that "no leverage gate" is an investment proposal** (8.4); (5) ranking weights, ramps and tie-breaker order, **and whether the overlap among cost, carry and breakeven (8.2) and the maturity bias of the carry component (8.3) are acceptable or the components should be merged / replaced**; (6) DELAYED allowance (30 min) and LAST_SESSION discovery use, **including the evidence window `W` (anywhere in session / final 60 min proposed / final 30 min) that decides how close to the close weekend-ranking evidence must be (4.3)**; (7) 60 s quote skew; (8) the OCC-root-plus-shares-per-contract sufficiency rule if the provider lacks deliverable records (4.4); (9) missing optional metrics do not affect the score; (10) IV observable-only, provider IV Rank informational.

**Questions for Quinn:** (1) additive acquisition module rather than extending `getPmccChain`; (2) the coverage model (`COMPLETE`/`RESTRICTED`/`FAILED`), the status precedence and decision table D1-D16 (Section 6), the `rankingScope` rule (acquisition complete **and** no unresolved candidate), and the `K >= S` provable exclusion; (3) caps (6 expirations, N = 40, 240 symbols, 25 underlyings, concurrency 3, 20 s) and the selection priorities (730-day DTE target, 0.80·S strike target); (4) the Find LEAPS production-path harness design and which observable surface (rendered rows vs `persistLeapsSession`); (5) the canonical quantized comparator and fixture `T`; (6) policy fingerprint and extending isolation guards; (7) the 5 s future-timestamp tolerance; (8) whether Gate 4 splits into 4a (provider audit + acquisition), 4b (pure evaluator and ranking), 4c (orchestration + equivalence).

**Scope questions for Paul:** (1) SETUP included in chain retrieval; (2) no production `StrategyInput` assembler: is a tested orchestrator with no production caller acceptable as Gate 4 exit; (3) debit/capital shown but no sizing; (4) cross-underlying "best contract" presentation deferred to Gate 6; (5) is the provider audit part of Gate 4 or a separate Gate 2d data amendment; (6) a session-open helper on the Gate 2c calendar is a small additive change outside `lib/discovery/leaps/` — acceptable in Gate 4?

**For Frank (authorization):** implementation stays BLOCKED until Ian's rulings, Quinn's architecture/test answers, Paul's scope confirmation and the completed provider audit are recorded in the ledger. No approvals are recorded here.

**Implementation readiness:** NOT READY. Blocking: Ian rulings (Sections 7-8), the provider audit (11.1, not performed; specific evidence listed), Quinn's acquisition/limit/harness decisions. Closed and available: Gate 2 contract metrics, Gate 3 evaluation, Gate 2c data and calendar.

## 17. Revision 1 — response to review round 1 (CHANGES REQUIRED at 6d7858c)
| # | Review item | Response (where) |
|---|---|---|
| 1 | Acquisition completeness | Restrictions (expiration, strike, symbol cap, chunk failure) make coverage `RESTRICTED`; `NO_SUITABLE_CONTRACT` only from `COMPLETE` coverage; restricted ranking carries `rankingScope = EVALUATED_SUBSET`; deterministic selection; considered/selected/omitted counts; `N = 40` defined; the lower moneyness band removed (not provable), only the `K >= S` exclusion kept as provably eligibility-preserving (Sections 2, 6, 10, 11.3) |
| 2 | Deterministic sorting | Epsilon comparison replaced by quantized integer keys and a lexicographic total order; three-contract fixture `T` proves input-order independence (8.1, test 7) |
| 3 | Quote freshness and session policy | Timestamp semantics, future timestamps, and separate LIVE / DELAYED / LAST_SESSION rules including underlying freshness; delay flag never overrides freshness; no price labelled executable (4.2, 4.3) |
| 4 | Instrument metadata | Missing evidence = `DATA_UNAVAILABLE`; verified non-standard = `INELIGIBLE`; multiplier 100 alone is not proof; default-100 kept out of the QV path via a required-multiplier wrapper (4.4) |
| 5 | Existing-finder verification | Production-path RTL/jsdom integration harness against pre-recorded goldens; pure-function characterization retained as secondary; copied formulas not accepted as proof (12) |
| E1 | Annualized extrinsic wording | Straight-line normalization of the premium fraction, not actual annual theta decay or expected return (Section 3) |
| E2 | Effective leverage wording | Depends on strike vs spot; matched example 3.4 vs 1.7; "no leverage gate" retained as an explicit proposal for review (7, 8.4) |
| E3 | Section 11.4 | Completed-bar timestamps (exist, Gate 2c) distinguished from the timestamped underlying quote still required (11.4) |
| E4 | Ranking overlap and maturity bias | Matched examples for Ian (8.2, 8.3) |
| E5 | Provider audit | Not performed: no authorized read-only access in this session; specific missing evidence listed; sanitized fixtures only, no credentials committed (11.1) |
Thresholds and weights remain PROPOSED. No Ian, Quinn or Paul approval is recorded.

### Revision 2 — response to the review of revision 1 (narrow corrections at 1fd91b2)
| # | Review item | Response (where) |
|---|---|---|
| R1 | Acquisition completeness is not evaluation completeness | `COMPLETE_CHAIN` only when acquisition is `COMPLETE` **and** no candidate is unresolved; otherwise `EVALUATED_SUBSET`; separate `notAcquired` and `notEvaluable` counts; eligible results always preserved, never implying exhaustive ranking (Sections 2, 6.3, 10) |
| R2 | Data failures preserved in restricted searches | Explicit five-step precedence: eligible -> `EVALUATED`; else unresolved data -> `DATA_UNAVAILABLE`; else restricted -> `NO_ELIGIBLE_IN_SUBSET`; else complete -> `NO_SUITABLE_CONTRACT` / verified-empty reason; decision-table fixtures D1-D16 including restricted acquisition with zero usable quotes (D9, D10) (Sections 5.2, 6, 13) |
| R3 | Quote-mode precedence | Session state and feed delay separated into two dimensions; precedence table (market closed -> LAST_SESSION regardless of a delay label; open + delayed -> DELAYED; open -> LIVE); ten worked cases covering Friday evening, Saturday and Monday pre-open; LAST_SESSION evidence window `W` (anywhere / final 60 min proposed / final 30 min) marked for investment review (Section 4.3, 16) |
Thresholds and weights remain PROPOSED; provider evidence remains outstanding (11.1); no Ian, Quinn or Paul approval is recorded.
