# SCREENER-CONFIG-0001B — Implementation report

**Date:** 2026-09-23 · **Built by:** Dane · **Base:** `0a4efe5` **plus CSP-IVR-0001** (this build assumes `CSP-IVR-0001.sh` has been applied; its script refuses to run otherwise).

## What changed

Covered calls now have the scan configuration the CSP screen got: a registry-driven modal with lifecycle tags and quick selects, a live scan summary, and a result receipt. The results view's Call OI chip starts at Any.

| Area | Change |
|---|---|
| `lib/screener/scanConfig/` | `ccRegistry.ts` and `receipt.ts` (new); `types.ts` gains the "Always applied" and "Capacity" groups. |
| `CcScanModal.tsx` | Rebuilt on the registry. Same props, inputs, accessible names, validation, holdings chips, and Run behavior. |
| `ActiveCcRules.tsx` (new) | The result receipt: rules, and counts by symbol. |
| `ScanReceiptPanel.tsx`, `LifecycleTag.tsx` | Shared rows plus a CC panel; a bare panel is a plain block (no duplicate region); tag text fixes. |
| `app/screener/page.tsx` | `ccMinOi` (default Any) for the Call OI chip and the CC advisor; a session-keyed record of the rules a CC scan ran with; the receipt. |

## Findings

- **CC results controls verified against the real screen.** The receipt's "Adjustable after the scan" line was checked against the rendered CC results: POP, OTM, IVR, Call OI chips and the sort. (CSP's version of this line was wrong; this one is right.)
- **The CC sort shows three buttons that do nothing** (Width minus debit %, Breakeven distance %, Annualized ROI %), the same inert-field wart Ranked had. Left alone; `SPREAD_SORT_FIELDS` would fix it in one line.
- **No IV rank rule for covered calls.** Nothing to add; the registry does not invent one.
- **The earnings check is fail-open when no earnings date is on file**, for CC and CSP. Pinned by a test; a follow-up ticket candidate.

## Sibling paths checked

The CC modal's callers (`page.tsx` only); the CC advisor's OI filter (now `ccMinOi`); CSP, PMCC, and spreads keep their own OI state; `runCcScan` (session id now recorded); the CSP receipt (only the shared panel markup changed).

## Verification

- `npx tsc --noEmit -p tsconfig.check.json`: 0 errors.
- Full suite (`npx vitest run`, on top of CSP-IVR-0001): **337 files, 4,814 tests, all passing.**
- New tests: engine truthfulness (20), registry (22), modal (20), receipt (5), page level (2).
- Mutation checks: a wrong Call OI default fails a page test; mislabeling OI as a search limit fails two tests.

## Not covered by an automated test

How it looks on a real account. On the preview: FIND CCs shows the tags, pills, summary, and no bid/ask percentage; run a CC scan and check the "Active CC rules" banner and that Call OI starts at Any.
