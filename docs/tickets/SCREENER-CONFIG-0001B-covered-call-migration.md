# SCREENER-CONFIG-0001B — Covered-call scan configuration on the registry

## Status

**Approved by Dean 2026-09-23; built 2026-09-23 (Dane); see [the implementation report](../implementation/SCREENER-CONFIG-0001B-implementation-report.md).** Behavior and copy spec: Diane's CC mock on the real app theme, https://claude.ai/artifact/5iw6rGRfkrGvuuHuZKXVCN, with Ian's corrections (earnings wording, cost-basis caveat, delta quick selects, "Click"). Third phase of `SCREENER-CONFIG-0001` (after the shell and CSP in `SCREENER-CONFIG-0001A`).

## Decisions of record

1. Covered calls have one mode. No Rank or Targeted, and no presets (the CC modal's own V1 decision stands).
2. Every lifecycle is checked against the engine code (`lib/scans/covered-call-finder.ts`), not comments. The registry states what covered calls do, which differs from cash-secured puts and PMCC (see `SCAN-ALIGN-0001`).
3. The results view's Call OI chip starts at **Any**, matching CSP. OI is advisory for covered calls (OI-LIQUIDITY-CHOICE-0001 removed it from the gate), so a thin-OI call is shown with its warning, not hidden by default. Approved by Dean; Ian recommended it.
4. A CC result receipt ("Active CC rules") is added, built from the same registry as the modal's scan summary.
5. No engine policy change.

## Criteria

| Criterion | Lifecycle | Fixed | Behavior |
|---|---|---|---|
| DTE range | fetch | no | Expirations outside it are never fetched; rescan to change |
| Delta range | fetch | no | A hard limit: a call outside it is never a candidate |
| Max bid/ask width | fetch | no | A real dollar-per-share setting; wider calls are never candidates |
| OI min | advisory | no | Lower OI is kept with a warning. The results view shows every call by default |
| Minimum strike | fetch | yes | At or above the stock price, and above cost basis when known. Unknown cost basis: kept, flagged |
| Quote validity | fetch | yes | Two-sided, uncrossed, finite |
| Earnings | fetch | yes | A call expiring on or after the earnings date is excluded on its own. No earnings date on file: the check cannot apply |
| Share capacity | read-only | yes | Quantity limited to available covered contracts; a position with none is skipped |
| After the scan | result-filter | yes | POP, OTM, IVR, and Call OI chips and the sort. No rescan |

## What changed

- `lib/screener/scanConfig/ccRegistry.ts` (new) and the neutral `receipt.ts` builder. The shared summary groups gain "Always applied" and "Capacity."
- `CcScanModal` is rendered from the registry. Its six inputs keep their accessible names and validation; new: lifecycle tags, quick selects for DTE, delta, width, and OI, the always-applied rows, inline validation messages, and a live scan summary with the capacity of the selected positions.
- `ActiveCcRules` (new) shows the rules the scan ran with and result counts by symbol (a CC scan returns one best call per symbol). It is tied to the scan's session: a CC session carries no rule snapshot, so a scan restored from cache shows no rules receipt rather than a guess.
- The shared receipt panel is split into rows plus a panel per strategy. A bare panel is a plain block, so the "Active CSP rules" and "Active CC rules" regions are no longer duplicated for screen readers.
- A fixed limit's tag no longer says RESCAN (it cannot be changed), and read-only rows are not tagged FIXED.

## Tests (Alan owns the fixtures)

Lifecycle claims are proven against the engine in `lib/scans/__tests__/ccConfigTruthfulness.test.ts`, with a pinned map that fails if any criterion's lifecycle changes: delta is a hard limit; width is honored; minimum strike and the cost-basis caveat; quote validity; earnings on, before, and after expiry, past earnings, and no date (pinned as current behavior); OI advisory even at zero; capacity. Registry, modal, receipt, and page-level tests cover the rest.

## Out of scope

PMCC, LEAPS, and Spreads migrations; any engine policy change (see `SCAN-ALIGN-0001`); visual alignment across strategies (`SCREENER-VISUAL-0001`).
