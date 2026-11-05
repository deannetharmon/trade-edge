'use client';

// features/screener/components/CcStrikeGrid.tsx
// CC-WHEEL-0001 S4 -- the covered-call strike grid: expirations across, strikes down, each cell showing the premium,
// delta, and the two outcomes (called away / not called). The goal (Upside, Balanced, Income) highlights the cells in
// its delta range; nothing is removed by it. Strikes below the cost basis are hidden until the switch is turned on.

import { useMemo, useState } from 'react';
import type { CcGrid, CcGridCell } from '@/lib/scans/ccGridTypes';
import { CC_GOALS, DEFAULT_CC_GOAL, cellInGoal, selectCcGridView, type CcGoal } from '@/lib/scans/ccGridView';

interface Theme { border: string; text: string; textMuted: string; textFaint: string }

const money = (n: number) => `${n < 0 ? '-' : '+'}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const MAX_COLUMNS = 8;

export function CcStrikeGrid({ grid, th }: { grid: CcGrid; th: Theme }) {
  const [goal, setGoal] = useState<CcGoal>(DEFAULT_CC_GOAL);
  const [showBelowFloor, setShowBelowFloor] = useState(false);
  const [allStrikes, setAllStrikes] = useState(false);
  const [selected, setSelected] = useState<{ expiration: string; strike: number } | null>(null);

  const view = useMemo(() => selectCcGridView(grid, goal, { showBelowFloor, allStrikes }), [grid, goal, showBelowFloor, allStrikes]);
  const columns = view.expirations.slice(0, MAX_COLUMNS);
  const picked: CcGridCell | undefined = selected ? view.cell(selected.expiration, selected.strike) : undefined;

  if (grid.cells.length === 0) {
    return <p className={`text-[10px] ${th.textFaint}`}>No calls passed the safety checks for the strike grid.</p>;
  }

  return (
    <section aria-label="Covered call strike grid" data-testid="cc-strike-grid" className={`mt-2 border-t ${th.border} pt-2`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className={`text-[9px] font-bold uppercase tracking-widest ${th.textMuted}`}>Strike grid</span>
        <div role="group" aria-label="Goal" className="flex gap-1">
          {(Object.keys(CC_GOALS) as CcGoal[]).map(g => (
            <button key={g} type="button" aria-pressed={goal === g} onClick={() => setGoal(g)}
              className={`rounded border px-2 py-0.5 text-[10px] font-bold ${goal === g ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300' : 'border-neutral-700 text-neutral-400'}`}>
              {CC_GOALS[g].label} <span className="opacity-60">Δ{CC_GOALS[g].min.toFixed(2)}–{CC_GOALS[g].max.toFixed(2)}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-[10px] text-neutral-400">
          <input type="checkbox" checked={allStrikes} onChange={e => setAllStrikes(e.target.checked)} /> All strikes
        </label>
        {grid.cells.some(c => c.belowFloor) && (
          <label className="flex items-center gap-1 text-[10px] text-amber-400">
            <input type="checkbox" checked={showBelowFloor} onChange={e => setShowBelowFloor(e.target.checked)} />
            Show below cost basis{view.hiddenBelowFloor > 0 ? ` (${view.hiddenBelowFloor} hidden)` : ''}
          </label>
        )}
      </div>

      {!view.narrowedToGoal && !allStrikes && (
        <p className="mb-1 text-[10px] text-yellow-400">No call in the {CC_GOALS[goal].label} delta range, so every strike is shown.</p>
      )}

      {view.strikes.length === 0 && view.hiddenBelowFloor > 0 && (
        <p data-testid="cc-grid-all-below" className="mb-1 text-[10px] text-amber-400">
          Every call that passed the safety checks is below your cost basis{grid.basis !== null ? ` ($${grid.basis.toFixed(2)})` : ''}. Tick &quot;Show below cost basis&quot; to see them; each one would lock in a loss if called away.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr>
              <th className={`p-1 text-left font-medium ${th.textFaint}`}>Strike</th>
              {columns.map(e => (
                <th key={e.expiration} className={`p-1 text-left font-medium ${th.textMuted}`}>{e.expiration.slice(5)} <span className="opacity-60">({e.dte}d)</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.strikes.map(strike => (
              <tr key={strike}>
                <th scope="row" className={`p-1 text-left font-bold ${th.text}`}>${strike}</th>
                {columns.map(e => {
                  const cell = view.cell(e.expiration, strike);
                  if (!cell) return <td key={e.expiration} className={`p-1 ${th.textFaint}`}>—</td>;
                  const inGoal = cellInGoal(cell, goal);
                  const isSel = selected?.expiration === cell.expiration && selected.strike === cell.strike;
                  return (
                    <td key={e.expiration} className="p-0.5">
                      <button type="button" onClick={() => setSelected({ expiration: cell.expiration, strike: cell.strike })}
                        aria-label={`${cell.strike} call ${cell.expiration}`}
                        className={`w-full rounded border p-1 text-left ${isSel ? 'border-white' : cell.belowFloor ? 'border-amber-500/50 bg-amber-500/10' : inGoal ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-neutral-800 opacity-60'}`}>
                        <span className={th.text}>${cell.premiumPerShare.toFixed(2)}</span> <span className="opacity-60">Δ{cell.delta.toFixed(2)}</span>
                        {(cell.wide || cell.thinOi) && <span className="ml-1 text-yellow-400" title={[cell.wide ? 'wide bid/ask spread' : '', cell.thinOi ? 'thin open interest' : ''].filter(Boolean).join(' and ')}>⚠ {cell.wide ? 'wide' : 'thin OI'}</span>}
                        {cell.calledAwayTotal !== null && (
                          <span className={`block ${cell.calledAwayTotal < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{money(cell.calledAwayTotal)} if called</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.expirations.length > MAX_COLUMNS && <p className={`mt-1 text-[9px] ${th.textFaint}`}>Showing the first {MAX_COLUMNS} of {view.expirations.length} expirations. Narrow the DTE range to see others.</p>}

      {picked && (
        <div data-testid="cc-grid-detail" className={`mt-2 rounded border ${th.border} p-2 text-[10px] leading-relaxed ${th.textMuted}`}>
          <p className={`font-bold ${th.text}`}>${picked.strike} call · {picked.expiration} ({picked.dte}d) · Δ{picked.delta.toFixed(2)} · bid ${picked.bid.toFixed(2)} / ask ${picked.ask.toFixed(2)} · OI {picked.openInterest}</p>
          <p>
            <b>If called away:</b>{' '}
            {picked.calledAwayTotal === null ? 'unavailable (no cost basis)' : <>{money(picked.calledAwayTotal)}{picked.calledAwayPct !== null ? ` (${picked.calledAwayPct.toFixed(1)}%)` : ''} on {grid.contracts} contract{grid.contracts === 1 ? '' : 's'}, measured against ${grid.basis?.toFixed(2)} per share</>}
          </p>
          <p>
            <b>If not called:</b> you keep ${picked.premiumTotal.toLocaleString('en-US', { maximumFractionDigits: 2 })} and the shares{picked.notCalledBasis !== null ? `; cost basis falls to $${picked.notCalledBasis.toFixed(2)} per share` : ''}.
          </p>
          {picked.belowFloor && <p className="text-amber-400">Below your cost basis: if called away this locks in a loss.</p>}
          {picked.wide && <p className="text-yellow-400">Wide bid/ask spread: the fill may be worse than the mid price.</p>}
          {picked.thinOi && <p className="text-yellow-400">Thin open interest.</p>}
        </div>
      )}
    </section>
  );
}
