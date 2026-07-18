# PT-0001 — Manual Paper Trading Sandbox — Implementation Report

**Status:** Original implementation **rejected** by Product Owner for blocking persistence, idempotency, identity, and accounting-safety defects. A first **corrective round** (§29–§38) addressed all seven required corrections but was itself **rejected on second review** — the atomic-commit design in that round (`WATCH`/`MULTI`/`EXEC`, justified by an "essentially never fails" argument) did not meet the required all-or-nothing guarantee, and a roadmap gap and a design-doc contradiction were also raised. A **second corrective round** (§39 onward) replaces the atomic-commit design entirely with a single precondition-checked Lua `EVAL`, adds ambiguous-commit-outcome resolution, adds PT-0002 to the roadmap, and removes the contradictory design-doc language. **Not yet re-reviewed, not yet merged, not yet committed** — nothing has been staged, committed, or pushed this round either; see §49.
**Base:** `main` @ `4812301`.
**Design doc:** `docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md`.

Sections 1–28 below are the ORIGINAL implementation report, preserved as-written for history. Sections 29–38 are the FIRST corrective round; its atomic-commit design (§30 Fix #3, and the note on Redis MULTI/EXEC) is **superseded by §39–§44 below** and is preserved only as the historical record of what was submitted and rejected — it does not describe the current design. Sections 39 onward describe the current, accepted-as-of-this-submission design.

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

## 29. Repository Snapshot (corrective round)

Preflight matched the sprint's expected state exactly before any change: branch `feature/manual-paper-trading`; `HEAD` and `origin/feature/manual-paper-trading` both `7b41eebfe68f72313741a8486be0b6625e017148`; `main`, `origin/main`, and their merge-base all `48123019175684690cac0faa88c88efdd4b075c5`; working tree clean; `git log --oneline --decorate main..HEAD` showed exactly one commit (`feat(paper): add manual paper trading sandbox`) — PT-0001 confirmed not merged into `main`. `feature/autopilot` was never referenced, switched to, or touched.

## 30. Fix-by-Fix Design

**Fix #1 — Canonical nested idempotency hashing.** `lib/paper-trading/idempotency.ts`'s `hashPayload()` passed `Object.keys(payload).sort()` as `JSON.stringify`'s replacer argument. When the replacer is an array, JSON.stringify treats it as a property-name allowlist applied at **every** level of the object graph, not a top-level-only sort — so any nested field whose name didn't also appear in the top-level key list (`legId`, `bid`, `ask`, `manualPrice`, ...) was silently dropped before hashing, meaning materially different nested legs/quotes/manual-fill details could hash identically. Replaced with `canonicalize()`, a recursive walker that sorts object keys at every depth, preserves array order (array order is semantically meaningful — legs and quote entries are never interchangeable), and rejects unsupported/unserializable values (`NaN`/`Infinity`, `undefined`, functions, symbols, bigint) explicitly rather than coercing them. The canonical JSON string is stored and compared **directly** (`buildIdempotencyWrite()`/`checkIdempotency()`), not hashed, removing any collision risk entirely. `service.ts` builds the idempotency payload from the raw client-input shape (never the server-resolved `confirmedAt`/`confirmedByUser`), so a legitimate retry with an identical logical request cannot fail to replay because of a nondeterministic server-generated value in the hash.

**Fix #2 — Atomic, ownership-safe lock release + lease-loss fencing.** `persistence/locking.ts`'s `releasePaperTradingLock()` did a separate `GET` then `DEL` — not atomic; a lease could expire and be reacquired by a different caller between the two calls, and the original caller's `DEL` would delete the replacement owner's lock. Replaced with a single Lua `EVAL` (`RELEASE_IF_OWNER_SCRIPT`) performing the compare-and-delete as one indivisible Redis operation — no new dependency, `ioredis` already supports `.eval()`. Separately, and more importantly: holding the lock was never sufficient on its own to guarantee a lease-expired mutation couldn't commit. `persistence/commit.ts`'s `commitPaperMutation()` re-verifies lock ownership **atomically together with the actual write** via `WATCH` on both the account key and the lock key, then `MULTI`/`EXEC` — if the lock key changed (deleted/reassigned) between the `WATCH` and the `EXEC`, `EXEC` returns `null` and the commit throws `LockLostError` (`code: 'LOCK_LOST'`, HTTP 409, safe to retry) instead of committing. This is a check-and-write performed as one atomic unit, not a separate preceding check that could itself race.

> **SUPERSEDED — see §39–§41.** The "Fix #3" design below (`WATCH`/`MULTI`/`EXEC`, plus the note excusing MULTI/EXEC's partial-application limitation as "essentially never" occurring) was rejected on second Product Owner review as not meeting the required all-or-nothing commit guarantee. It is preserved verbatim here only as the historical record of what was originally submitted; it is not the current design.

**Fix #3 — Atomic accepted-mutation commit.** The pre-corrective `mutatePaperTradingLedger()` called the mutator (which wrote the accepted audit event and the idempotency record directly, via `appendPaperAuditEvent`/`storeIdempotencyResult`) and only **afterward** called `savePaperAccount()` to persist the ledger — three separate, non-atomic writes, ordered so a caller could receive/replay a "success" (audit says accepted, idempotency has a result) for a ledger mutation that was never actually persisted, if that final `savePaperAccount()` failed. `persistence/commit.ts`'s `commitPaperMutation()` now writes the ledger, one accepted audit event (its id generated up front so it can also be threaded into `position.auditRefs` — see Fix #6), and the idempotency record together inside a single `WATCH`/`MULTI`/`EXEC` transaction. If `EXEC` is aborted (lease loss) or the transaction call itself fails (the realistic MULTI/EXEC failure mode — see the note on Redis's actual guarantees below), the whole commit throws `PaperTradingError('COMMIT_FAILED', ...)` and **nothing** is written; `service.ts`'s callers never see a success result in that case. Rejected attempts (validation/pricing/capital failures) and replayed duplicates are still logged via the simpler, standalone `appendPaperAuditEvent()`, since they touch no ledger state and have nothing to be atomic with.

  *A note on what Redis MULTI/EXEC actually guarantees:* Redis transactions do not roll back an individual queued command's runtime error while leaving other queued commands in the same transaction applied — that is a documented Redis limitation, not something client code can paper over without moving to a single-key data model (which would have meant folding the audit trail and idempotency records into the same key as the account, a materially larger and out-of-scope change). In practice this is not a real risk for this codebase's specific commands (`SET`/`LPUSH`/`LTRIM` against fresh, correctly-typed keys essentially never fail individually); the dominant real-world failure mode is the `EXEC` call itself failing outright (connection/protocol failure), which **is** fully atomic — nothing is applied server-side in that case. `commitPaperMutation()` treats both an aborted `EXEC` (`null`) and a rejected `EXEC` call as "nothing committed" and surfaces a conservative failure.

**Fix #4 — Server-derived confirmation identity.** `PaperTicketForm.tsx`/`PaperCloseForm.tsx` hardcoded `confirmedByUser: 'dean'` in the manual-override object sent to the API, and the domain/service layer accepted it as authoritative. The client now sends only `{ manualPrice, reason, confirmed: true }` (`PaperManualFillOverrideInput`, `types.ts`) — no identity, no timestamp. `lib/paper-trading/http.ts`'s `parseManualOverrideInput()` reads only those three fields from the request body, regardless of what else the client sends. `service.ts`'s `resolveManualOverride()` builds the full, server-authoritative `PaperManualFillOverride` using the already-server-resolved `req.userId` (resolved upstream by each route via the existing `resolveAutopilotUserId()`, never re-derived or re-trusted from the body) and `new Date().toISOString()` for `confirmedAt`. A caller-supplied `confirmedByUser`/`confirmedAt` anywhere in the request body is never read, let alone forwarded — verified in `security.test.ts`. Unauthenticated manual-fill requests still reject with 401 before any of this runs (routes check `resolveAutopilotUserId()` first, unchanged).

**Fix #5 — Reject economically invalid fill values.** Neither `buildFillEvidence()` nor anything downstream previously validated that an opening entry credit was positive or a closing debit was non-negative — a malformed leg market or a mistyped manual override could produce a zero/negative "credit" that would flow straight into the ledger. `pricing.ts` now validates both quote-derived and manual-override fills, for both open and close, at the single choke point both paths pass through (`buildFillEvidence()`), strictly before any caller can pass the result into a ledger mutation: opening entry credit must be finite and **strictly positive** (zero or negative is rejected — CSP/BPS/BCS/IC are credit-entry strategies); closing debit must be finite and **non-negative**, with the policy explicitly documenting that **zero is an acceptable close** given valid pricing evidence (a market that happens to net to exactly zero at close is economically valid — a genuinely crossed/malformed close producing a *negative* debit, which would mean paying the trader cash it never owed, is not). A rejected fill throws before `service.ts` ever calls `ledger.ts`'s `openPosition`/`closePosition`, so cash/reservedCapital/positions/equity/idempotency state is provably untouched (the rejection happens before the atomic commit is ever entered).

**Fix #6 — Audit references.** `PaperTradingPosition.auditRefs` was always `[]` — nothing ever populated it, a misleading field implying traceability the implementation didn't provide. Decision: populate it, consistently, as part of the same atomic commit rather than remove it. `service.ts` generates the accepted audit event's id up front (`createPaperAuditEventId()`, exported from `audit.ts`) before calling `ledger.ts`'s `openPosition`/`closePosition`, passes it as `auditRefs: [eventId]`, and uses the same id when building the `PaperAuditEvent` object written in the same atomic commit — so the position's `auditRefs` and the actually-persisted audit trail entry are guaranteed to agree (verified in `commit.test.ts`). `closePosition()`'s existing append-only `auditRefs` behavior (`[...openPos.auditRefs, ...(args.auditRefs ?? [])]`) means a closed position's `auditRefs` now contains both its entry and its close audit event ids.

## 31. Additional Correction: Mark Refresh Now Lease-Fenced

Not one of the five named defects directly, but a necessary consequence of removing `mutatePaperTradingLedger()` (Fix #3's replaced primitive): `refreshPaperMark()` performs a real ledger write and previously ran under the same non-atomic primitive as open/close/reset. It now runs through the same `withPaperTradingLock` + `commitPaperMutation` path as the other three operations, so a lost lease cannot let a stale mark commit either. This required one small, additive change: a `mark_refreshed` audit event type and a `'mark'` operation value (`types.ts`), since `commitPaperMutation()`'s commit unit always writes an audit event — mark refreshes now have real audit coverage where previously they had none.

## 32. Requirements-to-Test Mapping (corrective round)

- Canonical idempotency hashing, replay/conflict behavior → `idempotency.test.ts` (`canonicalize`/`canonicalPayloadString` describe block: reordered nested keys → same canonical string; nested bid/ask change → different; nested leg change → different; array-order change detected; non-finite/undefined/function rejected; replay for nested-key-reordered equivalent payload; reject for nested-field-changed payload under the same key).
- Atomic lock release, lock replacement/lease loss → `locking.test.ts` (owner releases own lock; non-owner cannot; expired-then-reacquired lock cannot be deleted by the stale owner; release of a never-acquired lock is a safe no-op).
- Accepted-operation atomic commit, injected persistence failures, lease-loss during commit → `commit.test.ts`, **rewritten for the single-EVAL design in the second corrective round — see §43's failure-state matrix** (this row is superseded; the original "injected EXEC failure" description below is preserved only for history: successful commit produces ledger + audit event + idempotency record together, with `auditRefs` agreeing; injected EXEC failure on open/close leaves no ledger mutation, no accepted audit event, and no idempotency record behind; replay cannot return success for the uncommitted position; retry after an uncommitted failure safely succeeds exactly once; a lock-ownership mismatch at commit time aborts with `LockLostError` and writes nothing).
- Invalid entry/close fills, accounting invariants → `pricing.test.ts`'s "fill-value economic validation" describe block (zero/negative manual entry credit; zero/negative quote-derived entry credit; negative quote-derived and manual closing debit; valid positive entry credit; valid zero closing debit; valid positive closing debit).
- Authenticated confirmation identity, spoofing resistance, unauthenticated rejection → `security.test.ts`'s "manual-fill confirmation identity cannot be spoofed" describe block; UI-level "sends no hardcoded personal identity" tests in `PaperTicketForm.test.tsx` and `PaperCloseForm.test.tsx`.
- Concurrent opens/closes, paper/live isolation, paper account backward compatibility, unrelated Autopilot paper-account reset preserving the PT-0001 ledger, paper Portfolio Intelligence isolation → unchanged, still covered by `service.test.ts`, `liveIsolation.test.ts`, `portfolioIntelligenceAdapter.test.ts` (all still passing against the corrected persistence layer).

## 33. Targeted-Test Results (corrective round)

150 / 150 passing across the paper-trading-scoped test set (`lib/paper-trading`, `components/paper-trading`, `app/api/paper-trading`): 16 test files, including two new files (`locking.test.ts`, `commit.test.ts`) and additions to `idempotency.test.ts`, `pricing.test.ts`, `service.test.ts`, `security.test.ts`, `PaperTicketForm.test.tsx`, `PaperCloseForm.test.tsx`.

## 34. Full-Suite Result (corrective round)

**65 test files / 847 tests passing repo-wide, 0 failures.** Partitioned across five `vitest run` invocations to stay within the sandbox's per-call time budget (each individual test completes in milliseconds; the constraint is wall-clock per shell call, not test correctness), with aggregate counts reconstructed from each partition's own summary. This baseline is 847 vs. the original round's reported 812 — the increase is entirely the corrective round's own new/added tests (idempotency canonicalization, lock atomicity, commit atomicity/failure-injection, fill-value validation, identity-spoofing resistance), not a change in what the rest of the suite covers. Note: this sandbox's checkout also contains an **untracked**, git-ignored-by-omission directory (`trade-edge/`, confirmed via `git status`/`git ls-files` to be outside version control) holding a stray duplicate copy of parts of this repo; it was excluded from every test/build command run in this round and was not modified, staged, or otherwise touched.

## 35. TypeScript Result (corrective round)

`npx tsc --noEmit` — **clean.** One error surfaced and was fixed during this pass: an inferred `ReturnType<typeof vi.fn>` on a mocked `fetch` in a new `PaperCloseForm.test.tsx` test was too narrow for a two-argument `mock.calls[0][1]` access; corrected to `ReturnType<typeof vi.fn<any[], any>>`, matching the same pattern already used elsewhere in this file's own sibling test files.

## 36. Production-Build Result (corrective round)

Not independently re-attempted this round beyond what `tsc --noEmit` already confirms; `npm run build` is the same documented, pre-existing sandbox limitation (hangs at the initial Next.js banner) noted in every prior ticket in this project, and re-investigating it was explicitly out of scope. No claim of production deployment or Vercel success is made.

## 37. Git Verification and Push Status (corrective round)

> **SUPERSEDED — see §48/§49.** The git-add list and evidence below reflect the FIRST corrective round, submitted for review and rejected before any commit happened. Nothing below was ever run. The current, revised git-add list (now also including `docs/roadmap/ROADMAP.md` and the newly-modified files from this second round) is in §49.

`git diff --check` — clean (no trailing-whitespace or line-ending issues in the corrective round's changes). `planning/SPRINT_STATUS.md`'s pre-existing trailing whitespace (three lines using markdown hard-break double-spaces, one accidental) was removed per this round's explicit instruction.

`tsconfig.tsbuildinfo` was modified by running `tsc`/`vitest` during validation, exactly as in every prior round. The restore step (`git restore --source=HEAD --worktree -- tsconfig.tsbuildinfo`) could not run: **a stale `.git/index.lock` exists in this sandbox** (0 bytes, no corresponding git process running — confirmed via `ps aux`), the same category of issue seen once before in this project (the original PT-0001 round). Per this sprint's explicit instruction — *"If `.git/index.lock` exists ... STOP. Do not force, delete, bypass, commit, or push."* — no attempt was made to remove it, and **nothing has been staged, committed, or pushed** by this round.

Verified immediately before stopping: branch is still `feature/manual-paper-trading`; `HEAD` is still `7b41eebfe68f72313741a8486be0b6625e017148`, exactly matching the preflight snapshot — no drift occurred while this round's work was in progress. All corrective-round changes exist only as uncommitted working-tree modifications plus three new untracked files (`lib/paper-trading/persistence/commit.ts`, `lib/paper-trading/__tests__/commit.test.ts`, `lib/paper-trading/__tests__/locking.test.ts`).

**For Dean to run natively** (this sandbox cannot safely remove the lock itself):

```
cd /path/to/trade-edge
rm -f .git/index.lock
git status --short
git restore --source=HEAD --worktree -- tsconfig.tsbuildinfo
git status --short
git diff --check
git diff -- tsconfig.tsbuildinfo   # must be empty after the restore

git add lib/paper-trading/idempotency.ts \
        lib/paper-trading/persistence/locking.ts \
        lib/paper-trading/persistence/commit.ts \
        lib/paper-trading/persistence/store.ts \
        lib/paper-trading/service.ts \
        lib/paper-trading/pricing.ts \
        lib/paper-trading/audit.ts \
        lib/paper-trading/http.ts \
        lib/paper-trading/types.ts \
        components/paper-trading/PaperTicketForm.tsx \
        components/paper-trading/PaperCloseForm.tsx \
        app/api/paper-trading/positions/route.ts \
        "app/api/paper-trading/positions/[positionId]/close/route.ts" \
        "app/api/paper-trading/positions/[positionId]/mark/route.ts" \
        lib/paper-trading/__tests__/idempotency.test.ts \
        lib/paper-trading/__tests__/locking.test.ts \
        lib/paper-trading/__tests__/commit.test.ts \
        lib/paper-trading/__tests__/pricing.test.ts \
        lib/paper-trading/__tests__/service.test.ts \
        lib/paper-trading/__tests__/testUtils/fakeRedisClient.ts \
        app/api/paper-trading/__tests__/security.test.ts \
        components/paper-trading/__tests__/PaperTicketForm.test.tsx \
        components/paper-trading/__tests__/PaperCloseForm.test.tsx \
        planning/SPRINT_STATUS.md \
        docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md \
        docs/reviews/PT-0001-Implementation-Report.md \
        docs/HANDOFF.md

git diff --cached --stat
git diff --cached --name-status
git diff --cached --check
git diff --cached -- tsconfig.tsbuildinfo   # must be empty

git commit -m "fix(paper): harden atomicity and idempotency"

git status --short --branch
git log --oneline --decorate main..HEAD
git diff --check main...HEAD
git diff --stat main...HEAD
git diff --name-status main...HEAD
git diff main...HEAD -- tsconfig.tsbuildinfo   # must be empty

git push origin feature/manual-paper-trading
```

Do not merge into `main`. Do not mark PT-0001 complete. Stop after pushing for Product Owner review.

## 38. Recommendation (corrective round)

> **SUPERSEDED — this recommendation was the basis for the submission the Product Owner rejected on second review. See §51 for the current recommendation.**

All seven required corrections are implemented and covered by the specified regression tests; the full repo-wide suite (847 tests) and `tsc --noEmit` are both clean; `git diff --check` is clean; `tsconfig.tsbuildinfo` was never staged. The only remaining step is the git commit/push sequence above, blocked solely by the sandbox's stale index lock — not by any outstanding code, test, or validation issue. Recommend Dean run the commands above, then return this branch for Product Owner re-review. Do not merge into `main` in the meantime.

## 39. Second Corrective Round — Scope and Repository Snapshot

The Product Owner rejected the first corrective round for five items: (1) PT-0002 missing from the roadmap, (2) the design doc stating entry credit "can be negative" while also stating it "must be finite and strictly positive," a direct contradiction, (3) the atomic-commit design relying on Redis `WATCH`/`MULTI`/`EXEC` and an "essentially never fails" justification, which does not meet an all-or-nothing guarantee, (4) no handling for the case where a commit's response is lost after Redis already applied it (an ambiguous outcome silently treated as "nothing happened" is a bug in the other direction), and (5) instructions not to stage/commit/push and to return evidence first. This section and §40–§51 address all five.

Repository snapshot before this round's work began: branch `feature/manual-paper-trading`; `HEAD` and `origin/feature/manual-paper-trading` both `7b41eebfe68f72313741a8486be0b6625e017148`, unchanged from the first corrective round's snapshot (§29) — no drift occurred between rounds. `main`/`origin/main` both `48123019175684690cac0faa88c88efdd4b075c5`, also unchanged. The working tree still carried the first corrective round's uncommitted changes (per that round's explicit "do not commit" instruction); this round's changes are additive on top of them, still entirely uncommitted. The stray untracked `trade-edge/` directory noted in §34 is still present, still outside version control, and was again excluded from every command run and left untouched.

## 40. Roadmap Documentation Change (PT-0002)

`docs/roadmap/ROADMAP.md` gained a new "PT-0002 — Application-Wide Portfolio Mode Foundation" entry, placed immediately after the existing PT-0001 entry, explicitly listing: a persistent global LIVE/PAPER selector; unmistakable mode display across portfolio-dependent screens; a shared portfolio-context abstraction; Portfolio Intelligence, Decision Engine inputs, Daily Briefing, reviews, risk analysis, analytics, and opportunities all reading the selected context; complete live/paper data isolation with no blending or implicit copying; persistence across navigation and refresh; safe failure for missing/ambiguous context; mode displayed at every execution-like confirmation; PAPER actions capable of mutating only the paper ledger; no possibility that switching mode triggers or enables live execution; Autopilot remaining disabled and out of scope; and PT-0001 explicitly described as the ledger/sandbox foundation, not the final UX. The roadmap's "Near-Term Roadmap" section gained a new "Paper Trading Sequencing" subsection stating the required order: (1) PT-0001, (2) PT-0002, (3) a separately-approved paper-action integration if required, (4) TE-0010 Autopilot Paper Mode only after manual paper mode is proven.

`planning/SPRINT_STATUS.md` gained a corresponding entry: PT-0002 is documented as queued in the roadmap, **not approved, not started, and not scoped as an active sprint**, dependent on PT-0001 being accepted first. A "Paper trading sequencing" subsection under "Known Follow-Ups" restates the same four-step order and gating condition, so a reader of either document sees the same sequencing.

`docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md`'s §12 (Known Limitations) also gained one bullet stating PT-0001 is the ledger/sandbox foundation only and pointing to PT-0002 as the queued, not-yet-approved next step — consistent with the roadmap/sprint-status language rather than silently omitting the connection.

## 41. Revised Atomic-Commit Design (supersedes §30 Fix #3)

`lib/paper-trading/persistence/commit.ts` was rewritten from `WATCH`/`MULTI`/`EXEC` to a **single Redis Lua script executed via `EVAL`** (`COMMIT_SCRIPT`). A Lua script runs as one indivisible unit on the Redis server — no other client command can interleave with it mid-execution — and this script is specifically structured so that every precondition check happens strictly before its first write:

1. Compare the stored mutation-lock value against the caller's lock id. Mismatch → return `"LOCK_LOST"`, write nothing.
2. `TYPE`-check the account key (must be absent or a string), the audit key (must be absent or a list), and — if an idempotency write is part of this operation — the idempotency key (must be absent or a string). Any mismatch → return `"TYPE_ERROR"`, write nothing.
3. Only once every check above has passed: `SET` the account, `LPUSH` + `LTRIM` the audit list, and (if applicable) `SET` the idempotency record with its TTL. Return `"OK"`.

Because no write occurs until every condition that could otherwise cause a write to fail has already been verified, the script cannot encounter an expected runtime error after it starts writing — it structurally either performs all three writes or none of them. This directly satisfies the requirement: *"a carefully validated Lua operation that performs all precondition and key-type checks before its first write and cannot encounter an expected runtime error after writing."* No new dependency was introduced (`ioredis` already supports `.eval()`, the same primitive already used for the lock-release script since the first corrective round).

`AtomicCommitPlan<T>` gained a new required field, `verify: (account: PaperAccount) => boolean`, supplied by each of `service.ts`'s four call sites (open/close/reset/mark). It answers "does this freshly-read account already reflect *this specific* attempted mutation" — for open/close, whether the position id is present in the corresponding list; for reset, whether the ledger's `createdAt` matches this attempt's freshly-generated timestamp; for mark, whether the position's `currentMark.evaluatedAt` matches this attempt's fill timestamp. This is used only by ambiguous-outcome resolution (§42), never by the normal success path.

## 42. Ambiguous-Outcome Resolution Design

A single atomic `EVAL` removes the *WATCH/MULTI/EXEC* partial-application risk entirely, but it does not remove one further, irreducible risk that is a property of networked systems in general, not of Redis specifically: the `EVAL` request can reach Redis, execute, and commit, and the **acknowledgement** can then be lost before it reaches the client (a dropped connection, a timeout). From the client's perspective, that failure is indistinguishable from "the request never arrived" — which is exactly the case the Product Owner flagged: *"A client-side EXEC rejection does not prove Redis applied nothing."*

`commitPaperMutation()` now distinguishes two categories of failure:

- **Confirmed abort** — the script itself returned `"LOCK_LOST"` or `"TYPE_ERROR"`. This proves the script ran to completion, made a decision, and wrote nothing. Surfaced directly as `LockLostError` or a `COMMIT_FAILED` "nothing was written" error — no re-reading needed, because there is nothing ambiguous about it.
- **Ambiguous outcome** — the `EVAL` call itself threw (a network/connection/protocol failure with no returned value). `resolveAmbiguousOutcome()` re-reads authoritative state: the account record (checked via the plan's `verify()`), the audit trail (checked by the pre-generated audit event id — generated in-memory before the commit attempt, exactly as `positionId` already was for Fix #6), and, where applicable, the idempotency record (checked by an exact raw-value match against what this attempt would have written). It then reasons from what it finds, never guesses:
  - All signals agree the operation committed → replay the already-computed result (`plan.extra`) as a success. This is safe because the result was computed deterministically from the same inputs the script would have written — replaying it is not re-deriving a different answer, it is returning the one the (confirmed-to-have-happened) commit already produced.
  - All signals agree it did not commit → throw a conservative, explicitly retryable `COMMIT_FAILED`.
  - Signals **disagree** with each other → throw a new, distinct `IntegrityFailureError` (`PaperTradingErrorCode: 'INTEGRITY_FAILURE'`, mapped to HTTP 500 in `http.ts`). Under the real, precondition-checked script, this case cannot arise through its own expected command paths — it either writes all three together or none of them — so a disagreement means something outside this commit path (or, in testing, a deliberately injected fault — see §43 row 5) altered persistence state. The code never silently picks a side, and it never attempts to automatically repair the inconsistency; it only detects and surfaces it.

The resolution path never re-executes the commit script and never retries the write itself, so an ambiguous outcome can never itself produce a duplicate mutation — a *client* retry (a fresh call to `openPaperPosition()` etc. with the same idempotency key) is what produces the "exactly once" behavior, via the ordinary idempotency replay path, since the idempotency record was genuinely written by the original (confirmed) commit.

## 43. Failure-State Matrix and Test Coverage

All six required scenarios are implemented as tests in the rewritten `lib/paper-trading/__tests__/commit.test.ts`, using a rewritten `lib/paper-trading/__tests__/testUtils/fakeRedisClient.ts` that recognizes the `PAPER_COMMIT_V2` script by its leading marker comment and exposes a `failNextCommit(mode)` hook with three modes (`before_apply`, `after_apply`, `partial_apply` — see that file's module doc comment for exactly what each simulates). The old `watch()`/`unwatch()`/`multi()`/`exec()`/`failNextExec()` apparatus was removed; nothing else in the codebase used it.

| # | Scenario | Mode | Result |
|---|---|---|---|
| 1 | Failure before the commit script's write phase runs | `before_apply` | Nothing written (ledger, audit, idempotency); a conservative, explicitly retryable `COMMIT_FAILED` is thrown; a client retry with the same idempotency key succeeds exactly once. |
| 2 | Confirmed lock-ownership abort | (direct: lock key mutated out from under the request) | Script itself returns `"LOCK_LOST"` — not ambiguous; `LockLostError` thrown; nothing written. |
| 3 | Response lost after the commit script's write phase fully applied | `after_apply` | `resolveAmbiguousOutcome()` confirms the commit via re-read (ledger + audit + idempotency all agree) and returns the original result as a success — not an error. |
| 4 | Retry after that response loss | `after_apply` then a second call with the same idempotency key | The retry replays the confirmed result via the ordinary idempotency path (the idempotency record was genuinely written); the ledger is not mutated a second time. |
| 5 | Artificially, deliberately inconsistent persistence state (test-only injection) | `partial_apply` — the test double writes only the account key and stops, injecting a state directly | Detected and surfaced as `IntegrityFailureError` (`code: 'INTEGRITY_FAILURE'`) — not treated as a success, not treated as a plain retryable failure, and **no automatic repair of the inconsistent state is attempted.** |
| 6 | No partial state from any *reachable* commit failure | swept across `before_apply` and confirmed lock-loss | Asserted directly in every scenario above — neither of these two reachable failure modes (the only ones a real client/network/Redis interaction can actually produce) leaves the ledger, audit trail, or idempotency record in a state where some but not all of an operation's effects are visible. |

On row 5, to state this precisely and avoid any ambiguity: **the real, precondition-checked Lua script cannot produce the `partial_apply` state through its own expected command paths** — it performs its `TYPE`/ownership checks before any write, and then either writes the account, the audit event, and the idempotency record together, or (on a failed check) writes none of them. `partial_apply` exists purely as a test-double injection — the fake Redis client is told to write only the account key and then throw, a sequence the real script's own logic cannot reach — so that `resolveAmbiguousOutcome()`'s disagreement-detection path can be exercised and proven correct. Row 6's "no partial state" claim is therefore scoped to the failure modes a real execution can actually produce (rows 1 and 2); it does not, and should not, describe row 5, whose entire purpose is to construct a partial state no real execution path produces, in order to confirm the resolver detects it rather than silently accepting or rejecting it.

Tests covering open (all six scenarios), close (scenarios 1 and 3), reset (scenario 3, exercising `verify()`'s `createdAt` check), and mark (scenario 3, exercising `verify()`'s `currentMark.evaluatedAt` check) — 12 tests total in `commit.test.ts`, up from 6 in the first corrective round.

## 44. Design-Doc Consistency Corrections

`docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md` §4.1 previously stated `cash` "increases by `entryCredit` ... (can be negative for a genuinely inverted debit fill — not clamped...)", directly contradicting §14's validation policy ("entry credit must be finite and strictly positive"). §4.1 now states entry credit is always finite and strictly positive and cross-references the validation policy, removing the contradiction. §14's atomic-commit description was replaced in place (not left alongside as a second, conflicting "current" description) with the design in §41–§42 above, and its failure-state-matrix summary was corrected to match §43's row-5/row-6 wording fix (below) rather than repeating the earlier overbroad "every one of the above leaves no partial state" phrasing. §6 (Idempotency, Atomicity, Audit) was also corrected — it previously referenced a `persistence/store.ts` function (`mutatePaperTradingLedger()`) that was already removed in the first corrective round, an inconsistency that predates this round but falls under "ensure every section agrees," so it was fixed to reference the actual current commit path. §30 Fix #3 and the accompanying MULTI/EXEC note in this report were left in place as historical record but marked superseded (§30, inline) rather than silently edited to look like they were always correct.

## 45. Requirements-to-Test Mapping (second corrective round)

- PT-0002 present in `ROADMAP.md` and `SPRINT_STATUS.md`, correctly sequenced and marked not-approved → verified by direct reading of both files (§40, §50); no test framework covers roadmap prose, so this is a documentation-review check, not an automated test.
- Single-EVAL atomic commit, precondition-before-write ordering → `commit.test.ts`'s "atomic successful commit" describe block, plus the failure-state matrix tests (§43).
- Confirmed abort vs. ambiguous outcome distinction, re-read resolution, replay-exactly-once, integrity-failure detection → `commit.test.ts`'s "1." through "6." describe blocks (§43's table).
- Design-doc entry-credit/atomicity/idempotency consistency → verified by direct reading (§44); not test-covered (a prose-consistency requirement, not a runtime behavior).
- Everything covered by the first corrective round's mapping (§32) that this round did not touch — idempotency canonicalization, lock release atomicity, fill-value validation, confirmation-identity spoofing resistance, paper/live isolation, Portfolio Intelligence isolation — re-verified still passing in this round's full-suite run (§47), not re-designed.

## 46. Targeted-Test Results (second corrective round)

`lib/paper-trading`, `components/paper-trading`, and `app/api/paper-trading` together: **156 / 156 passing**, 16 test files (up from 150/150 across the same scope in the first corrective round — the net increase is `commit.test.ts` growing from 6 to 12 tests). No regressions in any of the other 14 files in this scope, none of which needed changes for this round.

## 47. Full-Suite Result and TypeScript Result (second corrective round)

**65 test files / 853 tests passing repo-wide, 0 failures.** (847 in the first corrective round's baseline + 6 net new tests in `commit.test.ts`.) Run in six sequential `vitest run` shards to stay within the sandbox's per-shell-call time budget, covering every directory containing test files: `lib/paper-trading`+`components/paper-trading`+`app/api/paper-trading` (16 files / 156 tests); `lib/autopilot`+`lib/opportunity-engine`+`lib/portfolio-intelligence` (20 files / 301 tests); the remaining `lib/*` directories with test coverage — `decision-review`, `decision-engine`, `todaysPriorities`, `portfolioHealth`, `portfolioReview`, `dailyBriefing`, `priorityScore`, `tradeLog`, `position-snapshot`, `positionValuation`, `lib/__tests__` (13 unique files / 215 tests, after removing files also matched by the previous shard due to a substring-filter overlap in the invocation, not a real duplicate run); `components/opportunity-engine` (1 file / 15 tests); and `features/portfolio/**` in two shards (8 files / 71 tests, then 7 files / 95 tests). `lib/wheel`, `lib/ai`, `lib/commands`, `lib/jobs`, `lib/scans`, `lib/screener`, and `lib/tasks` contain no test files. Every shard reported 0 failures. As in every prior round, the stray untracked `trade-edge/` directory was excluded from all commands and left untouched.

`npx tsc --noEmit` — **clean**, no errors.

`npm run build` — not independently re-attempted this round, for the same documented, pre-existing sandbox limitation noted in every prior round (hangs at the initial Next.js banner). No claim of production build/deploy success is made.

## 48. Exact Changed-File List (second corrective round)

Files created or substantively rewritten in this round:

- `lib/paper-trading/persistence/commit.ts` (rewritten: single-EVAL atomic commit, ambiguous-outcome resolution, `IntegrityFailureError`)
- `lib/paper-trading/__tests__/commit.test.ts` (rewritten: failure-state matrix tests)
- `lib/paper-trading/__tests__/testUtils/fakeRedisClient.ts` (rewritten: `PAPER_COMMIT_V2` script emulation, `failNextCommit()`, old `watch`/`multi`/`exec` machinery removed)
- `lib/paper-trading/service.ts` (edited: `verify` field added to all four `AtomicCommitPlan` call sites)
- `lib/paper-trading/types.ts` (edited: `INTEGRITY_FAILURE` added to `PaperTradingErrorCode`)
- `lib/paper-trading/http.ts` (edited: `INTEGRITY_FAILURE` added to `STATUS_BY_CODE`, mapped to 500)
- `docs/roadmap/ROADMAP.md` (edited: PT-0002 entry and sequencing subsection added)
- `planning/SPRINT_STATUS.md` (edited: PT-0002 queued entry and sequencing subsection added)
- `docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md` (edited: entry-credit contradiction removed, atomic-commit/ambiguous-outcome design replaced in place, idempotency/atomicity section corrected, PT-0002 cross-reference added, failure-matrix wording corrected)
- `docs/reviews/PT-0001-Implementation-Report.md` (this file: superseded-markers added to §30/§32/§37/§38, §39–§51 added; **recreated at this canonical path in a third pass after being found deleted from the working tree — see §52**)

Files already modified by the first corrective round and **not touched again this round** (unchanged carry-forward, still uncommitted): `app/api/paper-trading/__tests__/security.test.ts`; `app/api/paper-trading/positions/route.ts`; `app/api/paper-trading/positions/[positionId]/close/route.ts`; `app/api/paper-trading/positions/[positionId]/mark/route.ts`; `components/paper-trading/PaperCloseForm.tsx`; `components/paper-trading/PaperTicketForm.tsx`; `components/paper-trading/__tests__/PaperCloseForm.test.tsx`; `components/paper-trading/__tests__/PaperTicketForm.test.tsx`; `docs/HANDOFF.md`; `lib/paper-trading/__tests__/idempotency.test.ts`; `lib/paper-trading/__tests__/pricing.test.ts`; `lib/paper-trading/__tests__/service.test.ts`; `lib/paper-trading/__tests__/locking.test.ts` (untracked); `lib/paper-trading/audit.ts`; `lib/paper-trading/idempotency.ts`; `lib/paper-trading/persistence/locking.ts`; `lib/paper-trading/persistence/store.ts`; `lib/paper-trading/pricing.ts`.

Not part of any git-add list: `tsconfig.tsbuildinfo` (build artifact, touched by running `tsc`/`vitest`, never staged — see §49); `trade-edge/` (untracked, outside version control, not this project's file, left untouched throughout, including during this file's recreation).

This matches `git status --short` exactly as of this round's end (verified in §49/§52).

## 49. Git Verification and Push Status (second corrective round)

`git diff --check` — **clean**, no output, no trailing-whitespace or line-ending issues anywhere in the working tree's changes.

`git status --short --branch` confirms: still on `feature/manual-paper-trading...origin/feature/manual-paper-trading`; the 23 modified-and-carried-forward-plus-this-round files listed in §48 as `M`; three untracked files (`lib/paper-trading/__tests__/commit.test.ts`, `lib/paper-trading/__tests__/locking.test.ts`, `lib/paper-trading/persistence/commit.ts`); the untracked, out-of-version-control `trade-edge/` directory, excluded from staging.

`tsconfig.tsbuildinfo` shows as modified (running `tsc --noEmit`/`vitest` touches it, as in every prior round) and **must not be staged** — restore it with `git restore --source=HEAD --worktree -- tsconfig.tsbuildinfo` immediately before staging anything else.

**A stale `.git/index.lock` (0 bytes) is still present in this sandbox**, unchanged from the first corrective round (§37) — confirmed again this round (no corresponding git process running). Per this sprint's explicit instruction, repeated at both the start and end of the Product Owner's message — *"Do not stage, commit, or push... Do not stage, commit, push, merge, or mark PT-0001 complete."* — **nothing has been staged, committed, or pushed this round**, independent of the lock (the instruction this round is to return evidence first regardless of lock state).

Verified immediately before stopping: branch is still `feature/manual-paper-trading`; `HEAD` is still `7b41eebfe68f72313741a8486be0b6625e017148`; `main`/`origin/main` still `48123019175684690cac0faa88c88efdd4b075c5` — no drift from either round's preflight snapshot.

**Revised explicit git-add list for Dean to run natively, once ready** (supersedes §37's list — adds `docs/roadmap/ROADMAP.md` and reflects this round's file set):

```
cd /path/to/trade-edge
rm -f .git/index.lock
git status --short
git restore --source=HEAD --worktree -- tsconfig.tsbuildinfo
git status --short
git diff --check
git diff -- tsconfig.tsbuildinfo   # must be empty after the restore

git add lib/paper-trading/idempotency.ts \
        lib/paper-trading/persistence/locking.ts \
        lib/paper-trading/persistence/commit.ts \
        lib/paper-trading/persistence/store.ts \
        lib/paper-trading/service.ts \
        lib/paper-trading/pricing.ts \
        lib/paper-trading/audit.ts \
        lib/paper-trading/http.ts \
        lib/paper-trading/types.ts \
        components/paper-trading/PaperTicketForm.tsx \
        components/paper-trading/PaperCloseForm.tsx \
        app/api/paper-trading/positions/route.ts \
        "app/api/paper-trading/positions/[positionId]/close/route.ts" \
        "app/api/paper-trading/positions/[positionId]/mark/route.ts" \
        lib/paper-trading/__tests__/idempotency.test.ts \
        lib/paper-trading/__tests__/locking.test.ts \
        lib/paper-trading/__tests__/commit.test.ts \
        lib/paper-trading/__tests__/pricing.test.ts \
        lib/paper-trading/__tests__/service.test.ts \
        lib/paper-trading/__tests__/testUtils/fakeRedisClient.ts \
        app/api/paper-trading/__tests__/security.test.ts \
        components/paper-trading/__tests__/PaperTicketForm.test.tsx \
        components/paper-trading/__tests__/PaperCloseForm.test.tsx \
        planning/SPRINT_STATUS.md \
        docs/roadmap/ROADMAP.md \
        docs/design/PT-0001-Manual-Paper-Trading-Sandbox.md \
        docs/reviews/PT-0001-Implementation-Report.md \
        docs/HANDOFF.md

git diff --cached --stat
git diff --cached --name-status
git diff --cached --check
git diff --cached -- tsconfig.tsbuildinfo   # must be empty

git commit -m "fix(paper): single-EVAL atomic commit, ambiguous-outcome resolution, PT-0002 roadmap entry"

git status --short --branch
git log --oneline --decorate main..HEAD
git diff --check main...HEAD
git diff --stat main...HEAD
git diff --name-status main...HEAD
git diff main...HEAD -- tsconfig.tsbuildinfo   # must be empty

git push origin feature/manual-paper-trading
```

Do not merge into `main`. Do not mark PT-0001 complete. Stop after pushing for Product Owner review.

## 50. Confirmation: PT-0002 in ROADMAP.md and SPRINT_STATUS.md

Confirmed by direct reading of both files as of this round's end:

- `docs/roadmap/ROADMAP.md` contains a "PT-0002 — Application-Wide Portfolio Mode Foundation" entry (queued, not approved, not started) with the full required scope list and the four-step sequencing subsection.
- `planning/SPRINT_STATUS.md`'s "Current State" section states PT-0002 is queued in the roadmap, not approved, not started, not scoped as an active sprint, and dependent on PT-0001's acceptance; its "Known Follow-Ups" section restates the same sequencing.

## 51. Recommendation (second corrective round)

All five items from the Product Owner's second review are addressed: PT-0002 is documented in both the roadmap and sprint status as queued (§40, §50); the design doc's entry-credit contradiction is removed and every section now agrees on close-debit, audit, idempotency, identity, and lock-loss behavior (§44); the atomic-commit guarantee is redesigned around a single precondition-checked Lua `EVAL` with a genuine all-or-nothing write boundary, not a reworded MULTI/EXEC justification (§41); ambiguous commit outcomes are resolved by re-reading authoritative state rather than assumed to mean nothing was written, with a new distinct integrity-failure path for genuinely inconsistent state (§42); and this evidence is being returned before any git operation (§45–§50), per the explicit instruction. The full repo-wide suite (853 tests, up from 847) and `tsc --noEmit` are both clean; `git diff --check` is clean; `tsconfig.tsbuildinfo` was never staged. Nothing has been staged, committed, or pushed. Recommend Product Owner review this evidence; if accepted, Dean can then run the §49 command sequence. Do not merge into `main` in the meantime, and do not mark PT-0001 complete.

## 52. Third Pass — Report File Recovery and Wording Correction

Between the second corrective round's submission and this Product Owner review, `docs/reviews/PT-0001-Implementation-Report.md` was found deleted from the working tree (`git status` showed it as `D`, not `M`; the file did not exist on disk; no replacement existed anywhere, including under the untracked `trade-edge/` directory). **This session's own tool-call history contains no delete, move, or rename operation against this file** — every action taken against it after its initial creation was a read or an in-place text edit, the same categories of action taken against every other file in this round, all of which remain intact and correctly modified (verified again in this pass: `commit.ts`, `service.ts`, `types.ts`, `http.ts`, `ROADMAP.md`, `SPRINT_STATUS.md`, the design doc, `fakeRedisClient.ts`, and `commit.test.ts` were all confirmed present and containing this round's changes). `git fsck --unreachable` found no dangling commit or tree corresponding to any staged version of this file — consistent with it never having been staged, and offering no recovery path through git itself. The cause of the deletion cannot be determined from within this session; it is not explained by any action this session recorded taking. The file has been recreated at the canonical path by reconstructing §1–28 from the original committed blob (`git show HEAD:docs/reviews/PT-0001-Implementation-Report.md`, read-only) and §29–§51 from this session's own record of what was written and edited, including the second corrective round's content.

While recreating it, the Product Owner's separate wording correction was also applied: §43's row 6 and the paragraph following the table previously implied that *no* scenario, including the deliberately-injected `partial_apply` case, left partial state — which is inaccurate, since `partial_apply` is specifically constructed to leave partial state so the resolver's detection of it can be tested. §43 (and the corresponding paragraph in the design doc's §14) now state this accurately: the real, precondition-checked Lua script cannot produce that modeled partial state through its own expected command paths; externally introduced or artificially injected inconsistency (as in the `partial_apply` test) is detected and surfaced as `IntegrityFailureError`; and no automatic repair of any such inconsistency is attempted. Row 6's "no partial state" claim is now explicitly scoped to the two failure modes a real execution can actually produce (rows 1 and 2), not to row 5. `lib/paper-trading/__tests__/commit.test.ts`'s describe-block title for that section was also corrected from "no partial ledger/audit/idempotency state from any modeled failure" to "no partial state from any reachable commit failure," with its inline comments adjusted to match.

## 53. Fourth Pass — Accepted/Rejected Audit Semantics and Idempotency-Write Precondition Validation

The Product Owner's fourth review identified two remaining correctness defects, both fixed in this pass.

**Defect 1 — a post-commit auxiliary failure could convert a committed success into a rejection.** `openPaperPosition()` and `closePaperPosition()` (`lib/paper-trading/service.ts`) wrapped `commitPaperMutation()` AND two subsequent, separate, non-atomic `appendPaperAuditEvent()` calls (stale-quote-confirmed / manual-override-confirmed notices) in the same `try`/`catch`. If the atomic commit succeeded but one of those separate appends then failed, the `catch` wrote an `entry_rejected`/`close_rejected` event and re-threw — telling the caller an already-committed mutation had failed, and leaving contradictory accepted-and-rejected audit evidence for the same operation. The same class of bug existed, undetected until now, in the duplicate-replay observational logging: `entry_duplicate_replayed`/`close_duplicate_replayed` were appended with no `try`/`catch` at all, so a failure there would throw straight out of the function, turning a CONFIRMED idempotent replay into an apparent failure.

Fixed with two changes:
1. Stale-quote-confirmed and manual-override-confirmed evidence is now recorded as additional rule IDs (`pt_stale_quote_confirmed`, `pt_manual_fill_override` — see `fillEvidenceRuleIds()`) directly on the PRIMARY accepted audit event, which already commits atomically with the ledger mutation. The two separate post-commit events are removed entirely — there is nothing left to run between "commit confirmed success" and "return the result" in either function, so a confirmed commit can no longer be converted into a rejection by anything downstream, because nothing is downstream.
2. Every remaining genuinely-separate, non-atomic audit append — the duplicate-replay notices, and the standalone `entry_rejected`/`close_rejected` notices for PRE-commit rejections (validation/pricing/lookup failures that never reach `commitPaperMutation()` at all) — now goes through a new `appendObservationalAuditEvent()` helper, which catches and reports (via `console.error`; no shared logger/telemetry sink exists in this codebase, confirmed by search) any failure in the append itself, and never re-throws it. A broken observational log can therefore never mask a confirmed replay as a failure, nor mask a genuine rejection's real error with an unrelated logging error.

New tests in `lib/paper-trading/__tests__/commit.test.ts` ("accepted/rejected audit semantics" describe block), using a new `FakeRedisClient.failNextPlainAppend()` hook that fails only the STANDALONE (non-script) `lpush()` path — i.e. exactly the calls `appendPaperAuditEvent()` makes — never the atomic commit script's own internal writes:
- open commit succeeds (stale-quote and, separately, manual-override cases) with the standalone-append path armed to fail; the result is unaffected, no `entry_rejected` event exists, and the accepted event's `ruleIds` carries the evidence.
- close commit succeeds (manual-override case) with the standalone-append path armed to fail; same assertions, `close_rejected` never appears.
- a confirmed idempotent replay (both open and close) remains a replay success with the standalone-append path armed to fail; `console.error` is confirmed called (the failure is reported, not silently dropped).

**Defect 2 — an invalid idempotency TTL could fail after earlier writes.** `COMMIT_SCRIPT`'s final command, `redis.call("SET", KEYS[4], ARGV[5], "EX", tonumber(ARGV[6]))`, validated the TYPE of the target keys up front but never validated the TTL argument itself — an invalid TTL could only be discovered by that command failing, which would happen AFTER the account and audit writes had already executed, breaking the "no write after the first write can fail" guarantee for this one argument. Fixed at both layers, per the explicit instruction not to rely on TypeScript validation alone:
1. **Lua layer (authoritative):** `COMMIT_SCRIPT` now validates, before any write, whenever an idempotency write is part of the operation: the idempotency value is non-empty; the TTL argument parses as a number; the TTL has no fractional part; the TTL is strictly positive. Any failure returns a new `"INVALID_ARG"` result and writes nothing — mirrors the existing `TYPE_ERROR` precondition-failure pattern.
2. **TypeScript layer (fail-fast, not authoritative):** `commitPaperMutation()` calls a new `assertValidIdempotencyPlan()` immediately after `build()` produces the plan, before `EVAL` is even invoked, checking the same three properties. This is a defense-in-depth guard, not a substitute for the Lua check — the Lua script is what actually stands between the argument and Redis at the moment it runs, and remains authoritative regardless of this guard.
3. `lib/paper-trading/__tests__/testUtils/fakeRedisClient.ts`'s `_evalPaperCommit()` now independently models the same validation (empty value / non-finite / non-integer / non-positive TTL → `"INVALID_ARG"`, nothing written) rather than silently accepting an invalid TTL, per the explicit instruction that the fake must model the real script's validation.

New tests in `commit.test.ts` ("idempotency TTL precondition validation" describe block): zero, negative, fractional, and non-numeric TTL each independently proven to write nothing (checked against the ledger, the accepted audit event, and the idempotency record); a valid positive integer TTL proven to commit all three; a sweep test confirming no invalid-TTL case leaves partial state; and a dedicated test that calls the fake's `eval()` directly with the exact `KEYS`/`ARGV` layout `commitPaperMutation()` uses, bypassing `assertValidIdempotencyPlan()` entirely, to prove the Lua-modeled validation independently rejects an invalid TTL and writes nothing — i.e. that the TypeScript guard is not the only thing standing between an invalid TTL and a write.

**Test-file wording (item 3).** `commit.test.ts`'s top-of-file doc comment still said "no partial ledger/audit/idempotency state from any modeled failure," which was the same overbroad claim already corrected in the describe-block title in the third pass (§52) but left uncorrected in the file's header. Fixed to read "no partial state from any REACHABLE commit failure (before_apply, confirmed lock-loss)," with `partial_apply` explicitly called out as deliberately excluded from that claim.

**Validation:** paper-trading-scoped suite (`lib/paper-trading`, `components/paper-trading`, `app/api/paper-trading`) — 16 files / **168 tests passing** (up from 156; `commit.test.ts` grew from 12 to 24 tests). Full repo-wide suite — 65 files / **865 tests passing**, 0 failures (up from 853; the +12 is entirely `commit.test.ts`'s growth). `npx tsc --noEmit` — clean. `git diff --check` — clean.

**A repository-state anomaly was found during this pass and is reported, not silently worked around: 28 files are currently STAGED in the git index** (`git diff --cached --name-status` lists exactly the files below), even though **no `git add` was run in this session** — this session's own tool-call history contains zero staging commands. `HEAD` and `origin/feature/manual-paper-trading` are both still `7b41eebfe68f72313741a8486be0b6625e017148`, unchanged, and `git reflog` shows no commit newer than the original PT-0001 commit, confirming **nothing was committed or pushed**. The staged file list matches, file-for-file, the `git add` command block provided as evidence in this report's own §49 (and, before that, §37) — the most plausible explanation is that this command block was run natively (outside this session) up through the `git add` step and paused there, consistent with the "stop after staging, do not commit" boundary those instructions describe, though this cannot be confirmed from inside this session. Per this sprint's standing instruction to stop and report rather than force/bypass/fix unexpected repository state, **this session did not run `git reset`, `git restore --staged`, or any other command that would alter what is currently staged** — the index was left exactly as found. See the final response to this round for the exact `git status --porcelain` output and the staged-file list.

## 54. Recommendation (fourth pass)

Both defects from the Product Owner's fourth review are fixed and covered by new failure-injection and precondition-validation tests (§53). No post-success auxiliary failure can convert a confirmed `openPaperPosition()`/`closePaperPosition()` result into a rejection (proven by construction — nothing runs after a confirmed commit succeeds — and by test, using a hook that fails only the standalone append path). No invalid idempotency TTL can reach a Redis write (proven at both the TypeScript guard and, independently, the Lua/fake-modeled script layer, with a direct test bypassing the TypeScript guard to exercise the Lua-level check alone). The full repo-wide suite (865 tests, up from 853) and `tsc --noEmit` are both clean; `git diff --check` is clean. **This pass discovered, but did not create or resolve, a git-index staging anomaly (28 files staged, matching a previously-provided `git add` list, with nothing committed or pushed) — this needs Dean's/the Product Owner's attention before any further git operation, since this session cannot determine from the inside whether that staging was intentional (e.g. a paused native run of the provided command block) or not.** Recommend: (1) Dean confirm/clarify whether that staging was intentional; (2) if not intentional, Dean run `git status`/`git diff --cached` natively to inspect before deciding whether to unstage; (3) once the index state is confirmed correct, the commit/push sequence can proceed. Do not merge into `main` in the meantime, and do not mark PT-0001 complete.

Read-only verification for this pass — `git status --short --branch`, `git diff --check`, `git diff --name-status`, `git diff -- docs/reviews/PT-0001-Implementation-Report.md`, and the requested `find trade-edge -maxdepth 4 -type f ...` — is reported directly to the Product Owner alongside this report, not restated here, since some of it (the git status of this very file) is only accurate at the moment it is run. As with every prior pass: nothing has been staged, committed, pushed, merged, deleted, moved, or copied, and the untracked `trade-edge/` directory was read from (to confirm it does not contain a replacement copy) but not modified.

## 55. Fifth Pass — Explicit Commit-Outcome Classification

The Product Owner's fifth review identified one remaining blocking error-classification defect, upstream of everything fixed in the fourth pass.

**The defect.** `commitPaperMutation()` may successfully commit (the `EVAL` script runs its full write phase), then lose the acknowledgement, and then, while `resolveAmbiguousOutcome()` is re-reading Redis to resolve that ambiguity, ONE OF THOSE RECONCILIATION READS ITSELF FAILS (a further connection/protocol error hitting `readAccount()`, the audit-trail read, or the idempotency-record read). Before this pass, that read failure propagated as a raw, unclassified error straight out of `resolveAmbiguousOutcome()` and `commitPaperMutation()`. `openPaperPosition()`/`closePaperPosition()`'s broad `catch` block could not distinguish it from a genuinely confirmed rejection, so it recorded `entry_rejected`/`close_rejected` — falsely declaring failed a mutation that, in fact, may already have committed. The same misclassification risk existed for `IntegrityFailureError`: that error means persisted signals *disagree*, not that the operation was rejected, yet the pre-fifth-pass `catch` block recorded a rejection for it too (its own doc comment, before this pass, explicitly and incorrectly said `IntegrityFailureError` should still produce a rejected event — see the corrected comment in `service.ts` now). Both cases risked a confirmed-accepted operation and a rejected audit event coexisting for the same mutation, contradicting each other, solely because reconciliation could not finish.

**The fix — explicit, typed outcome classification.** Every error that can leave `commitPaperMutation()` now carries a durable `commitOutcome` field (`lib/paper-trading/types.ts`'s new `PaperCommitOutcomeClass`), set at the throw site — never inferred from message text — as exactly one of:

- **`CONFIRMED_NOT_COMMITTED`** — proven nothing was written. Covers: a script-returned `"LOCK_LOST"` (`LockLostError`); a script-returned `"TYPE_ERROR"` or `"INVALID_ARG"` (both returned before any write); `resolveAmbiguousOutcome()`'s own `noneCommitted` branch (all reconciliation signals agree nothing committed); a pure `build()`/domain rejection (`INSUFFICIENT_CAPITAL`, `POSITION_ALREADY_CLOSED`, ...) thrown before `EVAL` is ever reached; and `assertValidIdempotencyPlan()`'s precondition-guard errors. Tagged via a new `tagAsConfirmedNotCommitted()` helper (`commit.ts`) that sets the field only if not already set, so a specific domain error's `code`/`instanceof` checks elsewhere in the codebase are unaffected.
- **`OUTCOME_UNKNOWN`** — genuinely unknown, not confirmed either way. Covers: the `EVAL` acknowledgement was lost AND the reconciliation read attempting to resolve that ambiguity itself failed (new `OutcomeUnknownError`, `lib/paper-trading/persistence/commit.ts`); and, newly reclassified this pass, an unrecognized commit-script return value (previously thrown as a generic `COMMIT_FAILED`, which wrongly implied a confirmed non-commit — an unrecognized result means the code does not know what happened server-side, which is exactly `OUTCOME_UNKNOWN`, not a confirmed rejection).
- **`INTEGRITY_FAILURE`** — persisted signals were successfully read but disagree (`IntegrityFailureError`, unchanged from the second pass's design — now simply carries the explicit tag instead of being inferred from `instanceof` alone).

**Protecting reconciliation itself.** `resolveAmbiguousOutcome()` now wraps each of its three reconciliation reads — `readAccount()`, the audit-trail read (`getPaperAuditEvents()`), and the idempotency-record read (`redis.get()`) — in its own `try`/`catch`. A failure in any one of them is converted immediately into a new `OutcomeUnknownError` via a `buildOutcomeUnknownError(userId, evalError, reconciliationError, stage)` helper, which preserves both the ORIGINAL `EVAL` error and the reconciliation-read error as `.message`-text-only diagnostic metadata (`originalCommitError`, `reconciliationError`, plus a `stage` label identifying which read failed) — never the full account/audit/idempotency payload, so no user-entered data or secrets can leak through this error path.

**Corrected service-layer audit semantics (`lib/paper-trading/service.ts`).** `openPaperPosition()`'s and `closePaperPosition()`'s post-commit `catch` blocks now branch on `e.commitOutcome` before deciding whether to append a rejected event:
- **`CONFIRMED_NOT_COMMITTED` is the ONLY classification that may ever produce a rejected event.** `entry_rejected`/`close_rejected` is appended if, and only if, `commitOutcome === 'CONFIRMED_NOT_COMMITTED'`.
- `OUTCOME_UNKNOWN` and `INTEGRITY_FAILURE` append NOTHING and re-throw as-is. `OutcomeUnknownError`'s own message already instructs the caller not to resubmit under a different idempotency key, and to retry/reconcile using the SAME key (which safely replays the original result if it turns out to have committed, or retries cleanly if it did not); `IntegrityFailureError`'s message is unchanged from the second pass — it already told the caller this requires investigation, never automatic retry or repair.
- **A missing or unrecognized `commitOutcome` also appends NOTHING** — an unclassified error is not evidence the mutation did not commit, so it must default to "do not record a rejection," never to "record one." *(This bullet corrects this same section's own original wording in this pass's first draft, which said an unclassified/unexpected error "fails toward recording" — that had the defensive default exactly backwards; see §57 for the full correction, made in direct response to the Product Owner's sixth review.)*

The stale doc comment on both `catch` blocks (which previously implied `IntegrityFailureError` should still produce a rejected event) was corrected to state the actual rule.

**HTTP mapping (`lib/paper-trading/http.ts`).** `OUTCOME_UNKNOWN` maps to HTTP 409, not 500 — this is a retryable/reconcile state the caller is expected to act on (using the same idempotency key), not a server-fault report.

**Correcting a prior overclaim.** Nothing in this report's own §41–§43 asserted that *every* error leaving `commitPaperMutation()` means the mutation did not commit — `IntegrityFailureError` was already documented there as its own distinct, non-rejection class. The overclaim that this pass corrects lived in `service.ts`'s code comment (quoted in §53 as background, not asserted as fact by this report), which said the post-commit `catch` block runs "only when the mutation did NOT commit ... or when its outcome could not be confirmed as a clean success (`IntegrityFailureError`) -- never after a confirmed accepted commit" — wording that, read carefully, already implied `IntegrityFailureError` was safe to treat as a rejection. That comment is now corrected in the code itself (§ above) and this report supersedes that implication explicitly: only `CONFIRMED_NOT_COMMITTED` is safe to record as a rejection; `OUTCOME_UNKNOWN` and `INTEGRITY_FAILURE` are not confirmed rejections and must never produce a rejected audit event.

**New tests** in `lib/paper-trading/__tests__/commit.test.ts`:
- `"commit-outcome classification: reconciliation-read failures (PO Round 5)"` — three tests (account-read failure, audit-trail-read failure, idempotency-record-read failure), each: commits fully via `after_apply` (write phase completes, acknowledgement lost), arms a single-shot, precisely-targeted read failure (new `FakeRedisClient.failNextGetForKey(key, reason?, skip?)` and `failNextLrange(reason?)` hooks — `skip` lets a test target the SECOND read of a key, since the account and idempotency keys are each legitimately read once earlier in the same call before the reconciliation read this pass targets), and asserts: the thrown error is `OutcomeUnknownError` with `commitOutcome === 'OUTCOME_UNKNOWN'`; the ledger, the accepted audit event, and (implicitly, via the later replay) the idempotency record all still reflect the original commit; no `entry_rejected` event was appended; and a later retry with the SAME idempotency key replays the original success exactly once (never opens a second position).
- The existing `partial_apply`/`IntegrityFailureError` test (fifth-scenario `describe` block from the second pass) was extended to assert `commitOutcome === 'INTEGRITY_FAILURE'` and that no `entry_rejected` event was appended.
- `"commit-outcome classification: confirmed rejections still produce a rejected event (regression, PO Round 5)"` — three tests proving this pass did not accidentally suppress a legitimate rejection: a confirmed before-commit failure (`before_apply`) still appends `entry_rejected`; a confirmed lock-ownership abort still appends `entry_rejected` (driven through the real `openPaperPosition()` call path via a new `FakeRedisClient` `CommitFailureMode`, `'lock_lost'`, that makes the commit-script emulation return `"LOCK_LOST"` unconditionally — a normal, non-throwing script return, exactly like the real script's confirmed lock-ownership check failing — so this can be exercised without needing to interleave a real concurrent lock-stealing request); and the equivalent before-commit-failure check on the close side, appending `close_rejected`.

**Validation (as originally reported for this pass — see §57 for the correction to this figure):** `lib/paper-trading/__tests__/commit.test.ts` grew from 24 to 30 tests. `npx tsc --noEmit` — clean, no errors. `git diff --check` — clean, no whitespace errors. The "154 tests passing across 17 files" paper-trading-scoped figure originally reported here was **wrong** — a manual-addition error, not a real test-count regression. See §57 for the corrected, single-command-verified totals and the explanation of how that error happened.

**The git-index staging anomaly first reported in the fourth pass (§53) was re-checked, not assumed resolved, and remains exactly as it was.** `git status --porcelain=v1`/`git diff --cached --name-only` still show the same 28 files staged; `HEAD` and `origin/feature/manual-paper-trading` are both still `7b41eebfe68f72313741a8486be0b6625e017148`; `git reflog` still shows no commit newer than the original PT-0001 commit. This pass's own edits (`commit.ts`, `service.ts`, `types.ts`, `http.ts`, `fakeRedisClient.ts`, `commit.test.ts`, and this report) appear only as UNSTAGED working-tree changes layered on top of the already-staged fourth-pass content (`git status` shows them as `MM`/`AM`, staged-then-modified) — this session ran no `git add`, `git reset`, `git restore --staged`, `git commit`, or `git push` at any point in this pass either.

## 56. Recommendation (fifth pass)

The fifth review's error-classification defect is fixed: every error leaving `commitPaperMutation()` now carries an explicit, typed `commitOutcome`, reconciliation reads that fail are converted to a distinct `OutcomeUnknownError` rather than propagating as raw, unclassified errors, and `service.ts` was INTENDED to only record a rejected audit event for `CONFIRMED_NOT_COMMITTED` — **but this pass's own service.ts implementation did not actually match that intent for the missing/unrecognized-commitOutcome case; see §57 for the sixth-pass correction.** `tsc --noEmit` was clean and `git diff --check` was clean at the time this pass was submitted (both re-verified clean again in the sixth pass). **The git-index staging anomaly from the fourth pass remains unresolved and unexplained from inside this session** — it was re-verified, not assumed away, and this pass did not touch the index in any way. Recommend the same as the fourth pass: Dean confirm whether the staging was intentional before any further git operation; do not merge into `main` in the meantime; do not mark PT-0001 complete.

## 57. Sixth Pass — Correcting the Unclassified-Error Default, and Reconciling Validation Counts

The Product Owner's sixth review identified one remaining defect in the fifth pass's own fix, plus a discrepancy in that pass's reported validation totals. Both are addressed here.

**The defect.** The fifth pass's `service.ts` catch-block logic was:

```ts
const outcome = e instanceof PaperTradingError ? e.commitOutcome : undefined;
if (outcome === 'OUTCOME_UNKNOWN' || outcome === 'INTEGRITY_FAILURE') {
  throw e; // skip the rejected-event append
}
// falls through to APPENDING entry_rejected/close_rejected otherwise
```

This correctly skipped recording a rejection for the two known non-rejection classes, but everything else — including a **missing** `commitOutcome` (`undefined`) or any **unrecognized** value — fell through to the `append` branch. That means an unclassified error was treated exactly like a proven `CONFIRMED_NOT_COMMITTED` error: recorded as a rejection. This is precisely the category of bug this entire sprint has been correcting, now found one level up — an unclassified error is not evidence the mutation didn't commit, so defaulting to "record a rejection" for it was wrong.

**The fix has two layers, per the Product Owner's explicit "when feasible" instruction:**

1. **`service.ts` (the defensive layer, always active):** a new exported `shouldRecordCommitRejection(commitOutcome)` function is now the single source of truth for this decision: `commitOutcome === 'CONFIRMED_NOT_COMMITTED'` → `true`; every other value (`'OUTCOME_UNKNOWN'`, `'INTEGRITY_FAILURE'`, `undefined`, or anything this codebase doesn't recognize) → `false`. Both `openPaperPosition()`'s and `closePaperPosition()`'s catch blocks now call this function instead of the inverted check above. When it returns `false` for a missing/unrecognized value specifically (i.e., NOT one of the two known non-rejection classes), the anomaly is reported via `console.error` — the same non-throwing "log it, don't record a rejection for it, don't swallow the real error" convention already used by `appendObservationalAuditEvent()` elsewhere in this file — and the original error is rethrown unchanged. No rejected event is ever appended for this case.
2. **`persistence/commit.ts` (a boundary guarantee, upstream of service.ts):** `commitPaperMutation()`'s entire body is now wrapped in a final `try`/`catch` (`ensureClassifiedOutcome()`) that converts ANY error reaching that boundary without an already-set `commitOutcome` into a new `OutcomeUnknownError` — never `CONFIRMED_NOT_COMMITTED` (that would risk exactly the false-rejection bug being fixed) and never `INTEGRITY_FAILURE` (which specifically means signals were successfully read but disagree, not applicable here). This closes the one remaining gap that could otherwise have produced a genuinely unclassified error: `readAccount()`'s very first call at the top of `commitPaperMutation()`, before `build()` is even invoked, previously had no dedicated `try`/`catch` classifying its failure at all. With this fix, an error can no longer leave `commitPaperMutation()` through its real call path without a `commitOutcome` — but `service.ts`'s own defensive handling (layer 1) is retained regardless, as an independent second layer, in case a future change to `commit.ts` (or any other caller) reintroduces an unclassified throw path.

**New tests:**
- A new file, `lib/paper-trading/__tests__/serviceCommitOutcomeClassification.test.ts`, mocks `commitPaperMutation()` directly (rather than driving it through the real, unmocked commit path used by `commit.test.ts`/`service.test.ts`) so that both the "unclassified" and "unrecognized value" cases can be exercised in isolation, independent of whether `commit.ts`'s own boundary fix would ever actually let such an error through in practice. Seven tests: an unclassified error produces no `entry_rejected` event (open) / no `close_rejected` event (close), is reported via `console.error`, and is rethrown unchanged; the same for an unrecognized `commitOutcome` value (`'SOME_FUTURE_OUTCOME_VALUE'`); `OUTCOME_UNKNOWN`/`INTEGRITY_FAILURE` still produce no rejected event and no anomaly log (they are known, expected classifications, not unclassified ones); and two regression tests confirming `CONFIRMED_NOT_COMMITTED` still appends the appropriate rejected event on both the open and close sides.
- A new test in `commit.test.ts` ("boundary guarantee for otherwise-unclassified errors") proves the `commit.ts`-layer fix directly: a failure injected into `commitPaperMutation()`'s very first, pre-`build()` account read is converted to `OutcomeUnknownError` (`commitOutcome === 'OUTCOME_UNKNOWN'`), and produces no `entry_rejected` event when driven through the real `openPaperPosition()` call path.

**Reconciling the validation counts.** The Product Owner asked why the paper-trading-scoped total changed from a previously reported "168 tests / 16 files" to "154 tests / 17 files" despite six tests being added. Having re-examined this pass's own record-keeping rather than trying to reconstruct the fifth pass's arithmetic from memory: **the "154 tests across 17 files" figure in §55 was itself wrong at the time it was written** — not because any test failed or regressed, but because it was assembled by manually adding together SEPARATE sharded `vitest` command outputs (necessary because this sandbox's shell tool enforces a hard ~45-second per-call timeout, so a single `vitest` invocation covering the whole paper-trading scope, let alone the whole repository, cannot always be run in one call) and that manual addition did not actually include `components/paper-trading`'s test files in the final total, despite the sentence claiming it did. This is a bookkeeping error in how separately-run shard totals were combined into one headline sentence, not a change in what actually passed.

To avoid repeating that mistake, this pass ran the paper-trading scope as **one single, authoritative command** rather than reconstructing a total from separate shards:

```
$ npx vitest run lib/paper-trading app/api/paper-trading components/paper-trading
```

Result: **17 test files, 182 tests, 0 failures.** This is the corrected, authoritative paper-trading-scoped figure — it supersedes both the fourth pass's "168/16" and the fifth pass's "154/17."

For the full repository-wide suite, a single `vitest` invocation covering all ~66 non-nested test files was attempted and does not complete inside this sandbox's ~45-second per-call limit even when backgrounded (a backgrounded process does not survive between tool calls in this environment, confirmed by testing it directly this pass). The full suite was therefore run as a set of shard commands that were deliberately checked, directory-by-directory against the exact non-nested test-directory list obtained via `find`, to be **non-overlapping and exhaustive** — unlike the arithmetic that produced the wrong §55 figure, no directory here is counted in more than one shard, and every non-nested test directory is covered by exactly one shard:

| Shard command (each run once) | Files | Tests |
|---|---|---|
| `vitest run lib/paper-trading app/api/paper-trading components/paper-trading` | 17 | 182 |
| `vitest run features/portfolio/briefing features/portfolio/components features/portfolio/dailyBriefing` | 8 | 86 |
| `vitest run components/opportunity-engine features/portfolio/decisionReview features/portfolio/intelligence features/portfolio/priorities features/portfolio/review` | 8 | 95 |
| `vitest run lib/__tests__ lib/autopilot lib/dailyBriefing lib/decision-engine lib/decision-review` | 10 | 177 |
| `vitest run lib/opportunity-engine lib/portfolio-intelligence lib/portfolioHealth lib/portfolioReview` | 18 | 269 |
| `vitest run lib/position-snapshot lib/positionValuation lib/priorityScore lib/todaysPriorities lib/tradeLog` | 5 | 70 |
| **Total** | **66** | **879** |

0 failures in every shard. This excludes the untracked, do-not-touch nested `trade-edge/` directory (per the third pass's standing instruction not to use, modify, or read as a source of truth from that directory).

`npx tsc --noEmit` — clean, no errors, re-run after this pass's edits. `git diff --check` — clean, no whitespace errors, re-run after this pass's edits.

**The git-index staging anomaly was re-checked again this pass and remains exactly as previously reported**: the same 28 files are staged; `HEAD` and `origin/feature/manual-paper-trading` are both still `7b41eebfe68f72313741a8486be0b6625e017148`; `git reflog` shows no new commit. This pass's own edits (`commit.ts`, `service.ts`, `commit.test.ts`, the new `serviceCommitOutcomeClassification.test.ts`, and this report) appear only as unstaged working-tree changes. No `git add`, `git reset`, `git restore --staged`, `git commit`, or `git push` was run.

## 58. Recommendation (sixth pass)

The sixth review's defect is fixed: `service.ts` now records a rejected audit event if and only if `commitOutcome === 'CONFIRMED_NOT_COMMITTED'`; a missing or unrecognized classification defaults to "do not record," is reported via `console.error`, and rethrows the original error conservatively. `persistence/commit.ts`'s own commit-boundary now independently guarantees no error can leave `commitPaperMutation()` without a classification in the first place, converting anything otherwise-unclassified to `OutcomeUnknownError`. Thirteen new tests (7 in a new dedicated file, 1 in `commit.test.ts`, plus the corrected total below reflecting all prior passes' tests) cover both layers directly. The paper-trading-scoped validation total was reconciled: the true, single-command-verified figure is **182 tests across 17 files**, not the "154/17" previously reported (that prior figure was a manual shard-addition bookkeeping error, not a real regression). The full repository-wide suite, run as six verified non-overlapping shards (no single command completes inside this sandbox's per-call time limit), totals **879 tests across 66 files, 0 failures**. `tsc --noEmit` and `git diff --check` are both clean. **The git-index staging anomaly remains unresolved and is, again, exactly as previously reported** — re-verified, not assumed away, and untouched by this pass. Recommend, unchanged from prior passes: Dean confirm whether the staging was intentional before any further git operation; do not merge into `main` in the meantime; do not mark PT-0001 complete.
