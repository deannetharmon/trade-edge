# SCAN-HEADER-0001 — One scan header vocabulary across Ranked, Targeted, CSP, CC, PMCC and LEAPS

## Status

**Built 2026-09-25 (small display change; Diane and Ian lenses inline, no separate mock: it reuses the existing CSP header style). Pushed to `main`; full suite 367 files / 5427 tests and real `next build` pass.** Dean's screenshot review of the four scans found four different header vocabularies.

## What changed

- Every scan header leads with the decision-tier counts "N QUALIFIED" then "M DISQUALIFIED" (`features/screener/components/ScanHeaderParts.tsx`, `QualificationCounts`). CSP and PMCC already did; Ranked spreads and Targeted now do. The counts come from the canonical session accounting when it matches the displayed mode, so the header and the accounting strip cannot disagree; the qualified flag is used, never the score.
- Ranked keeps its score-tier dots and Targeted keeps SETUPS and SYMBOLS, now as ambient detail after the counts. The duplicate ENTRIES count (same value as SETUPS) is removed.
- One provenance chip, `ScanProvenanceChip`: "scan 3m ago" (age counted from when the scan finished). The icon distinguishes results kept from this session (⚡) from results reloaded from storage (↺); the tooltip says which. The old "cached" and "restored" words are gone, since a fresh scan used to read "cached 0m ago".
- LEAPS: the header now shows "N of M QUALIFIED" (rows matching the current filters), "N INSUFFICIENT DATA" when any, "N SYMBOLS", and the same chip when the scan time is known. The Export PDF button was already aligned in an earlier change.

## Not changed

- PMCC keeps its extra readiness tallies after the qualified counts.
- LEAPS has no per-symbol accounting (evaluated, failed, skipped) because it has no scan session; it shows only the counts it has.
- No change to what qualifies anywhere.

## Follow-ups still open

- The green "Strong" score badge and "TRADE THIS" on disqualified rows (needs Ian's ruling and the extended mock).
- Red "Earnings in Nd" text on rows where the earnings check passes; OI floor/target wording; red credit numbers on passing checks.
