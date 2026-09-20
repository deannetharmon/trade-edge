# AI-POLICY-0001A — AI Policy Gateway Foundation

**Status:** Approved to start — decisions accepted by Dean 2026-09-19. D3 and D6 gate *enabling* a route, not this build.
**Epic:** [AI-POLICY-0001](./AI-POLICY-0001-epic.md) · **ADR:** [ADR-0005](../decisions/ADR-0005-ai-analysis-input-trust-classes.md)
**Delivers spec ACs:** 1 (boundary), 2, 3, 5, 6, 10, 11, 12 (budgets) — foundation only

## Problem

Every AI route in the spec needs the same guarantees (flags, governance, budgets, immutable inputs, output validation, provenance, fallback). Today each AI route re-implements a subset (`leaps-analysis`, `advisor`, `leaps-advisor`). Building them again per route would violate GOV-0004 ("every rule has one home").

## User value

None visible. This phase makes every later AI surface safe by construction and testable in isolation.

## Scope

A pure server-side library `lib/ai-policy/`. **No API routes, no UI, no change to any existing file** except adding `.env.example` documentation.

### Module layout (every file's first line is a path comment)

| File | Responsibility |
|---|---|
| `types.ts` | Route ids, tiers, trust class, source kinds, snapshot/input, output, citation, artifact, reason-code types |
| `config.ts` | Resolves global/per-route flags, tier→model, allowlist, governance attestation, budgets, freshness table. **Fail closed** on any missing/invalid value |
| `killSwitch.ts` | Reads Redis overrides `ai-policy:kill:global`, `ai-policy:kill:route:<route>`; Redis wins over env; Redis error ⇒ treat as **off** (unavailable) |
| `canonical.ts` | Canonical JSON (keys sorted by **code point**, not `localeCompare`; rejects `NaN`, `Infinity`, `undefined`, functions) + SHA-256 |
| `artifactCrypto.ts` | AES-256-GCM envelope `{kid, iv, tag, data}`; `kid` = first 8 hex of SHA-256(key); keys from `AI_POLICY_ARTIFACT_KEY` / `_PREVIOUS`, resolved **lazily**; fail closed if unset |
| `scope.ts` | `accountScopeId(userId, accountNumber)` = truncated HMAC-SHA256 with `AI_POLICY_SCOPE_SECRET`; account numbers never leave this function |
| `redact.ts` | Bounds (≤ 500 chars) and redacts user chat text before dispatch |
| `inputStore.ts` | Immutable analysis-input store (`SET … NX`, encrypted, 90-day TTL), user-scoped keys, opaque UUID ids |
| `artifactStore.ts` | Encrypted artifact store, per-user index, `current` pointer per subject, stale marking on read, 90-day TTL |
| `provenance.ts` | Builds/persists audit records (metadata + hashes only; 548-day TTL) |
| `freshness.ts` | Source-specific as-of/max-age evaluation |
| `budget.ts` | `BudgetStore` interface + `RedisBudgetStore` (single Lua script: check + reserve) + `InMemoryBudgetStore` (tests); `reconcile()` |
| `idempotency.ts` | Idempotency claim (`^[A-Za-z0-9_-]{16,100}$`), returns cached artifact id without spending budget |
| `circuitBreaker.ts` | Redis-backed: ≥ 5 failures in 60 s ⇒ open 120 s; one half-open probe via `SET NX` |
| `pricing.ts` | Per-model USD price table and worst-case cost estimator. Unknown model ⇒ unavailable. **Dane fills prices from the provider's pricing page at build time and cites the date** |
| `providerClient.ts` | The only outbound provider call. Builds the request, asserts **no tools**, enforces timeout (45 s `AbortController`), returns text + usage |
| `lexicon.ts` | Versioned prohibited-language lexicon (Ian owns) |
| `validator.ts` | Default-reject output validation and citation verification; renders `{{c:N}}` placeholders |
| `routeSpecs.ts` | Registry of the five routes: tier, template id/version, output schema, citable-field registry, required sources, flag names |
| `gateway.ts` | `runAiRoute()` orchestrator (order below) |
| `index.ts` | Public exports only |
| `fixtures/` | Synthetic snapshot fixtures used by tests (no real account data) |

