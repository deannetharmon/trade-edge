# PT-0001 — Manual Paper Trading Sandbox — Implementation Report

**Status:** Implementation complete on `feature/manual-paper-trading`. **Not yet reviewed or merged.** Awaiting Product Owner review.
**Base:** `main` @ `4812301`.
**Design doc:** `docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md`.

## 1. Repository Snapshot

Preflight (before any change) matched the sprint's expected state exactly: current branch `feature/manual-paper-trading`; `HEAD`, `main`, `origin/main`, and their merge-base all at `4812301`; working tree clean; no PT-0001 commits existed yet. No discrepancy — proceeded.

## 2. Architecture Discovered

See design doc §2 for the full account. Summary: the existing `lib/autopilot` paper-account foundation (`PaperAccount`/`PaperPosition` in `lib/autopilot/types.ts`, `paperAccountStore.ts`, the `/api/autopilot/paper-account` route) belongs to the still-dormant Autopilot Decision Engine framework and does not fit PT-0001's requirements (no cash/reserved-capital split, no per-leg quote evidence, no idempotency, no audit trail). Also discovered and reused: the existing Redis lock pattern (`lib/autopilot/scheduler/locking.ts`), the existing append-only audit-list pattern (`lib/autopilot/persistence/auditTrailStore.ts`), the canonical Portfolio Intelligence per-position evaluator (`evaluatePositionObjective()`) and batch prioritizer (`prioritizePortfolioObjectives()`), and the existing marketable-pricing direction convention in `app/portfolio/page.tsx`'s `closeValue` calculation.

## 3. Existing Paper Foundation Reused

One canonical account record per user (Redis key `autopilot:paper-account:<userId>`, unchanged). PT-0001 added exactly one new, fully optional field to `PaperAccount`: `paperTrading?: PaperTradingLedger`. Every existing Autopilot field is untouched.

## 4. Migration / Backward-Compatibility Behavior

An account that predates PT-0001 has no `paperTrading` field; `lib/paper-trading/persistence/store.ts`'s `getPaperTradingLedger()` lazily initializes (and persists) a default ledger the first time it's read, without touching any existing field. A real defect was found and fixed as a direct consequence: the *existing* `/api/autopilot/paper-account` reset (`resetPaperAccount()`) built and saved a brand-new account object wholesale, which would have silently deleted a user's PT-0001 ledger the first time that unrelated endpoint was called. Fixed by reading the existing account first and carrying `paperTrading` forward untouched (`lib/autopilot/persistence/paperAccountStore.ts`).

## 5. Accounting Invariants

See design doc §4.1 for the full, exact formulas (cash/reservedCapital/availableCapital/currentEquity/realizedPnl/unrealizedPnl/peakEquity). Verified by `lib/paper-trading/__tests__/ledger.test.ts` (entry credit increases cash; reserved capital reduces availability, not equity; marking updates equity without touching cash; close debit reduces cash and releases capital; realized P/L reconciles; peak equity only increases; reset produces a clean ledger).

## 6. Pricing and Fill Policy

