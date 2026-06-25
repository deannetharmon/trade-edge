#!/usr/bin/env python3
"""
Fixes the same stale "Within Xd buffer (DTE Max + 5)" earnings text in
Targeted mode that was already fixed in Rank mode last session.

ROOT CAUSE: runTargetedScan() calls runChecklist() with strictOnly=true,
same as exploreAllCandidatesForRank(). Inside runChecklist, the
strictOnly branch never sets its internal bestCandidate, so the
DTE-aware earnings recompute added previously (which only runs
`if (bestCandidate) {...}` inside runChecklist) never executes for this
call path either. Targeted mode builds its own candidate separately,
inline, in runTargetedScan -- so checks.earnings needs to be recomputed
there too, against the real per-candidate dte.

This patches both branches inside runTargetedScan:
  1. The IC branch (candidate from findBestICUnfiltered)
  2. The BPS/BCS branch (candidate built inline in the width-search loop)

Run from repo root: python3 fix_targeted_mode_earnings_check.py
"""

import sys

FILE = "app/screener/page.tsx"

# ── Patch 1: IC branch ───────────────────────────────────────────────
OLD_IC = """                const result = runChecklist(symbol, strat, metrics, singleExpChain, price, appliedRules, trendResult, undefined, isEtf ? etfRules : undefined, undefined, true);
                const displayResult: ScreenResult = {
                  ...result,
                  bestCandidate: result.bestCandidate ?? candidate,
                  qualified: result.checks.roc.status === 'pass' && result.checks.oi.status !== 'fail',
                  failReasons: result.failReasons.filter(r => !r.includes('qualifying strikes') && !r.includes('No 30-45 DTE')),
                };
                const scored = scoreCandidate(displayResult, rankConfig);
                const cachedEntry: RawScanEntry = { symbol, strategy: strat, metrics, chainData, price, trendResult };
                entries.push({
                  symbol, primaryStrategy: trendStrategy, expiration: exp, dte, strategy: strat,
                  candidate, screenResult: displayResult, pop: candidate.pop ?? 0,
                  score: scored?.score ?? 0, ivr: metrics.ivRank ?? null, price, isEtf, trendResult, cachedEntry,
                  allStrategies: [],
                });
                continue;
              }"""

NEW_IC = """                const result = runChecklist(symbol, strat, metrics, singleExpChain, price, appliedRules, trendResult, undefined, isEtf ? etfRules : undefined, undefined, true);
                const icBestCandidate = result.bestCandidate ?? candidate;
                // Recompute earnings against THIS candidate's actual dte -- the
                // strictOnly call into runChecklist above never set its internal
                // bestCandidate, so its earnings check is still the generic
                // DTE_MAX + 5 buffer text rather than this trade's real expiry.
                const icEarningsCheck: CheckResult = (() => {
                  if (isEtf || !result.earningsDate) return result.checks.earnings;
                  const ed = daysUntil(result.earningsDate);
                  if (ed < 0) return { status: 'pass', value: `${result.earningsDate} (past)`, reason: `Already reported · next est. ${formatDisplayDate(estimateNextEarningsDate(result.earningsDate))}` };
                  if (ed <= icBestCandidate.dte) return { status: 'warn', value: `${ed}d (${result.earningsDate})`, reason: `Falls within this trade's ${icBestCandidate.dte}d expiry — scored lower in rank mode` };
                  return { status: 'pass', value: `${ed}d (${result.earningsDate})`, reason: `Outside this trade's ${icBestCandidate.dte}d expiry` };
                })();
                const displayResult: ScreenResult = {
                  ...result,
                  bestCandidate: icBestCandidate,
                  qualified: result.checks.roc.status === 'pass' && result.checks.oi.status !== 'fail',
                  failReasons: result.failReasons.filter(r => !r.includes('qualifying strikes') && !r.includes('No 30-45 DTE')),
                  checks: { ...result.checks, earnings: icEarningsCheck },
                };
                const scored = scoreCandidate(displayResult, rankConfig);
                const cachedEntry: RawScanEntry = { symbol, strategy: strat, metrics, chainData, price, trendResult };
                entries.push({
                  symbol, primaryStrategy: trendStrategy, expiration: exp, dte, strategy: strat,
                  candidate, screenResult: displayResult, pop: candidate.pop ?? 0,
                  score: scored?.score ?? 0, ivr: metrics.ivRank ?? null, price, isEtf, trendResult, cachedEntry,
                  allStrategies: [],
                });
                continue;
              }"""

