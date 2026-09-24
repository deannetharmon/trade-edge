# Mock 1 and Mock 2 redrawn onto the real UI (Diane, 2026-09-24)

**Supersedes Mock 1 and Mock 2 in `SCAN-ALIGN-0001-mocks.md` for build.** Dane's read-only check found both drew controls that do not exist as drawn (see below). **Approved by Ian 2026-09-24. Dean delegated approval of these two mocks to Ian (2026-09-24: "I trust Ian to approve").** These were drawn as ASCII and text, which Dean cannot review; future mocks must be rendered visually for him (see memory), or, as here, he may delegate to Ian. Diane drew this from Dane's findings and did not open the repo.

## Mock 2 (gates C2)

Real UI: CC is registry-driven (`ccRegistry.ts`, cards "Search range", "Open interest", "Always applied"); PMCC (`PmccScanModal.tsx`) is a flat 2/3-column grid with no cards, presets or registry.

**2A: CC, "Search range" card**
```
+- Search range --------------------------------------+
| Max width                    [ 10 ] % of mid       |
|   [5%] [ 10% ] [15%]         (min $0.05 always)    |
| Width ceiling                [ 0.50 ] $ per share  |
|   [$0.30] [ $0.50 ] [$0.75]                        |
| Rejects wider than max(10% of mid, $0.05), or over |
| the ceiling. Not a percentage of strike.           |
+----------------------------------------------------+
 Errors: "Max width must be 0 or more." / "Width ceiling must be 0 or more."
```
**2B: PMCC, flat grid**
```
[Min Δ 0.15] [Max Δ 0.40] [Max spread % 10]
[Width ceiling $ 0.50 ]   ... (rest of grid unchanged)
 Hint (col-span-full, muted): "Short call only. Rejects wider than
 max(10% of mid, $0.05), or over the ceiling. Warns above 5%."
```

**CC changes** (`ccRegistry.ts:120-134`, default in `lib/scans/constants.ts:55`): keep criterion id `width` and control label "Max width" (`CcScanModalRegistry.test.tsx:65` queries it; the unit goes in the unit slot, not the label); unit "$ per share" becomes "% of mid", default $0.20 becomes 10, presets $0.10/$0.20/$0.30 become 5/10/15; summary "width ≤ 10% of mid (min $0.05)"; add a second control in the same card, "Width ceiling" ($ per share, default 0.50, presets $0.30/$0.50/$0.75, validation "Width ceiling must be 0 or more."); hint becomes "Rejects wider than max(10% of mid, $0.05), or over the ceiling."; `ActiveCcRules.tsx` Search row becomes "width ≤ 10% of mid · cap $0.50" (the only existing receipt). **Dane confirms what `BID_ASK_MAX` means once it holds a percent; renaming it is safer. The shared `BID_ASK_MAX` key is also used by CSP and rinse-repeat with a different meaning (C2 ticket): do not rename or reuse it for those scans.**

**PMCC changes** (`PmccScanModal.tsx`): keep the label "Max spread %" (`ScreenerPage.test.tsx:682/737` depend on it; still mapped to `maxSpreadPct` -> `qualifyingSpreadPctMax=10`); `acceptableSpreadPctMax=5` stays fixed; add one grid cell "Width ceiling ($)" (default 0.50) and one hint line; the ceiling applies to the short leg only.

**Copy.** Changelog line: "Bid/ask width filter now uses the hybrid rule: reject wider than max(10% of mid, $0.05), warn above 5%, and never over a $0.50 ceiling on the CC leg and PMCC short. The old fixed $0.20 default is retired." Static hint: as drawn above.

**Dropped or separate:** dismissible migration note (CC rules are not persisted, so nothing to migrate; changelog line and hint cover it); "Wide spread" amber tag (no tag component exists; separate ticket); PMCC receipt row (no PMCC receipt component; separate ticket).

## Mock 1 (gates F1): PMCC delta range, flat grid
```
Delta range (absolute)                 <- col-span-full label
[Min Δ 0.15] [Max Δ 0.40]
[0.15-0.25] [0.20-0.30] [0.25-0.35]    <- chips, set both fields
Absolute delta of the short call. Lower = further OTM.
(existing note at :114 stays until F2 lands)
```
Min/Max Δ fields (`PmccScanModal.tsx:109-110`, validation 0.10-0.40) stay. Add the group label as a full-width row above the fields (no card), a chips row reusing the pattern at `ccRegistry.ts:111-115`, and the muted hint line under the chips. Receipt row DROPPED (no PMCC receipt component). The note at `:114` ("Delta guides rank; it does not hide an otherwise tradable short call.") is removed only when F2 lands. Out of scope: Run is silently disabled when delta is invalid with no inline error (separate ticket).

## Ian sign-off needed

Chip values 0.15-0.25, 0.20-0.30, 0.25-0.35; CC presets 5/10/15% and $0.30/$0.50/$0.75; hint wording "warns above 5%" and whether the 5% warn level stays non-editable; making CC "Max width" a percent when it was dollars (the approved rule is a percent).
