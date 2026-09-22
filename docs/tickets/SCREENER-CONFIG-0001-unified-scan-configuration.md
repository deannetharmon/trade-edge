# SCREENER-CONFIG-0001 — Strategy-Aware Scan Configuration

## Problem

The Screener has five different scan-configuration experiences: defined-risk
spreads, cash-secured puts (CSP), covered calls (CC), poor man's covered calls
(PMCC), and LEAPS. They need a recognizable common interaction model, but their
economics and execution behavior are not interchangeable.

Today, similarly named controls can silently mean a fetch boundary, a hard
qualification rule, a ranking preference, or a post-scan result filter. This
creates an avoidable risk that the UI promises behavior the engine does not
perform. The approved mockup direction is in
`docs/mockups/screener-scan-configuration-unified-v4.html`.

## User value

A trader can tell, before running a scan:

1. What data will be fetched and therefore requires a rescan to change.
2. What can disqualify a candidate.
3. What only influences ordering or is adjustable after results return.
4. Which strategy-specific risk and return criteria apply.

The resulting controls are faster to use through presets/pills without
misstating trade economics.

## Scope

Build a common scan-configuration shell and criterion registry for Spreads,
CSP, CC, PMCC, and the LEAPS release state. The registry is the source of truth
for each rendered criterion:

| Required property | Meaning |
|---|---|
| label and unit | Trader-facing name and explicit unit/formula context |
| lifecycle | `fetch`, `gate`, `rank`, `result-filter`, or `read-only` |
| off state | Explicit `Any`, `No cap`, or not applicable state |
| preset set | Strategy- and leg-specific quick choices |
| custom behavior | Input validation and exact preset matching |
| summary text | What is displayed before and after scanning |

Use the common visual hierarchy:

1. Scope and eligibility.
2. Intent/profile only where it is a real strategy workflow.
3. Time/distance, liquidity, and strategy-specific economics.
4. Always-applied checks.
5. A persistent scan receipt showing fetch boundary, gates, preferences, and
   later-adjustable filters.

## Required behavior by strategy

### Defined-risk spreads

- Keep Filter, Rank, and Targeted as distinct intents.
- Rename the control to **Minimum credit (% of spread width)**. Do not call it
  credit/risk unless the formula is actually changed to credit divided by
  maximum loss.
- Offer credit presets `Any`, `15%`, `20%`, `25%`, and `33%`, plus Custom.
- Disclose the maximum spread-width and/or per-contract maximum-loss boundary
  applied by the scan. Premium quality alone is not exposure control.
- Show DTE as fetch, targeted POP/OTM/credit as gates where applicable, and
  post-scan controls as result filters.

### Cash-secured puts

- Preserve Filter, Rank, and Targeted intent selection.
- Targeted hard gates are POP, OTM, and period ROC. Current implementation
  treats short-put delta as a preference/ranking signal, not a targeted
  qualification failure; do not label it a gate unless engine policy changes.
- Add an execution-level regression that proves the policy: a quote-valid CSP
  outside the configured delta band remains available to the scan outcome,
  while a candidate below targeted POP, OTM, or ROC is marked a targeted
  near-miss. If the engine policy is changed instead, the registry, receipt,
  and this test must change together.
- OI and bid/ask remain preferences under current behavior and must say so.
- Expose the IVR hard cap in the visible scan receipt or Always Applied list.
  Keep lower-IVR guidance distinct from the cap.
- Label return as **Minimum period return on collateral (ROC)**, with its unit
  and period clear.
- Keep `Affordable only` optional. State the selected broker account/cash
  source and show collateral for candidates retained while it is off.

### Covered calls

- Treat this as a holdings-management scan: broker-verified covered capacity
  is a required upstream condition.
- Show OI as a preference while current policy retains low-OI calls with a
  warning. It becomes a gate only with an explicit engine policy change.
- Use **Maximum bid/ask width ($ per share)** with explicit dollar units.
- State the strike guard truthfully: above current price, and above cost basis
  only when verified cost basis is available.
- When no capacity is eligible, show a recovery-only state. Do not show
  editable filters or an enabled Run action.

### PMCC

- Treat held long calls as read-only broker-backed foundation context, not a
  second editable discovery leg.
- Short-call DTE is a fetch boundary. Short-call delta is rank/guardrail under
  current policy. Short OI is a qualification gate.
- Keep quote policy units explicit; the live PMCC quality policy is
  percentage-of-midpoint plus quote freshness, not CC's dollar-width policy.
