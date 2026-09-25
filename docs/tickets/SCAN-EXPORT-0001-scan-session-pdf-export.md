# SCAN-EXPORT-0001 — Scan Session PDF Export

## Owner

Dane

## Status

Approved for implementation — Diane’s design requirements incorporated 2026-09-24

## Product decision

Every completed screener session must be exportable as a self-contained, print-optimized research report. The first format is PDF, created through the browser’s native print dialog (Save as PDF), rather than a spreadsheet or a third-party PDF-generation service.

This is a **research snapshot**, never an order ticket or a source of live executable pricing. The report must make its scan timestamp, quote freshness, and market status obvious on every exported page.

## Problem

Scan results are currently useful only while they remain open in TradeEdge. A trader cannot reliably preserve a completed scan for later study, compare it to later scans, or share a decision record without manually capturing screenshots. That loses the scan configuration, candidate evidence, exclusions, and quote context needed to understand why each result qualified or failed.

## User value

A trader can save the complete outcome of a spread, CSP, covered-call, PMCC, or LEAPS scan as a readable report and study it independently of the live application.

## Scope

### Applies to every completed screener session

- Ranked, Targeted, and other supported screener modes.
- BPS, BCS, IC, CSP, covered call, new PMCC, held-LEAP short-call candidates, and LEAPS results.
- A scan with zero candidates, partial symbol failures, or only disqualified results is still exportable.
- The capability uses the completed, persisted scan session and its associated result data. It must not launch a new scan or refetch market data.

### Default report contents: full scan snapshot

The default export includes every result from the completed session—not merely cards currently visible after display filters, sorting, grouping, or collapsed disclosures.

1. **Report identity**
   - TradeEdge report title, export time, scan completion time, scan mode, and requested strategies.
   - Market status and quote-freshness statement, including an after-hours/stale-data warning when applicable.
   - The report footer: `Research snapshot only. Quotes and eligibility are not live execution authorization. Revalidate before trading.`

2. **Scan configuration and accounting**
   - Selected universe and selected-symbol count.
   - Active scan criteria, including relevant strategy, DTE, POP, credit, OTM, OI, IVR, liquidity, trend, and strategy-specific rules.
   - Selected/planned/attempted/evaluated/failed/skipped/qualified/disqualified totals.
   - Ruleset or configuration version when it is available in the session.

3. **Qualified or actionable candidates**
   - One compact summary row per candidate followed by complete decision evidence.
   - Underlying price, strategy, legs, expirations/DTE, credit or debit, max risk when applicable, POP/ROC/OTM, relevant deltas, OI, IV/IVR, score, quote evidence, and decision warnings.
   - Explicit strategy semantics. For example, a held LEAP must say `Held LEAP short-call candidate` and must never be represented as an existing PMCC unless a short call is actually held.

4. **Near misses, disqualified candidates, and audit results**
   - Candidate structure and all human-readable qualification or rejection reasons.
   - Strategy-specific evidence used to reach the decision, including PMCC held-LEAP cost-basis or breakeven-floor reasoning where applicable.
   - Symbol-level failures, exclusions, cancellations, supersessions, and no-candidate outcomes.

### Export control and scope choice — Diane-approved design

- Place an **Export PDF** control beside the existing result-export controls. It appears only after a scan completes and its session data is available.
- Before a scan completes, do not show an active export control. If the control is visible while session data is unavailable, it must be disabled with a short explanation.
- Clicking **Export PDF** opens a compact, keyboard-accessible scope menu. It presents:
  - **Full completed scan** — default and recommended.
  - **Current filtered view**.
- Under the choices, show: `Opens print preview. Choose Save as PDF to create your report.`
- Do not add an export setup wizard, a file-name form, or an extra confirmation step.

### Optional export scope

The export control offers two clearly named choices:

- **Full completed scan** — default; exports the complete session outcome.
- **Current results view** — exports only the currently visible, display-filtered results, while retaining the full scan identity and accounting summary so the limited scope cannot be mistaken for the whole scan.

The report must display which choice was exported.

### Delivery model

- Do not add a backend PDF service, a dependency on external storage, or a new market-data request.
- Build a print-specific report view from a pure, typed scan-export view model.
- Open that view in a dedicated print context and invoke the browser’s native print flow. The user chooses **Save as PDF** in the browser dialog.
- The report must paginate cleanly on Letter-size paper, repeat its report identity/footer, avoid clipping, and keep a candidate heading with its first evidence block where feasible.
- Hide interactive UI: buttons, filters, expand/collapse controls, order actions, refresh controls, and navigation must not appear in the printed report.

