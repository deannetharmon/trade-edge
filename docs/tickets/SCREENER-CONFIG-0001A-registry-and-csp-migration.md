# SCREENER-CONFIG-0001A — Scan-configuration registry and CSP migration

## Status

**Approved by Dean 2026-09-23. Built 2026-09-23 (Dane); see [the implementation report](../implementation/SCREENER-CONFIG-0001A-implementation-report.md).** Paul, Ian, Alan, and Diane aligned. Behavior and copy spec: Diane's v5 mock (CSP Targeted, CSP Rank, active-rules receipt), https://claude.ai/artifact/DnzSSeC1vwhbpHq44NKtLp, **as corrected on 2026-09-23 (delta is a preference; see decision 3)**. The mock is not the visual spec (see SCREENER-VISUAL-0001). Implements Phases 1 and 2 of `SCREENER-CONFIG-0001` as one build. Filter mode is out.

## Decisions of record

1. Combined build: registry shell and CSP migration together (Dean).
2. Rank and Targeted only for CSP and Spreads. Filter is not restored.
3. **DTE is the only CSP search range** (fetch; rescan to change). **Short-put delta is a preference, not a search range.** `cspSearch.ts` keeps every quote-valid put in the DTE window and sets `deltaTargetPassing`. Outside the band a put is kept, shown with a warning, ranks below puts nearer the band center, and cannot be a Best Opportunity (`isBestOpportunitiesEligible`, CSP-BESTOPP-GATE-0001). *Correction, 2026-09-23:* the first version of this decision, and the v5 mock's tag, called delta a search range. That came from a stale comment at the top of `cspSearch.ts`. The code, and the original ticket text, were right. Ian approved the corrected label and asked that the receipt line carry the consequence.
4. Bid/ask liquidity is a fixed gate, not a setting: strong at or under max($0.10, 10% of mid); borderline up to 15% of mid is kept but excluded from Best Opportunities; poor fails (`classifyCspLiquidity`). `rules.bidAskMax` no longer governs pass/fail. No editable bid/ask control exists, in the modal or the registry.
5. IVR cap is enforced per symbol (`DISQUALIFIED_IVR`). A missing IVR does not fail closed today. This build labels that truthfully and does not change it. Fail-closed is CSP-IVR-0001.
6. No engine policy change in this build. The IVR check moved unchanged from `app/screener/page.tsx` to `lib/scans/cspIvrPolicy.ts` so a test can pin it.

## Scope

In:
- Criterion registry, receipt builders, and shared pill and input components.
- CSP Rank and Targeted configuration modal rendered from the registry.
- CSP pre-run summary and result receipt built from the same registry, with result counts.

Out: Spreads (inline `RunModeModal` in `app/screener/page.tsx`), CC, PMCC, LEAPS, engine policy changes, visual alignment, screenshots.

## Files

- `lib/screener/scanConfig/types.ts` — `Lifecycle` (`fetch | gate | rank | advisory | result-filter | read-only`), retention table, summary groups.
- `lib/screener/scanConfig/presets.ts` — exact-match-to-preset else Custom; OI presets 100, 200, 300, 500.
- `lib/screener/scanConfig/cspRegistry.ts` — the CSP criteria, `buildCspReceipt`, `valuesFromSnapshot`, `summarizeCspResults`.
- `lib/screener/scanConfig/cspValidation.ts` — field-level validation, the same rules the modal always enforced.
- `lib/scans/cspIvrPolicy.ts` — the CSP IVR check, unchanged behavior.
- `features/screener/components/scanConfig/` — `LifecycleTag`, `CriterionPills`, `CriterionInput`, `ScanReceiptPanel`.
- `CspScanModal.tsx` and `ActiveCspRules.tsx` rebuilt on the registry; `app/screener/page.tsx` passes result counts to the receipt.

## CSP registry

| Criterion | Lifecycle | Modes | Off state | Copy |
|---|---|---|---|---|
| DTE range | fetch | Rank, Targeted | n/a | Search range, rescan to change |
| Preferred short-put delta | rank | Rank, Targeted | n/a | Preference. Outside the band: kept, warned, not a Best Opportunity |
| POP at least | gate | Targeted | Any | Below = targeted near-miss |
| OTM at least | gate | Targeted | Any | Below = targeted near-miss |
| Minimum period return on collateral (ROC) | gate | Targeted | Any | % of collateral over the option period |
| Then order by | rank | Rank | None | Score is always primary |
| After the scan (POP, OTM, DTE, delta, credit-ratio chips) | result-filter | Rank | n/a | No rescan |
| Bid/ask liquidity | gate (fixed) | both | not adjustable | Strong, borderline, poor tiers |
| Open interest | advisory | both | n/a | Lower OI kept with a warning; zero OI cannot be a Best Opportunity |
| IVR cap | gate | both | n/a | Above the cap disqualifies the symbol |
| IVR floor | rank | both | n/a | Below the floor ranks lower |
| Earnings inside expiration | gate (fixed) | both | n/a | Disqualifies the candidate |
| Affordable only / per-put cash ceiling | gate (optional) | both | Off / blank | Collateral shown when off |

**Missing IVR:** the summary and receipt state "IVR cap not enforced when IVR is unavailable," and the result receipt shows how many symbols were affected. Copy only; no engine change.

## Modes and types

- The modal offers Rank and Targeted only. The dead Filter draft is removed. A request left over from Filter mode opens as a Rank draft with the same rules.
- `CspRuleSnapshot.mode` keeps `'filter'` in its type and validator so older cached sessions still load. The snapshot schema is unchanged. The result receipt labels such a session "Filter (older scan)."
- Presets keep their stored `BID_ASK_MAX` values (inert). They are not displayed.

## Tests (Alan owns the fixtures)

Lifecycle claims are proven against the engine in `lib/scans/__tests__/cspConfigTruthfulness.test.ts`: DTE is the only fetch boundary; a put outside the delta band is kept, marked, and not Best-Opportunity eligible; bid/ask tiers pass or fail as specified and `BID_ASK_MAX` changes no outcome; low OI is warned and zero OI is not Best-Opportunity eligible; IVR above the cap yields `DISQUALIFIED_IVR`; a missing IVR is kept with a warning (pinned, references CSP-IVR-0001); earnings inside expiration disqualifies. A pinned map fails if any criterion's lifecycle changes.

Also covered: registry structure, receipts from one registry, result counts, presets and pill transitions, validation, the modal's tags, pills, live summary, inline validation, drafts, and dialog behavior.

## Verification

- `tsc --noEmit -p tsconfig.check.json` and the `app/screener`, `features/screener`, `lib/screener`, and `lib/scans` suites. CI runs the full suite on push.
- Scan behavior is unchanged: the engine is untouched, and the IVR check keeps its exact strings and results.
- Vercel preview is the authoritative build check.

## Sibling paths confirmed untouched

Spreads `RunModeModal`, CC, PMCC, and LEAPS modals; `scanPreferences.ts` and the scan-defaults page; session cache and snapshot validation; `lib/ai-policy` scanSession registry; Best Opportunities gating.

## Follow-ups

- `CSP-IVR-0001` — missing IVR fails closed (Ian, engine policy).
- `SCREENER-VISUAL-0001` — cross-strategy visual alignment.
- Next phases of `SCREENER-CONFIG-0001`: CC, PMCC, LEAPS, then Spreads. Check the v4 Spreads mock for a Filter pill first.
