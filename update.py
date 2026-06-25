#!/usr/bin/env python3
"""
Fixes missing OCC option symbols on candidates produced by
findBestSpreadUnfiltered() and findBestICUnfiltered().

ROOT CAUSE: Neither function ever copied shortOccSymbol/longOccSymbol
(and for IC, shortCallOccSymbol/longCallOccSymbol) from the option
chain legs onto the SpreadCandidate it returns. buildOrderLegs() (used
by TradeModal to actually place an order) reads these fields with a
non-null assertion (c.shortOccSymbol!), so a candidate missing them
produces a leg with symbol: undefined -- which fails silently at
dry-run/order-build time. The Trade button still opens the modal and
shows correct-looking numbers (strikes, credit, etc. are all present),
so this failure mode looks exactly like "nothing happens when I click
Trade" with no obvious cause.

BLAST RADIUS (all three confirmed call sites fixed by this one patch,
since both are shared helper functions):
  1. runChecklist's own "last resort: fully unfiltered" fallback --
     reachable in FILTER mode (and any non-strictOnly caller) whenever
     a symbol falls through both the strict and relaxed candidate
     searches. This affects BPS, BCS, AND IC.
  2. Rank mode's IC candidates (exploreAllCandidatesForRank).
  3. Targeted mode's IC candidates (runTargetedScan).

Rank/Targeted mode's own inline BPS/BCS candidate-building loops
already set these fields correctly themselves and don't call
findBestSpreadUnfiltered for their final candidate, so BPS/BCS in
Rank/Targeted mode were never affected -- only the Filter-mode
fallback path and all IC paths were.

Run from repo root: python3 fix_unfiltered_occ_symbols.py
"""

import sys

FILE = "app/screener/page.tsx"

# ── Patch 1: findBestSpreadUnfiltered ───────────────────────────────
OLD_SPREAD = """      candidates.push({
        strategy,
        expiration: expDate,
        dte: daysUntil(expDate),
        shortStrike: shortLeg.strikePrice,
        longStrike,
        shortDelta: absDelta,
        shortOI: shortLeg.openInterest ?? 0,
        longOI: longLeg.openInterest ?? 0,
        credit,
        spreadWidth: width,
        creditRatio,
        roc,
        pop,
        optimized: false
      });"""

NEW_SPREAD = """      candidates.push({
        strategy,
        expiration: expDate,
        dte: daysUntil(expDate),
        shortStrike: shortLeg.strikePrice,
        longStrike,
        shortDelta: absDelta,
        shortOI: shortLeg.openInterest ?? 0,
        longOI: longLeg.openInterest ?? 0,
        credit,
        spreadWidth: width,
        creditRatio,
        roc,
        pop,
        optimized: false,
        shortOccSymbol: shortLeg.occSymbol,
        longOccSymbol: longLeg.occSymbol,
      });"""

# ── Patch 2: findBestICUnfiltered ───────────────────────────────────
OLD_IC = """  return { strategy: 'IC', expiration: expDate, dte: daysUntil(expDate), shortStrike: putSpread.shortStrike, longStrike: putSpread.longStrike, shortDelta: putSpread.shortDelta, shortOI: putSpread.shortOI, longOI: putSpread.longOI, credit: putSpread.credit, spreadWidth: putSpread.spreadWidth, creditRatio: putSpread.creditRatio, roc, pop: (1 - putSpread.shortDelta - callSpread.shortDelta) * 100, shortCallStrike: callSpread.shortStrike, longCallStrike: callSpread.longStrike, shortCallOI: callSpread.shortOI, longCallOI: callSpread.longOI, callCredit: callSpread.credit, callWidth: callSpread.spreadWidth, totalCredit, optimized: false };"""

NEW_IC = """  return { strategy: 'IC', expiration: expDate, dte: daysUntil(expDate), shortStrike: putSpread.shortStrike, longStrike: putSpread.longStrike, shortDelta: putSpread.shortDelta, shortOI: putSpread.shortOI, longOI: putSpread.longOI, credit: putSpread.credit, spreadWidth: putSpread.spreadWidth, creditRatio: putSpread.creditRatio, roc, pop: (1 - putSpread.shortDelta - callSpread.shortDelta) * 100, shortCallStrike: callSpread.shortStrike, longCallStrike: callSpread.longStrike, shortCallOI: callSpread.shortOI, longCallOI: callSpread.longOI, callCredit: callSpread.credit, callWidth: callSpread.spreadWidth, totalCredit, optimized: false, shortOccSymbol: putSpread.shortOccSymbol, longOccSymbol: putSpread.longOccSymbol, shortCallOccSymbol: callSpread.shortOccSymbol, longCallOccSymbol: callSpread.longOccSymbol };"""

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

    content = apply_patch(content, OLD_SPREAD, NEW_SPREAD, "findBestSpreadUnfiltered")
    content = apply_patch(content, OLD_IC, NEW_IC, "findBestICUnfiltered")

    with open(FILE, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"Patched {FILE}: findBestSpreadUnfiltered and findBestICUnfiltered "
          f"now populate OCC symbols, fixing silent order-build failures for "
          f"Filter mode's unfiltered fallback and all IC candidates in "
          f"Rank/Targeted/Filter mode.")

if __name__ == "__main__":
    main()