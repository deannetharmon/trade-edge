# SCREENER-PREFS-0001 — User-scoped default preferences for scan and result filters

## Status

**Approved 2026-09-22.** Both open items from the draft are resolved below; ready for implementation.

## Problem

Filter defaults are hardcoded in `app/screener/page.tsx` (e.g. `filteredMinOi` at line 8694, `filterPopMin`/`filterOtmMin`/`filterCreditRatioMin`/`filterDteMin` around line 10507, `filterCspDeltaRange` at 10529). Every time Dean wants a different starting point — Put OI at 100 instead of 0, Delta defaulting to the scan's own band instead of Any — it means asking Dane to change a source line and ship a script. This has happened repeatedly this session (CSP's Delta default, the Put OI question still unresolved). None of it should require a code change.

## User value

Dean sets his own defaults once, in the app, and every scan and result view opens already narrowed the way he wants — no more per-value tickets, no more "tell me the line to change."

## Scope

### 1. Storage

- One preferences record per user, keyed the same way existing account-scoped data already is (Redis, via the session's user id — same pattern as portfolio snapshots and scan sessions; see `lib/jobs/redis.ts` / `getServerSession` in `lib/ai/requireSession.ts` for the existing convention to follow, not duplicate).
- Read once on load. Missing record or missing individual field both mean "no preference set" — never an error, never a blank/broken control.
- No default value is ever hardcoded again for the values in scope below; each control's fallback is `Any` (or the value's existing off-state) when nothing is saved.

### 2. What's in scope, and how each is scoped

| Value | Scope | Available pre-scan | Available post-scan |
|---|---|---|---|
| DTE (min/max) | Global | Yes (already exists) | Yes (already exists) |
| Open interest minimum | Global | Yes (already exists) | Yes (already exists) |
| Credit ratio minimum | Global | Yes (already exists) | Yes (already exists) |
| POP minimum | Global | No — see Non-goals | Yes (already exists) |
| OTM minimum | Global | No — see Non-goals | Yes (already exists) |
| Delta (min/max) | **Per-strategy** (CSP, Iron Condor, other spreads each keep their own) | Yes (already exists) | Yes (already exists) |
| Default scan mode (Rank / Targeted) | Per-launcher | N/A (this is the pre-scan choice) | N/A |
| Default sort field | Per-launcher | N/A | Yes (already exists) |

Every row above already has a working, existing control in the app today (pre-scan modal field, post-scan chip, or both, per the table). This ticket does not add any new field to any scan modal — it makes each existing control's *starting value* configurable and remembered, nothing more.

### 3. Settings screen

- One settings page (or panel) listing the values in the table above, grouped by scan/result concern, with Delta shown per-strategy and everything else shown once.
- Each field's current default is editable inline; clearing a field returns that value to `Any`/off.
- Diane's mock required before this is built (project standing rule: UI before code).

## Non-goals

- **No pre-scan POP or OTM field.** Both are computed from a candidate after the scan evaluates it (delta, DTE, and OI genuinely narrow what the broker fetches; POP and OTM cannot, since they don't exist until after evaluation). A pre-scan cutoff on either would silently exclude candidates before they're ever shown — the opposite of the fail-visible-not-fail-silent pattern this session's other CSP fixes (the OI gate, the scoring fix) were built around. POP and OTM stay post-scan-only, as they are today.
- No change to the underlying scan logic, scoring, or qualification rules — this only changes what a control's *starting* value is; every value remains fully overridable in the moment, exactly as today.
- No cross-account sync or preference sharing between users.
- Not a redesign of the preset system (Conservative/Balanced/More Opportunities/Custom) — presets and saved preferences are separate, complementary mechanisms.

## Acceptance criteria

1. A user with no saved preferences sees identical behavior to today (`Any`/off everywhere) — this ships with zero behavior change for anyone who hasn't set anything.
2. Setting a global value (e.g. Put OI = 100) changes the default on every strategy's post-scan chip and, where applicable, every pre-scan modal, without a code change or deploy.
3. Setting CSP's Delta default does not change Iron Condor's or Spreads' Delta default, and vice versa.
4. Every value in scope remains editable in the moment on both the pre-scan modal (where it already exists) and the post-scan chips — a saved preference is a starting point, never a lock.
5. No pre-scan POP or OTM field exists anywhere in the app after this ships.
6. Clearing a saved preference returns that control to its pre-ticket hardcoded behavior (`Any`/off), not to an error or a blank state.
7. Preferences are scoped to the signed-in user; switching accounts never reads another user's saved values.

## Team alignment (2026-09-21)

- **Ian:** global default for most values; Delta stays per-strategy, since CSP/IC/Spreads' bands reflect real structural risk differences, not just preference.
- **Paul:** approved scope, contingent on no new pre-scan POP/OTM fields (confirmed not needed — see Non-goals).
- **Diane:** settings screen groups by scan/result concern, Delta shown per-strategy; no new modal fields to design.
- **Quinn:** one Redis-backed record per user, same pattern as existing account-scoped data; no new infrastructure.
- **Alan:** no scoring/formula impact; nothing to validate.

## Diane's mock (2026-09-22)

One settings page ("Scan Defaults"), reached from the header alongside Help/Performance, in three groups:
1. **General** — DTE min/max, OI minimum, credit ratio minimum, POP minimum, OTM minimum. One row each, current default shown inline and editable in place, with an "Any" pill to clear back to no preference.
2. **Delta, by strategy** — three clearly separated rows: **CSP**, **Iron Condor**, **Spreads**, each with its own min/max, same inline-edit pattern, visually grouped apart from General so the per-strategy scoping is unmistakable.
3. **Scan behavior** — default mode (Rank/Targeted) and default sort field, one row per launcher (CSP/CC/PMCC/Spreads), simple dropdowns.

No save button — edits apply immediately, same pattern as the existing post-scan chips, with a brief "Saved" confirmation per edit.

## Schema (Quinn, 2026-09-22)

Follows the existing session-scoped Redis pattern used elsewhere (portfolio snapshots, scan sessions), resolved via the same `getServerSession(authOptions)` identity as `lib/ai/requireSession.ts`. One key per user, one JSON blob (not one key per field, since every value is read together on load):

```
screener:prefs:<userId>
```

A missing key, or a missing field inside the blob, both mean "no preference set" — falls back to `Any`/off per the ticket's own rule. No new session-resolution logic, no new infrastructure.
