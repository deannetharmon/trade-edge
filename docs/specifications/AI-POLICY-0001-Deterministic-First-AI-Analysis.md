> **Source specification, recorded verbatim as provided by Dean.**
> This is the authoritative statement of requirements. The epic and phase
> tickets ([AI-POLICY-0001 epic](../tickets/AI-POLICY-0001-epic.md)) sequence
> and ground these requirements in the codebase; if they ever disagree, raise
> it with Paul before building.

# AI-POLICY-0001 — Deterministic-First AI Analysis

## Objective

Add useful AI explanations without allowing AI to alter market facts, calculations, eligibility, rankings, execution readiness, portfolio state, or orders.

## Scope

1. TradeEdge code remains authoritative for broker facts, quotes, Greeks, DTE, P/L, breakeven, liquidity, earnings, capital, ranking, readiness, and trading rules.
2. An economical model supports user-requested summaries, grounded questions about a completed snapshot, and plain-language explanation of verified facts.
3. A stronger reasoning model supports an explicit, read-only deep analysis of one LEAPS candidate or held PMCC structure.
4. Batch processing is retrospective only and cannot affect a live scan, quote, qualification, ranking, recommendation, or order.
5. Every AI route has provenance, validation, safe fallback, feature flags, and independent rollout.

## Non-goals

- AI calculation or replacement of deterministic financial data.
- AI changes to filters, ranking, qualification, portfolio state, readiness, or orders.
- Order drafting/submission, autonomous monitoring, or automatic deep analysis.
- Analysis of stale or unverifiable data.

## Routes and boundaries

| Route | Trigger | Tier | Role |
|---|---|---|---|
| `scan_summary` | User request | Economical | Explain a completed scan |
| `grounded_chat` | User question | Economical | Explain the active completed snapshot |
| `leaps_deep_analysis` | Explicit action | Stronger reasoning | Explain one LEAPS candidate's trade-offs |
| `pmcc_deep_analysis` | Explicit action | Stronger reasoning | Explain one authorized, currently evaluated held PMCC foundation and its paired short-call structure |
| `retrospective_batch` | Scheduled/manual offline | Batch | Produce dated research and completed-session reports |

Each route receives a frozen, identified snapshot. The server rejects incomplete,
stale, unsupported, credential-bearing, or order-related requests. Model routes
are **no-tools, read-only**: they receive no broker, market-data, account,
portfolio-write, scan-write, recommendation-write, or order capability. The
model can neither fetch new data nor invoke an application action.

### Authorization, identity, and immutable input

- Resolve authorization server-side before materializing any AI context. Never
  trust a client-supplied session, candidate, position, account, or OCC ID.
- `pmcc_deep_analysis` is allowed only for a broker-authorized held-long
  foundation that is in the caller's current evaluated PMCC snapshot. It must
  not analyze an arbitrary option, a stale holding, or a foundation from a
  different account/user.
- Authorize every snapshot/candidate/position reference against the acting
  user and account scope (anti-IDOR), then issue an opaque immutable analysis
  input ID. The model route accepts that ID, not raw mutable client objects.
- Build and persist a canonical, versioned snapshot payload and cryptographic
  hash before dispatch. A refresh creates a new artifact; it never mutates the
  input or output of an existing artifact.

### Data minimization, privacy, and provider governance

- Send only fields required by the route's documented schema. Use opaque IDs;
  exclude credentials, tokens, account numbers, personally identifying data,
  free-form broker payloads, and unnecessary portfolio positions.
- Redact and bound user chat text before provider dispatch. Treat all model and
  user text as untrusted data, never as instructions to expand route access.
- Use an approved provider/model allowlist, documented retention and regional
  data-handling terms, and a vendor configuration that does not train on
  TradeEdge data where available. Record provider policy/configuration version
  in provenance. Do not dispatch when the provider-governance check fails.
- Store TradeEdge AI artifacts encrypted at rest. Artifact reads require the
  acting user's authorization plus the artifact's opaque account and snapshot
  scope. Define a bounded retention period and deletion/anonymization process
  for prompts, outputs, telemetry, and artifacts. Immutable audit evidence is
  retained only under a separately documented compliance exception, with its
  access scope and expiry/review period recorded.

## Output and safeguards

Use a fixed structured response: `summary`, `observations`, `tradeoffs`,
`missingOrStaleData`, `questionsForTrader`, `limitations`, and `citations`.

- Each factual claim cites one or more machine-verifiable deterministic field
  paths, their canonical values, and the immutable snapshot hash. A snapshot
  ID alone is insufficient provenance.
- Display: “AI explanation — does not change scan results or trading eligibility.”
- The deterministic UI remains fully usable before, during, after, or without AI.
- AI cannot override `Hold`, `Monitor`, `Not ready`, or an ineligible state.
- AI cannot invent or recompute numbers, apply an unverified formula, rank or
  compare candidates as a decision output, rank ineligible trades, make a
  trade recommendation, issue order commands, or tell the client to change
  filters, eligibility, readiness, or state.
