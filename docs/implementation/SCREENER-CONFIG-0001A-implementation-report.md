# SCREENER-CONFIG-0001A — Implementation report

**Date:** 2026-09-23 · **Built by:** Dane · **Base:** `e0e6c40`

## What changed

The CSP scan-configuration modal, its pre-run summary, and the result receipt are now built from one criterion registry. Each control shows what the engine does with it (a lifecycle tag), offers quick-select pills, and states its unit. Filter mode is gone from the modal.

| Area | Change |
|---|---|
| `lib/screener/scanConfig/` (new) | `types.ts`, `presets.ts`, `cspRegistry.ts`, `cspValidation.ts`: the vocabulary, preset matching, the CSP criteria with receipt builders and result counts, and field-level validation. |
| `lib/scans/cspIvrPolicy.ts` (new) | The CSP IVR check, moved out of `app/screener/page.tsx` with the same results and the same strings. |
| `features/screener/components/scanConfig/` (new) | `LifecycleTag`, `CriterionPills`, `CriterionInput`, `ScanReceiptPanel`. |
| `CspScanModal.tsx` | Rebuilt on the registry. Rank and Targeted only. Same drafts, presets, Targeted confirmation, and request shape. |
| `ActiveCspRules.tsx` | Rebuilt on the registry, with result counts. |
| `app/screener/page.tsx` | Uses `evaluateCspIvr`; passes result counts and capital settings to the receipt. |

## A correction to the approved spec

The approved decision and the v5 mock called CSP delta a **search range**. The code says otherwise: `cspSearch.ts` keeps every quote-valid put in the DTE window and only marks whether it is inside the delta band. Outside the band a put is kept, warned, ranked lower, and cannot be a Best Opportunity. The spec came from a stale comment at the top of `cspSearch.ts`. **DTE is the only fetch boundary; delta is a preference** (tag PREFERENCE). Ian approved the corrected label and asked the receipt line to carry the consequence. The ticket and the mock are corrected in this commit. Every other lifecycle was re-checked against code, not comments.

## Deviations and behavior notes

- The Rank secondary sort stays a dropdown (the existing control and its tests). The mock drew pills; visuals are deferred (SCREENER-VISUAL-0001).
- New per-field validation messages, announced politely beside each field. The rules are exactly the ones the modal always enforced.
- A request left over from Filter mode opens as a Rank draft with the same rules. `CspRuleSnapshot.mode` and the cached-session validator still accept `'filter'`; the receipt labels such a session "Filter (older scan)."
- The result receipt's wording changed (for example "Order Score → rocPct" became "Order: Score → ROC %"). Nothing else reads that text.
- Five existing assertions were updated on purpose: four in `CspScanModal.test.tsx` (they pinned the old hide-first Filter state and the old preview copy) and one in `ActiveCspRules.test.tsx`.
- Not changed: the engine, scan results, the snapshot schema, the `filter` key in the page's per-mode request state (harmless, cleanup deferred), and Spreads.

## Sibling paths checked

Spreads `RunModeModal`, CC, PMCC, LEAPS modals, `scanPreferences.ts` and the scan-defaults page, session cache and snapshot validation, `lib/ai-policy` scanSession registry, Best Opportunities gating. None changed.

## Verification

- `npx tsc --noEmit -p tsconfig.check.json`: 0 errors.
- Full suite (`npx vitest run`): 333 files, 4,737 tests. **4 failed, all on the unchanged base `e0e6c40`, none caused by this work:**
  - 2 in `CspCandidateDiscovery.test.tsx` (NKE two-candidate fixture; account-status label).
  - 1 in `PositionsWorkspace.test.tsx` (TradingView chart link).
  - 1 in `lib/ai-policy/__tests__/importBoundary.test.ts` (`lib/screener` imports the AI policy: `scanPreferences.ts` imports `RedisLike` from it).
- 100 new tests: registry (25), presets (8), validation (16), engine truthfulness (20), pills and tags (8), modal (23).
- Mutation check: relabeling delta as a fetch range fails 2 tests (the pinned lifecycle map and the modal tag test).

## Not covered by an automated test

- The result counts on the rendered receipt. `summarizeCspResults` is tested; passing `results` into it happens in `page.tsx`. Check on the preview after a CSP scan.
- Focus returning to the launch button on close, and receipt invalidation after an account or universe change. Both live in `page.tsx` and are unchanged.
- Screenshots per strategy (deferred with SCREENER-VISUAL-0001).

## Check on the Vercel preview

Open FIND CSPs. In Rank and in Targeted confirm: the lifecycle tags (DTE SEARCH RANGE · RESCAN, delta PREFERENCE, bid/ask GATE · FIXED, OI ADVISORY); the pills; the live Scan summary; no bid/ask control. Run a CSP scan and check the "Active CSP rules" receipt shows the counts and, if any symbol has no IV rank, the IVR warning.
