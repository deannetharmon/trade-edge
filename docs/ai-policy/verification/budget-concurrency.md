# Budget Concurrency Verification (AI-POLICY-0001A, spec AC 12)

**Purpose:** show that concurrent requests cannot overspend a route/user/global allowance against the **real Redis Lua implementation**. Unit tests only cover the in-memory store, because the shared fake Redis client does not execute Lua.

**Where:** a Vercel Preview deployment with Redis, using a test user and a stubbed provider (`AI_POLICY_PROVIDER_STUB=true` is **not** allowed in Production; Dane adds the stub as a test-only branch inside `providerClient` guarded by `NODE_ENV !== 'production'` **and** `VERCEL_ENV !== 'production'`).

## Procedure

1. Set a tiny allowance: `AI_POLICY_<ROUTE>_HOURLY_LIMIT=5`, `AI_POLICY_USER_MONTHLY_BUDGET_USD=0.05`, a per-call worst-case estimate of `0.01` USD (so at most 5 reservations fit).
2. Fire 25 simultaneous requests (distinct idempotency keys) from one signed-in user, e.g. with `xargs -P 25`.
3. Expect exactly 5 accepted (200) and 20 unavailable with reason `RATE_LIMIT` or `BUDGET` — never more than 5.
4. After completion, read the budget keys: reserved-but-unused amounts must be released (spent = sum of actual usage).
5. Repeat with two users sharing a small `AI_POLICY_GLOBAL_DAILY_BUDGET_USD` to prove the global cap.
6. Repeat the first run with the same idempotency key on all 25 requests: expect exactly one provider call and one cost.

## Record in the implementation report

Date, preview URL, the three outcomes above (counts), and the Redis key values after each run.
