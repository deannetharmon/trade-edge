# ENTRY-0002 — Credit-Spread Entry Snapshot Performance Analysis

**Audience:** Dane (implementation owner)  
**Product:** Ian  
**Requirements:** Paul  
**Depends on:** ENTRY-0001A, ENTRY-0001; canonical Trade Log reconstruction; complete closed-trade cohort  
**Status:** Deferred until a reviewable complete-snapshot cohort exists

## Problem

Trade Log and Performance report realized results, but cannot reliably answer whether outcomes correlate with the conditions under which a credit spread was entered. Without immutable entry evidence, the trader cannot separate selection quality, execution friction, market regime, and later position management.

## User value

The trader can learn from complete, attributed credit-spread history: whether trades with particular entry conditions or advisories produced different realized outcomes, while seeing the sample size and data-quality limits behind every comparison.

## Product decisions

1. Performance is an analysis of realized closed-trade outcomes; it does not produce entry recommendations, alter scoring, or rewrite historical snapshots.
2. The default view compares all eligible spreads with **no entry advisories** against spreads with **one or more entry advisories**, then permits evidence-backed breakdowns.
3. Complete entry snapshots are required for entry-condition cohorts. Historical trades without snapshots remain in existing totals but are explicitly excluded from entry-condition comparisons.
4. No cohort may be framed as causation, prediction, or proof of a profitable rule. Small samples and incomplete reconstructions must be conspicuous.
5. ENTRY-0002 may start only after Quinn accepts ENTRY-0001's stable snapshot/execution identity and retention contract. A client cache alone is not a sufficient historical-analysis store.

## Scope

### 1. Canonical analysis join

Join immutable `CreditSpreadEntrySnapshot` records to canonical `ClosedTrade` reconstruction through a stable execution/trade identity. Do not duplicate FIFO lot reconstruction or create a competing realized-P/L calculation.

Surface join/data-quality states at minimum:

- complete snapshot + complete closed-trade reconstruction;
- snapshot exists but trade remains open;
- closed trade has no entry snapshot;
- snapshot exists but closed-trade reconstruction is incomplete;
- identity cannot be safely joined.

### 2. Performance rollup

For the selected time range, show a credit-spread entry-analysis rollup containing:

- eligible closed trade count and excluded/incomplete count;
- realized P/L, win rate, average P/L, average P/L percentage, and average hold days;
- strategy and ticker breakdowns;
- no-advisory versus one-or-more-advisory comparison;
- advisory-category breakdowns;
- entry-condition buckets using raw saved snapshot values: OTM buffer, expected-move relationship, short delta, DTE, IVR, IV trend, realized volatility, price trend, event proximity, and execution/fill quality.

Bucket definitions must be versioned and disclosed. They may be changed prospectively without modifying source snapshots. Do not make a bucket appear if it has no usable samples.

### 3. Drilldown and evidence

Every aggregate must link to a readable set of constituent closed trades and their entry snapshots. A trade detail must distinguish:

- entry-time quote/fill friction;
- entry market context and advisories;
- elapsed holding period and exit evidence;
- realized P/L and reconstruction completeness.

Current market values may be shown elsewhere but must never replace entry snapshot values in this analysis.

### 4. Data-quality and interpretation guardrails

- Always display the eligible sample size, selected time window, excluded count, and reason for exclusion.
- Preserve existing Trade Log totals and their reconstruction-status semantics.
- Do not show a percentage, rank, “best condition,” or directional conclusion for an inadequate sample; use a product-approved minimum-sample policy and a plain-language insufficiency state.
- Clearly label that observations are descriptive and can be affected by ticker mix, market regime, execution, and management after entry.
- Place sample size, completeness, time window, and exclusions in the primary comparison header—not behind a tooltip or disclosure—so a visually prominent result can never be read without its evidence strength.

### 5. Performance information hierarchy

The primary view first shows the eligible cohort and the no-advisory versus one-or-more-advisory comparison, with each cohort's sample size and insufficiency state. Strategy/ticker/advisory/category breakdowns are secondary exploration. Raw entry evidence, quote/fill math, policy versions, and join provenance remain available in an accessible trade-level drilldown; they must not overwhelm the initial performance view.

## Non-goals

- Backfilling snapshots from current or inferred historical market data.
- Creating a new composite performance score.
- Changing a completed trade’s entry snapshot, classification, or realized P/L.
- Recommending, blocking, or auto-adjusting future trades from these correlations.
- Cross-strategy comparisons until ENTRY scope is expanded deliberately.

## Acceptance criteria

### Cohort integrity

**Given** closed credit spreads with complete snapshots and canonical closed-trade records,  
**when** the trader opens entry-performance analysis,  
**then** each included result is joined to its own immutable entry evidence and canonical realized P/L.

### Incomplete history

**Given** a closed historical trade has no complete entry snapshot,  
**when** entry-condition comparisons are calculated,  
**then** it is excluded from those comparisons with a visible count/reason, while existing overall Trade Log totals remain unchanged.

### Advisory comparison

**Given** enough eligible closed spreads in both cohorts,  
**when** the default analysis renders,  
**then** it compares no-advisory versus one-or-more-advisory trades using the same time window, metrics, and data-quality disclosure.

### Evidence drilldown

**Given** the trader selects a breakdown or aggregate,  
**when** its details are opened,  
**then** TradeEdge lists the contributing trades and their relevant saved entry values, advisories, policy version, and realized outcome.

### No false precision

**Given** a cohort fails the approved sample-size or completeness policy,  
**when** its analysis is viewed,  
**then** TradeEdge presents an insufficient-evidence state rather than a winner/loser conclusion or predictive claim.

## Implementation notes

- Build this as a thin read-only composition over `lib/tradeLog` and ENTRY-0001 snapshot records. It must not fetch current quotes to calculate historical entry conditions.
- Reuse the existing time-range semantics where possible. Do not create an uncoordinated second cache/reconstruction pipeline in `app/performance/page.tsx`.
- Keep aggregate and bucketing math pure and fully fixture-tested. Expose all eligibility decisions for inspection.
- Ian and Paul must approve bucket labels and minimum-sample policy from actual accumulated data before the view is promoted from feature-flagged experimental analysis.

## Validation

- Fixture tests for complete joins, unmatched identities, partial closes, incomplete trade reconstruction, no snapshot, open position, and multi-fill cases.
- Arithmetic tests for every displayed aggregate and cohort exclusion.
- Tests that an old snapshot continues to analyze under its captured policy version while new display buckets evolve.
- UI tests for sample-size/data-quality disclosures and drilldown provenance.
- UX tests confirming an insufficient cohort cannot visually resemble a reliable conclusion, including at narrow viewport widths.
- Regression tests confirming existing Trade Log and overall Performance totals are unchanged.

## Rollout

Keep entry-performance analysis flagged until a meaningful cohort of complete ENTRY-0001 snapshots exists. Release as descriptive analysis, review the first real results with Ian, and only then consider expanded strategies or additional breakdowns.
