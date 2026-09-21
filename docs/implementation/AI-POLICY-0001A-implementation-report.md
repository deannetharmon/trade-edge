# AI-POLICY-0001A — Implementation Report

**Ticket:** [AI-POLICY-0001A](../tickets/AI-POLICY-0001A-gateway-foundation.md)
**Base:** `main` @ 5878135
**Decisions used:** the epic's D1–D15 as accepted 2026-09-19. **D3 (model names, data-controls attestation) and D6 (budget numbers) are still open** — they gate *enabling* a route, not this build. Nothing here enables anything.

## What changed

New library `lib/ai-policy/` (41 files: 22 modules incl. `index.ts`, 17 test files, 2 fixtures). Every file starts with a path comment. Plus `.env.example` documentation (comment-only). **No API route, no UI, and no existing file other than `.env.example` was changed.**

| Module | Responsibility |
|---|---|
| `types.ts`, `lexicon.ts` (`lex-v1-draft`), `canonical.ts`, `config.ts`, `pricing.ts`, `freshness.ts`, `killSwitch.ts`, `artifactCrypto.ts`, `scope.ts`, `redact.ts` | As in the ticket's module table |
| `inputStore.ts`, `artifactStore.ts`, `provenance.ts`, `budget.ts`, `idempotency.ts`, `circuitBreaker.ts`, `providerClient.ts`, `validator.ts`, `routeSpecs.ts`, `gateway.ts`, `index.ts` | As in the ticket's module table |
| `pointer.ts` | **Added** (not in the table): RFC 6901 pointer parsing/matching, shared by the input store (payload allowlist) and the validator |
| `fixtures/fakeRedis.ts`, `fixtures/testRoute.ts` | Test-only in-memory Redis and synthetic route/registry/template/data |

**Deviations from the ticket's module table**
- `gatewayKill.ts` is not a separate file; the gateway calls `checkKillSwitch` directly.
- `AnalysisInput` has one added field, `subjectKey` (route-defined id of what is analysed, e.g. a scan session). It drives the per-subject `current` pointer that makes older artifacts read back as `stale` on refresh. It lives inside the encrypted input; only its hash appears in the `current` Redis key.

**Route specs are inert on purpose.** In `routeSpecs.ts` every route has an EMPTY citable-field registry and `template: null`, so even with a full environment the gateway returns `FLAG_OFF` for every route. Fields, prompt text and the confirmed `requiredSources` / `strictFreshness` / `maxOutputTokens` arrive with 0001B/D/E (the values now present are provisional defaults).

## Sibling and adjacent paths checked

- `lib/jobs/redis.ts` — `getRedis()` reused; no second client added.
- `lib/leaps-analysis/analysisService.ts` (claim/Lua pattern) and `lib/crypto.ts` — read for reference only, **not imported or modified**. `artifactCrypto.ts` is new because `crypto.ts` reads its key at import and has no key id.
- `lib/leaps-analysis/featureFlag.ts` — flag style followed. `lib/ai/models.ts` and `app/api/leaps-analysis/route.ts` (existing OpenAI call shape) — untouched.
- `grep -rn "ai-policy" app/ features/ components/` → **no output** (no consumers).
- Import boundary, both directions, enforced by `importBoundary.test.ts` (55 tests, including scanner self-tests so the check cannot pass vacuously).

## Verification actually run (sandbox clone of `main` + this change)

- `tsc --noEmit -p tsconfig.check.json`: **exit 0, no output.**
- `vitest run lib/ai-policy`: **17 files, 367 tests passed.**
- Full `vitest run` (risky change, so the full suite): **299 files passed; 4160 tests passed, 2 skipped, 1 todo, 0 failed.**
- **Not run:** `next build` (Vercel preview is authoritative). ESLint was not run: the repo has no ESLint config in the sandbox.

### Budget concurrency on a real Redis (ticket AC 6 / spec AC 12)

Run against a **real Redis 7.0.15 server in the sandbox** with the actual `RedisBudgetStore` Lua script via `ioredis`, on 2026-09-21. **This was not a Vercel Preview deployment** (see the open item below).

| Run | Result |
|---|---|
| 25 simultaneous reserves, hourly limit 5 | **5 accepted, 20 `RATE_LIMIT`** |
| After the 5 reservations | hour=5, month=50000, day=50000 µUSD; TTLs 7200 s / 40 d / 3 d |
| After `reconcile()` to actual 4000 each | month=20000, day=20000 (unused reserve released) |
| 25 simultaneous, monthly allowance $0.05, $0.01 each | **5 accepted, 20 `BUDGET`** |
| 24 simultaneous over 2 users, global cap $0.03 | **3 accepted, 21 `BUDGET`**, day counter 30000 |
| Full gateway, stub provider, 25 distinct keys, hourly limit 5 | **5 provider calls, 5 accepted, 20 `RATE_LIMIT`** |
| Full gateway, same idempotency key on all 25 | **1 provider call, 1 artifact**; keys after: hour=1, month=320, day=320 |