### Contracts (summary; Dane writes the full types)

- `SourceKind = 'quoteGreeks' | 'brokerPositionCapacity' | 'earningsCalendar' | 'scanCalculation'`.
- `AnalysisInput { id, userId, accountScope, route, trust ('server_verified' | 'client_attested'), schemaVersion, payload, payloadHash, sourceAsOf: Record<SourceKind, string | null>, createdAt, expiresAt }`. Immutable once stored.
- **Citable-field registry (per route, static, versioned):** map of RFC 6901 JSON Pointer patterns (e.g., `/candidates/*/delta`) → `{ label, source: SourceKind, format: 'usd' | 'pct' | 'number' | 'integer' | 'date' | 'text' | 'boolean' }`. `label` is the human label shown to users (Diane owns the wording). The payload may only contain registry fields plus structural keys.
- **Model output (strict JSON schema, exact keys, no extras):**
  `summary: string` · `observations: Claim[]` · `tradeoffs: Claim[]` · `missingOrStaleData: Claim[]` · `questionsForTrader: { text }[]` · `limitations: { text }[]` · `citations: { id: number, pointer: string }[]`
  where `Claim = { text: string, citationIds: number[] }`. Values appear in `text` **only** as `{{c:N}}` placeholders.
- **Rendered artifact:** placeholders replaced server-side with the canonical value formatted per `format`; each citation exposes `{ label, displayValue, sourceLabel, asOf }` to the client. Raw pointers and hashes stay in provenance only.
- **Artifact status:** `ready | unavailable | rejected | stale` (`stale` is computed at read time from the `current` pointer).
- **Reason codes:** `FLAG_OFF, KILL_SWITCH, GOVERNANCE, BUDGET, RATE_LIMIT, CIRCUIT_OPEN, INPUT_MISSING, INPUT_STALE, INPUT_INVALID, TIMEOUT, PROVIDER_ERROR, VALIDATION_REJECTED, NOT_FOUND`.

### Gateway order (`runAiRoute`) — every stage failure returns a neutral `unavailable`/`rejected` result; the function never throws to the route

1. Flags (global + route) then Redis kill switches.
2. Governance: `AI_POLICY_PROVIDER_GOVERNANCE_ATTESTED === 'true'`, policy version present, model in allowlist and priced.
3. Load input by opaque id **scoped to the acting user** (`NOT_FOUND` for missing *or* foreign — identical result).
4. Freshness of every source required by the route (deep routes: any missing/stale source ⇒ `INPUT_STALE`; summary/chat: proceed, and the server itself appends a mandatory `missingOrStaleData` disclosure for each omitted/stale source regardless of model output).
5. Idempotency claim (cached ⇒ return stored artifact, no spend).
6. Circuit breaker.
7. Budget reserve (atomic; user-route hourly, user monthly USD, global daily USD).
8. Provider call (no tools, strict JSON schema, timeout).
9. Validate → render. Reject ⇒ store `rejected` artifact + provenance, return neutral state.
10. Persist artifact + provenance; reconcile budget with actual usage (release the difference); update circuit breaker; update `current` pointer (older artifact for the subject becomes `stale`).

### Validator rules (default reject; first failure wins; reason recorded)

1. Exactly the allowed keys/types/size bounds; no extra keys.
2. Every `observations`/`tradeoffs` item and the `summary` has ≥ 1 citation (`{{c:N}}` present and `N ∈ citationIds`).
3. Every `citation.pointer` matches a registry pattern for this route **and resolves** to a primitive value in the payload; value and `payloadHash` are recorded.
4. Cited source freshness re-checked at validation time.
5. After removing placeholders, **no digit** and no number-word/percent/currency term (see lexicon `numberWords`) in any text field.
6. Lexicon categories below (NFKC-normalized, case-insensitive, word-boundary).
7. No URLs, markdown links, code fences, or HTML/script tags.
8. Any string that is not a placeholder-bearing claim cannot assert a state (`Hold`, `Monitor`, `Not ready`, `eligible`, `qualified`); state words may only appear via a cited field.

