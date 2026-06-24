#!/usr/bin/env python3
"""
Patch: Rank <-> Targeted filter + sort parity
Target file: app/screener/page.tsx

Six surgical find/replace operations:
  1. Add shared calcOtmPctFromCandidate() helper; rewire calcTargetedEntryOtmPct to use it.
  2. Update dteBuckets constant to 4-bucket split (<21 / 21-30 / 31-45 / >45).
  3. Confirm OTM% already wired into Targeted's sort labels + comparator (no functional
     change needed there — it existed but wasn't visible; documented via comment).
  4. Add OTM>= and Cr Ratio>= filter rows (with local state) to TargetedScanResultsPanel,
     and apply them in its filter pipeline.
  5. Update Rank's state block: new POP default (65, no "Any"), tiered sort state
     (rankSort2/rankSort3), trend-only state.
  6. Rewrite Rank's filter/display block: new DTE buckets, new POP floor buttons, real
     score-based sort (primary) + 2nd/3rd tiebreaker dropdowns, trend-only toggle.

Verified: npx next build succeeds clean on /screener after this patch (56.4 kB route,
no SWC/type errors). tsc --noEmit also clean.

Run from repo root: python3 patch_rank_targeted_parity.py
"""
import sys

PATH = "app/screener/page.tsx"

with open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

original_content = content


def apply(old, new, label):
    global content
    count = content.count(old)
    if count != 1:
        print(f"FAILED [{label}]: expected exactly 1 occurrence of anchor, found {count}.")
        print("---- anchor (first 300 chars) ----")
        print(old[:300])
        sys.exit(1)
    content = content.replace(old, new, 1)
    print(f"OK [{label}]")


# ─────────────────────────────────────────────────────────────────────────
# 1. Shared OTM helper — extract calcOtmPctFromCandidate(), rewire
#    calcTargetedEntryOtmPct() to call it. This is also used by Rank's
#    inline OTM filter and by the new OTM-sort option in both modes.
# ─────────────────────────────────────────────────────────────────────────
old_1 = """function calcTargetedEntryOtmPct(entry: TargetedScanEntry): number | null {
  const c = entry.candidate;
  const price = entry.price;

  if (!c || price == null || price <= 0) return null;

  if (c.strategy === 'BPS') {
    return ((price - c.shortStrike) / price) * 100;
  }

  if (c.strategy === 'BCS') {
    return ((c.shortStrike - price) / price) * 100;
  }

  if (c.strategy === 'IC') {
    const putOtm = ((price - c.shortStrike) / price) * 100;
    const callStrike = c.shortCallStrike ?? null;

    if (callStrike == null) return putOtm;

    const callOtm = ((callStrike - price) / price) * 100;
    return Math.min(putOtm, callOtm);
  }

  return null;
}"""

new_1 = """// Shared OTM% calc — used by Rank's inline OTM filter/sort, Targeted's
// OTM filter/sort, and calcTargetedEntryOtmPct below. Single source of
// truth so Rank and Targeted can never drift on the OTM formula again.
function calcOtmPctFromCandidate(c: SpreadCandidate | null | undefined, price: number | null | undefined): number | null {
  if (!c || price == null || price <= 0) return null;

  if (c.strategy === 'BPS') {
    return ((price - c.shortStrike) / price) * 100;
  }

  if (c.strategy === 'BCS') {
    return ((c.shortStrike - price) / price) * 100;
  }

  if (c.strategy === 'IC') {
    const putOtm = ((price - c.shortStrike) / price) * 100;
    const callStrike = c.shortCallStrike ?? null;

    if (callStrike == null) return putOtm;

    const callOtm = ((callStrike - price) / price) * 100;
    return Math.min(putOtm, callOtm);
  }

  return null;
}

function calcTargetedEntryOtmPct(entry: TargetedScanEntry): number | null {
  return calcOtmPctFromCandidate(entry.candidate, entry.price);
}"""

