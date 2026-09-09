# ENTRY-0001 / ENTRY-0002 — Entry Context Readiness Review

**Reviewed:** 2026-09-09  
**Reviewers:** Ian (professional options trader), Quinn (safety/testability), Diane (UX)  
**Product owner:** Paul  
**Decision:** ENTRY-0001A’s data-contract gate is closed in implementation; live filled-OTO verification remains the release-readiness check.

The exact Quinn verification procedure is recorded in `docs/reviews/ENTRY-0001A-live-filled-oto-verification.md`.

## Evidence reviewed

- `lib/tastytrade.ts` provides underlying quote fields, option-chain bid/ask/mid, option implied volatility, market-metrics IVR, and expected earnings date.
- `lib/scans/checklist.ts` and `lib/scans/rank-scoring.ts` calculate an expiration-specific expected move and already distinguish short strikes inside/outside that move.
- `lib/tradeLog/reconstructTrades.ts` reconstructs closed trades from transaction identities and carries `sourceTransactionIds`, but it does not own an immutable entry-context record.
- Existing screener caches are browser IndexedDB/session-oriented scan caches. No reviewed durable, execution-linked entry-snapshot repository or migration/retention contract exists.
- The reviewed market-metrics path provides current IV/IVR, not an evidenced historical IV series or a timestamped 5/20-day price-bar contract for the new snapshot requirement.

## Ian — methodology review

**Approved:** first-release strategy boundary (BPS/BCS only), advisory-only behavior, full immutable evidence capture, and the distinction between mark/fill friction and real subsequent market movement.

**Approved initial policy shape:**

| Advisory family | First-release decision |
|---|---|
| Expected-move clearance | Reuse the existing factual inside/barely-outside/well-outside calculation only after it is recorded with its IV, DTE, formula, and as-of time. It is advisory, not a POP/profitability claim. |
| Short-strike cushion | Display raw OTM buffer with short delta and DTE. Do not approve a standalone percentage threshold. |
| Earnings | Advisory whenever a supported reported date falls inside expiration/intended holding period; unknown remains unavailable. |
| Execution friction | Display raw bid/ask/mid and actual fill-to-mid. Do not label a fixed width “bad” until per-symbol/price policy is verified. |
| Price action / realized volatility / IV trend | No alert threshold approved: there is no accepted historical-series definition or source contract yet. |
| Low IVR | Display IVR as context. Do not treat it as a universal entry failure; its interpretation must remain coupled to credit, expected move, and liquidity. |

Ian does **not** authorize the ticket to use the existing score's IVR/expected-move weights as entry-alert thresholds. Ranking and entry advice are different decisions.

## Quinn — safety and testability review

**Approved requirements:** raw + derived data, as-of/freshness disclosure, policy versioning, unavailable states, policy-independent snapshot immutability, canonical realized-P/L reuse, and no silent historical backfill.

**Resolved implementation-readiness items:**

1. Versioned server-side Redis/KV snapshots use authenticated-user plus broker-account scope, idempotent keys, schema/policy versions, and explicit unavailable evidence.
2. The complex-order entry component ID is matched only to the broker transaction’s `order-id`; the resulting transaction IDs join `ClosedTrade.sourceTransactionIds`. Promotion reads the paginated broker ledger server-side after authenticated-user/account validation; contingent OTO exits are excluded.
3. IV trend, realized volatility, and 5/20-day price action remain explicitly unavailable until their source contracts are accepted.
4. Scan quote timestamps are preserved; unknown quote timestamps are unavailable rather than relabeled as current.
5. The v1 immutable schema is retained by idempotent write. A migration/retention policy remains a follow-up before any destructive schema evolution.

No current source gap may be filled with a zero, an unlabelled proxy, a current value substituted for historical entry evidence, or a client-only cache.

## Diane — UX review

**Approved:** compact-first summary, advisory-only behavior, progressive disclosure, color-independent severity, and visible unavailable explanations.

**Required UX contract:**

1. First screen: short-strike cushion versus expected move, price direction, IV/event context, and active advisory reasons.
2. Detail disclosure: formulas, raw returns/volatility, quote and fill math, timestamps, policy version, and source/unavailable reason.
3. A warning must be plain language and state the observed condition; it must not suggest a prediction or an automatic action.
4. Performance comparisons must show sample size, completeness, exclusions, and time window alongside—not after—the comparison.
5. An insufficient cohort must be a prominent dedicated state at both desktop and narrow widths.

## Product ruling and next gate

Paul accepts the implemented foundation. ENTRY-0001’s advisory surface may proceed with only the approved source families; unavailable families remain clearly unavailable rather than delaying factual context.

ENTRY-0002 remains limited to snapshots that join complete closed-trade records and must disclose sample completeness.
