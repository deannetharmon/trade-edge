#!/usr/bin/env python3
"""
Fixes a false-positive OI floor failure for BPS/BCS results in Rank mode
and Targeted mode.

ROOT CAUSE: Both exploreAllCandidatesForRank() and runTargetedScan()
override the displayed `oi` check using `Math.min(shortOI, longOI)` --
gating on whichever leg has LESS open interest. This contradicts the
philosophy already documented and correctly implemented in
runChecklist's own oiCheck (search "Weighted on the SHORT leg(s)"):
the short leg is the one you actually trade twice (open + close) and
the one carrying assignment risk, so IT should gate the check. The long
leg is protection that typically only transacts as part of the same
combo order, so thin long-leg OI alone rarely blocks a clean fill.

This was producing false "fail" badges on solid trades whenever the
long (protective) leg happened to have OI just under the floor, even
though the short leg -- the side that actually matters -- was deeply
liquid (e.g. 4042/468: short leg OI of 4042 is excellent, but the old
logic failed the check because the long leg's 468 was just under 500).

This also fixes a latent inconsistency: `qualified` already correctly
referenced runChecklist's own (short-leg-only) oi check, so a trade
could show qualified=true while its own OI badge contradicted it by
showing fail. After this fix, the displayed badge and `qualified`
agree, both gating on the short leg only.

IC strategy already inherits runChecklist's correct logic untouched (it
gates on the worse of the two SHORT legs -- put + call -- which is the
right comparison since both shorts carry equal assignment risk). No
change needed there.

Run from repo root: python3 fix_oi_floor_short_leg_only.py
"""

import sys

FILE = "app/screener/page.tsx"

# ── Patch 1: Rank mode (exploreAllCandidatesForRank) ────────────────
OLD_RANK = """              oi: (() => {
              const minOI = Math.min(bestCandidate.shortOI, bestCandidate.longOI);
              return {
                status: minOI >= appliedRules.OI_MIN ? 'pass' as const : 'fail' as const,
                value: `${bestCandidate.shortOI}/${bestCandidate.longOI}`,
                reason: minOI >= appliedRules.OI_MIN
                  ? `Both legs ≥ ${appliedRules.OI_MIN}`
                  : `Below OI floor ${appliedRules.OI_MIN}`,
              };
            })(),"""

NEW_RANK = """              oi: (() => {
              // Gate on the SHORT leg only -- it's the one traded twice
              // (open + close) and the one carrying assignment risk. The
              // long leg is protection that typically only transacts as
              // part of the same combo order, so its OI alone rarely
              // blocks a clean fill the way thin short-leg OI does.
              const shortLegOi = bestCandidate.shortOI;
              return {
                status: shortLegOi >= appliedRules.OI_MIN ? 'pass' as const : 'fail' as const,
                value: `${bestCandidate.shortOI}/${bestCandidate.longOI}`,
                reason: shortLegOi >= appliedRules.OI_MIN
                  ? `Short leg ≥ ${appliedRules.OI_MIN}`
                  : `Below OI floor ${appliedRules.OI_MIN} on short leg`,
              };
            })(),"""

# ── Patch 2: Targeted mode (runTargetedScan) ────────────────────────
OLD_TARGETED = """                    oi: (() => {
                      const minOI = Math.min(bestCandidate.shortOI, bestCandidate.longOI);
                    
                      return {
                        status: minOI >= appliedRules.OI_MIN ? 'pass' as const : 'fail' as const,
                        value: `${bestCandidate.shortOI}/${bestCandidate.longOI}`,
                        reason: minOI >= appliedRules.OI_MIN
                          ? `Both legs ≥ ${appliedRules.OI_MIN}`
                          : `Below OI floor ${appliedRules.OI_MIN}`,
                      };
                    })(),"""

NEW_TARGETED = """                    oi: (() => {
                      // Gate on the SHORT leg only -- it's the one traded twice
                      // (open + close) and the one carrying assignment risk. The
                      // long leg is protection that typically only transacts as
                      // part of the same combo order, so its OI alone rarely
                      // blocks a clean fill the way thin short-leg OI does.
                      const shortLegOi = bestCandidate.shortOI;

                      return {
                        status: shortLegOi >= appliedRules.OI_MIN ? 'pass' as const : 'fail' as const,
                        value: `${bestCandidate.shortOI}/${bestCandidate.longOI}`,
                        reason: shortLegOi >= appliedRules.OI_MIN
                          ? `Short leg ≥ ${appliedRules.OI_MIN}`
                          : `Below OI floor ${appliedRules.OI_MIN} on short leg`,
                      };
                    })(),"""

def apply_patch(content, old, new, label):
    if old not in content:
        print(f"ERROR: Could not find target block for {label}. No changes made.")
        sys.exit(1)
    count = content.count(old)
    if count != 1:
        print(f"ERROR: Expected exactly 1 match for {label}, found {count}. Aborting.")
        sys.exit(1)
    return content.replace(old, new, 1)

def main():
    with open(FILE, "r", encoding="utf-8") as f:
        content = f.read()

    content = apply_patch(content, OLD_RANK, NEW_RANK, "Rank mode oi override")
    content = apply_patch(content, OLD_TARGETED, NEW_TARGETED, "Targeted mode oi override")

    with open(FILE, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"Patched {FILE}: Rank mode and Targeted mode BPS/BCS results now "
          f"gate the OI floor check on the short leg only, matching "
          f"runChecklist's own correctly-weighted logic.")

if __name__ == "__main__":
    main()