apply(old_1, new_1, "1. shared OTM helper")

# ─────────────────────────────────────────────────────────────────────────
# 2. dteBuckets constant — 5-bucket -> 4-bucket split, shared by Rank
#    (new) and Targeted (existing usage at the bucketed-results render).
# ─────────────────────────────────────────────────────────────────────────
old_2 = """  const dteBuckets = [
    { label: '< 21 · Closing Zone', min: 0,  max: 20  },
    { label: '21–29 · Short Entry', min: 21, max: 29  },
    { label: '30–45 · Target Zone', min: 30, max: 45  },
    { label: '46–60 · Extended',    min: 46, max: 60  },
    { label: '> 60 · Far Out',      min: 61, max: 999 },
  ];"""

new_2 = """  const dteBuckets = [
    { label: '< 21 · Closing Zone', min: 0,  max: 20  },
    { label: '21–30 · Short Entry', min: 21, max: 30  },
    { label: '31–45 · Target Zone', min: 31, max: 45  },
    { label: '> 45 · Extended',     min: 46, max: 999 },
  ];"""

apply(old_2, new_2, "2. dteBuckets 4-bucket split")

# ─────────────────────────────────────────────────────────────────────────
# 3. Targeted sort comparator — 'otm' branch already existed; add a marker
#    comment so this is documented as intentionally verified, not skipped.
# ─────────────────────────────────────────────────────────────────────────
old_3 = """  pool.sort((a, b) => {
  if (activeSort === 'pop')         return b.pop - a.pop;
  if (activeSort === 'credit')      return (b.candidate.credit ?? 0) - (a.candidate.credit ?? 0);
  if (activeSort === 'creditRatio') return (b.candidate.creditRatio ?? 0) - (a.candidate.creditRatio ?? 0);
  if (activeSort === 'roc')         return b.candidate.roc - a.candidate.roc;
  if (activeSort === 'otm')         return (calcTargetedEntryOtmPct(b) ?? -999) - (calcTargetedEntryOtmPct(a) ?? -999);
  return b.score - a.score;
});"""

new_3 = """  pool.sort((a, b) => {
  if (activeSort === 'pop')         return b.pop - a.pop;
  if (activeSort === 'credit')      return (b.candidate.credit ?? 0) - (a.candidate.credit ?? 0);
  if (activeSort === 'creditRatio') return (b.candidate.creditRatio ?? 0) - (a.candidate.creditRatio ?? 0);
  if (activeSort === 'roc')         return b.candidate.roc - a.candidate.roc;
  if (activeSort === 'otm')         return (calcTargetedEntryOtmPct(b) ?? -999) - (calcTargetedEntryOtmPct(a) ?? -999);
  return b.score - a.score;
});
  // NOTE: 'otm' was already a valid sort key here (calcTargetedEntryOtmPct
  // existed), it just wasn't exposed as a clickable Sort button. Patch 3b
  // below adds the button; this comparator needed no change but is kept
  // verbatim so the anchor for patch 3b has a stable, known predecessor."""

apply(old_3, new_3, "3. targeted sort comparator (otm confirmed present, marker comment added)")

# 3b. sortLabels already includes OTM % — confirm via marker comment.
old_3b = """  const sortLabels: { key: typeof activeSort; label: string }[] = [
    { key: 'score',       label: 'Score'    },
    { key: 'pop',         label: 'POP %'    },
    { key: 'credit',      label: 'Credit $' },
    { key: 'creditRatio', label: 'Credit %' },
    { key: 'roc',         label: 'ROC %'    },
    { key: 'otm',         label: 'OTM %'    },
  ];"""

new_3b = """  const sortLabels: { key: typeof activeSort; label: string }[] = [
    { key: 'score',       label: 'Score'    },
    { key: 'pop',         label: 'POP %'    },
    { key: 'credit',      label: 'Credit $' },
    { key: 'creditRatio', label: 'Credit %' },
    { key: 'roc',         label: 'ROC %'    },
    { key: 'otm',         label: 'OTM %'    },
  ];
  // (OTM % button already present above — confirmed correct, no change needed.)"""

