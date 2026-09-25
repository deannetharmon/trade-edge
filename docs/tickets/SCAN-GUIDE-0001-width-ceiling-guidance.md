# SCAN-GUIDE-0001 — Width-ceiling guidance: report-only scan note and plain-English help

## Status

**Proposed by Paul 2026-09-24 (Dean's request: "I am just not sure I will remember when to change it. Can we build logic in that gives guidance and some simple help there if needed?"). Not approved. Not built.** Paul recommends it goes AFTER D, E and F1 (see Priority). Depends on C2, which is on main (`a44b47c`). Note: Paul drafted from a stale local checkout and found no ceiling code; the shared width function lives in `lib/scans/hybridSpread.ts` on main. Confirm file and function names before Diane and Alan start.

## Problem

C2 added a $0.50 absolute width ceiling on the CC leg and PMCC short, plus percent-of-mid rules. Dean will not remember when to change the ceiling or spread settings, and a silent filter looks like "no candidates" with no clue why.

## Scope (in)

1. **Post-scan info line (report-only).** Per scan and per symbol: "Width rule removed N of M short calls (ceiling: X, percent rule: Y)". **Ian 2026-09-24: the "K more would qualify at $0.75" clause is REMOVED (it nudges toward loosening and breaks "trust the qualified realm"); show the count and the cause only.** Never changes results, ranking or settings.
2. **Nudge (muted and ambient, not amber; Ian and Paul: Paul holds the nudge until its own weight check), only when width/ceiling removed a majority (>50%) of a symbol's otherwise-eligible candidates.** One neutral line pointing at the setting ("Most calls on SYM were removed by the width ceiling. See Width ceiling in scan settings."). States the fact and the location. Does not say "raise it".
3. **Help text beside the fields, one line, no tooltip (Ian, 2026-09-24; drops the "Warns above 5%" claim because warnings are not shown anywhere in the UI, and the "$20 call with a $2 gap" example):** "Max spread %": "Calls with a wider bid/ask gap than this are removed." "Width ceiling ($)": "Removes calls whose gap exceeds this many dollars per share, even if the percent rule passes." Applies to CC "Max width"/"Width ceiling" and PMCC "Max spread %"/"Width ceiling ($)". Paul: ships with or right after PMCC-RECEIPT-0001 part 1.

## Non-goals

Auto-adjusting any setting; an "Apply $0.75" button; any advice that loosens risk limits; changing C2 rules or thresholds; surfacing disqualified candidates or warnings on them ("trust the qualified realm"); guidance for other settings (OI, delta, DTE).

## Data needed (verify against origin/main)

- PMCC: `legRejections` (pmccTypes.ts, built in pmccPairing.ts) carries per-leg reason codes including a bid/ask-too-wide code; it is one code, so percent rule vs ceiling cannot be told apart, and the "would qualify at the next preset" count needs the leg's width.
- CC: covered-call-finder.ts has no rejection list or reason counts. New engine data required.
- Minimal addition (in scope): at the width gate only, tag the rejection PERCENT_RULE or CEILING and record the leg's width; aggregate counts computed in a display helper in `lib/`, not inside the gates. No general rejection-reason framework for CC. If the tag cannot be added without touching gate logic, cut the "would qualify at $0.75" sentence and ship counts alone.

## Acceptance criteria

- Info line appears only when at least one call was removed by width/ceiling.
- Counts equal the number of legs tagged CEILING / PERCENT_RULE; totals reconcile with M.
- The same scan with the info line on or off yields identical results, ordering and settings (test).
- The nudge appears only above the majority threshold, and never on a symbol with zero qualified results caused by other gates.
- Help text present beside all four fields; no tooltip; wording matches Ian-approved copy.
- No NaN, null or undefined in any line; a missing width is excluded from the "next preset" count and the line degrades to counts only.

## Gates

Ian signs off wording (neutral fact plus location only, never advice to loosen risk). Diane produces a RENDERED mock for Dean (not ASCII). Alan only for counting and threshold math. Quinn: result-identity test (guidance on/off) and the CC engine-data change.

## Risks

Guidance reads as a recommendation to widen (Ian gate); CC rejection tagging touches a gate file (tag-only, full suite); visual weight must stay ambient; "next preset" must use only presets already in the modal.

## Priority

Ambient help, not a decision path. Recommend AFTER D, E and F1. Exception: item 3 (help text) alone can ship early: copy only, needs Ian's wording sign-off and Diane's rendered mock, no engine data.

## Validation steps

`tsconfig.check.json` tsc, real `next build`, full suite (gate-adjacent change), Vercel preview.