- Enforce bounded inputs, rate/concurrency limits, timeouts, and per-user cost budgets.
- Validate outputs server-side using an allowlist of fields and claim types.
  Default reject: do not render malformed, uncited, unsupported, action-
  oriented, uncited qualitative-as-factual, or prohibited-output content. A
  rejected artifact receives a neutral unavailable/fallback state only.
- Keep provider credentials server-side and redact account identity/secrets.
- Provide global and per-route kill switches.

## Provenance

Persist artifact ID/type; provider/model/version; template/policy/provider-
configuration versions; snapshot IDs/hash/schema version; authorization scope;
source timestamps; deterministic states/reason codes; output/validation;
latency/cost; feature flag; user action; and failure/fallback reason. Claim
provenance must record field path, canonical value/hash, source name, and
source-specific as-of time. Display model, as-of time, and stale state.
Refreshes mark old artifacts stale rather than rewriting them.

Freshness is source-specific, not a single generic timestamp: quote/Greek
fields, broker-position/capacity fields, earnings/calendar fields, and scan
calculation fields each declare their own schema, as-of time, and maximum age.
Deep analysis is unavailable when any required source is missing or stale;
summary/chat must disclose omitted or stale sources rather than infer them.

## UI lifecycle

- AI entry points are explicit opt-in controls, never automatic deep analysis.
- Render deterministic results first. The AI panel has accessible requested,
  loading, ready, unavailable, rejected, stale, and retry states; it never
  blocks scanning or hides deterministic content.
- Announce state changes with accessible status/error messaging, maintain
  keyboard focus, and label the panel with model tier, read-only status,
  source-specific as-of times, and the immutable analysis/snapshot reference.
- Every rendered citation is keyboard-operable and opens or scrolls to its
  deterministic evidence. The disclosure shows the field label, canonical
  value, source, and as-of time. If the evidence is unavailable in the current
  view, render that same information as a plain-language disclosure; never
  expose a raw field path or snapshot hash as the user-facing citation.
- A refresh invalidates the visible artifact as stale and offers an explicit
  rerun; it does not silently replace the analysis.

## Budget and rate controls

- Reserve per-user and global route budgets atomically before dispatch;
  reconcile the actual provider cost once complete. Concurrent requests may
  not overspend the same allowance.
- Enforce server-side idempotency keys, request-size limits, per-user and
  global concurrency/rate limits, timeouts, and a circuit breaker for provider
  errors. Budget/circuit-breaker failures return the same non-blocking
  unavailable state as other failures.

## Acceptance criteria

1. Tests prove AI cannot alter calculations, filters, eligibility, rankings, portfolio state, readiness, or orders.
2. Each route accepts only its frozen input schema and returns only its defined output schema.
3. Unsupported factual/numeric claims are rejected.
4. Deep analysis requires explicit user action and current data.
5. Failure leaves the deterministic experience intact.
6. Every call is auditable through model, policy, template, snapshot, and validation records.
7. Batch is isolated from live decision paths.
8. The UI makes the explanatory/read-only boundary clear.
9. PMCC deep analysis rejects cross-user/cross-account IDs, non-held
   foundations, and foundations absent from the caller's current evaluated
   snapshot.
10. Claim-level provenance is machine-verifiable against the exact snapshot
    schema, field paths, values, hashes, and source-specific timestamps.
11. Output validation defaults to reject and tests cover every prohibited
    output category, including action/recommendation language and invented or
    recomputed numbers.
12. Concurrent budget requests cannot exceed configured route/user/global
    limits, and all UI lifecycle states are accessible and non-blocking.
13. Every displayed citation is keyboard-operable and reveals its
    human-readable deterministic evidence or a plain-language fallback.

## Tests and rollout

- Unit: routing, authorization/anti-IDOR, immutable input construction,
  flags, schema, source-specific freshness, field-level citations, redaction,
  atomic budgets, prohibited-output rejection, and fallback.
- Integration: provider failure/timeout/malformed output, circuit breaker,
  provenance persistence, provider-governance failure, and server-only
  credentials/no-tools isolation.
- Regression: scan counts, dispositions, rankings, and readiness are unchanged with AI enabled/disabled.
- UI/accessibility: opt-in, requested, loading, ready, unavailable, rejected,
  stale, retry, and error states; labels/status announcements/focus behavior;
  keyboard-operable citation navigation and evidence-disclosure fallback.
- Evaluation: human-reviewed fixtures for accuracy, citations, stale-data handling, prohibited-action rate, and usefulness; each route stays disabled until thresholds pass.

Ship dark with flags and provenance; evaluate on synthetic or consented
completed snapshots. Before enabling any route, create and approve a versioned
launch-gate record that names its owner and approver; defines numeric or
explicitly testable thresholds for grounded accuracy, claim verification,
prohibited-output rejection, freshness, latency, cost, and usefulness; sets a
minimum fixture/audit sample and cohort hold period; and specifies its exact
rollback triggers. Roll out summaries, grounded chat, LEAPS deep analysis,
then PMCC deep analysis independently. Roll back via global/per-route flag or
circuit breaker while preserving deterministic TradeEdge behavior and
authorized immutable audit artifacts; investigate and pass a newly approved
launch gate before re-enabling.