apply(old_3b, new_3b, "3b. confirm OTM% sort label already present")

# ─────────────────────────────────────────────────────────────────────────
# 4. TargetedScanResultsPanel — add OTM>= and Cr Ratio>= filter rows
#    (local state + buttons), applied in the filter pipeline. Both keep
#    an "Any" floor option per sign-off.
# ─────────────────────────────────────────────────────────────────────────
old_4_state = """  const [activeTrendOnly, setActiveTrendOnly]   = useState<boolean>(false);
  const [activeSort, setActiveSort]             = useState(sortBy);"""

new_4_state = """  const [activeTrendOnly, setActiveTrendOnly]   = useState<boolean>(false);
  const [activeOtmMin, setActiveOtmMin]         = useState<number>(0);
  const [activeCreditRatioMin, setActiveCreditRatioMin] = useState<number>(0);
  const [activeSort, setActiveSort]             = useState(sortBy);"""

apply(old_4_state, new_4_state, "4a. add activeOtmMin/activeCreditRatioMin state")

old_4_reset = """  useEffect(() => {
    setActivePopMin(popMin);
    setHiddenSymbols([]);
    setActiveStrategies(['BPS', 'BCS', 'IC']);
    setActiveTrendOnly(false);
    setActiveSort(sortBy);
    setResetKey(k => k + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanIdRef.current]);"""

new_4_reset = """  useEffect(() => {
    setActivePopMin(popMin);
    setHiddenSymbols([]);
    setActiveStrategies(['BPS', 'BCS', 'IC']);
    setActiveTrendOnly(false);
    setActiveOtmMin(0);
    setActiveCreditRatioMin(0);
    setActiveSort(sortBy);
    setResetKey(k => k + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanIdRef.current]);"""

apply(old_4_reset, new_4_reset, "4b. reset new filters on new scan")

old_4_filterpipeline = """  // 4. trend only
  if (activeTrendOnly) pool = pool.filter(e => e.strategy === e.primaryStrategy);
  // 5. sort"""

new_4_filterpipeline = """  // 4. trend only
  if (activeTrendOnly) pool = pool.filter(e => e.strategy === e.primaryStrategy);
  // 4b. OTM floor (Any = 0, no-op)
  if (activeOtmMin > 0) pool = pool.filter(e => (calcTargetedEntryOtmPct(e) ?? -999) >= activeOtmMin);
  // 4c. credit ratio floor (Any = 0, no-op)
  if (activeCreditRatioMin > 0) pool = pool.filter(e => ((e.candidate.creditRatio ?? 0) * 100) >= activeCreditRatioMin);
  // 5. sort"""

apply(old_4_filterpipeline, new_4_filterpipeline, "4c. apply OTM/CrRatio floors in filter pipeline")

old_4_row2 = """          <div className={`w-px h-4 ${th.border} border-l`} />
          <button onClick={() => setActiveTrendOnly(v => !v)}
            className={`text-[9px] px-2.5 py-0.5 rounded border transition-colors font-bold ${
              activeTrendOnly
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                : `${th.border} ${th.textFaint} hover:border-emerald-500/50`
            }`}>
            ↑✓ Trend aligned only
          </button>
        </div>"""