- Surface pair-level readiness in Always Applied/result receipt: earnings
  timing, quote freshness/actionability, **trend-alignment qualification
  gate**, LEAPS DTE health, and
  short-credit relative to long extrinsic/decay evidence. These may be
  read-only checks rather than new controls.

### LEAPS

- Do not show a live Run action unless the standalone LEAPS launcher is enabled
  in the same release. Otherwise show an unavailable/preview state.
- DTE is the fetch boundary. Use long-dated presets: `90–180`, `180–365`,
  `365–730`, and `180–730` days.
- Delta and OI are result filters under the current implementation. Candidates
  with unavailable delta/OI remain visible and are flagged; they are not
  silently rejected.
- Keep extrinsic-percent filtering disabled until its denominator is formally
  defined, implemented, and shown in the UI and result receipt.

## Shared pill and input contract

- Pills are scoped to one criterion category. A click must not clear selection
  in another category.
- A pill updates its matching field. Typed input matching a preset exactly
  selects that preset; any other valid value selects `Custom`.
- All relevant OI categories use `100`, `200`, `300`, and `500` presets.
- Use real, labelled input elements with correct `min`, `max`, `step`, unit
  parsing, keyboard support, and inline validation announced to assistive
  technology.
- `Any` and `No cap` are intentional off states, visually distinct from a
  disabled/unavailable condition.

## Candidate-retention and session contract

For every registry lifecycle, define the candidate disposition and recovery
behavior in the implementation rather than inferring it from styling:

| Lifecycle | Candidate disposition | Can relaxing it recover an already fetched candidate? |
|---|---|---|
| Fetch | Not fetched outside the boundary | No; rescan required |
| Gate | Qualified or auditable near-miss, according to strategy policy | Only if the fetched candidate was retained; otherwise rescan required |
| Rank | Retained and re-ordered | Yes, without rescan |
| Result filter | Retained in the fetched dataset but hidden from the current view | Yes, without rescan |
| Read-only | Disclosed context only | Not applicable |

The pre-run receipt and result receipt must say which controls require a
rescan and which can be relaxed over the existing dataset. Every strategy must
explicitly choose whether a failed gate is a visible near-miss or omitted from
the returned candidate list.

## Modal and draft-state contract

- Every configuration modal uses `role="dialog"`, `aria-modal="true"`, a
  labelled title, initial focus, Escape-to-close, a focus trap, and returns
  focus to its launching control on close.
- Cancel discards uncommitted edits. Run commits a validated request snapshot.
- Filter, Rank, and Targeted retain independent drafts where those modes are
  available; changing a profile updates only the fields it explicitly owns.
- An account, holdings, universe, or eligibility change invalidates the
  affected scan receipt and displays why the saved draft can or cannot be
  reused.

## Non-goals

- Do not create a universal economic filter matrix.
- Do not make CC/PMCC adopt Filter/Rank/Targeted just for symmetry.
- Do not change a policy from preference to gate, or vice versa, as a UI-only
  refactor.
- Do not enable LEAPS extrinsic-percent filtering without a documented
  denominator and engine support.

## Acceptance criteria

1. Every visible criterion is rendered from a strategy criterion registry and
   declares lifecycle, unit, off state, and summary text.
2. The same registry drives the pre-run receipt and the applied-rules/result
   receipt, preventing label drift.
3. A test proves every pill-to-value and input-to-preset/Custom transition,
   including independent groups on the same screen.
4. Tests prove no control is labeled Gate when the current engine retains it as
   a preference or result filter, and no true rejection rule is hidden as a
   preference. This includes CSP delta behavior and PMCC trend alignment/short
   OI behavior.
5. Tests cover zero-eligible, unavailable LEAPS, loading, no-account, and
   invalid-range states.
6. Tests prove each lifecycle's retention/recovery rule, including whether a
   failed gate becomes an auditable near-miss or requires a rescan.
7. Screen-reader and keyboard tests cover dialog semantics, initial and return
   focus, focus trapping, labels, selected pill state, validation messages,
   and disabled Run states.
8. Tests cover Cancel, per-mode draft preservation, profile changes, and
   account/universe/eligibility invalidation.
9. Screenshots/regression tests cover each strategy configuration and its
   applied-rules receipt.

## Validation and rollout

1. Validate registry semantics against the engine before each strategy is
   migrated.
2. Ship behind the existing Screener route without changing order-placement
   behavior.
3. Compare scan counts and qualification reasons before/after migration; any
   count change must be attributable to an approved engine-policy change.
4. Keep the v4 mockup as the visual review reference until implementation
   screenshots replace it.
