# ADR-0005 — Trust Classes for AI Analysis Inputs

**Status:** Proposed — draft for Alan's review
**Related:** [AI-POLICY-0001 epic](../tickets/AI-POLICY-0001-epic.md), [specification](../specifications/AI-POLICY-0001-Deterministic-First-AI-Analysis.md), ADR-0004

## Context

The specification requires that the server "resolve authorization before materializing any AI context" and "never trust a client-supplied session, candidate, position, account, or OCC ID."

Verified facts in `main` @ 02b8276c:

- **The server can read the broker.** `lib/tastytrade/server-token.ts` and `lib/leaps-analysis/serverTradeReview.ts` refresh a stored (encrypted) TastyTrade credential and read accounts, positions, and option quotes server-side (`validatedAccount`, `resolveLeapsContractEvidence`, `fetchHeldPmccPositionSnapshot`). A deep-analysis input can be rebuilt by the server itself.
- **Scans run in the browser.** The canonical `ScreenerScanSession` (`lib/screener/scanSession.ts`) is built client-side and persisted in IndexedDB (`screenerActiveSession_v1`). The server has no copy. A `scan_summary` / `grounded_chat` input can only arrive from the client.

(An earlier draft of this analysis assumed the server could not verify anything because "TastyTrade is browser-only." That was incorrect for the deep-analysis paths and is superseded by this ADR.)

## Decision

Every stored analysis input carries a **trust class**, recorded in provenance and shown to the user in plain language.

1. **`server_verified`** — every fact in the payload was read by the server at request time from the broker/market-data services, using the acting user's server-held credential. The client contributes only an *identifier* (OCC symbol, underlying, opaque frozen-input id), never a value.
2. **`client_attested`** — the payload was submitted by the acting user's browser (a completed scan session). The server:
   - authenticates the user and scopes the stored input to that user id (no cross-user reads);
   - validates it with the existing pure `validateSessionData` and requires `status === 'complete'`;
   - rebuilds a **bounded, allowlisted** payload (drops everything not in the route schema) rather than storing the client object;
   - re-derives what existing pure functions can re-derive (e.g., DTE from expiration and scan date) and **rejects on mismatch**;
   - stores it immutably (`SET … NX`) with a canonical hash.

### Route rules

| Route | Allowed trust class | How the spec's authorization requirements are met |
|---|---|---|
| `scan_summary`, `grounded_chat` | `client_attested` | User-scoped storage; explanation only; disclosure wording: "Built from your scan results" |
| `leaps_deep_analysis` | `server_verified` | Candidate identified by OCC + a frozen LEAPS scan input owned by the caller; all quote/Greek/qualification facts re-resolved server-side; drift vs. the attested input → reject |
| `pmcc_deep_analysis` | `server_verified` | Held-long foundation verified against the broker for a `validatedAccount`; the caller's frozen PMCC evaluation input (attested) is used **only to establish "currently evaluated" membership**, never as a source of facts |

A `client_attested` input can never be the sole authority for a deep-analysis fact.

### Threat model

- **Cross-user access (IDOR):** prevented by user-scoped Redis keys and identical `404` for missing/foreign ids.
- **Forged client scan session:** a user can only distort an explanation of their *own* scan. It cannot reach another account, cannot alter deterministic state (AI is read-only and no-tools), and cannot authorize deep analysis.
- **Forged PMCC membership:** membership only narrows what the user may ask about; the foundation must still exist in the broker positions of an account the user owns.

## Alternatives considered

- **Server re-runs the scan.** Rejected: duplicates scan logic (violates one-home-per-rule), heavy on broker rate limits, changes latency profile.
- **Client signs snapshots.** Rejected: no trust root; the client holds the key.
- **Persist scan sessions server-side at scan completion.** Viable future upgrade (would promote scan inputs toward `server_verified`); out of scope for this epic, no schema decided here.

## Consequences

- Acceptance criterion 9 (PMCC) is met honestly by broker verification, not by attestation.
- Scan explanations are labelled as built from the user's own scan results; they are never described as broker-verified.
- Two builder families exist (`attested/`, `verified/`) under `lib/ai-policy/builders/`; the gateway treats them uniformly and records the class.
- Provenance gains a `trustClass` field.

## Follow-ups

- Alan to accept, amend, or reject this ADR before 0001A starts.
- Consider server-side persistence of completed scan sessions (separate ticket) to upgrade scan inputs.