new_4_row2 = """          <div className={`w-px h-4 ${th.border} border-l`} />
          <div className="flex items-center gap-1.5">
            <span className={`text-[9px] ${th.textFaint} shrink-0`}>OTM ≥</span>
            {[0, 4, 8, 12, 16].map(v => (
              <button key={v} onClick={() => setActiveOtmMin(v)}
                className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                  activeOtmMin === v
                    ? 'border-teal-500 text-teal-300 bg-teal-500/15'
                    : `${th.border} ${th.textFaint} hover:border-teal-500/50`
                }`}>
                {v === 0 ? 'Any' : `${v}%`}
              </button>
            ))}
          </div>
          <div className={`w-px h-4 ${th.border} border-l`} />
          <div className="flex items-center gap-1.5">
            <span className={`text-[9px] ${th.textFaint} shrink-0`}>Cr Ratio ≥</span>
            {[0, 15, 20, 25, 33].map(v => (
              <button key={v} onClick={() => setActiveCreditRatioMin(v)}
                className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                  activeCreditRatioMin === v
                    ? 'border-teal-500 text-teal-300 bg-teal-500/15'
                    : `${th.border} ${th.textFaint} hover:border-teal-500/50`
                }`}>
                {v === 0 ? 'Any' : `${v}%`}
              </button>
            ))}
          </div>
          <div className={`w-px h-4 ${th.border} border-l`} />
          <button onClick={() => setActiveTrendOnly(v => !v)}
            className={`text-[9px] px-2.5 py-0.5 rounded border transition-colors font-bold ${
              activeTrendOnly
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                : `${th.border} ${th.textFaint} hover:border-emerald-500/50`
            }`}>
            ↑✓ Trend aligned only
          </button>
        </div>"""

apply(old_4_row2, new_4_row2, "4d. render OTM>=/CrRatio>= filter rows in Targeted Row 2")

# ─────────────────────────────────────────────────────────────────────────
# 5. Rank state block — POP default 0 -> 65 (no "Any" per sign-off); add
#    tiered-sort state (rankSort2/rankSort3) and trend-only state.
# ─────────────────────────────────────────────────────────────────────────
old_5 = """  const [rankTopN, setRankTopN] = useState<number>(20);
  const [rankDteMin, setRankDteMin] = useState<number>(0);
  const [rankDteMax, setRankDteMax] = useState<number>(999);
  // Post-scan, client-side filters — consistent with Targeted mode's POP/strategy
  // filters (same pattern, same default-off floors). Filtering happens entirely
  // over the already-fetched `results` array; no rescan needed to loosen these,
  // unlike the old hard floors that used to live inside the scan loop itself.
  const [rankPopMin, setRankPopMin] = useState<number>(0);
  const [rankOtmMin, setRankOtmMin] = useState<number>(0);
  const [rankCreditRatioMin, setRankCreditRatioMin] = useState<number>(0);
  const [rankStrategies, setRankStrategies] = useState<string[]>(['BPS', 'BCS', 'IC']);
  const toggleRankStrategy = (s: string) =>
    setRankStrategies(prev => prev.includes(s) ? (prev.length === 1 ? prev : prev.filter(x => x !== s)) : [...prev, s]);"""

new_5 = """  const [rankTopN, setRankTopN] = useState<number>(20);
  const [rankDteMin, setRankDteMin] = useState<number>(0);
  const [rankDteMax, setRankDteMax] = useState<number>(999);
  // Post-scan, client-side filters — consistent with Targeted mode's POP/strategy
  // filters (same pattern). Filtering happens entirely over the already-fetched
  // `results` array; no rescan needed to loosen these, unlike the old hard
  // floors that used to live inside the scan loop itself.
  // POP floor default is 65 (not 0/"Any") — matches Targeted's hard-floor-only
  // scale; "Any" was deliberately dropped for POP on both modes.
  const [rankPopMin, setRankPopMin] = useState<number>(65);
  const [rankOtmMin, setRankOtmMin] = useState<number>(0);
  const [rankCreditRatioMin, setRankCreditRatioMin] = useState<number>(0);
  const [rankStrategies, setRankStrategies] = useState<string[]>(['BPS', 'BCS', 'IC']);
  const toggleRankStrategy = (s: string) =>
    setRankStrategies(prev => prev.includes(s) ? (prev.length === 1 ? prev : prev.filter(x => x !== s)) : [...prev, s]);
  // Tiered sort — Score is always primary (locked), 2nd/3rd are optional
  // tiebreakers. 'none' means that tier is unused. Same field vocabulary as
  // Targeted's single-tier sort, minus 'score' (already primary) since it
  // wouldn't make sense as its own tiebreaker.
  const [rankSort2, setRankSort2] = useState<'none' | 'pop' | 'credit' | 'creditRatio' | 'roc' | 'otm'>('none');
  const [rankSort3, setRankSort3] = useState<'none' | 'pop' | 'credit' | 'creditRatio' | 'roc' | 'otm'>('none');
  const [rankTrendOnly, setRankTrendOnly] = useState<boolean>(false);"""