### Lexicon seed (`lex-v1-draft`; Ian to amend before build)

- `recommendation`: recommend, suggest you, you should, you could consider, consider (buy|sell|open|close|roll|entering), worth (taking|entering), attractive, favorable, good entry, great setup, safe, safest, low-risk trade, no-brainer
- `orderCommand`: place (an )?order, submit, sell to open, buy to open, sell to close, buy to close, limit order, market order, stop order, gtc, send the order, execute
- `rankingComparison`: best, top pick, ranks?, ranked, better than, worse than, outperforms?, preferred, prefer, winner, first choice
- `stateOverride`: override, ignore the (warning|flag), mark (it )?as (ready|eligible), treat (it )?as (ready|eligible), despite being (ineligible|not ready), loosen, widen your filters?, relax the, raise your (delta|dte), lower your (delta|dte), change your (filter|criteria)
- `prediction` (Ian, 2026-09-19): likely to, should expect, will (expire|be assigned|hit|reach|rise|fall), high probability, sweet spot, cheap, rich
- `derivedMath`: works out to, calculates to, adds up to, net of, minus, plus, times, multiplied by, divided by, approximately equals, roughly equals
- `numberWords`: zero…twenty, thirty…ninety, hundred, thousand, million, percent, per cent, dollars?, bucks, half, double, triple, x%

## Non-goals

No routes, UI, snapshot builders, or prompt templates for real routes (route specs contain schema/registry/template ids; template text is added by each route phase). No changes to `lib/crypto.ts`, `lib/leaps-analysis/*`, `lib/ai/models.ts`, or any existing route.

## Acceptance criteria

1. With no env set, every route resolves to `unavailable(FLAG_OFF)` and `providerClient` makes **zero** network calls.
2. **Import-boundary tests pass in both directions:** (a) files in `lib/ai-policy/` other than `builders/` import nothing from `lib/scans`, `lib/screener`, `lib/order-lifecycle`, `lib/portfolio-snapshot`, `lib/tastytrade`, `lib/leaps-analysis/serverTradeReview`, `lib/autopilot`, `lib/paper-trading`; (b) no file in `lib/scans`, `lib/portfolio-snapshot`, `lib/order-lifecycle`, `lib/decision-engine`, `lib/autopilot`, `lib/screener`, `lib/portfolio`, `lib/paper-trading` imports `@/lib/ai-policy`. (`builders/` is added in 0001B+ and may import read-only resolvers only; the test rejects any import whose name matches `submit|order|place|cancel|write|save`.)
3. `providerClient` request builder throws if the body contains any of `tools, functions, tool_choice, function_call, web_search, plugins, mcp`; requires strict `json_schema` response format.
4. Canonical hash: key order independence, code-point ordering, golden hash vectors, and rejection of non-finite numbers/`undefined`.
5. Input store: `NX` immutability (second write to same id fails), foreign-user read returns the same `NOT_FOUND` as a missing id, ciphertext round-trip, wrong key fails, `_PREVIOUS` key decrypts old data.
6. Budget: `BudgetStore` contract tests (run against `InMemoryBudgetStore`): N concurrent `reserve()` calls never exceed any configured limit; `reconcile()` releases unused reserve; hourly window expiry. The Redis Lua implementation is verified per [budget-concurrency verification](../ai-policy/verification/budget-concurrency.md) on a preview deployment and the result is recorded in the implementation report.
7. Circuit breaker opens at threshold, returns `CIRCUIT_OPEN`, admits exactly one probe when half-open.
8. Validator fixture table covers **every** prohibited category with ≥ 3 rejecting fixtures and ≥ 3 benign fixtures that must pass: invented digit; number word/percent/currency; derived-math phrasing; ranking/comparison; recommendation; order command; state/filter override; ineligible ranking; uncited claim; pointer not in registry; pointer resolving to non-primitive; extra keys/malformed JSON; URL/markup; state-word without citation; stale cited source.
9. Placeholder rendering: substituted values equal the canonical payload values formatted per registry `format`; a mismatched or unknown `{{c:N}}` rejects.
10. Gateway: stage-failure matrix (one test per stage) proves the provider is called only after stages 1–7 pass, no stage throws, and a rejected/failed run leaves the input unchanged.
11. Provenance record contains every field in the spec's Provenance section (including `trustClass`, per-claim pointer + value hash + source + as-of) and **no** prompt/output text or account number; audit read requires the owning user.
12. Redaction: account-number-shaped strings, emails, bearer/JWT tokens, and ≥ 32-char hex/base64 runs are removed; length bound enforced.
13. Existing suite unchanged and green with `lib/ai-policy` present.

