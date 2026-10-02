// features/screener/components/FilteredResultControls.tsx
//
// SCREENER-UX-0001 — "Controls and filters," item 3 in the required
// hierarchy. Extraction of the existing Filtered-mode POP/OTM/Credit-Ratio/
// Strategy row + OI/sort controls + ticker chips from app/screener/page.tsx
// (previously rendered AFTER Best Opportunities — the concrete hierarchy
// violation this ticket exists to fix). Behavior is preserved verbatim;
// this component adds only: removable individual filter chips summarizing
// the active filters, one "Reset result filters" action, and a "Showing X
// of Y qualified candidates" narrowing indicator. Display filtering here
// only ever narrows what's rendered — it must never be able to change the
// canonical accounting numbers (AccountingSummaryBar reads
// computeSessionAccounting(session) independently and is never passed
// filtered counts).
//
// The OI/sort control block (SCREENER-OI-0001) is page-local
// (app/screener/page.tsx's own OiAndSortControls) and is not duplicated
// here — the page renders it via the oiAndSortControls render slot so this
// component stays decoupled from page.tsx internals per ADR-0004.

import type { ReactNode } from 'react';
import type { ScreenResult } from '@/lib/scans/types';

export type FilterStrategy = 'BPS' | 'BCS' | 'IC' | 'CSP' | 'CC' | 'PMCC';

const STRATEGY_OPTIONS: FilterStrategy[] = ['BPS', 'BCS', 'IC', 'CSP', 'CC', 'PMCC'];

const STRATEGY_COLOR: Record<FilterStrategy, string> = {
  BPS: 'border-emerald-600 text-emerald-400 bg-emerald-500/10',
  BCS: 'border-red-600 text-red-400 bg-red-500/10',
  IC: 'border-blue-600 text-blue-400 bg-blue-500/10',
  CSP: 'border-teal-600 text-teal-400 bg-teal-500/10',
  CC: 'border-cyan-600 text-cyan-400 bg-cyan-500/10',
  PMCC: 'border-purple-600 text-purple-400 bg-purple-500/10',
};

export interface FilteredResultControlsProps {
  results: ScreenResult[];
  qualifiedTotal: number;
  filteredQualifiedCount: number;

  popMin: number;
  setPopMin: (v: number) => void;
  otmMin: number;
  setOtmMin: (v: number) => void;
  creditRatioMin: number;
  setCreditRatioMin: (v: number) => void;
  // IVR-0001 — IVR floor, same preset-chip pattern as POP/OTM/Credit Ratio.
  // This narrows already-scanned RESULTS (Filter mode's post-scan chips),
  // distinct from IVR_MIN on the scan-time rule presets (Course/Relaxed/
  // etc.) which controls what gets scanned/qualified in the first place --
  // two different, complementary knobs, not a duplicate of existing scope.
  ivrMin: number;
  setIvrMin: (v: number) => void;
  /** Exact-expiration IVX; CSP opts in because each result is one contract. */
  ivxMin?: number;
  setIvxMin?: (v: number) => void;
  /** Optional post-scan lower DTE bound. This only narrows rendered results;
   * it never changes the DTE range used to fetch the original scan. */
  dteMin?: number;
  setDteMin?: (v: number) => void;
  /** Optional post-scan delta range. Used by CSP, where a delta range is a
   * meaningful decision filter rather than a spread-only configuration. */
  deltaRange?: [number, number] | null;
  setDeltaRange?: (v: [number, number] | null) => void;
  strategies: FilterStrategy[];
  toggleStrategy: (s: FilterStrategy) => void;

  hiddenSymbols: string[];
  toggleSymbol: (s: string) => void;
  setHiddenSymbols: (s: string[]) => void;

  /** Renders the page-local OiAndSortControls (SCREENER-OI-0001) — kept
   * page-local since it isn't an exported module. A render function lets this
   * component place the OI half on line 1 and the Sort half on line 2
   * (FILTER-LAYOUT-0001); a plain node is placed whole on line 1. */
  oiAndSortControls: ReactNode | ((part: 'oi' | 'sort') => ReactNode);

