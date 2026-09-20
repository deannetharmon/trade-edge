# AI-POLICY-0001B — Snapshot Freeze, `scan_summary`, `grounded_chat`

**Status:** Draft — depends on 0001A merged and ADR-0005 accepted
**Epic:** [AI-POLICY-0001](./AI-POLICY-0001-epic.md) · **Delivers spec ACs:** 2, 3, 5, 6 (route-level), 1 (regression)

## Problem

Traders can't get a plain-language explanation of a completed scan that is provably grounded in that scan's own results. The scan session lives only in the browser (`ScreenerScanSession`, IndexedDB `screenerActiveSession_v1`), so it must be frozen server-side before any model sees it.

## User value

"Summarize this scan" and "why was X excluded / what does this reason code mean" answered from the actual completed results, with citations, without touching scan results or eligibility.

## Scope

1. **Freeze endpoint** `POST /api/ai-policy/snapshots` — body `{ kind: 'scan_session', session, idempotencyKey }`.
   - Requires a session (`getServerSession(authOptions)`; **not** `resolveAutopilotUserId`).
   - Rejects unless `validateSessionData` passes **and** `status === 'complete'` (`error`/`stopped`/in-progress ⇒ 422 `INPUT_INVALID`).
   - `lib/ai-policy/builders/attested/scanSession.ts` builds a **bounded allowlisted** payload: strategy, mode, filters used, per-symbol terminal outcomes with reason codes, counts, and up to N candidate rows (N set in the route spec; proposed 25) restricted to registry fields. Drops everything else, including free-form text and identifiers not in the registry.
   - Re-derives DTE from expiration vs. scan date using the existing pure helper, and rejects on mismatch (ADR-0005).
   - Stores immutably (0001A `inputStore`) with `trust: 'client_attested'`; returns `{ analysisInputId, payloadHash, createdAt }` (opaque id; hash returned only for display in the panel's reference line).
2. **`POST /api/ai-policy/scan-summary`** — `{ analysisInputId, idempotencyKey }` → runs the `scan_summary` route (economy tier).
3. **`POST /api/ai-policy/grounded-chat`** — `{ analysisInputId, idempotencyKey, message, priorArtifactIds? }` (economy tier).
   - `message` is redacted and bounded (`redact.ts`).
   - **No client-supplied assistant text.** Conversation continuity uses `priorArtifactIds`, which the server loads (same user, same input) and passes as validated prior outputs. Unknown/foreign ids ⇒ `NOT_FOUND`.
4. **`GET /api/ai-policy/artifacts/[id]`** — returns the rendered artifact (`status` computed, `stale` if not the `current` pointer). Same 404 for missing/foreign.
5. Each route exports `maxDuration = 60`, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`. Routes contain no policy logic — they parse, authenticate, call `runAiRoute`, and serialize.
6. Route specs (in `routeSpecs.ts`) gain: prompt template id/version, citable-field registry for the scan payload, required sources (`scanCalculation`), summary/chat disclosure text, output bounds.
7. System prompt rules (template text lives with the route spec): explain only from the payload; use `{{c:N}}` for every value; never state numbers; do not recommend, rank, compare, or instruct; describe reason codes in plain language; list uncertainty under `limitations`.

## Non-goals

No UI (0001C). No deep analysis. No changes to scanning, `scanSession.ts`, or the screener page. No server-side persistence of scan sessions (future ticket per ADR-0005).

## Acceptance criteria

1. Freeze rejects incomplete/error/stopped sessions, invalid sessions, oversize payloads, and DTE-mismatched candidates; accepted payloads contain **only** registry fields (asserted by a deep-key test).
2. Two users: user B requesting user A's `analysisInputId` or `artifactId` gets the identical `NOT_FOUND` as a random id.
3. Frozen input is immutable; the freeze function does not mutate its argument (deep-freeze the input in tests).
4. `grounded_chat` ignores/blocks any client-supplied assistant messages and any attempt to widen scope (prompt-injection fixtures: "ignore instructions", "call the order API", "use another user's snapshot") — outputs stay within schema or are rejected; the provider request never contains tools.
5. Stale/omitted sources: the artifact's `missingOrStaleData` contains the server-appended disclosures even when the model returns none.
6. Regression: with all AI flags on vs off, a fixture scan session's counts, dispositions, ranking order, and readiness fields are byte-identical after freeze + summary + chat (freeze/summary/chat cannot reach deterministic state).
7. All route failures return the same neutral `unavailable`/`rejected` body (no stack, no provider error text) and HTTP status per the reason code table in 0001A.
8. Idempotency: repeating a request with the same key returns the same artifact and one provider call.

## Implementation notes

- Verify exact contents of `lib/screener/scanSession.ts` (`ScreenerScanSession`, `validateSessionData`) and `lib/screener/scanSessionCache.ts` (client key name; **server never reads IndexedDB**) before writing the builder. Import only pure functions/types.
- Builders live in `lib/ai-policy/builders/attested/`; the 0001A boundary test allows read-only imports there and rejects `submit|order|place|cancel|write|save` names.
- Tests: `lib/ai-policy/__tests__/builders/scanSession.test.ts`, `app/api/ai-policy/__tests__/{snapshots,scanSummary,groundedChat,artifacts}.test.ts` (route-level auth + IDOR + fallback), following `app/api/paper-trading/__tests__/security.test.ts`. Provider stubbed at the `providerClient` boundary.
- Sibling paths to state: `app/api/leaps-analysis`, `advisor`, `leaps-advisor` (untouched); other consumers of `ScreenerScanSession`.

## Validation steps

`tsc --noEmit`, full `npm test`, Vercel preview build; on preview with flags on for the test user: freeze → summary → chat → GET; then flags off ⇒ all routes `unavailable(FLAG_OFF)` and the Screener behaves as before.

## Rollout notes

Ships dark: `AI_POLICY_ENABLED`, `AI_POLICY_SCAN_SUMMARY_ENABLED`, `AI_POLICY_GROUNDED_CHAT_ENABLED` all default off. Enabling in Production additionally requires an approved launch gate from 0001F for each route.