## D4 deletion procedure (Alan's sign-off condition)

Stored data and lifetimes: inputs and artifacts **90 days** (encrypted, AES-256-GCM, bound to owner and id); audit records **548 days** (hashes and metadata only: no prompt text, output text or account number); idempotency claims and budget counters expire on their own (≤ 40 days). Everything expires by TTL with no action.

To delete one user's data early (no deletion tool ships in 0001A), run this against the shared Redis with the user's id. User ids cannot contain glob characters (`isSafeUserId`):

```
UID='<user id>'
for P in "ai-policy:input:$UID:*" "ai-policy:artifact:$UID:*" "ai-policy:current:$UID:*" \
         "ai-policy:idem:$UID:*" "ai-policy:budget:hour:$UID:*" "ai-policy:budget:month:$UID:*" \
         "ai-policy:audit:$UID:*"; do
  redis-cli --scan --pattern "$P" | xargs -r -n 100 redis-cli unlink
done
redis-cli unlink "ai-policy:index:$UID"
```

Audit records (`ai-policy:audit:*`) are the 548-day compliance trail. Whether an erasure request removes them, or they are retained as non-personal metadata, is **Alan's call**; drop the `audit` pattern above if they are kept.

## Behavior notes and known limits

- **Pricing** (`pricing.ts`): taken from OpenAI's official pricing page on 2026-09-21, Standard, short context, per 1M tokens input/output: `gpt-5.6-luna` $0.20/$1.20, `gpt-5.6-terra` $2/$12, `gpt-5.6-sol` $4/$20, `gpt-6-astra` $10/$50. The page says GPT-5.6 Sol's *promotional* pricing runs at least through 2026-11-21 and does not say which figures are promotional, so **re-check the Sol price on or after that date**.
- **`gpt-4o-mini` is deliberately not priced.** The epic's suggested economy model is no longer on OpenAI's official pricing page, and a model with no price is unavailable (fail closed). D3 needs an economy model named, not only the reasoning one.
- **Token parameter and temperature per model family** (`providerRequestProfile`): gpt-5.x/gpt-6.x/o-series use `max_completion_tokens` and no `temperature`; older models use `max_tokens` and `temperature: 0`. This follows the ticket and my knowledge of the API; it could not be confirmed with a live call from the sandbox (no route to `api.openai.com`). **The first live call on a preview (0001B) is the confirmation.**
- **Provider stub** (`AI_POLICY_PROVIDER_STUB=true`): allowed only when `VERCEL_ENV` is `preview`/`development`, or, with no `VERCEL_ENV`, when `NODE_ENV` is not `production` (`NODE_ENV` is `production` on Preview builds, so it cannot be the only guard). Tests prove it is inert in production.
- **A failed provider attempt still uses one of the user's hourly slots** (the USD reservation is released, the request count is not). Simple and retry-storm-safe; the circuit breaker limits the exposure. Say if you want the slot returned on provider failure.
- **Concurrent requests for the same subject supersede each other**: an accepted run can read back as `stale` if a newer one for the same subject finished first. That is the intended `current`-pointer behavior.
- **Lexicon false rejections to review (Ian):** `numberWords` includes `one`, `half`, `double`, `triple`; `stateWords` includes `hold`. Ordinary sentences using them are rejected even when otherwise valid (a validator fixture caught `one` while I was writing an unrelated case). Rejections are safe, but each costs an explanation, so the seed list should be trimmed by Ian before the fixtures freeze.
- **Unexpected internal errors** return `unavailable(PROVIDER_ERROR)` (there is no generic reason code). The idempotency claim and any half-open probe are released; a held budget reservation is kept because the spend is unknown.

## Open items

1. **Preview verification of the budget Lua script is not done.** The verification doc calls for a Vercel Preview run, but 0001A ships no route to send requests to, so it cannot be done without a temporary preview-only endpoint (outside this ticket's scope). The real-Redis run above proves the script's logic. Quinn/Dean: accept that for 0001A and run the doc's procedure on the first route in 0001B, or ask for a throwaway endpoint.
2. D3 (economy and reasoning model names, data-controls attestation) and D6 (budget numbers) — needed only to enable a route.
3. Ian: finalise the lexicon (above), then Quinn freezes the validator fixtures.