# ── Patch 2: BPS/BCS branch ──────────────────────────────────────────
OLD_BPSBCS = """                const result = runChecklist(symbol, strat, metrics, syntheticChain, price, appliedRules, trendResult, undefined, isEtf ? etfRules : undefined, undefined, true);
                const displayResult: ScreenResult = {
                  ...result,
                  bestCandidate: bestCandidate,  // always our specific strike, never runChecklist's pick
                  qualified: result.checks.roc.status === 'pass' && result.checks.oi.status !== 'fail',
                  failReasons: result.failReasons.filter(r => !r.includes('qualifying strikes') && !r.includes('No 30-45 DTE')),
                  checks: {
                    ...result.checks,
                    credit: { status: 'pass', value: `$${bestCandidate.credit.toFixed(2)}`, reason: `${(bestCandidate.creditRatio * 100).toFixed(0)}% of width` },
                    delta: { status: 'pass', value: bestCandidate.shortDelta.toFixed(2), reason: 'Short leg delta' },
                    pop: { status: 'pass', value: `${(bestCandidate.pop ?? 0).toFixed(0)}%`, reason: `≥ ${popMin}% gate` },"""

NEW_BPSBCS = """                const result = runChecklist(symbol, strat, metrics, syntheticChain, price, appliedRules, trendResult, undefined, isEtf ? etfRules : undefined, undefined, true);
                // Recompute earnings against THIS candidate's actual dte -- the
                // strictOnly call into runChecklist above never set its internal
                // bestCandidate, so its earnings check is still the generic
                // DTE_MAX + 5 buffer text rather than this trade's real expiry.
                const spreadEarningsCheck: CheckResult = (() => {
                  if (isEtf || !result.earningsDate) return result.checks.earnings;
                  const ed = daysUntil(result.earningsDate);
                  if (ed < 0) return { status: 'pass', value: `${result.earningsDate} (past)`, reason: `Already reported · next est. ${formatDisplayDate(estimateNextEarningsDate(result.earningsDate))}` };
                  if (ed <= bestCandidate.dte) return { status: 'warn', value: `${ed}d (${result.earningsDate})`, reason: `Falls within this trade's ${bestCandidate.dte}d expiry — scored lower in rank mode` };
                  return { status: 'pass', value: `${ed}d (${result.earningsDate})`, reason: `Outside this trade's ${bestCandidate.dte}d expiry` };
                })();
                const displayResult: ScreenResult = {
                  ...result,
                  bestCandidate: bestCandidate,  // always our specific strike, never runChecklist's pick
                  qualified: result.checks.roc.status === 'pass' && result.checks.oi.status !== 'fail',
                  failReasons: result.failReasons.filter(r => !r.includes('qualifying strikes') && !r.includes('No 30-45 DTE')),
                  checks: {
                    ...result.checks,
                    earnings: spreadEarningsCheck,
                    credit: { status: 'pass', value: `$${bestCandidate.credit.toFixed(2)}`, reason: `${(bestCandidate.creditRatio * 100).toFixed(0)}% of width` },
                    delta: { status: 'pass', value: bestCandidate.shortDelta.toFixed(2), reason: 'Short leg delta' },
                    pop: { status: 'pass', value: `${(bestCandidate.pop ?? 0).toFixed(0)}%`, reason: `≥ ${popMin}% gate` },"""

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

    content = apply_patch(content, OLD_IC, NEW_IC, "Targeted mode IC branch")
    content = apply_patch(content, OLD_BPSBCS, NEW_BPSBCS, "Targeted mode BPS/BCS branch")

    with open(FILE, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"Patched {FILE}: Targeted mode's IC and BPS/BCS candidates now show "
          f"earnings status relative to their own actual expiry instead of "
          f"the generic DTE_MAX + 5 buffer text.")

if __name__ == "__main__":
    main()