Direction convention matches the existing repo convention (`app/portfolio/page.tsx`'s `closeValue`): open short → bid, open long → ask, close short → ask, close long → bid. Quote validation rejects missing/non-positive/non-finite/crossed quotes and missing leg identity or timestamp — never silently substitutes mid. A quote older than 300s requires explicit confirmation (`stale_confirmed`) or is rejected. A Manual Paper Fill override (explicit price + reason + confirmation) is never labeled marketable and never used as an automatic fallback. Full detail and rationale in design doc §5. One real sign-convention bug was found (via its own test) and fixed during implementation: the CLOSE-side fill computation initially returned a net **cash-received** figure sharing the OPEN side's sign convention, which — left uncorrected — would have made `ledger.ts`'s `cash -= closingDebit` move cash in the wrong direction on every close. Fixed in `pricing.ts`'s `computeNetValue()` by returning the OPEN side as a credit (positive = received) and the CLOSE side as a debit (positive = paid), matching how `ledger.ts` already consumed it.

## 7. Supported Strategies

CSP, BPS, BCS, IC only, exactly as scoped. Leg-shape and strategy validation in `lib/paper-trading/validation.ts`.

## 8. Idempotency Design

Every open/close/reset requires a caller-supplied idempotency key, scoped by `(userId, operation, key)` (`lib/paper-trading/idempotency.ts`). A repeat with the same key and payload replays the stored result; a different payload under the same key is rejected as a conflict. The check and the mutation share one lock acquisition (`persistence/store.ts`'s `mutatePaperTradingLedger()`), so a duplicate/concurrent request can never race between check and act.

## 9. Atomicity / Locking Design

A per-user Redis `SET key val EX ttl NX` lock (`persistence/locking.ts`), mirroring — not sharing — the existing Autopilot run-lock pattern, under its own key namespace so it can never contend with an Autopilot run lock. A short retry/backoff loop handles lock contention. Verified under real concurrency in `service.test.ts` (11 concurrent opens against capital for exactly 10 → exactly 10 succeed, 1 rejected with `INSUFFICIENT_CAPITAL`; 2 concurrent closes of the same position → exactly 1 succeeds, 1 sees `POSITION_ALREADY_CLOSED`).

## 10. Audit Model

Append-only Redis list (`lib/paper-trading/audit.ts`), its own key namespace and event-type union (distinct from the existing Autopilot audit trail, which is order/broker-specific and doesn't apply here). Every mutation attempt — accepted or rejected — is recorded with user, operation, position/account reference, timestamp, idempotency key, pricing source, quote age, capital/cash before-and-after, rule IDs, and failure reason where applicable. No secrets or tokens are ever recorded.

## 11. Paper-Only API

```
GET  /api/paper-trading/account
POST /api/paper-trading/account/reset
POST /api/paper-trading/positions
POST /api/paper-trading/positions/[positionId]/close
POST /api/paper-trading/positions/[positionId]/mark
GET  /api/paper-trading/intelligence
```

Every route resolves the user server-side (`resolveAutopilotUserId()`) and never reads a caller-supplied user id from the request body — verified in `app/api/paper-trading/__tests__/security.test.ts`. Routes contain no accounting formulas. `/api/autopilot/paper-account` is unchanged in behavior; a doc comment now explains the coexistence.

## 12. UI Delivered

New page `app/paper-trading/page.tsx`, linked from the home page's top nav and Quick Access grid. Focused components under `components/paper-trading/`: account summary, the four-strategy manual ticket, open/closed position lists, full-close flow, manual mark-refresh flow, destructive reset (type-to-confirm), and a Paper Portfolio Intelligence summary. PAPER labeling throughout; button copy is "Add Paper Position" / "Simulate Paper Fill" / "Close Paper Position" — never "Trade" or "Submit Order". The ticket/close/mark forms import only pure `lib/paper-trading` modules, never `service.ts` or the barrel export, so `ioredis` is never pulled into the client bundle.

## 13. Mark-to-Market Behavior

No automatic browser-owned quote wiring in this sprint (see design doc §9 for the full, honest account of why). Explicit manual mark entry only. No server-side TastyTrade call was added anywhere.

## 14. Portfolio Intelligence Integration

`adapters/portfolioIntelligenceAdapter.ts` maps open paper positions into the canonical `PositionObjectiveInput` shape and calls the same, unmodified `evaluatePositionObjective()` real positions use, then re-sorts with the canonical `prioritizePortfolioObjectives()`. No new/forked recommendation logic. Isolation in both directions covered by `portfolioIntelligenceAdapter.test.ts`.

## 15. Security and Paper/Live Isolation Evidence

No file under `lib/paper-trading/`, `app/api/paper-trading/`, or `components/paper-trading/` imports, calls, or is called by the broker order-submission module or its order builders — enforced by a source-scanning regression test (`liveIsolation.test.ts`, 28 files scanned), not just review. Every mutation requires a server-resolved authenticated user; unauthenticated requests reject with 401 (`security.test.ts`); a caller-supplied `userId` in a request body is ignored (verified). Paper account/position persistence is namespaced separately from any live-order concept.

## 16. Files Changed

**New:**
- `lib/paper-trading/` — `types.ts`, `validation.ts`, `pricing.ts`, `capital.ts`, `ledger.ts`, `idempotency.ts`, `audit.ts`, `service.ts`, `http.ts`, `index.ts`, `persistence/{keys,locking,store}.ts`, `adapters/portfolioIntelligenceAdapter.ts`, `__tests__/*` (8 test files + `testUtils/fakeRedisClient.ts`)
- `app/api/paper-trading/` — `account/route.ts`, `account/reset/route.ts`, `positions/route.ts`, `positions/[positionId]/close/route.ts`, `positions/[positionId]/mark/route.ts`, `intelligence/route.ts`, `__tests__/security.test.ts`
- `app/paper-trading/page.tsx`
- `components/paper-trading/` — `PaperAccountSummary.tsx`, `PaperTicketForm.tsx`, `PaperCloseForm.tsx`, `PaperMarkForm.tsx`, `PaperPositionsList.tsx`, `PaperResetControl.tsx`, `PaperIntelligenceSummary.tsx`, `__tests__/*` (5 test files)
- `docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md`
- `docs/reviews/PT-0001-Implementation-Report.md` (this file)

**Modified:**
- `lib/autopilot/types.ts` — additive `paperTrading?` field on `PaperAccount`.
- `lib/autopilot/persistence/paperAccountStore.ts` — `resetPaperAccount()` now preserves `paperTrading`.
- `app/api/autopilot/paper-account/route.ts` — doc comment only, no behavior change.
- `app/page.tsx` — nav link + Quick Access card for Paper Trading.
- `app/help/page.tsx` — new Paper Trading help section.
- `vitest.config.ts` — added `components/**/__tests__/**/*.test.ts` and `app/**/__tests__/**/*.test.ts` to `include` (both were previously absent; without them the new component-level `.test.ts` files and the new route-level security tests would silently never run under `npm test`).

## 17. Requirements-to-Code Mapping

Section 3 (safety boundary) → `service.ts`, `pricing.ts`, `liveIsolation.test.ts`. Section 5 (strategies) → `validation.ts`. Section 6 (domain model) → `types.ts`, `ledger.ts`. Section 7 (pricing) → `pricing.ts`. Section 8 (capital) → `capital.ts`. Section 9 (idempotency/atomicity/audit) → `idempotency.ts`, `persistence/locking.ts`, `audit.ts`. Section 10 (API) → `app/api/paper-trading/*`. Section 11 (UI) → `components/paper-trading/*`, `app/paper-trading/page.tsx`. Section 12 (mark-to-market) → `PaperMarkForm.tsx`, `/positions/[id]/mark`. Section 13 (Portfolio Intelligence) → `adapters/portfolioIntelligenceAdapter.ts`.

## 18. Requirements-to-Test Mapping

Domain validation → `validation.test.ts` (15 tests). Pricing → `pricing.test.ts` (17 tests). Capital/accounting → `capital.test.ts` (7) + `ledger.test.ts` (9). Idempotency/concurrency → `idempotency.test.ts` (5) + `service.test.ts` (8, real concurrency via a shared in-memory fake Redis). Security/isolation → `liveIsolation.test.ts` (28) + `app/api/paper-trading/__tests__/security.test.ts` (4) + `portfolioIntelligenceAdapter.test.ts` (4). UI → 5 component test files (18 tests) covering the PAPER banner, empty/open/closed states, ticket validation, stale-quote and manual-override warnings, double-submit prevention, full-close and reset confirmations, and the absence of any live-order wording/control.

## 19. Targeted-Test Results

93 tests in `lib/paper-trading/__tests__/`, 18 in `components/paper-trading/__tests__/`, 4 in `app/api/paper-trading/__tests__/` — **115 / 115 passing.**

## 20. Full-Test Result

**63 test files / 812 tests passing repo-wide, 0 failures** (partitioned across multiple `vitest run` invocations to stay within the sandbox's practical per-call window; aggregate counts reconstructed from each partition).

## 21. TypeScript Result

`npx tsc --noEmit` — **clean.** (Two type errors were found and fixed in new test files during this pass — an over-narrow `ReturnType<typeof vi.fn>` annotation on a mocked `fetch` — before reaching this clean result; see the corrected test files.)

## 22. Production-Build Result

`npm run build` hangs at the initial Next.js banner in this sandbox — the same documented, pre-existing environment limitation seen on every prior ticket (PI-0014, OE-0001, ...), not treated as a regression given `tsc --noEmit` is clean and all tests pass. Not re-investigated, per standing instruction.

## 23. Manual Testing Steps

See design doc §13.

## 24. Final Commit SHA

Not yet committed — see §25.

## 25. Push Status

**Not committed or pushed.** A stale `.git/index.lock` produced an `unable to unlink ... Operation not permitted` warning during a routine `git status` call in this sandbox (the same recurring, previously-documented sandbox quirk). Per this sprint's explicit instruction, this was not forced, reset, or bypassed. Repository state was otherwise verified fully consistent (see the consolidated report's git section) and is ready for Dean to stage, commit, and push natively.

## 26. Deviations or Limitations

- No automatic mark-to-market quote feed (manual entry only) — disclosed, not silently shipped.
- The pre-existing `/api/autopilot/paper-account` reset defect (would have deleted a user's PT-0001 ledger) was discovered and fixed as a necessary consequence of this sprint's own design decision, not a pre-existing ticket requirement — disclosed here rather than silently folded in.
- A CLOSE-side pricing sign-convention bug was found and fixed by this sprint's own test suite before it ever reached a commit — disclosed for transparency, not because it reached any shipped state.

## 27. Deferred Backlog Items

See design doc §12: automatic live quote feed for marks; partial closes/rolls/assignment/exercise/expiration (explicitly out of scope); multi-portfolio paper support; a fuller Paper Portfolio Review/Daily Briefing composition (only a focused summary exists today).

## 28. Recommendation

Ready for Product Owner review. No further action planned unless review requires correction.
