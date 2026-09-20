# LEAPS-UI-0001 — Ticker leads the LEAPS result row

**Requested by:** Dean, 2026-09-20 ("the ticker is hard to find; it should be right left of the score, not buried after Contract Qualified")
**Base:** `main` @ 28b843eb
**Team positions (advisory):** Diane approves the reorder and the modest size bump; Ian and Paul: no objection (display only).

## What changed

| File | Change |
|---|---|
| `app/screener/page.tsx` (`LeapsResultRow` header) | The ticker is now the first element of the row, immediately left of the score, at 14 px bold (was 11 px, after the status badge). Order is now: **ticker · score/chart · status badge · price · ITM% …**. Nothing else in the row moved or changed. Two `data-testid`s added (`leaps-result-ticker`, `leaps-result-score-column`) |
| `app/screener/__tests__/ScreenerPage.test.tsx` | New test asserting document order ticker → score → status badge and that the ticker sits directly before the score column |

## Sibling and adjacent paths checked

- Only `LeapsResultRow` (the LEAPS candidates list) was changed, as requested. The CSP, Covered Call, and PMCC result cards have their own headers and were not touched; if you want the ticker to lead those too, say so.
- Row components elsewhere use `candidate.symbol` independently; no shared header component exists for LEAPS.
- No new exports from `page.tsx`.

## Verification actually run

- `tsc --noEmit` (temporary es2017 config): exit 0.
- New test passes; it **fails against the previous markup**. `ScreenerPage.test.tsx`: 40 passed.
- Full `vitest run`: **260 files passed; 3309 tests passed, 2 skipped, 1 todo, 0 failed** (the 3308 from before plus this one).
- **Not verified:** the visual result in a browser (jsdom checks order, not looks). Please look at the LEAPS list once after deploy.
