# PT-0001 — Manual Paper Trading Sandbox

**Status:** Implementation complete on `feature/manual-paper-trading`. Not yet reviewed or merged.
**Sprint:** PT-0001, approved and scope-frozen.
**Roadmap item:** New capability, not previously named in the roadmap. Enables Dean to use TradeEdge broadly and evaluate its recommendations without risking real money, ahead of any future live-execution work.

## 1. Product Objective

Allow Dean to create and manage a realistic, isolated paper portfolio: manually open CSP/BPS/BCS/IC positions against simulated fills, monitor them, and manually close them, with the existing Portfolio Intelligence rules available to evaluate the paper portfolio the same way they evaluate the real one.

This is **manual** paper trading. Every position is opened and closed by an explicit, confirmed user action. There is no autonomous entry, no scheduled trading, and no automatic close of any kind in this sprint.

## 2. Architecture Discovery Summary

The existing `lib/autopilot` package already has a `PaperAccount`/`PaperPosition` shape (`lib/autopilot/types.ts`), a Redis-backed store (`lib/autopilot/persistence/paperAccountStore.ts`, key `autopilot:paper-account:<userId>`), and a compatibility route (`/api/autopilot/paper-account`). This is the Autopilot Decision Engine's own dormant paper-trading framework (Sprint 1B/2) — it has never actually opened a paper position (the Autopilot page is an explicit "no paper entries yet" dry-run shell), and its fields (`currentBalance`, `peakBalance`, generic `AutopilotStrategy` including `CC`, `decisionConfidenceAtEntry`, ...) are read by `lib/autopilot/decision/riskGateEngine.ts` and `portfolioState.ts` for Autopilot's own future risk gates.

That shape does not fit PT-0001's requirements: it has no cash/reserved-capital split, no per-leg quote evidence, no idempotency, no audit trail, and a materially different position record. Rebuilding it in place would risk the Autopilot Decision Engine's own (currently dormant, but real) contract.

**Decision:** reuse the *account record* (one Redis key per user, `getPaperAccount`/`savePaperAccount`), but not the Autopilot-specific fields. `lib/autopilot/types.ts`'s `PaperAccount` interface gained exactly one new, fully optional field:

```ts
paperTrading?: PaperTradingLedger;
```

Every existing field is untouched and keeps its existing meaning for Autopilot. PT-0001's own domain (`lib/paper-trading/`) reads and writes only `account.paperTrading`. This satisfies "reuse the canonical account store, avoid two accounts per user" without touching or duplicating the Autopilot Decision Engine's contract.

One real bug was found and fixed as a direct consequence of this decision: `resetPaperAccount()` (used by the *existing* `/api/autopilot/paper-account` reset) built a brand-new `PaperAccount` object and saved it wholesale, which would have silently deleted a user's PT-0001 ledger the first time that unrelated reset endpoint was ever called. Fixed by having `resetPaperAccount()` read the existing account first and carry `paperTrading` forward untouched.

