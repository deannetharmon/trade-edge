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
  strategies: FilterStrategy[];
  toggleStrategy: (s: FilterStrategy) => void;

  hiddenSymbols: string[];
  toggleSymbol: (s: string) => void;
  setHiddenSymbols: (s: string[]) => void;

  /** Renders the page-local OiAndSortControls (SCREENER-OI-0001) — kept
   * page-local since it isn't an exported module. */
  oiAndSortControls: ReactNode;

  th: { border: string; textFaint: string };
}

const POP_PRESETS = [0, 50, 60, 70, 80];
const OTM_PRESETS = [0, 4, 8, 12, 16];
const CREDIT_RATIO_PRESETS = [0, 15, 20, 25, 33];

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
  strategies,
  toggleStrategy,
  hiddenSymbols,
  toggleSymbol,
  setHiddenSymbols,
  oiAndSortControls,
  th,
}: FilteredResultControlsProps) {
  const allFilterSymbols = Array.from(new Set(results.map(r => r.symbol))).sort();

  const activeChips: ActiveChip[] = [];
  if (popMin > 0) activeChips.push({ key: 'pop', label: `POP ≥ ${popMin}%`, onRemove: () => setPopMin(0) });
  if (otmMin > 0) activeChips.push({ key: 'otm', label: `OTM ≥ ${otmMin}%`, onRemove: () => setOtmMin(0) });
  if (creditRatioMin > 0) activeChips.push({ key: 'cr', label: `Cr Ratio ≥ ${creditRatioMin}%`, onRemove: () => setCreditRatioMin(0) });
  for (const s of strategies) {
    activeChips.push({ key: `strat-${s}`, label: s, onRemove: () => toggleStrategy(s) });
  }
  for (const sym of hiddenSymbols) {
    activeChips.push({ key: `hide-${sym}`, label: `Hiding ${sym}`, onRemove: () => toggleSymbol(sym) });
  }

  const hasActiveFilters = activeChips.length > 0;

  function resetAll() {
    setPopMin(0);
    setOtmMin(0);
    setCreditRatioMin(0);
    for (const s of [...strategies]) toggleStrategy(s);
    setHiddenSymbols([]);
  }

  return (
    <section aria-label="Result filters" data-testid="filtered-result-controls" className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className={`text-[9px] ${th.textFaint} shrink-0`}>POP ≥</span>
          {POP_PRESETS.map(v => (
            <button key={v} onClick={() => setPopMin(v)}
              className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                popMin === v ? 'border-amber-500 text-amber-300 bg-amber-500/15' : `${th.border} ${th.textFaint} hover:border-amber-500/50`
              }`}>
              {v === 0 ? 'Any' : `${v}%`}
            </button>
          ))}
        </div>
        <div className={`w-px h-4 ${th.border} border-l`} />
        <div className="flex items-center gap-1.5">
          <span className={`text-[9px] ${th.textFaint} shrink-0`}>OTM ≥</span>
          {OTM_PRESETS.map(v => (
            <button key={v} onClick={() => setOtmMin(v)}
              className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                otmMin === v ? 'border-amber-500 text-amber-300 bg-amber-500/15' : `${th.border} ${th.textFaint} hover:border-amber-500/50`
              }`}>
              {v === 0 ? 'Any' : `${v}%`}
            </button>
          ))}
        </div>
        <div className={`w-px h-4 ${th.border} border-l`} />
        <div className="flex items-center gap-1.5">
          <span className={`text-[9px] ${th.textFaint} shrink-0`}>Cr Ratio ≥</span>
          {CREDIT_RATIO_PRESETS.map(v => (
            <button key={v} onClick={() => setCreditRatioMin(v)}
              className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                creditRatioMin === v ? 'border-amber-500 text-amber-300 bg-amber-500/15' : `${th.border} ${th.textFaint} hover:border-amber-500/50`
              }`}>
              {v === 0 ? 'Any' : `${v}%`}
            </button>
          ))}
        </div>
        <div className={`w-px h-4 ${th.border} border-l`} />
        <div className="flex items-center gap-1.5">
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
      </div>

      <div>{oiAndSortControls}</div>

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
