# LEAPS-PI-0001 — Implementation Report

**Branch:** `codex/leaps-position-intelligence`  
**Base:** `origin/main` at `2a28affc`  
**Status:** Foundation corrected and ready for team re-review; not yet enabled for users.

## Policy correction: DTE and quote age

The prior 180–730 value was an inherited existing-PMCC pairing boundary, not the trader's intended new-LEAPS acquisition model. Policy version `LEAPS-PI-1.1` now separates:

| Decision | Rule |
|---|---|
| New LEAPS entry | 270–720 DTE |
| Existing held LEAPS | Review below 180 DTE; never auto-close solely for DTE |
| New/active PMCC cycle | At least 120 DTE remain on the long call after the short call expires |
| Actionable quote age | No more than 120 seconds old |

The quote-age boundary is a maximum age, not a minimum wait. It prevents an actionable Review state from relying on market evidence older than two minutes.

## Delivered

| Plan area | Delivery | Evidence |
|---|---|---|
| Canonical policy evaluator | `lib/leaps-position-intelligence/evaluate.ts` | Pure facts-in/result-out waterfall with coded evidence and no UI, fetch, or storage imports. Thesis invalidation, event-window, active-cycle, and market-session precedence are explicit. |
| Policy/economics | `policy.ts`, `economics.ts` | Shared PMCC-policy adapter; trader target-based participation; income-cap strike; trader minimum cycle credit; executable bid-credit and original-expiration break-even warning. |
| Safety states | `types.ts`, `evaluate.ts` | Health-only, Hold uncovered, Review income call, Monitor, Reassess thesis, Not ready, and Market closed. Event data fails closed even when known-earnings permission is enabled. |
| Exact handoff | `handoff.ts` | Opaque account + position + exact OCC + quantity + policy + timestamp plus bid/ask/OI/spread/quote-snapshot/delta/DTE validation. Changed evidence returns `candidate-changed`; it cannot silently reuse approval. |
| Mandate/ledger persistence foundation | `persistence/*` | Opaque, hash-segmented Redis keys; atomic mandate-change + immutable ledger append; idempotency for mandate and generic event retries; separate immutable outcome events. |
| Regression protection | focused tests | Existing PMCC pairing/production and Positions Workspace tests remain green. |

## Verification

- Type check: passed.
- Canonical foundation suites: evaluator (16) and persistence (2) passed.
- Targeted regression verification: `pmccPairing` (29), `pmccProduction` (16), and `PositionsWorkspace` (25), plus the foundation suites: 88 tests passed together.
- Whitespace/error check: passed.

## Intentionally not enabled

The feature remains unconnected to the live Portfolio UI and broker order path. That is deliberate: the remaining work needs the approved server-side canonical-account authorization map, fresh event-fact adapter, portfolio-context adapter, mandate screens, and revalidated PMCC review route. Enabling the engine without those facts would either create a false-clear path or block all income-call reviews.

Conventional stock covered calls were not changed.

## Remaining implementation work

1. Build server orchestration that maps authorized broker snapshots, event facts, exact PMCC candidates, and position context into the canonical evaluator.
2. Add authenticated mandate/history APIs using the canonical account-ID mapping—never raw broker account numbers in client payloads or persistence keys.
3. Implement the approved Position Intelligence views, accessibility acceptance, history/prompt/outcome rendering, and feature flags.
4. Route the existing held-LEAPS PMCC review through exact handoff revalidation and explicit replacement-candidate reconfirmation.
5. Run full golden fixtures and staged shadow/read-only/review rollout gates before enabling the feature.
