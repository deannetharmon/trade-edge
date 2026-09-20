# AI-POLICY-0001 — Deterministic-First AI Analysis (Epic)

**Status:** Draft — pending team sign-off (see [Sign-offs](#sign-offs))
**Requirements source:** [AI-POLICY-0001 specification](../specifications/AI-POLICY-0001-Deterministic-First-AI-Analysis.md) (authoritative)
**Architecture decision:** [ADR-0005 Trust classes for AI analysis inputs](../decisions/ADR-0005-ai-analysis-input-trust-classes.md)
**Verified against:** `main` @ 02b8276c

## Outcome

Traders can opt in to AI explanations of completed scans, one LEAPS candidate, and one held PMCC structure. TradeEdge code stays the only authority for facts, eligibility, ranking, readiness, and orders. AI failure, absence, or rejection never degrades the deterministic experience.

## Why this is an epic

The specification has 13 acceptance criteria across five routes, a UI, a governance model, and a rollout gate. It is delivered as two security tickets plus seven phase tickets. Each phase ships dark behind flags, has its own Definition of Done, and produces its own implementation report.

| Ticket | Title | Depends on |
|---|---|---|
| [SEC-0001](./SEC-0001-tracked-env-file-and-api-auth-triage.md) | **Urgent:** tracked `.env.local` credentials; API auth triage | Dean, today (step S1 needs no code) |
| [AI-SEC-0001](./AI-SEC-0001-legacy-ai-route-authentication.md) | Authenticate legacy AI routes, retire public-named key | Paul approval (D11) — independent of the rest |
| [AI-POLICY-0001A](./AI-POLICY-0001A-gateway-foundation.md) | AI policy gateway foundation (`lib/ai-policy`) — no routes, no UI | ADR-0005 accepted; D3–D9 decided |
| [AI-POLICY-0001B](./AI-POLICY-0001B-scan-summary-and-grounded-chat.md) | Snapshot freeze, `scan_summary`, `grounded_chat` routes | 0001A |
| [AI-POLICY-0001C](./AI-POLICY-0001C-ai-panel-ui.md) | AI panel UI, lifecycle states, accessible citations | 0001B; Diane's approved mocks |
| [AI-POLICY-0001D](./AI-POLICY-0001D-leaps-deep-analysis.md) | `leaps_deep_analysis` route | 0001A; Ian's LEAPS field list |
| [AI-POLICY-0001E](./AI-POLICY-0001E-pmcc-deep-analysis.md) | `pmcc_deep_analysis` route | 0001D; ADR-0005 |
| [AI-POLICY-0001F](./AI-POLICY-0001F-evaluation-and-launch-gates.md) | Evaluation fixtures, harness, launch-gate registry | 0001A (parallel to B–E); **blocks enabling any route** |
| [AI-POLICY-0001G](./AI-POLICY-0001G-retrospective-batch.md) | `retrospective_batch` | **Deferred** — Paul (D10) |

Execution order: `SEC-0001` first · `AI-SEC-0001` next · `0001A → 0001B → 0001C` · `0001D → 0001E` · `0001F` in parallel · `0001G` deferred.
Rollout order (spec): summaries → grounded chat → LEAPS deep → PMCC deep, each independently.

## Current-state findings (verified in code)

1. **`/api/ai`, `/api/ocr`, `/api/analyze` have no session check.** `middleware.ts` protects page routes only, not `/api/*`. Anyone who can reach the deployment can spend the OpenAI key. `/api/ai` forwards the caller's raw body (caller chooses model and prompt) and has **no callers** in the app. All three read `NEXT_PUBLIC_OPENAI_API_KEY` in server route handlers only (no client-bundle reference found). → AI-SEC-0001.
2. **`/api/analyze`** has 18 call sites across 7 pages (`portfolio`, `screener`, `engine`, `trade-log`, `rinse-repeat`, `performance`, `wheel-simulator`) and lets the client pick the model/profile. Migration is out of this epic (see D2).
3. **`/api/advisor` and `/api/leaps-advisor`** are authenticated and flag-gated, but return `recommendation` arrays. That conflicts with the spec's non-goals. Disposition is Paul's call (D2).
4. **`/api/leaps-analysis`** is the closest existing implementation: server-resolved broker evidence, immutable snapshot, SHA-256 request fingerprint, atomic idempotency + hourly limit (Lua), 90-day TTL, strict JSON-schema output. It lacks citations with hashes, budget reservation, kill switches, provider-governance check, and no-tools enforcement. **This epic does not modify it.** 0001D builds a new route that reuses its evidence resolvers.
5. **Server-side broker read access exists** (`lib/tastytrade/server-token.ts`, `lib/leaps-analysis/serverTradeReview.ts`: `resolveLeapsContractEvidence`, `fetchHeldPmccPositionSnapshot`, `validatedAccount`). Deep-analysis routes can therefore be **server-verified**. Scan sessions, however, are computed in the browser (IndexedDB key `screenerActiveSession_v1`), so `scan_summary` / `grounded_chat` inputs are **client-attested**. See ADR-0005.
6. `lib/crypto.ts` is AES-256-GCM with the key read at import and no key id. It is not modified; 0001A adds a versioned wrapper.
7. `resolveAutopilotUserId` (`lib/autopilot/server/auth.ts`) honors a debug auth-bypass header. **AI routes must not use it.**
8. `export const maxDuration = 60` is already used in `app/api/jobs/start/route.ts`, so 60 s function duration is available for synchronous deep analysis.
9. Vitest globs cover `lib/**/__tests__`, `app/**/__tests__`, `features/**/__tests__`, `components/**/__tests__`. New tests must live under those paths or they silently never run.

10. **`.env.local` is tracked in git** with non-placeholder TastyTrade credential entries, and the repository is cloneable without credentials. Independent of this epic and more urgent → SEC-0001.

## Architecture at a glance

- **One gateway:** `lib/ai-policy/` owns flags, kill switches, model allowlist, provider governance, budgets, circuit breaker, immutable inputs, provenance, output validation. Routes are thin (GOV-0004: every rule has one home).
- **Dependency direction:** `app → features → lib` (ADR-0004). Deterministic modules never import `lib/ai-policy` (enforced by test).
- **Builders** (`lib/ai-policy/builders/`) turn deterministic data into a bounded snapshot. Builders may call existing **read-only** resolvers; they may never import order, submit, or write functions (enforced by test).
- **Model output never carries numbers.** The model writes prose with `{{c:N}}` placeholders; the server substitutes canonical values from the snapshot. Any digit, number word, or percent in model prose is rejected. This makes "invented or recomputed numbers" structurally impossible rather than heuristically detected.
- **Trust classes:** `server_verified` (rebuilt server-side from broker reads) and `client_attested` (browser-computed scan sessions). Deep routes require `server_verified`.

## Decisions register

Recommended defaults are what the phase tickets assume. Nothing here is decided until the owner signs off.

| # | Decision | Recommended default | Owner | Status |
|---|---|---|---|---|
| D1 | Snapshot trust model | ADR-0005: `server_verified` for deep routes, `client_attested` for scan summary/chat | Alan | Proposed |
| D2 | Legacy AI routes and LEAPS-ADVISOR-0001B | Freeze `/api/advisor`, `/api/leaps-advisor` as-is (no new features). 0001B superseded by this epic. Migrate/retire `/api/analyze` etc. under a new ticket AI-POLICY-0002 after 0001D | Paul | Proposed |
| D3 | Provider, models, governance | OpenAI only. Economy tier `gpt-4o-mini`; reasoning tier **named by Dean** (route unavailable until set). Dean verifies OpenAI org data controls (no-train, retention, region) and sets the attestation env vars; missing → fail closed | Dean | Open |
| D4 | Retention | Prompts/outputs/artifacts: 90 days (matches `LEAPS_ANALYSIS_TTL_SECONDS`). Audit record = hashes + metadata only (no prompt/output text), 548 days (matches `pmcc-review-snapshots`), access limited to the owning user's scope. Deletion request removes artifacts, keeps audit metadata | Alan, Dean | Proposed |
| D5 | Kill switches | Env flags (default off) **plus** Redis override keys checked per request: `ai-policy:kill:global`, `ai-policy:kill:route:<route>`. Redis wins over env. No redeploy needed to stop | Alan | Proposed |
| D6 | Budgets | Route hourly limits and per-user monthly / global daily USD budgets are env-configured; **any unset → route unavailable** (forces a conscious number). Suggested starting hourly limits: summary 20, chat 60, LEAPS deep 10, PMCC deep 10 | Paul | Open |
| D7 | Freshness max ages | Config table, fail-closed if a required source has no max age. Proposed for Ian: quote/Greeks 300 s, broker position/capacity 900 s, earnings/calendar 86 400 s, scan calculation ≤ 8 h and status `complete` | Ian | Proposed |
| D8 | No-numbers-in-prose output design | Adopt (see Architecture) | Alan, Quinn | Proposed |
| D9 | Prohibited-language lexicon | Seed list in 0001A; Ian owns and versions it; expansion never needs a code change beyond the lexicon file | Ian | Proposed |
| D10 | `retrospective_batch` | Defer 0001G until Paul defines the reports | Paul | Proposed |
| D11 | `wheel-simulator` login requirement | It calls `/api/analyze` but is outside the middleware matcher. Add `/wheel-simulator/:path*` to the matcher and require a session on `/api/analyze` (single app, single trader) | Paul | Open |
| D12 | Accessibility testing | No new dependency. Testing-Library role/name/focus assertions + a manual keyboard/screen-reader checklist per release | Alan, Quinn | Proposed |
| D13 | Sync vs async deep analysis | Synchronous with `maxDuration = 60`, 45 s provider timeout, explicit loading state. Revisit only if the reasoning tier routinely exceeds it | Alan | Proposed |
| D14 | Deep analysis of an ineligible LEAPS candidate | Unavailable (`INPUT_INELIGIBLE`), no provider call — mirrors today's `MORE_INFORMATION_NEEDED`. Alternative: explain *why* ineligible using cited reason codes only | Ian | Open |
| D15 | Meaning of "paired short-call structure" for `pmcc_deep_analysis` | Foundation plus (a) the open paired short call if one exists and/or (b) the short-call structure evaluated in the caller's current PMCC evaluation input | Paul, Ian | Open |

## Sign-offs

| Role | Signs off on | Status |
|---|---|---|
| Paul (Product Owner) | Scope, D2, D6, D10, D11, D15, SEC-0001 triage table, launch-gate owner/approver | Pending |
| Ian (Trader) | D7, D9 lexicon, D14, LEAPS/PMCC analysis field lists, launch thresholds for usefulness/accuracy | Pending |
| Alan (Chief Architect) | ADR-0005, D1, D4, D5, D8, D12, D13 | Pending |
| Diane (UX) | Mocks for the seven states on Screener, LEAPS, PMCC, Positions (desktop + mobile); field-label catalog | Pending |
| Quinn (Test) | Test plan per phase, prohibited-output fixture list, acceptance-criteria traceability | Pending |
| Frank (Scrum Master) | Sequencing against in-flight work (paper-trading parity, PMCC discovery flow) | Pending |
| Dean (Sponsor) | D3 provider governance evidence, credential decisions, launch-gate approval | Pending |

## Acceptance-criteria traceability

| Spec AC | Delivered by |
|---|---|
| 1 AI cannot alter deterministic state | 0001A import-boundary + no-tools tests; regression tests in B, D, E |
| 2 Frozen input / defined output schema | 0001A schemas; enforced per route in B, D, E |
| 3 Unsupported numeric claims rejected | 0001A validator (placeholders, digit/number-word rejection) |
| 4 Deep analysis: explicit action + current data | 0001D, 0001E; 0001A freshness |
| 5 Failure leaves deterministic UI intact | 0001A gateway fallback; 0001C panel |
| 6 Auditable via model/policy/template/snapshot/validation | 0001A provenance |
| 7 Batch isolated | 0001G |
| 8 UI shows explanatory/read-only boundary | 0001C |
| 9 PMCC rejects cross-user/account, non-held, absent-from-snapshot | 0001E |
| 10 Machine-verifiable claim provenance | 0001A citation verifier |
| 11 Default-reject; every prohibited category tested | 0001A validator + fixture table |
| 12 Concurrent budgets; accessible non-blocking states | 0001A budget store; 0001C UI |
| 13 Keyboard-operable citations with fallback | 0001C |

## Definition of Ready (per phase)

- Owner sign-offs for that phase's decisions are recorded in the register above.
- Dane has read every file the ticket names **in the repo** and lists any difference from this document before writing code.
- Any UI work has Diane's approved mock. Any lexicon/threshold/logic content has Ian's approval.

## Definition of Done (every phase)

- Script delivered per the standing format (`git pull --rebase origin main`, heredocs with complete files, commit, push); first line of each `.ts/.tsx` file is a comment with its full path.
- **Sibling-path check stated:** which adjacent code paths were checked for the same class of bug.
- **Real verification run and reported:** `tsc --noEmit` with `tsconfig.check.json` and the **full** `npm test` suite (not focused); results quoted, not claimed. `next build` via the Vercel preview is the authoritative build check (no named exports from `page.tsx`).
- Ships dark: every new route and UI entry point is off unless its flag is on and its launch gate is approved.
- Implementation report added at `docs/implementation/AI-POLICY-0001X-implementation-report.md` for team acceptance.
- Existing behavior unchanged with all AI flags off (regression tests named in the phase).

## New environment variables (all server-only)

| Variable | Purpose |
|---|---|
| `AI_POLICY_ENABLED` | Global flag (default off) |
| `AI_POLICY_SCAN_SUMMARY_ENABLED`, `AI_POLICY_GROUNDED_CHAT_ENABLED`, `AI_POLICY_LEAPS_DEEP_ENABLED`, `AI_POLICY_PMCC_DEEP_ENABLED`, `AI_POLICY_RETRO_BATCH_ENABLED` | Per-route flags (default off) |
| `AI_POLICY_ECONOMY_MODEL`, `AI_POLICY_REASONING_MODEL`, `AI_POLICY_ALLOWED_MODELS` | Tier → model, and provider/model allowlist |
| `AI_POLICY_PROVIDER_POLICY_VERSION`, `AI_POLICY_PROVIDER_GOVERNANCE_ATTESTED` | Dean's governance attestation (must be `true` + version string to dispatch) |
| `AI_POLICY_ARTIFACT_KEY`, `AI_POLICY_ARTIFACT_KEY_PREVIOUS` | 32-byte hex AES-256-GCM keys for artifacts (current / previous, for rotation) |
| `AI_POLICY_SCOPE_SECRET` | HMAC secret for opaque account-scope ids |
| `AI_POLICY_USER_MONTHLY_BUDGET_USD`, `AI_POLICY_GLOBAL_DAILY_BUDGET_USD`, `AI_POLICY_<ROUTE>_HOURLY_LIMIT` | Budgets (unset → route unavailable) |
| `OPENAI_API_KEY` | Existing; server-only. `NEXT_PUBLIC_OPENAI_API_KEY` is removed by AI-SEC-0001 |

## Risks

- **Scope creep into legacy routes.** Mitigation: legacy migration is AI-POLICY-0002, not this epic.
- **Validator false rejections** (rejecting benign prose). Mitigation: fixtures include benign prose; rejection shows a neutral unavailable state; lexicon is versioned and Ian-tunable.
- **In-flight work collision** (PMCC discovery flow, paper-trading parity). Mitigation: Frank sequences; 0001E waits for the PMCC discovery flow to land.
- **Provider pricing/model drift.** Mitigation: unknown model → unavailable; price table verified at build time.
