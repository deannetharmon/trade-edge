# AI-SEC-0001 — Authenticate Legacy AI Routes and Retire the Public-Named Key

**Status:** Approved — D11 = require login (Dean, 2026-09-19). Implemented; see the [implementation report](../implementation/AI-SEC-0001-implementation-report.md).
**Related:** [SEC-0001](./SEC-0001-tracked-env-file-and-api-auth-triage.md) (do S1 there first)

## Problem

`app/api/ai/route.ts`, `app/api/ocr/route.ts`, and `app/api/analyze/route.ts` call OpenAI with the deployment's key and have **no session check**. `middleware.ts` matches page routes only, so `/api/*` is open to anyone who can reach the deployment.

- `/api/ai` forwards the caller's raw body (caller picks model and prompt). It has **no callers** in the repo.
- `/api/ocr` is called from `app/screener/page.tsx` (~line 651). It reads only `NEXT_PUBLIC_OPENAI_API_KEY` and, if unset, sends `Bearer ` with an empty key.
- `/api/analyze` has 18 call sites across `portfolio`, `screener`, `engine`, `trade-log`, `rinse-repeat`, `performance`, `wheel-simulator`. It reads `OPENAI_API_KEY ?? NEXT_PUBLIC_OPENAI_API_KEY`.
- The three references to `NEXT_PUBLIC_OPENAI_API_KEY` are all in server route handlers (no client reference found today), but the `NEXT_PUBLIC_` name means any future client import would embed the key in the browser bundle.
- `wheel-simulator` (a caller of `/api/analyze`) is **not** in the middleware matcher, so requiring a session on `/api/analyze` changes that page's behavior for logged-out users.

## User value

Only the signed-in trader can spend the OpenAI key; the key name no longer invites client exposure.

## Scope

1. New `lib/ai/requireSession.ts` exporting `requireSessionUserId(): Promise<string | null>` using `getServerSession(authOptions)` (same pattern as `/api/advisor`). No debug-bypass header.
2. `/api/analyze` and `/api/ocr`: return `401 { error: 'Unauthorized' }` **before** reading the body or touching any key/fetch when there is no session.
3. Key handling: read **only** `OPENAI_API_KEY`. Remove every `NEXT_PUBLIC_OPENAI_API_KEY` fallback. Missing key → `500 { error: 'OpenAI API key not configured' }` (for `/api/ocr` this also removes the empty-`Bearer` call).
4. `/api/ocr` input hardening: `mediaType` must be one of `image/png`, `image/jpeg`, `image/webp`, `image/gif` (else 400).
5. `/api/ai`: delete `app/api/ai/route.ts` **if** Paul confirms it is unused (no callers were found). If Paul wants it kept, require a session and fix the model to the `getAiModel('chat')` result; do not forward raw client bodies.
6. `middleware.ts`: add `'/wheel-simulator/:path*'` to the matcher (D11). If Paul declines D11, `/api/analyze` must still require a session and the wheel-simulator AI call must handle the 401 gracefully — Paul chooses, Dane does not.
7. `.env.example`: document `OPENAI_API_KEY` (server-only); no `NEXT_PUBLIC_OPENAI_*` entry.

## Non-goals

- No change to `/api/analyze` request/response shapes, model/profile selection, or web-search behavior.
- No gateway, provenance, or budget work (AI-POLICY-0001A onward).
- No change to `/api/advisor`, `/api/leaps-advisor`, `/api/leaps-analysis` (already authenticated and flag-gated).
- No credential rotation performed by code (Dean decides; see Rollout).

## Acceptance criteria

1. Unauthenticated `POST /api/analyze` and `POST /api/ocr` return 401 and **never call `fetch`** (spy asserts zero calls; request body is not read).
2. Authenticated calls behave as before: same upstream URL, same `Authorization: Bearer <OPENAI_API_KEY>`, same model selection, same response shape.
3. With only `NEXT_PUBLIC_OPENAI_API_KEY` set (no `OPENAI_API_KEY`), both routes return 500 and make no upstream call.
4. `/api/ocr` rejects a non-image `mediaType` with 400 before any upstream call.
5. `app/api/ai/route.ts` is deleted (or, if kept, authenticated and body-restricted per scope item 5) and no `NEXT_PUBLIC_OPENAI` string remains in `app/`, `lib/`, `components/`, `features/`.
6. Wheel simulator behavior matches Paul's D11 decision; no page that calls `/api/analyze` is left silently broken.

## Implementation notes

- Files: `lib/ai/requireSession.ts` (new), `app/api/analyze/route.ts`, `app/api/ocr/route.ts`, `app/api/ai/route.ts` (delete), `middleware.ts`, `.env.example`.
- Tests (must live where Vitest globs run): `app/api/analyze/__tests__/auth.test.ts`, `app/api/ocr/__tests__/auth.test.ts`. Follow `app/api/paper-trading/__tests__/security.test.ts`: `vi.mock('next-auth')` for `getServerSession`, `vi.mock('@/lib/auth')`, stub `global.fetch` with `vi.fn()`.
- Verify exact current contents of `app/api/analyze/route.ts` (213 lines) and `app/api/ocr/route.ts` before patching; change only the auth and key-read lines.
- Sibling paths checked and to be restated in the report: the other 14 unauthenticated-looking routes are tracked in SEC-0001, not changed here; `/api/advisor` and `/api/leaps-advisor` already call `getServerSession`; all `fetch('/api/analyze' | '/api/ocr' | '/api/ai')` callers.
- Follow-up (not this ticket): `/api/analyze` still lets the client choose `model`/`profile`; migrate to the gateway under AI-POLICY-0002.

## Validation steps

1. `tsc --noEmit` with `tsconfig.check.json`; full `npm test`.
2. Vercel preview build.
3. Manual on the preview: signed-out `curl -i -X POST <preview>/api/analyze` → 401; signed-in AI features on Portfolio and Screener (including OCR upload) still work.

## Rollout notes

1. **Before merging:** Dean confirms `OPENAI_API_KEY` is set in Vercel for **Production and Preview** (this ticket removes the `NEXT_PUBLIC_` fallback; `/api/ocr` has no other key source today). **Confirmed by Dean 2026-09-19.**
2. Merge; verify on preview, then production.
3. After the merge, Dean removes `NEXT_PUBLIC_OPENAI_API_KEY` from Vercel. Whether to rotate the OpenAI key is Dean's decision: check the OpenAI usage dashboard for unexplained spend; rotate if any is found or if you cannot rule out exposure.
