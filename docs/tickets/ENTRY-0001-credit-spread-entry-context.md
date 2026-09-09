# ENTRY-0001 — Credit-Spread Entry Context and Advisory Risk Signals

**Audience:** Dane (implementation owner)  
**Product:** Ian  
**Requirements:** Paul  
**Design review:** Diane  
**Depends on:** ENTRY-0001A; verified live underlying, option-chain, expected-move, and event-calendar evidence  
**Status:** Implemented; release enablement awaits Quinn’s live filled-OTO verification. Historical-series fields remain explicitly unavailable until separately sourced.

## Problem

TradeEdge scores and presents credit-spread candidates, but it does not preserve a single, auditable view of the market, structure, and execution conditions at the moment the trader enters. A trader can therefore encounter an immediate marked loss without knowing whether it came from bid/ask execution friction, a real market move, or avoidable entry conditions. The existing score must not be represented as a complete substitute for this evidence.

## User value

Before entering a credit spread, the trader can see the cushion to the short strike, volatility and price-action context, event exposure, and non-blocking adverse-condition warnings. After entry, the exact information seen is retained for later outcome analysis.

## Product decisions

1. First release covers defined-risk **credit spreads** only: bull put spreads and bear call spreads. Iron condors, cash-secured puts, covered calls, naked options, debit spreads, and portfolio-management actions are out of scope.
2. The entry-context view belongs in the candidate-analysis / order-review workflow, not in Trade Log or Performance. It must be visible before an execution is recorded or submitted.
3. Signals are advisory only. They never block an order, alter a broker order, alter a ranking, or claim a trade is safe/unsafe.
4. Every evaluated input and result is captured in an immutable, versioned entry snapshot when actual execution evidence is recorded. A refresh must never overwrite it.
5. A displayed score remains separately explained. ENTRY-0001 neither changes score weights nor assumes a score already contains any of these fields.
6. Dane may not start production implementation until Ian approves the threshold/policy ledger against real candidate examples, Quinn approves the source/freshness/identity contract, and Diane approves the compact-first entry presentation.

## Scope

### 1. Entry-context contract

Create a typed, versioned `CreditSpreadEntrySnapshot` (exact module location to be selected by Dane) that contains raw values, derived values, data provenance, and explicit availability state. It must be serializable and linked to the execution/trade identity.

Required fields:

| Category | Required evidence |
|---|---|
| Structure | strategy, symbol, underlying, expiration, long/short strikes, width, quantity, credit/debit, maximum profit, maximum loss, breakeven(s), DTE, short-leg delta |
| Underlying and cushion | underlying price, OTM/ATM/ITM state, OTM-buffer percentage to short strike, price direction to short strike |
| Expected movement | expected move value, its source/timeframe, expected-move-to-buffer comparison |
| Volatility | IV, IVR, IV trend, realized volatility, each calculation/source window and timestamp |
| Price action | 5-day and 20-day return, trend classification, price-action timeframe and timestamp |
| Events | earnings date/proximity and any supported material-event flag, including the known/unknown state |
| Execution quality | bid, ask, midpoint, quoted spread width, intended/actual fill, fill-to-mid difference, quote timestamp |
| Assessment | every rule evaluated, raw observed value, policy version/threshold identifier, resulting advisory state, and unavailable reason when applicable |
| Provenance | source, as-of timestamp, snapshot-captured timestamp, and data freshness for every externally sourced group |

Do not persist just alert text or a single risk label. Raw inputs are required so later analysis can apply revised policies to historical snapshots.

#### Required pre-implementation source and identity ledger

Before code is written, Dane must document and submit for Quinn review one source contract for every externally derived group: underlying/option quote, expected move, IV, IVR, IV trend, realized volatility, historical price bars, earnings/events, and actual execution. For each, the ledger must state:

- authoritative provider and exact field(s);
- calculation/lookback/time zone where TradeEdge derives a value;
- maximum permitted age and stale/missing behavior;
- symbol/expiration/contract identity mapping;
- whether the value is available before fill, after fill, or both.

The contract must also define an immutable `entrySnapshotId` and stable links to the actual execution/fill identities and, later, canonical closed-trade reconstruction. Storage ownership, schema migration/versioning, retention, and read permissions must be explicit. A provider that cannot satisfy the contract stays unavailable in this release; no silent proxy, scrape, or inferred replacement is allowed.

### 2. Deterministic factual displays

The entry view must show:

- OTM buffer to the short strike, clearly labeled as percent of the current underlying price, plus the factual OTM/ATM/ITM state.
- Short-leg delta and DTE alongside the buffer; buffer is never presented as a complete risk measure on its own.
- Spread width, stated maximum loss, expected move, and the relationship between expected move and the short-strike cushion.
- IV, IVR, recent IV trend, realized volatility, 5-day/20-day return, and trend state when evidence is available.
- Event context, including earnings proximity when a reliable source exists.
- Bid, ask, midpoint, quote width, and actual/expected fill quality when they are available.

All percentages and money figures must identify their reference point. Unknown/missing/stale inputs display `Unavailable` with a concise reason; never display zero, a neutral value, or an implied pass.

### 3. Advisory assessment

Render a compact, explainable advisory section. Each advisory must name the condition, observed evidence, relevant timestamp, and why it matters. It must not use “safe,” “guaranteed,” “high probability,” or equivalent outcome claims.

Initial advisory families, subject to Ian's policy verification before release:

- short strike inside or insufficiently outside the expected move through expiry;
- thin OTM buffer in combination with DTE and short-leg delta;
- underlying trend materially toward the short strike;
- elevated/expanding realized volatility or unstable price action;
- IV expansion after entry or low IVR that provides weak premium compensation;
- earnings or a supported material event inside the intended holding period;
- execution friction: unusually wide market or fill meaningfully worse than midpoint.

Thresholds must live in one versioned policy/contract, not JSX or scattered constants. The policy must declare the unit, lookback, strategy applicability, severity vocabulary, and missing-data rule for every condition. No numeric threshold is authorized by this ticket until Ian verifies it against live examples.

The review authorizes only the following initial policy boundary: expected-move clearance, earnings proximity, and execution evidence may be shown when their full source contract is accepted; short-strike cushion and IVR are factual context, not standalone pass/fail rules. No threshold is approved for IV trend, realized volatility, or 5/20-day price action until their historical-series contracts are approved.

Ian's verification set must include live-like examples across short/long DTE, low/high IVR, differing underlying prices, bull put and bear call spreads, and cases near every proposed boundary. The approved policy must state whether a condition is informational, cautionary, or elevated—not a forecast of loss or a trade recommendation.

### 4. Compact-first interaction design

The primary entry surface must answer the practical question without a wall of indicators. It shows, in this order:

1. short-strike cushion and expected-move relationship;
2. price direction toward/away from the short strike;
3. IV context and event proximity;
4. active advisory count and plain-language reasons.

The full calculation details—returns, raw volatility measurements, quote math, timestamps, sources, policy version, and unavailable reasons—must be available through accessible progressive disclosure. Severity uses text and an icon/label in addition to color. `Unavailable` is a normal evidence state with an explanation, never an error-style dead end.

### 5. Immutable execution linkage

- Capture the snapshot only when actual execution evidence is recorded or a broker fill is confirmed; planned candidate values are planning context, not an executed snapshot.
- Record the actual fill, fees, quantity, timestamp, and broker/transaction identity separately from the pre-fill quote evidence.
- If a position is filled in multiple executions, retain either a snapshot per fill or a documented aggregate snapshot that preserves each quote/fill identity. Do not silently treat an initial partial fill as the whole entry.
- The snapshot must remain readable after current market data changes or a policy version changes.
- Snapshot capture failure must be visible and must not fabricate data. Whether it blocks manual execution recording is a follow-up product decision; broker execution may not be weakened or delayed by this feature.

## Non-goals

- Changing screener rank/score calculations or filtering candidates.
- Automatically blocking, confirming, routing, or submitting orders.
- Predicting profitability, probability of profit, or future price movement.
- Retrospectively creating snapshots for historical trades without evidence.
- Implementing the Performance analysis UI; that is ENTRY-0002.
- Supporting non-credit-spread strategies.

## Acceptance criteria

### Entry evidence

**Given** a credit-spread candidate with fresh supported market data,  
**when** the trader opens its entry analysis,  
**then** TradeEdge displays the specified structure, cushion, volatility, price-action, event, and execution-quality evidence with its as-of time.

### Honest unavailability

**Given** IVR, event, or historical-price evidence is absent or stale,  
**when** the entry analysis is displayed,  
**then** that field and any dependent advisory display `Unavailable` with a reason, and no neutral/pass state is inferred.

### Advisory transparency

**Given** an entry condition matches a verified advisory policy,  
**when** the candidate is reviewed,  
**then** the advisory identifies the observed value, policy version/condition, and rationale, and the trader can still proceed.

### Immediate-loss distinction

**Given** a credit spread is entered at a fill less favorable than midpoint,  
**when** the trade is recorded,  
**then** the saved snapshot preserves quote/fill evidence sufficient to distinguish initial bid/ask marking friction from a subsequent market move.

### Immutability

**Given** a recorded credit-spread entry snapshot,  
**when** quotes refresh or advisory policy changes,  
**then** the original snapshot remains unchanged and retains its original policy/version and timestamps.

## Implementation notes

- Reuse canonical option-leg/strategy/economic values where they already exist; do not reconstruct spread economics separately in a page component.
- Keep pure calculations and advisory evaluation independent of React and network fetching. Unit-test them with timestamped fixtures.
- Treat `actual fill`, quote-side valuation, and midpoint as distinct values. An initial unrealized P/L is not itself evidence that the market moved.
- Before implementation, Dane must inventory available sources for historical IV/IVR, expected move, historical price bars, events, and quote timestamps. Any unavailable provider is an architecture/data-contract decision, not a reason to substitute a proxy silently.
- Do not create a client-only snapshot that disappears on cache clear or cannot be joined to later closed-trade evidence. The storage decision must meet the approved retention and identity contract.

## Validation

- Unit tests for OTM/ATM/ITM state, buffer calculations, expected-move comparison, fill-to-mid arithmetic, and absent/stale evidence.
- Policy tests for each advisory family, each severity, and all missing-data paths.
- Snapshot serialization/immutability tests, including policy-version change and multi-fill cases.
- Integration tests proving only credit spreads expose the first-release workflow and actual execution evidence creates the linked snapshot.
- Accessibility tests for advisory names, details, color-independent meaning, and unavailable states.
- Contract tests for source freshness, source identity mapping, snapshot/execution identity stability, schema migration, and retention/read behavior.

## Rollout

Release behind a credit-spread entry-context flag. Validate on live-like examples with Ian and the approved source ledger with Quinn before enabling broadly. Diane must verify compact-first and detail-disclosure behavior at desktop and narrow widths. ENTRY-0002 may not treat the output as reliable performance evidence until enough complete snapshots exist and its data-quality disclosure is live.
