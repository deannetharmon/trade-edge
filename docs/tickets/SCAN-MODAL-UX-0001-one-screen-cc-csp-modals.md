# SCAN-MODAL-UX-0001: one-screen Covered Call and CSP scan modals

Status: IMPLEMENTED 2026-10-15. Presentation only. Design brief and mocks: TradeEdge project doc `claude/ux-brief-cc-csp-scan-modals.md`.

## Problem
Find Covered Calls needed two scrolling screens and Find Cash-Secured Puts three: a badge and a paragraph on every control, fixed rules as full cards, a summary box that repeated the screen, and large preset cards.

## Sign-offs (inline team lenses)
Diane (mocks, after one fix: Capital moved into the volatility row), Ian (logic preserved, wording changes approved), Quinn (test list), Paul (scope).

## What changed
- Both modals are 720 / 760 px wide and one screen (measured in a browser: CC 439 px, CSP Rank 481 px, CSP Targeted 608 px tall; the app caps modals at 92% of the viewport height, 644 px on a 700 px screen).
- A colored dot per control replaces the tag pill; one legend line decodes the dots. The tag text ("SEARCH RANGE · RESCAN", "GATE · FIXED") stays in the page for screen readers.
- Help text moved into an "i" tooltip (hover, keyboard focus, tap). Every tooltip is the text the control already had.
- Fixed rules are one "Always applied" strip, each rule named on screen. CSP also keeps "No IV rank = disqualified" as its own chip.
- Scan summary box replaced by a short recap next to Run, built from the same registry.
- CSP preset cards and mode cards became one-row selectors. Radio semantics, arrow keys and the "Selected" cue are unchanged.
- Max bid/ask width and its dollar ceiling share one row. Both rules still apply.
- New shared pieces in `features/screener/components/scanConfig/`: `InfoTip`, `LifecycleDot`, `ScanLegend`, `AlwaysAppliedStrip`, `CompactControls`. `ScanModalShell`, `CriterionInput`, `CriterionPills`, `ScanModeRadioGroup` gained optional compact props; their default rendering is unchanged.

## Not changed
Every gate, default, threshold, rescan requirement, eligibility rule and validation message. The CSP request still carries `rankSecondary` (default None), and the Targeted confirm step and "set at least one target" rule are unchanged. Spreads, LEAPS and PMCC modals are untouched.

## Approved wording changes
- CC "OI min" is now "OI pref." (CSP's existing name).
- The earnings rule is named "Earnings buffer · 10 days" in both modals. Each tooltip keeps its own existing rule text.
- The CC delta tooltip no longer mentions cash-secured puts.

## Approved removals (convenience only, typing still works)
- Quick-select chips on CC max width, CC width ceiling, CC OI and CSP OI. DTE and delta keep theirs, and Targeted POP / OTM / ROC keep theirs (Any is an explicit off state).
- CSP "Then order by" left the modal. It only seeds the sort the results view already offers (`OiAndSortControls`), and the request keeps its value.

## Tests
CC and CSP modal tests updated for the new layout; added tests for the strip, legend, tooltips and recap; registry tests assert every fixed rule has a strip name, one name per concept across CC and CSP, and that `rankSecondary` is still passed through. One discovery test now uses the OI preference as its edited Rank field. Full suite green.

## Follow-ups
- Dean: look at both modals on the laptop screen in market hours, including the no-holdings banner and a Targeted error state.
- Optional: apply the same compact treatment to PMCC's receipts later; none planned.
