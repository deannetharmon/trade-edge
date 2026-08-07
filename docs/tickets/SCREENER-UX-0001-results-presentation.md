# SCREENER-UX-0001 — Screener Results Presentation Redesign

## Scope

Redesign the Screener results workspace's information hierarchy and controls
placement so a trader can immediately answer: what produced these results,
how did the scan account for every selected symbol, what filters are active,
which candidates qualified, why the others didn't, and which qualified
candidates rank highest. This is a presentation and interaction change only —
no scanner calculation, qualification rule, scoring formula, canonical
session transition, Covered Call capacity rule, or execution behavior
changes.

Base: `main @ 7308bf5` (SCREENER-RESULTS-0001 Task 1, complete). This ticket
is Task 2 of the Screener rework and depends on Task 1's canonical
`ScreenerScanSession` model, which it treats as read-only.

## Non-goals (explicitly out of scope this pass)

- Buying-power source correction / the `$100,000` placeholder.
- Duplicate React key correction (not forced by this redesign; left
  documented).
- Any scanner, qualification-rule, scoring, or new-strategy change.
- Order construction/execution changes.
- Global navigation, theme selector, Opportunity Universe, LIVE/PAPER
  indicator, or Portfolio-page changes.

## Information hierarchy (required order)

1. Scan identity
2. Reconciled scan accounting
3. Result controls and active filters
4. Best qualified opportunities
5. All qualified candidates
6. Disqualified candidates
7. Symbol-level failures and skips

This order is now enforced for **Filtered mode** (`screenMode === 'filter'`,
`requestedStrategy` one of spreads/csp/cc/pmcc), which is where the concrete,
pre-existing violation lived: the POP/OTM/Credit-Ratio/Strategy/OI/sort
filter row rendered **after** Best Opportunities. It has been moved above.
Scan identity and the accounting summary are now shared components mounted
once, above the mode branch, so they apply to every mode (Filtered, Ranked,
Targeted) without duplicating markup.

Ranked and Targeted modes already render their own filter/sort controls
directly above their own result lists (no Best-Opportunities-before-filters
violation existed there — Ranked/Targeted never feed Best Opportunities
duplicated content the same way). Extending the same Disqualified-section and
Symbol-outcomes-disclosure components into Ranked/Targeted/CSP/CC/PMCC's
per-mode branches is documented as follow-up (see Deviations below) — this
pass wires them for Filtered mode as the reference implementation, since
Filtered is the mode with real qualified/disqualified/failed/skipped data in
one place today.

## Component architecture

New, framework-agnostic presentational components under
`features/screener/components/`, each taking an explicit view-model prop
(no direct session/page-state coupling beyond what's passed in):

- `scanIdentity.ts` + `ScanIdentityHeader.tsx` — pure `getScanIdentityTitle(mode, requestedStrategy)` mapping to the six required titles, plus a heading component.
- `AccountingSummaryBar.tsx` — renders `computeSessionAccounting()`'s fields as individually labeled, tooltipped segments (Selected/Planned/Attempted/Evaluated/Failed/Skipped/Qualified/Disqualified), hiding zero-value Failed/Skipped, matching the existing compact single-line style.
- `FilteredResultControls.tsx` — the existing POP/OTM/Credit-Ratio/Strategy/OI+sort/ticker controls extracted verbatim (no behavior change), plus a compact active-filter-chip row (each chip individually removable) and one `Reset result filters` action.
- `BestOpportunitiesShortlist.tsx` — collapsed-by-default top-3 shortlist (Rank/Symbol/Strategy/Expiration-DTE/Strike/Credit/POP/OTM/ROC/OI/Score), each row keyboard-expandable to the existing full recommendation detail; preserves the exact required empty-state copy.
- `DisqualifiedSection.tsx` — section-level collapse with a count in the heading; each candidate collapsed by default showing symbol/strategy/essential structure/primary reason/additional-failure count, expandable to full checks.
- `SymbolOutcomesDisclosure.tsx` — reads `session.symbolOutcomes` directly, groups by Failed / Excluded from scope / Cancelled / Superseded / No qualifying candidate, renders symbol + human-readable reason (via the existing `REASON_CODE_LABELS`), collapsed by default.

`ResultCard` (existing, already strategy-aware — it already branches on
`result.strategy`/`bestCandidate.strategy` for CSP/CC/PMCC/spread-specific
fields from prior tickets) is reused unmodified. No scanner/session file is
touched except `app/screener/page.tsx`'s own render tree, which now composes
these new components instead of inlining the accounting span and the
Filtered-mode filter block.

## Display-filter semantics

Display filters (POP/OTM/Credit Ratio/Strategy/ticker chips/OI+sort) operate
on the already-fetched `results` array client-side, exactly as before this
change — nothing here alters what gets scanned or persisted. The canonical
`activeSession` and its accounting are never recomputed from filtered data;
`AccountingSummaryBar` always renders `computeSessionAccounting(activeSession)`
directly, independent of how many cards are currently visible. A
`Showing X of Y qualified candidates` line appears whenever a display filter
has narrowed the visible Qualified set below its true count.

## Validation

- New focused component tests (`features/screener/components/__tests__/`)
- Existing Screener suite (`app/screener/**`)
- Canonical scan-session tests (`lib/screener/**`)
- `npx tsc --noEmit`
- Full test suite
- `git diff --check`
- `npx next build`