  th: { border: string; textFaint: string };

  // SCREENER-CSP-CC-FILTER-PARITY-0001 — CSP and CC each have their own
  // dedicated result-controls branch in page.tsx rather than rendering this
  // component, specifically because the Strategy toggle (BPS/BCS/IC/CSP/
  // CC/PMCC) is meaningless clutter on a page whose scan only ever produces
  // one strategy's results — that's a real, deliberate reason, not an
  // oversight, so it's an opt-out flag here rather than removed outright.
  // Both default true (unchanged behavior for the existing generic-spreads
  // caller). CC also opts out of the credit-ratio slider per Ian's
  // explicit call: covered-call yield math doesn't translate cleanly to
  // the same credit-ratio threshold CSP/BPS/BCS use.
  showStrategyToggle?: boolean;
  showCreditRatio?: boolean;
  showIvx?: boolean;
  popLabel?: string;
}

const POP_PRESETS = [0, 50, 60, 70, 80];
const OTM_PRESETS = [0, 4, 8, 12, 16];
const CREDIT_RATIO_PRESETS = [0, 15, 20, 25, 33];
const DTE_MIN_PRESETS = [0, 14, 21, 30, 45, 60];
const DELTA_RANGE_PRESETS: { label: string; value: [number, number] | null }[] = [
  { label: 'Any', value: null },
  { label: '0.10–0.16', value: [0.10, 0.16] },
  { label: '0.15–0.25', value: [0.15, 0.25] },
  { label: '0.20–0.35', value: [0.20, 0.35] },
  { label: '0.30–0.45', value: [0.30, 0.45] },
];
// IVR-0001: anchored on Dean's own Prosper rule set floor (30% minimum,
// "no exceptions" per the universal rules) plus the surrounding scan-rule
// preset values (Low Vol 20 / Relaxed 25 / Course 30 / Strict 40) so these
// buttons land on numbers that already mean something in this app, not
// arbitrary round numbers.
const IVR_PRESETS = [0, 20, 30, 40, 50];
const IVX_PRESETS = [0, 20, 30, 40, 50];

