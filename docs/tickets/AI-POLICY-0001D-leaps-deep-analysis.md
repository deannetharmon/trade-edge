# AI-POLICY-0001D — `leaps_deep_analysis`

**Status:** Draft — depends on 0001A; needs Ian's field list and D14 (ineligible handling); UI mock from Diane for the LEAPS host
**Epic:** [AI-POLICY-0001](./AI-POLICY-0001-epic.md) · **Delivers spec ACs:** 2, 3, 4, 6, 1 (regression), 11 (route-level)

## Problem

`/api/leaps-analysis` already explains one LEAPS contract using server-resolved broker evidence, but it predates the policy: no claim-level citations with hashes, no budget reservation, no kill switches, no governance check, no no-tools enforcement, and its `posture` output (`SUPPORTS_FURTHER_REVIEW` / `WAIT_MONITOR`) reads as a recommendation.

## User value

An explicit, read-only explanation of one LEAPS candidate's trade-offs (extrinsic vs intrinsic, delta, DTE, liquidity/spread, IV, breakeven) grounded in fresh broker facts, with every fact cited.

## Scope

1. **Route** `POST /api/ai-policy/leaps-deep` — `{ analysisInputId, occSymbol, underlyingSymbol, idempotencyKey }` (reasoning tier; `maxDuration = 60`; provider timeout 45 s).
   - `analysisInputId` must reference a frozen `client_attested` LEAPS scan input **owned by the caller** (0001B freeze, strategy LEAPS) that **contains** `occSymbol`. Otherwise `NOT_FOUND`.
2. **Builder** `lib/ai-policy/builders/verified/leapsCandidate.ts` (trust `server_verified`):
   - Calls the existing read-only `resolveLeapsContractEvidence(userId, { underlyingSymbol, occSymbol })` — every quote/Greek/qualification fact is re-read server-side.
   - **Drift check:** broker strike/expiration/OCC must equal the attested candidate's; mismatch ⇒ `INPUT_INVALID`.
   - **Map, don't recompute:** derived values (intrinsic/extrinsic, breakeven, DTE, qualification status + reason codes) come from the existing deterministic modules (`lib/leaps-analysis/tradeQualification.ts`, `lib/scans/leapsEntryQualification.ts`, or the values already on `ServerLeapsReview`). The builder adds no arithmetic. Fields sent are exactly Ian's approved list (registry), nothing else; no account numbers, tokens, or raw broker payloads.
   - Sources and as-of: option/underlying quote timestamps → `quoteGreeks`; earnings/event risk → `earningsCalendar` only if Ian lists it and a server-side read exists (Dane confirms).
3. **Freshness:** any required source missing/stale ⇒ `unavailable(INPUT_STALE)` with **no provider call** (deep-analysis rule).
4. **Ineligibility (D14, recommended default):** if qualification ≠ qualified, return `unavailable(INPUT_INELIGIBLE)` without a provider call — mirrors today's `MORE_INFORMATION_NEEDED` behavior and guarantees AI never explains a way around an ineligible state. Ian may instead approve explaining *why* it is ineligible using only cited reason codes.
5. **Template** (`routeSpecs.ts`): explain trade-offs among intrinsic/extrinsic, delta, DTE, liquidity/spread, IV, breakeven; every value via `{{c:N}}`; no selection, no posture, no ranking against unseen candidates, no return/price prediction, no sizing, no authority language.
6. **UI:** reuse `AiExplanationPanel` (0001C) in the LEAPS scan modal, behind an explicit "Explain this contract" control, per Diane's mock. Never auto-invoked.

## Non-goals

No changes to `/api/leaps-analysis`, `lib/leaps-analysis/*`, `/api/leaps-advisor`, or qualification/scoring. No comparison of candidates. No orders.

## Acceptance criteria

1. Deep analysis runs only from an explicit control; a test proves the API wrapper is imported by that component only (no scheduled/auto callers).
2. A candidate not in the caller's frozen input, a foreign `analysisInputId`, or a drifted contract ⇒ identical neutral failure with no provider call.
3. Stale/missing quote source ⇒ `INPUT_STALE`, provider spy has **zero** calls.
4. Ineligible contract ⇒ per D14 outcome, provider spy zero calls (default).
5. Output validator rules from 0001A apply unchanged; the route fixture set adds LEAPS-specific rejections ("this is the better LEAPS", "attractive extrinsic", "roughly 0.80 delta" typed digits).
6. Regression: qualification status, reason codes, and scores for a fixture contract are identical with AI on/off.
7. Budget/kill-switch/governance failures return the same non-blocking unavailable state as any other failure.
8. Provenance includes trust class `server_verified`, per-claim pointer + value hash + source + as-of, and the broker read timestamp.

## Implementation notes

- Verify before writing: `lib/leaps-analysis/serverTradeReview.ts` exports (`resolveLeapsContractEvidence`, `ServerLeapsReview`), `analysisService.ts` (`buildSnapshot` field set — reuse its field choices as the registry starting point, do not import its Redis code), `tradeQualification.ts`, and how the LEAPS scan populates `ScreenerScanSession` candidates (confirm OCC symbols are present in candidate rows).
- Tests: `lib/ai-policy/__tests__/builders/leapsCandidate.test.ts` (synthetic `ServerLeapsReview` fixtures, broker mocked), `app/api/ai-policy/__tests__/leapsDeep.test.ts`.
- Sibling paths to state: `/api/leaps-analysis` (untouched), `/api/leaps-advisor`, PMCC held routes (`/api/pmcc-held-trade-review`, order-related, untouched).

## Validation steps

`tsc --noEmit`, full `npm test`, Vercel preview build; on preview: explicit action ⇒ artifact with citations; stale quote simulated by clock-injected test; flags off ⇒ control hidden.

## Rollout notes

Dark behind `AI_POLICY_LEAPS_DEEP_ENABLED`; requires `AI_POLICY_REASONING_MODEL` (Dean) and an approved 0001F launch gate. Independent of PMCC deep analysis.
