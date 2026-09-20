# AI-POLICY-0001E — `pmcc_deep_analysis`

**Status:** Draft — depends on 0001D and ADR-0005; **do not start until the PMCC three-stage discovery flow has landed** (Frank to sequence); needs D15 (what "paired short-call structure" means)
**Epic:** [AI-POLICY-0001](./AI-POLICY-0001-epic.md) · **Delivers spec ACs:** 9, 4, 6, 10, 11 (route-level), 1 (regression)

## Problem

The spec allows deep analysis only for "one authorized, currently evaluated held PMCC foundation and its paired short-call structure", and forbids arbitrary options, stale holdings, and cross-account/user foundations. This is the most security-sensitive route.

## User value

An explicit, read-only explanation of how a held LEAPS foundation and its short-call structure interact (runway vs. short-call DTE, delta/assignment mechanics, liquidity) from verified broker facts.

## Scope

1. **Route** `POST /api/ai-policy/pmcc-deep` — `{ analysisInputId, longOccSymbol, underlyingSymbol, accountLocator?, idempotencyKey }` (reasoning tier; `maxDuration = 60`).
2. **Authorization sequence (all server-side, in this order; any failure ⇒ identical neutral `NOT_FOUND`/unavailable, no provider call):**
   1. Authenticated user (`getServerSession`).
   2. `analysisInputId` resolves to a frozen PMCC evaluation input **owned by the caller** (0001B freeze, strategy PMCC; extended here so the freeze also accepts `accountLocator`, validates it with the broker (`validatedAccount`), and stores the opaque `accountScope` = HMAC(userId, accountNumber)).
   3. **Membership:** the requested foundation (`longOccSymbol` + `underlyingSymbol`) is present in that evaluation input and its `accountScope` matches the one derived from the broker-validated account. (Attested data only decides *what was evaluated*, never a fact — ADR-0005.)
   4. **Broker verification:** `fetchHeldPmccPositionSnapshot(userId, { accountLocator, underlyingSymbol, longOccSymbol })` returns `matched: true`, quantity > 0, single-leg long call, in range per the existing PMCC-long policy (180–730 DTE, the PMCC-0002 launch gate), with a current broker as-of.
   5. Paired short-call structure resolved per D15 (below).
3. **Builder** `lib/ai-policy/builders/verified/pmccFoundation.ts` (trust `server_verified`): maps broker facts and existing deterministic PMCC modules (`lib/scans/pmccReadiness.ts`, `pmccPairing.ts`, `pmccHeldLeaps.ts`, `lib/portfolio-data/pmccPairDetection.ts`) into the route's registry payload. No new arithmetic. Account numbers never enter the payload or provenance (only `accountScope`).
4. **D15 (recommended default):** the analysis covers the held foundation plus (a) the already-open paired short call if one exists, and/or (b) the short-call structure evaluated in the caller's current PMCC evaluation input. Dane's pre-build audit confirms what read-only server-side path exists to resolve an open paired short call (today `fetchHeldPmccPositionSnapshot` returns only long-leg fields). **If none exists, Dane proposes a minimal read-only export to Alan before building; no order/submit function may be touched.**
5. **Freshness:** `quoteGreeks` and `brokerPositionCapacity` (and earnings if required) must be present and within max age; otherwise `INPUT_STALE`, no provider call.
6. **UI:** the shared panel in the PMCC/Positions host per Diane's mock, behind an explicit "Explain this structure" control. Never auto-invoked.

## Non-goals

No changes to `pmcc-held-trade-review`, order-dry-run/submit, paper trading, or PMCC scoring. No analysis of arbitrary options, unpaired/stale holdings, or other accounts.

## Acceptance criteria (spec AC 9 in full)

1. **Cross-user:** user B with user A's `analysisInputId` ⇒ identical neutral failure, no provider call.
2. **Cross-account:** a foundation whose `accountScope` differs from the broker-validated account, or an `accountLocator` the user does not own ⇒ rejected, no provider call.
3. **Non-held:** `matched: false`, zero quantity, or a contract that is not an unambiguous single-leg long call in range ⇒ rejected.
4. **Absent from the current evaluated snapshot:** foundation not present in the caller's PMCC evaluation input (or the input is superseded/stale) ⇒ rejected.
5. **Stale holding:** broker as-of beyond max age ⇒ `INPUT_STALE`.
6. **Arbitrary option:** any `longOccSymbol` outside the above ⇒ rejected.
7. Every rejection above has a named test and asserts the provider spy has zero calls and the responses are indistinguishable from each other and from a random id (no oracle).
8. Payload/provenance/artifact contain no account number, token, or raw broker payload (deep key + string scan test).
9. Regression: PMCC readiness, pairing, and scores for fixtures are identical with AI on/off.
10. Same validator, budget, breaker, kill-switch, governance behavior as 0001A/0001D.

## Implementation notes

- Verify before writing: `lib/leaps-analysis/serverTradeReview.ts` (`fetchHeldPmccPositionSnapshot`, `validatedAccount`, `HeldPmccPositionSnapshot`, and whether `brokerContext`/`findHeldPmccLongPosition` are exported), `lib/portfolio-data/pmccPairDetection.ts` (`isPairedPmccLong`, `findPairedShortCall` take client `Position[]`), `lib/scans/pmccHeldLeaps.ts`, `pmccReadiness.ts`, `pmccPairing.ts`, and how the PMCC scan session records held foundations.
- Tests: `lib/ai-policy/__tests__/builders/pmccFoundation.test.ts`, `app/api/ai-policy/__tests__/pmccDeep.test.ts` (auth matrix as above; broker mocked with two users/two accounts).
- Sibling paths to state: `/api/pmcc-held-trade-review`, `/api/pmcc-trade-review`, `/api/pmcc-review-snapshots` (untouched; the last already stores user-scoped immutable snapshots — reuse its retention convention only).

## Validation steps

`tsc --noEmit`, full `npm test`, Vercel preview build; on preview with a real held foundation: explicit action ⇒ artifact; changed/closed holding ⇒ rejected; second account (if available) ⇒ rejected.

## Rollout notes

Last route to enable. Dark behind `AI_POLICY_PMCC_DEEP_ENABLED`, `AI_POLICY_REASONING_MODEL`, and an approved 0001F launch gate.