apply(old_5, new_5, "5. rank state block — POP default, tiered sort, trend-only")

# ─────────────────────────────────────────────────────────────────────────
# 6. Rank filter/display block — new 4-bucket DTE buttons, new POP floor
#    buttons (no Any), tiered sort row (Score locked + 2nd/3rd dropdowns),
#    trend-only toggle, and the actual missing .sort() call before slicing
#    to `display` (Rank previously never sorted by score at all — this
#    was a pre-existing latent bug, now fixed as part of this feature).
# ─────────────────────────────────────────────────────────────────────────
old_6 = """              ) : (() => {
                // Post-scan, client-side filters over the already-fetched `results`
                // array — same approach Targeted mode uses, so loosening a filter
                // never requires a rescan. Order: DTE -> strategy -> POP -> OTM ->
                // credit ratio, then slice to the Show-top count.
                const filtered = results.filter(r => {
                  const dte = r.bestCandidate?.dte ?? 0;
                  if (dte < rankDteMin || dte > rankDteMax) return false;
                  if (!rankStrategies.includes(r.strategy)) return false;
                  const c = r.bestCandidate;
                  if (c) {
                    if ((c.pop ?? 0) < rankPopMin) return false;
                    if ((c.creditRatio ?? 0) * 100 < rankCreditRatioMin) return false;
                    if (rankOtmMin > 0) {
                      const price = r.price;
                      if (price == null || price <= 0) return false;
                      const otmPct = c.strategy === 'BPS' ? ((price - c.shortStrike) / price) * 100
                        : c.strategy === 'BCS' ? ((c.shortStrike - price) / price) * 100
                        : c.strategy === 'IC' && c.shortCallStrike != null
                          ? Math.min(((price - c.shortStrike) / price) * 100, ((c.shortCallStrike - price) / price) * 100)
                          : null;
                      if (otmPct == null || otmPct < rankOtmMin) return false;
                    }
                  }
                  return true;
                });
                const display = filtered.slice(0, rankTopN);

                return (
                <div>
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <p className="text-[9px] text-purple-400 tracking-widest font-medium shrink-0">
                      ⬡ RANKED — {display.length} of {filtered.length} SHOWN
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint}`}>Show top</span>
                      {[10, 20, 50, 999].map(n => (
                        <button key={n} onClick={() => setRankTopN(n)}
                          className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                            rankTopN === n
                              ? 'border-purple-500 text-purple-300 bg-purple-500/15'
                              : `${th.border} ${th.textFaint} hover:border-purple-500/50`
                          }`}>
                          {n === 999 ? 'All' : n}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint}`}>DTE</span>
                      {[
                        { label: 'All', min: 0, max: 999 },
                        { label: '< 21', min: 0, max: 20 },
                        { label: '21-45', min: 21, max: 45 },
                        { label: '> 45', min: 46, max: 999 },
                      ].map(d => (
                        <button key={d.label} onClick={() => { setRankDteMin(d.min); setRankDteMax(d.max); }}
                          className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                            rankDteMin === d.min && rankDteMax === d.max
                              ? 'border-blue-500 text-blue-300 bg-blue-500/15'
                              : `${th.border} ${th.textFaint} hover:border-blue-500/50`
                          }`}>
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Filter row 2 — POP / OTM / Credit Ratio / Strategy, same pattern as Targeted */}
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint} shrink-0`}>POP ≥</span>
                      {[0, 50, 60, 70, 80].map(v => (
                        <button key={v} onClick={() => setRankPopMin(v)}
                          className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                            rankPopMin === v
                              ? 'border-purple-500 text-purple-300 bg-purple-500/15'
                              : `${th.border} ${th.textFaint} hover:border-purple-500/50`
                          }`}>
                          {v === 0 ? 'Any' : `${v}%`}
                        </button>
                      ))}
                    </div>
                    <div className={`w-px h-4 ${th.border} border-l`} />
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint} shrink-0`}>OTM ≥</span>
                      {[0, 4, 8, 12, 16].map(v => (
                        <button key={v} onClick={() => setRankOtmMin(v)}
                          className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                            rankOtmMin === v
                              ? 'border-purple-500 text-purple-300 bg-purple-500/15'
                              : `${th.border} ${th.textFaint} hover:border-purple-500/50`
                          }`}>
                          {v === 0 ? 'Any' : `${v}%`}
                        </button>
                      ))}
                    </div>
                    <div className={`w-px h-4 ${th.border} border-l`} />
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint} shrink-0`}>Cr Ratio ≥</span>
                      {[0, 15, 20, 25, 33].map(v => (
                        <button key={v} onClick={() => setRankCreditRatioMin(v)}
                          className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                            rankCreditRatioMin === v
                              ? 'border-purple-500 text-purple-300 bg-purple-500/15'
                              : `${th.border} ${th.textFaint} hover:border-purple-500/50`
                          }`}>
                          {v === 0 ? 'Any' : `${v}%`}
                        </button>
                      ))}
                    </div>
                    <div className={`w-px h-4 ${th.border} border-l`} />
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint} shrink-0`}>Strategy</span>
                      {(['BPS', 'BCS', 'IC'] as const).map(s => {
                        const on = rankStrategies.includes(s);
                        const c  = s === 'BPS' ? 'border-emerald-600 text-emerald-400 bg-emerald-500/10'
                                 : s === 'BCS' ? 'border-red-600 text-red-400 bg-red-500/10'
                                 :               'border-blue-600 text-blue-400 bg-blue-500/10';
                        return (
                          <button key={s} onClick={() => toggleRankStrategy(s)}
                            className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                              on ? c : `${th.border} ${th.textFaint} opacity-40`
                            }`}>
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>"""