interface ActiveChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export function FilteredResultControls({
  results,
  qualifiedTotal,
  filteredQualifiedCount,
  popMin,
  setPopMin,
  otmMin,
  setOtmMin,
  creditRatioMin,
  setCreditRatioMin,
  ivrMin,
  setIvrMin,
  ivxMin = 0,
  setIvxMin,
  dteMin = 0,
  setDteMin,
  deltaRange = null,
  setDeltaRange,
  strategies,
  toggleStrategy,
  hiddenSymbols,
  toggleSymbol,
  setHiddenSymbols,
  oiAndSortControls,
  th,
  showStrategyToggle = true,
  showCreditRatio = true,
  showIvx = false,
  popLabel = 'POP',
}: FilteredResultControlsProps) {
  const allFilterSymbols = Array.from(new Set(results.map(r => r.symbol))).sort();

  const activeChips: ActiveChip[] = [];
  if (popMin > 0) activeChips.push({ key: 'pop', label: `${popLabel} ≥ ${popMin}%`, onRemove: () => setPopMin(0) });
  if (otmMin > 0) activeChips.push({ key: 'otm', label: `OTM ≥ ${otmMin}%`, onRemove: () => setOtmMin(0) });
  if (ivrMin > 0) activeChips.push({ key: 'ivr', label: `IVR ≥ ${ivrMin}%`, onRemove: () => setIvrMin(0) });
  if (showIvx && ivxMin > 0 && setIvxMin) activeChips.push({ key: 'ivx', label: `Expiration IVX ≥ ${ivxMin}%`, onRemove: () => setIvxMin(0) });
  if (showCreditRatio && creditRatioMin > 0) activeChips.push({ key: 'cr', label: `Cr Ratio ≥ ${creditRatioMin}%`, onRemove: () => setCreditRatioMin(0) });
  if (setDteMin && dteMin > 0) activeChips.push({ key: 'dte', label: `DTE ≥ ${dteMin}`, onRemove: () => setDteMin(0) });
  if (setDeltaRange && deltaRange) activeChips.push({ key: 'delta', label: `Δ ${deltaRange[0].toFixed(2)}–${deltaRange[1].toFixed(2)}`, onRemove: () => setDeltaRange(null) });
  if (showStrategyToggle) {
    for (const s of strategies) {
      activeChips.push({ key: `strat-${s}`, label: s, onRemove: () => toggleStrategy(s) });
    }
  }
  for (const sym of hiddenSymbols) {
    activeChips.push({ key: `hide-${sym}`, label: `Hiding ${sym}`, onRemove: () => toggleSymbol(sym) });
  }

  const hasActiveFilters = activeChips.length > 0;

  function resetAll() {
    setPopMin(0);
    setOtmMin(0);
    setIvrMin(0);
    if (showIvx && setIvxMin) setIvxMin(0);
    if (showCreditRatio) setCreditRatioMin(0);
    if (setDteMin) setDteMin(0);
    if (setDeltaRange) setDeltaRange(null);
    if (showStrategyToggle) for (const s of [...strategies]) toggleStrategy(s);
    setHiddenSymbols([]);
  }

  const chipCls = (on: boolean) => `text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
    on ? 'border-amber-500 text-amber-300 bg-amber-500/15' : `${th.border} ${th.textFaint} hover:border-amber-500/50`
  }`;

  function presetGroup(key: string, label: string, presets: number[], current: number, onSelect: (v: number) => void, suffix: string, title?: string): ReactNode {
    return (
      <div key={key} className="flex items-center gap-1.5">
        <span title={title} className={`text-[9px] ${th.textFaint} shrink-0`}>{label}</span>
        {presets.map(v => (
          <button key={v} onClick={() => onSelect(v)} className={chipCls(current === v)}>
            {v === 0 ? 'Any' : `${v}${suffix}`}
          </button>
        ))}
      </div>
    );
  }

  const popGroup = presetGroup('pop', `${popLabel} ≥`, POP_PRESETS, popMin, setPopMin, '%', 'A displayed estimate, not a broker-guaranteed probability');
  const dteGroup = setDteMin ? presetGroup('dte', 'DTE ≥', DTE_MIN_PRESETS, dteMin, setDteMin, 'd') : null;
  const deltaGroup = setDeltaRange ? (
    <div key="delta" className="flex items-center gap-1.5">
      <span className={`text-[9px] ${th.textFaint} shrink-0`}>Delta</span>
      {DELTA_RANGE_PRESETS.map(({ label, value }) => {
        const selected = value === null
          ? deltaRange === null
          : deltaRange?.[0] === value[0] && deltaRange?.[1] === value[1];
        return (
          <button key={label} onClick={() => setDeltaRange(value)} className={chipCls(selected)}>
            {label}
          </button>
        );
      })}
    </div>
  ) : null;
  const ivxGroup = showIvx && setIvxMin
    ? presetGroup('ivx', 'Exp. IVX ≥', IVX_PRESETS, ivxMin, setIvxMin, '%', "Implied volatility for the candidate's exact expiration")
    : null;
  const otmGroup = presetGroup('otm', 'OTM ≥', OTM_PRESETS, otmMin, setOtmMin, '%');
  const ivrGroup = presetGroup('ivr', 'IVR ≥', IVR_PRESETS, ivrMin, setIvrMin, '%');
  const creditRatioGroup = showCreditRatio ? presetGroup('cr', 'Cr Ratio ≥', CREDIT_RATIO_PRESETS, creditRatioMin, setCreditRatioMin, '%') : null;
  const strategyGroup = showStrategyToggle ? (
    <div key="strategy" className="flex items-center gap-1.5">
      <span className={`text-[9px] ${th.textFaint} shrink-0`}>Strategy</span>
      {STRATEGY_OPTIONS.map(s => {
        const on = strategies.includes(s);
        return (
          <button key={s} onClick={() => toggleStrategy(s)}
            className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
              on ? STRATEGY_COLOR[s] : `${th.border} ${th.textFaint} opacity-40`
            }`}>
            {s}
          </button>
        );
      })}
    </div>
  ) : null;

  // Thin vertical rule between consecutive groups on one line.
  function withDividers(groups: (ReactNode | null)[]): ReactNode[] {
    return groups.filter((g): g is ReactNode => g != null).flatMap((g, i) => (
      i === 0 ? [g] : [<div key={`div-${i}`} className={`w-px h-4 ${th.border} border-l`} />, g]
    ));
  }

  // FILTER-LAYOUT-0001 (Ian): at most three lines, same shape on every result
  // screen. Line 1 = which contract and can I trade it (Delta, POP, OTM
  // cushion, credit ratio / strategy where they exist, then OI); line 2 =
  // tenor and volatility, then ordering (DTE, IVR, Exp. IVX, Sort); line 3 =
  // Tickers. Groups a screen doesn't have simply drop out.
  const slot = (part: 'oi' | 'sort'): ReactNode =>
    typeof oiAndSortControls === 'function' ? oiAndSortControls(part) : (part === 'oi' ? oiAndSortControls : null);
  const line1 = [deltaGroup, popGroup, otmGroup, creditRatioGroup, strategyGroup, slot('oi')];
  const line2 = [dteGroup, ivrGroup, ivxGroup, slot('sort')];

  return (
    <section aria-label="Result filters" data-testid="filtered-result-controls" className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">{withDividers(line1)}</div>
      <div className="flex items-center gap-3 flex-wrap">{withDividers(line2)}</div>

      {allFilterSymbols.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[9px] ${th.textFaint} shrink-0`}>Tickers</span>
          {allFilterSymbols.map(sym => {
            const hidden = hiddenSymbols.includes(sym);
            return (
              <button key={sym} onClick={() => toggleSymbol(sym)}
                className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                  hidden ? `${th.border} ${th.textFaint} line-through opacity-40` : 'border-amber-600 text-amber-300 bg-amber-500/10'
                }`}>
                {sym} <span className="opacity-60">({results.filter(r => r.symbol === sym).length})</span>
              </button>
            );
          })}
          {/* FILTER-LAYOUT-0001: scan wide, then narrow to a few -- Hide all, click the ones to keep. */}
          <button type="button" onClick={() => setHiddenSymbols([...allFilterSymbols])}
            className={`text-[9px] px-2 py-0.5 rounded border ${th.border} ${th.textFaint} hover:border-amber-500/50`}>
            Hide all
          </button>
        </div>
      )}

      {/* Removable filter-chip summary + single reset action + narrowing
          indicator, per the ticket's "Controls and filters" requirements. */}
      {(hasActiveFilters || qualifiedTotal > 0) && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            {activeChips.map(chip => (
              <span key={chip.key} className={`inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded border ${th.border} ${th.textFaint}`}>
                {chip.label}
                <button
                  type="button"
                  aria-label={`Remove filter: ${chip.label}`}
                  onClick={chip.onRemove}
                  className="hover:text-red-400"
                >
                  ✕
                </button>
              </span>
            ))}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAll}
                className={`text-[9px] px-2 py-0.5 rounded border ${th.border} ${th.textFaint} hover:border-red-500 hover:text-red-400`}
              >
                Reset result filters
              </button>
            )}
            {hiddenSymbols.length > 0 && (
              <button
                type="button"
                onClick={() => setHiddenSymbols([])}
                className={`text-[9px] px-2 py-0.5 rounded border ${th.border} ${th.textFaint} hover:border-red-500 hover:text-red-400`}
              >
                Reset ticker filter
              </button>
            )}
          </div>
          {qualifiedTotal > 0 && (
            <p className={`text-[9px] ${th.textFaint}`} data-testid="narrowing-indicator">
              Showing {filteredQualifiedCount} of {qualifiedTotal} qualified candidates
            </p>
          )}
        </div>
      )}
    </section>
  );
}