## Implementation notes

- Verify against the repo before writing: `lib/jobs/redis.ts` (`getRedis()` — reuse the shared client, do not add another), `lib/leaps-analysis/analysisService.ts` (`claimAnalysis` Lua pattern and `LEAPS_ANALYSIS_TTL_SECONDS` as reference; **do not import or modify it**), `lib/crypto.ts` (reference only; `artifactCrypto.ts` is new because `crypto.ts` reads its key at import and has no key id), `lib/leaps-analysis/featureFlag.ts` (flag-reading style).
- Hand-written validators (no new dependency). Any new dependency needs Alan's approval.
- `providerClient` must pick the correct token-limit parameter and temperature handling per model family (older chat models use `max_tokens`; newer reasoning models may require `max_completion_tokens` and reject `temperature`). Dane verifies against the provider's current API reference and records the mapping in `config.ts`.
- Redis keys (all prefixed `ai-policy:`): `input:{userId}:{id}`, `artifact:{userId}:{id}`, `index:{userId}`, `current:{userId}:{route}:{subjectHash}`, `audit:{userId}:{artifactId}`, `idem:{userId}:{fp}`, `budget:*`, `cb:{tier}`, `kill:*`.
- Test-only provider stub: `providerClient` may return canned output when `AI_POLICY_PROVIDER_STUB=true`, but only if `NODE_ENV !== 'production'` **and** `VERCEL_ENV !== 'production'` (used by the budget-concurrency verification and preview tests; a unit test proves it is inert in production).
- Redis errors on any *gate* (kill switch, budget, breaker, idempotency) fail **closed** (unavailable), never open.
- Test files live in `lib/ai-policy/__tests__/` (matches Vitest glob): `config`, `killSwitch`, `canonical`, `artifactCrypto`, `scope`, `redact`, `inputStore`, `artifactStore`, `provenance`, `freshness`, `budget`, `idempotency`, `circuitBreaker`, `providerClient`, `validator`, `gateway`, `importBoundary`.

## Validation steps

1. `tsc --noEmit` (tsconfig.check.json) and **full** `npm test`; quote counts in the report.
2. Vercel preview build (no runtime behavior expected; confirms `lib/ai-policy` compiles in the Next bundle).
3. Budget concurrency check per the verification doc (needs Redis on the preview).
4. Confirm `grep -rn "ai-policy" app/ features/ components/` returns nothing (no consumers yet).

## Rollout notes

Nothing is reachable: no routes or UI import the library. Merge is behavior-neutral. Dean adds the new env vars in Vercel only when 0001B is about to be enabled in Preview.

## Sign-off conditions (accepted by Dean 2026-09-19)

- Alan: the D4 deletion procedure is documented in the implementation report; provider timeout (45 s) stays below `maxDuration` (60 s).
- Quinn: validator fixtures freeze only after the lexicon is final; the budget Lua check is run on a Vercel preview and recorded.
- Ian: lexicon seed plus the `prediction` category above.
- Still open, needed only to enable a route: D3 (reasoning-tier model name, OpenAI data-controls attestation) and D6 (budget numbers).