### Print-report layout — Diane-approved design

- Begin with a compact report-identity and scan-summary area; do **not** add a separate cover page.
- Present sections in this order:
  1. Qualified opportunities
  2. Held LEAP short-call candidates
  3. Other non-actionable candidates
  4. Symbol outcomes and scan failures
- Put any stale/after-hours quote warning immediately below the scan timestamp and render it with text as well as color.
- Use color-independent status labels throughout the report. Do not rely on red, green, amber, or cyan alone to communicate qualification, caution, or rejection.
- Use print-specific typography and page breaks to keep a candidate heading with its first evidence block whenever practical. Report headers and the research-snapshot footer repeat across pages.
- Never print application navigation, filters, card toggles, buttons, order actions, refresh actions, or other interactive controls.
- Held-LEAP wording is mandatory: use **`Potential short-call candidate`** for an unpaired LEAP. Use **PMCC** only when an actual held short call exists.

## Non-goals

- Excel, CSV, JSON, or direct broker-order export; those can be separately scoped later.
- Changing scan calculations, qualification rules, rankings, session persistence, quote retrieval, or trade/order workflows.
- Reconstructing historical scans that were not retained as a completed session.
- Sharing the report externally, cloud storage, email delivery, or user accounts/permissions beyond the existing application session.
- Treating an exported candidate as executable or preserving an order-entry ticket.

## Acceptance criteria

1. After any completed scan with available session data, an export control is available; it is unavailable before a scan runs and communicates why if session data is missing.
2. A full-scan export includes every session result and every symbol outcome, regardless of card collapse state or client display filters.
3. A current-view export includes only visible results and labels itself as a filtered view while retaining the full scan accounting totals.
4. The report includes scan identity, configuration, quote/market status, accounting, candidate evidence, decision/rejection reasons, and the research-snapshot disclaimer.
5. Every supported strategy renders appropriate structure and evidence without blank, misleading, or spread-only fields.
6. Held LEAPS are labeled as potential short-call candidates; the report does not imply an existing PMCC when there is no held short call.
7. The print view contains no controls that can submit orders, refresh data, alter filters, or rerun scans.
8. A large scan produces a complete multi-page print document with no omitted candidates, clipped content, or overlapping sections.
9. The report never includes API keys, broker access tokens, account numbers, or other secrets.
10. The report is generated solely from the existing session snapshot and does not make network calls.
11. The export control appears beside the existing result-export controls after scan completion and uses the Diane-approved two-choice scope menu.
12. The print layout begins with a compact summary area, follows Diane’s required section order, uses text-plus-color status treatment, and contains no interactive application UI.

## Implementation guidance

- Create a strategy-neutral export view model under `features/screener/` or another shared screener boundary. It must accept a completed session plus results and be unit-testable without React, browser printing, or network access.
- Reuse canonical strategy-specific display/decision helpers wherever possible rather than duplicating financial calculations in print markup.
- Keep the interactive screener and printable report as separate views that consume the same snapshot. Do not scrape the rendered screen or clone mutable DOM state.
- Use print CSS for page breaks and print-only headers/footers. Confirm behavior in Chromium-based browsers first.
- Preserve the original raw session timestamp and quote timestamps. Do not replace them with export-time values.
- If a field is unavailable, render `Not available in this scan snapshot`; never invent a value or silently omit a decision-critical field.

## Validation

1. Unit tests for view-model construction across BPS/BCS/IC, CSP, covered call, new PMCC, held-LEAP short-call candidate, and LEAPS fixtures.
2. Tests proving full-scan versus current-view inclusion behavior and unfiltered scan accounting.
3. Tests that stale/market-closed state, symbol failures, missing data, rejected candidates, and held-LEAP floor outcomes render with correct copy.
4. Tests that no report data path calls broker, market-data, or scan APIs.
5. Browser print-preview checks for a small scan, zero-result scan, mixed-results scan, and a large multi-page scan.
6. `npx tsc --noEmit --incremental false`, relevant screener tests, full test suite, `git diff --check`, and `npm run build`.

## Review and approval gate

- **Paul:** product scope, default full-session behavior, and research-versus-execution boundary.
- **Ian:** trader usefulness, strategy wording, and stale-price safeguards.
- **Diane:** approved the export interaction and print-report design incorporated above.
- **Alan:** snapshot boundary, component architecture, privacy, and no-network guarantee.
- **Quinn:** test coverage, large-report behavior, and regression plan.

All five roles approve this ticket. Dane may implement it.