Other reused foundations: the existing Redis `SET key val EX ttl NX` lock pattern (`lib/autopilot/scheduler/locking.ts`) — mirrored, not shared, under its own key (`paper-trading:mutation-lock:<userId>`) so a paper mutation is never blocked by (or blocks) an Autopilot run lock; the existing append-only Redis list pattern (`lib/autopilot/persistence/auditTrailStore.ts`) — mirrored under `paper-trading:audit:<userId>` with its own event-type union, since the existing one is order/broker-specific; the canonical Portfolio Intelligence per-position evaluator (`lib/portfolio-intelligence/objectives/positionObjective.ts`'s `evaluatePositionObjective()`) and its batch prioritizer (`prioritizePortfolioObjectives()`) — called directly, not copied; and the existing marketable-pricing direction convention already established in `app/portfolio/page.tsx`'s `closeValue` calculation (short leg closes at ask, long leg closes at bid), applied symmetrically to opening.

No canonical trade-ticket/order-entry component existed that could safely be reused without risking a reachable live-submission path, so the manual ticket (`components/paper-trading/PaperTicketForm.tsx`) is new, built from primitive inputs only.

## 3. Supported Strategies

CSP, BPS, BCS, IC only. The leg/strategy shape is validated in `lib/paper-trading/validation.ts` (`validateTicket()`): each strategy has an exact required leg count, option-type composition, short/long strike ordering, and (for IC) a non-overlapping put/call spread requirement. The domain is deliberately organized so a future strategy could be added without rewriting the ledger (`ledger.ts`'s open/close/mark functions are strategy-agnostic; only `capital.ts`'s `computeCapitalRequirement()` and `validation.ts` branch on strategy) — but no other strategy is implemented in this sprint.

## 4. Domain Model (`lib/paper-trading/`)

| File | Responsibility |
|---|---|
| `types.ts` | All types: `PaperTradingLedger`, `PaperTradingPosition`, `PaperLeg`, `PaperQuoteSnapshot`, `PaperFillEvidence`, `PaperAuditEvent`, `PaperTradingError`. |
| `validation.ts` | Strategy/leg shape validation. |
| `pricing.ts` | Quote validation, marketable-fill direction rules, stale-quote policy, manual-override handling. |
| `capital.ts` | Per-strategy reserved-capital / max-loss formulas. |
| `ledger.ts` | Pure open/close/mark/reset mutations and the account-invariant derivation (`deriveLedgerView()`). |
| `idempotency.ts` | Idempotency record check/store, scoped by user + operation + key. |
| `audit.ts` | Append-only audit event log. |
| `persistence/keys.ts`, `persistence/locking.ts`, `persistence/store.ts` | Redis key namespace, the paper-trading-specific mutation lock, and the atomic read-modify-write wrapper around the shared account record. |
| `service.ts` | Orchestration layer API routes call — combines validation, pricing, capital, ledger, idempotency, and audit under one lock acquisition per request. |
| `adapters/portfolioIntelligenceAdapter.ts` | Maps open paper positions into the canonical `PositionObjectiveInput` shape and calls the real Decision Engine. |
| `http.ts` | Shared `PaperTradingError` → HTTP status mapping for routes. |

### 4.1 Accounting invariants

- `cash` increases by `entryCredit` when a position opens (can be negative for a genuinely inverted debit fill — not clamped, since clamping would misrepresent what the quotes actually said); decreases by the closing debit when a position closes.
- `reservedCapital` is the sum of `capitalReserved` across open positions — buying power set aside, never a change in equity by itself.
- `availableCapital = cash - reservedCapital`.
- `currentEquity = startingBalance + realizedPnl + unrealizedPnl`. This is the algebraic equivalent of "cash minus the cost to close every open position now"; a position without a refreshed mark contributes `0` to `unrealizedPnl` (never a fabricated number).
- `realizedPnl = Σ closedPositions[].realizedPnl`, where each position's `realizedPnl = entryCredit − closingDebit`.
- `unrealizedPnl = Σ openPositions[].unrealizedPnl` (treating an unmarked position as `0`), where each `unrealizedPnl = entryCredit − currentMarkValue`.
- `peakEquity` only ever increases (high-water mark), recomputed on every mutation.

### 4.2 Capital and max-loss formulas (section 8)

- **CSP:** `reservedCapital = strike × 100 × quantity` (the full cash-secured obligation, independent of credit — never a naked-put margin formula). `theoreticalMaxLoss = max(0, reservedCapital − entryCredit)`.
- **BPS / BCS:** `theoreticalMaxLoss = max(0, width × 100 × quantity − entryCredit)`; `reservedCapital = theoreticalMaxLoss`.
- **IC:** `theoreticalMaxLoss = max(0, max(putWidth, callWidth) × 100 × quantity − entryCredit)` — the **larger** wing only, never the sum of both (an iron condor cannot lose on both sides at once); `reservedCapital = theoreticalMaxLoss`.

## 5. Pricing and Fill Simulation (section 7)

Direction convention (matches the existing repo convention in `app/portfolio/page.tsx`'s `closeValue`):

- Opening a short leg (`sell_to_open`) → **bid**. Opening a long leg (`buy_to_open`) → **ask**.
- Closing a short leg (`buy_to_close`) → **ask**. Closing a long leg (`sell_to_close`) → **bid**.

`pricing.ts`'s `computeMarketableFill()` returns the OPEN side as a net **credit** (positive = received) and the CLOSE side as a net **debit** (positive = paid), so `ledger.ts` can uniformly do `cash += entryCredit` and `cash -= closingDebit`.

A quote snapshot is rejected (never silently substituted) when any required leg is missing its needed bid/ask, has a non-positive or non-finite price, is crossed (`bid > ask`), is missing leg identity, or has an unparsable timestamp. A quote older than `STALE_QUOTE_THRESHOLD_SECONDS` (300s — no market-hours utility exists anywhere in this repo today, so staleness is judged purely by quote age, which also transparently covers "market closed") requires an explicit `staleConfirmed` flag or is rejected. A **Manual Paper Fill** override (explicit price + reason + confirmation) bypasses quote validation entirely, is labeled `manual_paper_fill` (never `marketable`), and is never used as an automatic fallback for a missing/invalid quote.

## 6. Idempotency, Atomicity, Audit (section 9)

Every open/close/reset requires a caller-supplied idempotency key, scoped by `(userId, operation, key)`. A repeat with the same key and the same payload replays the original result; the same key with a different payload is rejected as `IDEMPOTENCY_CONFLICT`. The idempotency check and the ledger mutation happen inside the **same** lock acquisition (`persistence/store.ts`'s `mutatePaperTradingLedger()`) so a duplicate/concurrent submission can never race between "check" and "act". Mark refresh is not idempotency-guarded (not listed in section 9.1, and naturally idempotent — refreshing twice with the same quote recomputes the same mark) but still runs under the same lock.

Atomicity is a per-user Redis `SET key val EX ttl NX` lock (mirroring, not sharing, the existing Autopilot run-lock pattern) with a short retry/backoff loop. Every mutation (accepted or rejected) writes an append-only audit event (`account_initialized`, `account_reset`, `entry_accepted`/`entry_rejected`/`entry_duplicate_replayed`, the `close_*` equivalents, `stale_quote_confirmed`, `manual_fill_override_confirmed`) recording user, operation, position/account reference, timestamp, idempotency key, pricing source, quote age, capital/cash before-and-after, and rule IDs. No secrets or auth tokens are ever recorded.

## 7. Paper-Only API

```
GET  /api/paper-trading/account
POST /api/paper-trading/account/reset
POST /api/paper-trading/positions
POST /api/paper-trading/positions/[positionId]/close
POST /api/paper-trading/positions/[positionId]/mark
GET  /api/paper-trading/intelligence
```

Every route resolves the user server-side via the existing `resolveAutopilotUserId()` and never reads a caller-supplied user id from the body. Routes contain no accounting math — they validate request shape only and delegate to `service.ts`. `/api/autopilot/paper-account` (the pre-existing Autopilot compatibility route) is unchanged in behavior and now explicitly documented as unrelated to PT-0001.

## 8. UI (section 11)

`app/paper-trading/page.tsx` — a new, focused top-level page (not an addition to the Income Engine or Portfolio pages), composed of small components under `components/paper-trading/`: `PaperAccountSummary` (stat grid, PAPER badge), `PaperTicketForm` (the four-strategy manual ticket), `PaperPositionsList` (open/closed lists), `PaperCloseForm` (full-close only, inline), `PaperMarkForm` (manual mark refresh), `PaperResetControl` (destructive, type-to-confirm), `PaperIntelligenceSummary` (the Portfolio Intelligence adapter's output, explicitly labeled PAPER). Linked from the home page's top nav and Quick Access grid.

The ticket and close/mark forms import only the pure `lib/paper-trading` modules (`types`, `validation`, `pricing`, `capital`) — never `service.ts` or the barrel `index.ts` — so `ioredis` (Node-only) is never pulled into the client bundle.

## 9. Mark-to-Market (section 12) — Known Limitation

No automatic browser-owned option-quote wiring exists in this sprint. The existing live option bid/ask retrieval lives entirely inside `app/portfolio/page.tsx`'s large, tightly-coupled, browser-authenticated TastyTrade session logic — there is no small, safely reusable function for it, and no server-side TastyTrade call is reintroduced (per the sprint's explicit constraint). Phase 1 therefore uses **explicit manual mark entry**: the user enters the current bid/ask themselves (the same quote-evidence shape used for entry/close), and a mark is never fabricated. This is disclosed here as a deferred item, not silently shipped as if it were live.

## 10. Portfolio Intelligence Integration (section 13)

`adapters/portfolioIntelligenceAdapter.ts`'s `buildPaperPortfolioIntelligence()` maps each open paper position into the canonical `PositionObjectiveInput` shape and calls the **same, unmodified** `evaluatePositionObjective()` real positions are evaluated by, then re-sorts the resulting objectives with the canonical `prioritizePortfolioObjectives()`. No recommendation logic is copied or forked. The adapter's only input is the caller-supplied paper positions array — it has no implicit "current real portfolio" reference, no module-level real-position state, and no session lookup of its own; isolation in both directions is covered by `__tests__/portfolioIntelligenceAdapter.test.ts`. Real positions never enter this path, and paper positions never enter the real Portfolio page's evaluation path (they are structurally different arrays with no shared reference).

## 11. Security / Non-Negotiable Safety Boundary (section 3)

No file under `lib/paper-trading/`, `app/api/paper-trading/`, or `components/paper-trading/` imports, calls, or is called by `lib/tastytrade.ts`'s `placeOrder()` or its order builders (`buildBullPutSpread`, etc.). This is enforced by a source-scanning regression test (`__tests__/liveIsolation.test.ts`), not just code review. Paper account/position persistence is namespaced separately from any live-order concept. The UI is unmistakably labeled PAPER throughout (badge, form copy, button labels — "Add Paper Position" / "Simulate Paper Fill" / "Close Paper Position", never "Trade" or "Submit Order"). Every mutation requires a server-resolved authenticated user, an idempotency key, and is lock-protected.

## 12. Known Limitations / Deferred Backlog

- No automatic live quote feed for mark-to-market (section 9, above) — future work, requires a decision about safely extracting a slice of the existing browser-owned quote logic.
- No partial closes, rolls, assignment, exercise, or expiration processing — explicitly out of scope for PT-0001.
- No multi-portfolio support for the paper account (one paper ledger per user, same as the real portfolio today).
- The Paper Portfolio Intelligence summary is a focused list, not the full Portfolio Review/Daily Briefing composition layers — those could read paper data in a future slice via the same adapter pattern, not attempted here.
- `/api/autopilot/paper-account`'s own reset now preserves `paperTrading`, but the two "paper account" concepts (Autopilot framework vs. PT-0001 sandbox) coexisting on one Redis record is worth revisiting if Autopilot's own paper framework is ever activated.

## 13. Manual Testing Steps

1. Visit `/paper-trading`. Confirm the PAPER badge and a fresh $100,000 account summary.
2. Add a CSP: strategy CSP, a symbol, an expiration, strike, bid/ask, confirm the PAPER checkbox, submit. Confirm it appears under Open Positions with the correct entry credit and max risk.
3. Refresh Mark with a different bid/ask; confirm unrealized P/L updates.
4. Close the position with a bid/ask; confirm it moves to Closed Positions with the correct realized P/L, and Available Capital/Reserved Capital update correctly.
5. Repeat for BPS, BCS, and IC, confirming reserved capital matches the documented formulas.
6. Try submitting the same idempotency key twice (e.g. via a slow network + double click) — confirm no duplicate position is created.
7. Try opening a position larger than available capital — confirm rejection with a clear message, no partial mutation.
8. Reset the account — confirm it requires typing RESET, and real Portfolio/Trade Log pages are unaffected.
9. Confirm the Paper Portfolio Intelligence panel renders objectives for open paper positions, labeled PAPER.
