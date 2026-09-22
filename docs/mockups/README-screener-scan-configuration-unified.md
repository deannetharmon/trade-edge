# Unified Screener scan configuration — design brief

Open `screener-scan-configuration-unified-v4.html` in a browser for the current design review. It opens the corrected Revision 3 visual artifact; earlier explorations are retained for history. All are design-only, interactive static mockups; none imports or alters application code.

## Revision 4 — narrow qualification correction

- CSP short-put delta is a **qualification gate**, and the targeted summary lists it with POP, OTM, and ROC as a must-qualify condition.
- PMCC short OI minimum is a **qualification gate**, and the summary lists `Short OI ≥ 100` under must qualify. Neither is represented as a preference.

## Revision 3 — final acceptance corrections

- Controls are real labeled `<input>` elements in the mockup, and pills expose `aria-pressed` selected state. The mockup visibly shows a real manual Custom state: Spreads credit is typed as 18% and only `Custom` is selected for that category.
- Every OI quick-selection set uses the consistent `100 / 200 / 300 / 500` ladder.
- CSP now has the same Filter / Rank / Targeted intent selector as Spreads. Its targeted POP/OTM/ROC values are gates; delta, OI, and bid/ask values are accurately presented as search/ranking preferences with the existing independent quality policy.
- CC labels OI as a preference and states the cost-basis guard honestly: current price always applies, while cost basis applies only when verified.
- LEAPS plainly preserves and flags missing delta/OI rather than silently rejecting those candidates. The extrinsic percentage control is intentionally disabled as a decision-needed state: the current standalone engine does not establish a verified percentage denominator, so the mockup does not invent one.

## Revision 2 — source-of-truth corrections

- Pills are compact category rows and are scoped to the strategy (and PMCC leg) that owns the value. A selected pill always matches the displayed value; a manual override becomes `Custom`.
- LEAPS uses only long-DTE fetch presets. Delta, OI, and extrinsic are explicitly result filters, so changing them does not imply a rescan.
- PMCC treats the held long as broker-backed, read-only foundation context. Only short-call DTE is a fetch boundary; short delta is a ranking/guardrail and not a hidden rejection rule.
- CSP distinguishes preferences from gates and states that affordable-only is optional, with the connected-account disclosure retained.
- Covered Call calls OI a minimum and treats the cost-basis/current-price requirement as a fixed broker-derived guardrail. Its zero-eligible screen offers recovery only.
- Spread terminology is `Minimum credit (% of spread width)`. Liquidity policies remain strategy-specific and retain their actual dollar/quality semantics.

## Decision

Use one configuration grammar across the Screener while preserving strategy-specific economics. The mockup deliberately does **not** make every strategy expose the same controls or modes.

1. Context: title, scope, and whether the scan is universe- or holdings-based.
2. Intent: Filter / Rank / Targeted only where it changes the trader's decision (Spreads and CSP).
3. Criteria: grouped as time/distance, return/risk, liquidity/capital, and strategy-specific construction.
4. Always applied: hard safety and eligibility rules are named rather than hidden in footer prose.
5. Summary: a persistent, plain-language account of what will fetch, what must qualify, and what can be changed later as a result filter.

## Boundary legend

Every mockup labels the lifecycle of a criterion:

- **FETCH** — affects the broker data requested; changing it requires a rescan.
- **GATE** — qualifies or rejects candidates during the scan.
- **RANK** — changes the recommended ordering but does not reject candidates.
- **RESULT FILTER** — operates after a completed scan and does not require a rescan.

This distinction is critical: a trader should never mistake an after-scan result filter for a scan-time qualification requirement.

## Consolidation decisions

- **Quick-selection pills lead; manual entry completes the system.** Each numeric/range control presents common, strategy-appropriate choices directly below its field. Selecting a pill fills the field; entering a bespoke value changes that row to `Custom`. Pills include an explicit `Any`, `No cap`, or `Not required` option when the filter can be off.
- Use `DTE range`, `Delta range`, `Minimum OI`, and `Maximum bid/ask width` consistently, including units (`days`, `contracts`, `$ per share`, `%`).
- Preserve `Minimum credit / risk` for defined-risk spreads only. CSP uses `Minimum period ROC`; it must not borrow spread credit/risk terminology.
- Use explicit off states: `Any`, `No cap`, and `Not required`. Numeric `0` must not secretly mean off.
- Keep PMCC's foundation and income legs separate. Its two-leg construction is real strategy complexity, not a layout inconsistency.
- Treat broker capacity as an automatic eligibility condition for CSP and holdings-based strategies. A zero-eligible state disables Run and offers an actionable recovery path.
- Profiles remain editable. They are recommendations, not hidden modes or locked presets.

### Pill policy

Pills are recommended for repeatable, familiar decisions: DTE, delta, POP/OTM, IVR, OI, quote width, credit percentage, and CSP period ROC. They are also useful for LEAPS extrinsic (`No cap` first) and PMCC leg ranges. A manual numeric/range field remains directly above every pill row for deliberate tuning.

Do not create pills for inherently contextual decisions such as a covered call's cost-basis guard, PMCC structure validation, or broker-capital availability. Those remain clear toggles/statuses because a handful of numeric presets would be misleading.

## Accessibility and interaction requirements for implementation

- Every input needs an associated visible `<label>` and a programmatic name; chips and controls need a minimum practical target size.
- Maintain visible keyboard focus and restore focus to the launching control when a modal closes.
- Do not rely on color alone for selected state, gate type, or disabled state.
- Keep the scan summary and primary action reachable at laptop height; use a sticky summary only when it does not conceal content.
- Preserve drafts on cancel/reopen only when that behavior is intentionally communicated; reset should state exactly what it resets.

## Screens shown

1. Targeted Spreads — profile, target constraints, and result-filter distinction.
2. Cash-Secured Put — return on committed cash, capital eligibility, targeted profile.
3. Covered Call — broker-verified lots and cost-basis guard.
4. PMCC — separate long foundation and short income legs, pair gates.
5. LEAPS — explicit no-cap extrinsic state and ranking preference.
6. Zero-eligible Covered Call — blocked primary action with recovery guidance.