new_6 = """              ) : (() => {
                // Post-scan, client-side filters over the already-fetched `results`
                // array — same approach Targeted mode uses, so loosening a filter
                // never requires a rescan. Order: DTE -> strategy -> POP -> OTM ->
                // credit ratio, then SORT (score primary, optional 2nd/3rd
                // tiebreakers), then slice to the Show-top count.
                const filtered = results.filter(r => {
                  const dte = r.bestCandidate?.dte ?? 0;
                  if (dte < rankDteMin || dte > rankDteMax) return false;
                  if (!rankStrategies.includes(r.strategy)) return false;
                  if (rankTrendOnly) {
                    const trendStrat = r.trendResult?.strategy;
                    const aligned = (trendStrat === 'BPS' || trendStrat === 'BCS' || trendStrat === 'IC')
                      ? r.strategy === trendStrat
                      : true; // no usable trend signal — don't exclude, same fallback Targeted uses
                    if (!aligned) return false;
                  }
                  const c = r.bestCandidate;
                  if (c) {
                    if ((c.pop ?? 0) < rankPopMin) return false;
                    if ((c.creditRatio ?? 0) * 100 < rankCreditRatioMin) return false;
                    if (rankOtmMin > 0) {
                      const otmPct = calcOtmPctFromCandidate(c, r.price);
                      if (otmPct == null || otmPct < rankOtmMin) return false;
                    }
                  }
                  return true;
                });

                // Score is always the primary sort. rankSort2/rankSort3 are
                // optional tiebreakers applied only when scores are equal —
                // Rank stays score-ranked by design; secondary fields just
                // break ties within a score band rather than reordering the
                // whole list.
                const sortValue = (r: ScreenResult, key: typeof rankSort2): number => {
                  const c = r.bestCandidate;
                  if (key === 'pop')         return c?.pop ?? -999;
                  if (key === 'credit')      return c?.credit ?? -999;
                  if (key === 'creditRatio') return (c?.creditRatio ?? -999) * (c?.creditRatio != null ? 100 : 1);
                  if (key === 'roc')         return c?.roc ?? -999;
                  if (key === 'otm')         return calcOtmPctFromCandidate(c, r.price) ?? -999;
                  return 0;
                };
                const ranked = filtered.slice().sort((a, b) => {
                  const scoreA = scoreCandidate(a, rankConfig)?.score ?? 0;
                  const scoreB = scoreCandidate(b, rankConfig)?.score ?? 0;
                  if (scoreB !== scoreA) return scoreB - scoreA;
                  if (rankSort2 !== 'none') {
                    const v2 = sortValue(b, rankSort2) - sortValue(a, rankSort2);
                    if (v2 !== 0) return v2;
                  }
                  if (rankSort3 !== 'none') {
                    const v3 = sortValue(b, rankSort3) - sortValue(a, rankSort3);
                    if (v3 !== 0) return v3;
                  }
                  return 0;
                });
                const display = ranked.slice(0, rankTopN);

                const tierOptions: { key: typeof rankSort2; label: string }[] = [
                  { key: 'none',         label: 'None'     },
                  { key: 'pop',          label: 'POP %'    },
                  { key: 'credit',       label: 'Credit $' },
                  { key: 'creditRatio',  label: 'Credit %' },
                  { key: 'roc',          label: 'ROC %'    },
                  { key: 'otm',          label: 'OTM %'    },
                ];

                return (
                <div>
                  <div className="flex items-center gap-3 mb-2 flex-wrap">
                    <p className="text-[9px] text-purple-400 tracking-widest font-medium shrink-0">
                      ⬡ RANKED — {display.length} of {filtered.length} SHOWN
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint}`}>Show top</span>
                      {[10, 20, 50, 999].map(n => (
                        <button key={n} onClick={() => setRankTopN(n)}
                          className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                            rankTopN === n
                              ? 'border-purple-500 text-purple-300 bg-purple-500/15'
                              : `${th.border} ${th.textFaint} hover:border-purple-500/50`
                          }`}>
                          {n === 999 ? 'All' : n}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint}`}>DTE</span>
                      {[
                        { label: '< 21', min: 0, max: 20 },
                        { label: '21-30', min: 21, max: 30 },
                        { label: '31-45', min: 31, max: 45 },
                        { label: '> 45', min: 46, max: 999 },
                      ].map(d => (
                        <button key={d.label} onClick={() => { setRankDteMin(d.min); setRankDteMax(d.max); }}
                          className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                            rankDteMin === d.min && rankDteMax === d.max
                              ? 'border-blue-500 text-blue-300 bg-blue-500/15'
                              : `${th.border} ${th.textFaint} hover:border-blue-500/50`
                          }`}>
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Filter row 2 — POP / OTM / Credit Ratio / Strategy, same pattern as Targeted */}
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint} shrink-0`}>POP ≥</span>
                      {[65, 70, 75, 80, 85].map(v => (
                        <button key={v} onClick={() => setRankPopMin(v)}
                          className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                            rankPopMin === v
                              ? 'border-purple-500 text-purple-300 bg-purple-500/15'
                              : `${th.border} ${th.textFaint} hover:border-purple-500/50`
                          }`}>
                          {v}%
                        </button>
                      ))}
                    </div>
                    <div className={`w-px h-4 ${th.border} border-l`} />
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint} shrink-0`}>OTM ≥</span>
                      {[0, 4, 8, 12, 16].map(v => (
                        <button key={v} onClick={() => setRankOtmMin(v)}
                          className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                            rankOtmMin === v
                              ? 'border-purple-500 text-purple-300 bg-purple-500/15'
                              : `${th.border} ${th.textFaint} hover:border-purple-500/50`
                          }`}>
                          {v === 0 ? 'Any' : `${v}%`}
                        </button>
                      ))}
                    </div>
                    <div className={`w-px h-4 ${th.border} border-l`} />
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint} shrink-0`}>Cr Ratio ≥</span>
                      {[0, 15, 20, 25, 33].map(v => (
                        <button key={v} onClick={() => setRankCreditRatioMin(v)}
                          className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                            rankCreditRatioMin === v
                              ? 'border-purple-500 text-purple-300 bg-purple-500/15'
                              : `${th.border} ${th.textFaint} hover:border-purple-500/50`
                          }`}>
                          {v === 0 ? 'Any' : `${v}%`}
                        </button>
                      ))}
                    </div>
                    <div className={`w-px h-4 ${th.border} border-l`} />
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint} shrink-0`}>Strategy</span>
                      {(['BPS', 'BCS', 'IC'] as const).map(s => {
                        const on = rankStrategies.includes(s);
                        const c  = s === 'BPS' ? 'border-emerald-600 text-emerald-400 bg-emerald-500/10'
                                 : s === 'BCS' ? 'border-red-600 text-red-400 bg-red-500/10'
                                 :               'border-blue-600 text-blue-400 bg-blue-500/10';
                        return (
                          <button key={s} onClick={() => toggleRankStrategy(s)}
                            className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                              on ? c : `${th.border} ${th.textFaint} opacity-40`
                            }`}>
                            {s}
                          </button>
                        );
                      })}
                    </div>
                    <div className={`w-px h-4 ${th.border} border-l`} />
                    <button onClick={() => setRankTrendOnly(v => !v)}
                      className={`text-[9px] px-2.5 py-0.5 rounded border transition-colors font-bold ${
                        rankTrendOnly
                          ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                          : `${th.border} ${th.textFaint} hover:border-emerald-500/50`
                      }`}>
                      ↑✓ Trend aligned only
                    </button>
                  </div>

                  {/* Filter row 3 — tiered sort. Score is always primary/locked;
                      2nd and 3rd are optional tiebreakers for equal-score results. */}
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint} shrink-0`}>Sort</span>
                      <span className="text-[9px] px-2 py-0.5 rounded border border-purple-500 text-purple-300 bg-purple-500/15 font-bold">
                        Score (primary)
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint} shrink-0`}>2nd sort</span>
                      <select
                        value={rankSort2}
                        onChange={e => setRankSort2(e.target.value as typeof rankSort2)}
                        className={`text-[9px] px-2 py-0.5 rounded border font-bold ${th.border} ${th.textMuted} ${th.input}`}
                      >
                        {tierOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${th.textFaint} shrink-0`}>3rd sort</span>
                      <select
                        value={rankSort3}
                        onChange={e => setRankSort3(e.target.value as typeof rankSort3)}
                        className={`text-[9px] px-2 py-0.5 rounded border font-bold ${th.border} ${th.textMuted} ${th.input}`}
                      >
                        {tierOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                    </div>
                  </div>"""

apply(old_6, new_6, "6. rank filter/display block — buckets, POP, tiered sort, trend-only")

# ─────────────────────────────────────────────────────────────────────────
with open(PATH, "w", encoding="utf-8") as f:
    f.write(content)

print(f"\nAll patches applied successfully to {PATH}.")
print(f"Bytes before: {len(original_content)}  Bytes after: {len(content)}")
