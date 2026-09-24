# CSP-IVR-0001 and the CSP OI default — Implementation report

**Date:** 2026-09-23 · **Built by:** Dane · **Base:** `0a4efe5` · **Decisions:** Dean, following Ian's recommendations.

## What changed

1. **A symbol with no IV rank now fails the IVR cap closed** (CSP-IVR-0001). Every candidate is classified `DISQUALIFIED_IVR_UNAVAILABLE`, kept visible in the Disqualified audit with its reason, and counted on the result receipt.
2. **The CSP results view starts with the Put OI chip at Any.** It defaulted to 100, which hid the NKE OI-78 put. Open interest is advisory for CSP: low OI is warned about, and a trader can still choose a floor.

| File | Change |
|---|---|
| `lib/scans/cspQualification.ts` | New market state `DISQUALIFIED_IVR_UNAVAILABLE`. |
| `lib/scans/csp-finder.ts` | `ivrUnavailableDisqualified` parameter (off by default). Precedence: earnings, IVR above cap, IVR unavailable, liquidity. |
| `lib/scans/cspIvrPolicy.ts` | Unavailable IVR is `fail`, with `unavailable: true`. Other cases unchanged. |
| `lib/screener/scanSession.ts` | The cached-session validator accepts the new state. |
| `app/screener/page.tsx` | Passes the flag, adds the specific fail reason, and gives CSP its own OI-chip state (`cspMinOi`, default 0) so CC, PMCC, and spreads keep theirs. |
| `lib/screener/scanConfig/cspRegistry.ts`, `ScanReceiptPanel.tsx` | Copy: the unavailable-IVR rule, the OI default, and the correct list of result chips. |

## Findings

- **The receipt named chips the CSP view does not have.** "Adjustable after the scan" listed credit-ratio chips, but the CSP results view hides them. It now lists POP, OTM, DTE, delta, Exp. IVX, IVR, and Put OI.
- **The two failing `CspCandidateDiscovery` tests were the OI default.** With the fixture's OI set to 150 they passed; with the default at Any they pass as written. Main is green.
- **The validator entry matters.** A scan saved with the new state would have been rejected as invalid without it. A test fails if the entry is removed.

## Sibling paths checked

- `findAllCsp` has one caller (the Screener); the Wheel and other pages do not use it, so nothing else changes.
- The new state appears in no other code path: no label map, no AI-policy allow-list, no export.
- CC, PMCC, and spreads keep the shared `filteredMinOi` default of 100. Targeted CSP already ignored the OI floor.

## Verification

- `npx tsc --noEmit -p tsconfig.check.json`: 0 errors.
- Full suite (`npx vitest run`): **333 files, 4,745 tests, all passing.** It was 4 failing before this work: the two `CspCandidateDiscovery` tests (fixed by the OI default), and the `PositionsWorkspace` and import-boundary tests (fixed in TEST-TRIAGE-0002).
- One existing test needed a change: `ScreenerSessionWiring` ran a CSP scan with no IV rank and expected a qualified result. It now supplies an in-band IV rank, as its own helper was written to do. A test that scans with no IV rank and expects a qualified CSP is exactly what this change makes wrong.
- 8 new tests: 3 page-level (`CspCandidateDiscovery`: unavailable IVR is disqualified and explained, in-band IVR still qualifies, Put OI defaults to Any and still narrows), 3 engine (`cspConfigTruthfulness`), 1 session validator, 1 registry copy.
- Mutation check: removing the new state from the session validator fails its test.

## Not covered by an automated test

The Vercel preview is the check for how the Put OI chip and the disqualified audit look on a real scan. Run a CSP scan on a symbol you know has thin OI, and if you can find one, a symbol with no IV rank.
