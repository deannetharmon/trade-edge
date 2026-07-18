# PT-0001 — Manual Paper Trading Sandbox

**Status:** Original implementation rejected by Product Owner (persistence, idempotency, identity, and accounting-safety defects). A corrective round (see §14) has addressed all seven required corrections. Not yet re-reviewed, not yet merged, not yet committed.
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

- `cash` increases by `entryCredit` when a position opens; decreases by the closing debit when a position closes. `entryCredit` is always finite and strictly positive — a fill that would produce a zero or negative entry credit is rejected before it ever reaches the ledger (see §4.2's validation policy and §5). Closing debit is finite and non-negative (zero is a valid outcome, not clamped or synthesized).
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

Every open/close/reset requires a caller-supplied idempotency key, scoped by `(userId, operation, key)`. A repeat with the same key and the same payload replays the original result; the same key with a different payload is rejected as `IDEMPOTENCY_CONFLICT`. The idempotency check and the ledger mutation happen inside the **same** per-user mutation lock acquisition (`persistence/locking.ts`'s `withPaperTradingLock()`), and the accepted mutation, its one audit event, and its idempotency record then commit together as a single atomic operation (`persistence/commit.ts`'s `commitPaperMutation()` — see §14 for the full atomic-commit and ambiguous-outcome design), so a duplicate/concurrent submission can never race between "check" and "act", and an accepted commit can never be partially applied. Mark refresh is not idempotency-guarded (not listed in section 9.1, and naturally idempotent — refreshing twice with the same quote recomputes the same mark) but still runs under the same lock and the same atomic commit.

Lock acquisition is a per-user Redis `SET key val EX ttl NX` (mirroring, not sharing, the existing Autopilot run-lock pattern) with a short retry/backoff loop; lock ownership is then re-verified as the first step of the atomic commit script itself (§14), so a lease lost between acquisition and commit aborts the commit rather than corrupting it. Every mutation (accepted or rejected) writes an append-only audit event (`account_initialized`, `account_reset`, `entry_accepted`/`entry_rejected`/`entry_duplicate_replayed`, the `close_*` equivalents, `stale_quote_confirmed`, `manual_fill_override_confirmed`) recording user, operation, position/account reference, timestamp, idempotency key, pricing source, quote age, capital/cash before-and-after, and rule IDs. No secrets or auth tokens are ever recorded.

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
- PT-0001 is the ledger/sandbox foundation only — a single focused page with no application-wide LIVE/PAPER mode concept. Extending a portfolio-mode selector, isolation, and mode display across Portfolio Intelligence, Decision Engine inputs, Daily Briefing, reviews, risk analysis, analytics, and opportunities is explicitly out of scope here and queued as PT-0002 in `docs/roadmap/ROADMAP.md` (queued, not approved, not started).

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

## 14. Corrective Round — Persistence and Accounting Safety Design

The Product Owner rejected the original implementation for five defects; this section is the design record for the fix, kept separate from §1–13 (the original design) rather than silently editing those sections, since the original architecture (one canonical account record, one lock namespace, marketable-vs-manual fill policy, capital formulas) is unchanged and remains correct — only the *persistence and identity mechanics around it* were wrong.

**Atomic commit design.** An accepted open/close/reset/mark commits its ledger mutation, one audit event, and (for open/close/reset) an idempotency record together as a **single Redis Lua script executed via `EVAL`** (`lib/paper-trading/persistence/commit.ts`'s `COMMIT_SCRIPT`), not a `WATCH`/`MULTI`/`EXEC` transaction. A Redis Lua script runs as one indivisible unit from the server's perspective — no other client command can interleave with it — and the script is written so that every precondition check (lock ownership, and a `TYPE` check on each key it is about to write) happens **before its first write**. Concretely: it first compares the stored mutation-lock value against the caller's lock id and returns `LOCK_LOST` (writing nothing) if they disagree; it then checks that the account key, audit key, and (if present) idempotency key each hold a type consistent with the operation about to be performed, returning `TYPE_ERROR` (writing nothing) otherwise; only once every check has passed does it perform its writes — `SET` the account, `LPUSH`+`LTRIM` the audit list, and optionally `SET` the idempotency record — and return `OK`. Because no write happens until every check that could otherwise cause a write to fail has already run, the script cannot encounter an expected runtime error after it has started writing, and it either performs all of its writes or none of them. This is a stronger guarantee than `WATCH`/`MULTI`/`EXEC` ever provided: Redis transactions do not roll back an individual queued command's own runtime failure while leaving the rest of the queue applied, so relying on that mechanism for an all-or-nothing guarantee was structurally unsound, not just unlikely to occur in practice.

**Lock ownership / release design.** Lock acquisition (`SET key val EX ttl NX`) is unchanged. Release is a separate atomic Lua compare-and-delete (`EVAL`), so a stale owner can never delete a replacement owner's lock. Ownership is re-verified as the very first step of the commit script itself (see above) rather than renewed mid-mutation — a lease lost at any point before the script runs is caught by that check and aborts the commit with nothing written, rather than corrupting it.

**Ambiguous commit outcome design.** A single atomic `EVAL` still leaves one irreducible ambiguity, inherent to any networked write and not specific to Redis: the request can reach Redis, execute, and commit, and then the *acknowledgement* can be lost before it reaches the client (a dropped connection, a timeout). From the client's point of view this is indistinguishable from "the request never arrived." `commitPaperMutation()` never guesses in this situation. It distinguishes two outcomes: a **confirmed abort**, where the script itself returned a definitive value (`LOCK_LOST` or `TYPE_ERROR`) proving it ran, decided, and wrote nothing — safe to treat as a normal rejection; and an **ambiguous outcome**, where the `EVAL` call itself threw (a network/connection/protocol failure with no returned value at all). On an ambiguous outcome, `resolveAmbiguousOutcome()` re-reads authoritative state — the account record, the audit trail (by the pre-generated audit event id), and, where applicable, the idempotency record (by exact value match) — and reasons from what it finds: if all three signals agree the operation committed, it replays the already-computed result as a success; if all three agree it did not commit, it throws a conservative, explicitly retryable `COMMIT_FAILED`; if the signals disagree with each other, it throws a distinct `IntegrityFailureError` (`INTEGRITY_FAILURE`) rather than picking a side, since the atomic script's own design guarantees a genuine single execution can never produce disagreeing signals — a disagreement means persistence state was altered outside this commit path, which requires investigation rather than a guess. It never retries the write itself and never re-executes the commit script on an ambiguous outcome, so no ambiguous failure can ever produce a duplicate mutation.

**Canonical idempotency design.** Payloads are canonicalized via a recursive walk that sorts object keys at every depth and preserves array order, then compared/stored as a plain string (not a hash), eliminating collision risk. See `lib/paper-trading/idempotency.ts`.

**Authenticated manual-confirmation design.** The client sends only price, reason, and a confirmation flag. The server (already having resolved the authenticated user via `resolveAutopilotUserId()` upstream in the API route) stamps identity and timestamp itself when building the domain object passed into pricing/audit. See `lib/paper-trading/service.ts`'s `resolveManualOverride()`.

**Entry-credit/close-debit validation policy.** Opening entry credit must be finite and strictly positive. Closing debit must be finite and non-negative — zero is explicitly accepted (a market that nets to exactly zero at close is a valid outcome, not a malformed one); negative is always rejected, since a negative close debit would mean the simulation paying the trader cash it never owed. Applied uniformly to marketable/quote-derived and manual-override fills, at the single point (`buildFillEvidence()`) both paths pass through, before any ledger mutation.

**Audit-reference decision.** `PaperTradingPosition.auditRefs` is now populated, not removed: the accepted audit event's id is generated before the ledger mutation and threaded into both the position's `auditRefs` and the audit event actually written, in the same atomic commit, so the two can never disagree.

**Failure-state matrix / test coverage.** See the implementation report's failure-state matrix section for the full test mapping (`lib/paper-trading/__tests__/commit.test.ts`). In summary, six outcomes are exercised: (1) failure before the commit script's server-side write phase runs — nothing is written, and the resulting error is safe to retry; (2) a confirmed lock-ownership abort — the script itself returns `LOCK_LOST` (not an ambiguous failure), and nothing is written; (3) response loss after the script's write phase fully applied — `resolveAmbiguousOutcome()` confirms the commit via re-read and returns the original result rather than an error; (4) a client retry following that response loss replays the confirmed result (via the ordinary idempotency path, since the idempotency record was genuinely written) rather than creating a second mutation; (5) an artificially, deliberately injected inconsistent persistence state — a test-double-only condition the real, precondition-checked script cannot produce through its own expected command paths, since it either performs all of its writes together or none of them — is detected and surfaced as a distinct `IntegrityFailureError`, never silently resolved either way, and never automatically repaired; and (6) neither of the two *reachable* failure modes (1 and 2 — the ones a real client/network/Redis interaction can actually produce) leaves partial ledger/audit/idempotency state; each is asserted directly against the ledger, audit trail, and idempotency record after the fact. (Scenario 5 is deliberately excluded from claim 6: its entire purpose is to construct a partial state no real execution path produces, so the resolver's detection of it can be verified.)
