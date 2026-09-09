# ENTRY-0001 Facilitation Resolution

**Facilitator:** Frank  
**Date:** 2026-09-08  
**Decision:** Proceed in a three-step delivery sequence. No unresolved concern may block the whole outcome when it can be represented honestly as unavailable.

## Working agreement

| Step | Owner | Deliverable | Exit condition |
|---|---|---|---|
| 1 | Dane + Quinn | ENTRY-0001A durable immutable snapshot foundation | Server-side persistence, execution identity, idempotency, and unavailable states verified |
| 2 | Dane + Ian + Diane | ENTRY-0001 entry-context surface | Existing live evidence shown compactly; only approved advisory families enabled; responsive/a11y review passes |
| 3 | Dane + Quinn + Paul | ENTRY-0002 outcome analysis | Complete snapshots join canonical closed trades; sample-quality disclosure passes |

## Resolved decisions

1. **Persistence:** authoritative snapshots use the project’s existing server-side Redis/KV pattern; browser storage is non-authoritative cache only.
2. **Scope now:** ship available current evidence—quotes, chain IV/delta, IVR, earnings, expected-move calculation, and execution/fill evidence—once its timestamp/provenance is captured.
3. **Fields without historical data:** IV trend, realized volatility, and 5/20-day price action remain in the snapshot schema with explicit `UNAVAILABLE` state. They do not block steps 1–2 and do not generate alerts.
4. **Advisories now:** expected-move relationship and earnings timing are eligible after source-contract tests; execution quality is factual evidence first. OTM buffer and IVR are context, not binary approval gates.
5. **Future data:** adding a historical-series provider is a bounded follow-up that fills existing snapshot fields. It does not alter past snapshots.

## Team commitments

- Ian validates only the policy families with actual source evidence; no made-up numeric thresholds.
- Quinn owns the durable contract and fails closed on missing or stale evidence.
- Diane owns compact-first review and ensures the warning system does not read as a wall of red flags.
- Paul prevents new strategies, score rewrites, or predictive claims from entering this sequence.
- Dane delivers in the three steps above and reports any provider/identity mismatch immediately.

## What is no longer an open question

The project did not need to select a historical IV or price-bar vendor before work began. ENTRY-0001A now has durable snapshot ownership and honest unavailable behavior. The immediate external gate is Quinn’s read-only verification of an already-filled OTO through Trade Log.
