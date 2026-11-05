'use client';

// features/screener/components/CcStrikeGrid.tsx
// CC-WHEEL-0001 S4 (grid v2) -- the covered-call strike grid. A small window: the first few expirations across, a few
// strikes down around the selected trade. Each cell leads with the result that matters, the total if the shares are called
// away, with the premium and delta beneath. One sentence above the grid describes the selected trade. The goal
// (Upside, Balanced, Income) picks the starting trade and outlines the cells in its delta range; nothing is removed by it.
// Strikes below the cost basis are hidden until the switch is turned on.

import { useEffect, useMemo, useState } from 'react';
import type { CcGrid, CcGridCell } from '@/lib/scans/ccGridTypes';
import { CC_GOALS, DEFAULT_CC_GOAL, ccGridSummary, cellInGoal, selectCcGridWindow, type CcGoal } from '@/lib/scans/ccGridView';

interface Theme { border: string; text: string; textMuted: string; textFaint: string }

const signed = (n: number) => `${n < 0 ? '-' : '+'}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export function CcStrikeGrid({ grid, th, symbol, initial, onAnchorChange }: {
  grid: CcGrid; th: Theme; symbol?: string;
  /** The trade the scan picked: the grid starts on it, so the grid and the Trade button agree from the first frame. */
  initial?: { expiration: string; strike: number } | null;
  /** Called with the trade the summary describes whenever it changes, so the card's Trade button orders exactly that. */
  onAnchorChange?: (cell: CcGridCell | null) => void;
}) {
  const [goal, setGoal] = useState<CcGoal>(DEFAULT_CC_GOAL);
  const [showBelowFloor, setShowBelowFloor] = useState(false);
  const [allExpirations, setAllExpirations] = useState(false);
  const [selected, setSelected] = useState<{ expiration: string; strike: number } | null>(initial ?? null);
  const [extraAbove, setExtraAbove] = useState(0);
  const [extraBelow, setExtraBelow] = useState(0);

  const view = useMemo(
    () => selectCcGridWindow(grid, goal, { showBelowFloor, allExpirations, selected, extraAbove, extraBelow }),
    [grid, goal, showBelowFloor, allExpirations, selected, extraAbove, extraBelow],
  );

  const anchorKey = view.anchor ? `${view.anchor.expiration}|${view.anchor.strike}` : '';
  useEffect(() => { onAnchorChange?.(view.anchor); }, [anchorKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (grid.cells.length === 0) {
    return <p className={`text-[10px] ${th.textFaint}`}>No calls passed the safety checks for the strike grid.</p>;
  }

  const pickGoal = (g: CcGoal) => { setGoal(g); setSelected(null); setExtraAbove(0); setExtraBelow(0); };
  const anchor = view.anchor;

  return (
    <section aria-label="Covered call strike grid" data-testid="cc-strike-grid" className={`mt-2 border-t ${th.border} pt-2 cursor-default`} onClick={e => e.stopPropagation()}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className={`text-[9px] font-bold uppercase tracking-widest ${th.textMuted}`}>Strike grid</span>
        <div role="group" aria-label="Goal" className="flex gap-1">
          {(Object.keys(CC_GOALS) as CcGoal[]).map(g => (
            <button key={g} type="button" aria-pressed={goal === g} onClick={() => pickGoal(g)}
              className={`rounded border px-2 py-0.5 text-[10px] font-bold ${goal === g ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300' : 'border-neutral-700 text-neutral-400'}`}>
              {CC_GOALS[g].label} <span className="opacity-60">Δ{CC_GOALS[g].min.toFixed(2)}–{CC_GOALS[g].max.toFixed(2)}</span>
            </button>
          ))}
        </div>
        {grid.cells.some(c => c.belowFloor) && (
          <label className="flex items-center gap-1 text-[10px] text-amber-400">
            <input type="checkbox" checked={showBelowFloor} onChange={e => { setShowBelowFloor(e.target.checked); setSelected(null); setExtraAbove(0); setExtraBelow(0); }} />
            Show below cost basis{view.hiddenBelowFloor > 0 ? ` (${view.hiddenBelowFloor} hidden)` : ''}
          </label>
        )}
      </div>

      {anchor && (
        <p data-testid="cc-grid-summary" className={`mb-1.5 rounded border ${th.border} px-2 py-1.5 text-[11px] leading-snug ${th.text}`}>
          {ccGridSummary(grid, anchor, symbol)}
        </p>
      )}

      {view.strikes.length === 0 && view.hiddenBelowFloor > 0 && (
        <p data-testid="cc-grid-all-below" className="mb-1 text-[10px] text-amber-400">
          Every call that passed the safety checks is below your cost basis{grid.basis !== null ? ` ($${grid.basis.toFixed(2)})` : ''}. Tick &quot;Show below cost basis&quot; to see them; each one would lock in a loss if called away.
        </p>
      )}
      {!view.anyInGoal && view.strikes.length > 0 && (
        <p className="mb-1 text-[10px] text-yellow-400">No call in the {CC_GOALS[goal].label} delta range. Showing the best available.</p>
      )}

      {view.strikes.length > 0 && (
        <div className="overflow-x-auto">
          {view.moreStrikesAbove > 0 && (
            <button type="button" onClick={() => setExtraAbove(n => n + 1)} className="mb-1 rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300">+ Add one higher strike</button>
          )}
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr>
                <th className={`p-1 text-left font-medium ${th.textFaint}`}>Strike</th>
                {view.expirations.map(e => (
                  <th key={e.expiration} className={`p-1 text-left font-medium ${th.textMuted}`}>{e.expiration.slice(5)} <span className="opacity-60">· {e.dte}d</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.strikes.map(strike => (
                <tr key={strike}>
                  <th scope="row" className={`p-1 text-left font-bold ${th.text}`}>${strike}<span className={`block text-[9px] font-normal ${th.textFaint}`}>call</span></th>
                  {view.expirations.map(e => {
                    const cell = view.cell(e.expiration, strike);
                    if (!cell) return <td key={e.expiration} className={`p-1 ${th.textFaint}`}>—</td>;
                    const isSel = anchor !== null && anchor.expiration === cell.expiration && anchor.strike === cell.strike;
                    const total = cell.calledAwayTotal;
                    const tone = total === null ? th.textMuted : total < 0 ? 'text-red-400' : 'text-emerald-400';
                    return (
                      <td key={e.expiration} className="p-0.5">
                        <button type="button" onClick={() => setSelected({ expiration: cell.expiration, strike: cell.strike })}
                          aria-label={`${cell.strike} call ${cell.expiration}`} aria-pressed={isSel}
                          className={`w-full rounded border p-1.5 text-left ${isSel ? 'border-white' : cell.belowFloor ? 'border-amber-500/50' : cellInGoal(cell, goal) ? 'border-emerald-500/60' : 'border-neutral-800'}`}>
                          <span className={`block text-sm font-bold ${tone}`}>{total === null ? '—' : signed(total)}</span>
                          {cell.calledAwayPct !== null && <span className={`block ${tone}`}>{cell.calledAwayPct >= 0 ? '+' : ''}{cell.calledAwayPct.toFixed(2)}% return</span>}
                          <span className={`block ${th.textFaint}`}>
                            ${cell.premiumPerShare.toFixed(2)} prem · Δ{cell.delta.toFixed(2)}
                            {(cell.wide || cell.thinOi) && <span className="ml-1 text-yellow-400" title={[cell.wide ? 'wide bid/ask spread' : '', cell.thinOi ? 'thin open interest' : ''].filter(Boolean).join(' and ')}>⚠ {cell.wide ? 'wide' : 'thin OI'}</span>}
                          </span>
                          {cell.belowFloor && <span className="block text-amber-400">locks in a loss</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {view.moreStrikesBelow > 0 && (
            <button type="button" onClick={() => setExtraBelow(n => n + 1)} className="mt-1 rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300">+ Add one lower strike</button>
          )}
        </div>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-3">
        {view.moreExpirations > 0 && (
          <button type="button" onClick={() => setAllExpirations(true)} className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300">+ {view.moreExpirations} more expiration{view.moreExpirations === 1 ? '' : 's'}</button>
        )}
        {allExpirations && (
          <button type="button" onClick={() => setAllExpirations(false)} className="rounded border border-neutral-700 px-2 py-0.5 text-[10px] text-neutral-300">Show fewer expirations</button>
        )}
        <span className={`text-[9px] ${th.textFaint}`}>Totals are if the shares are called away, before fees, against your cost basis. Click a cell to change the trade above.</span>
      </div>

      {anchor && (
        <div data-testid="cc-grid-detail" className={`mt-2 rounded border ${th.border} p-2 text-[10px] leading-relaxed ${th.textMuted}`}>
          <p className={`font-bold ${th.text}`}>${anchor.strike} call · {anchor.expiration} ({anchor.dte}d) · Δ{anchor.delta.toFixed(2)} · bid ${anchor.bid.toFixed(2)} / ask ${anchor.ask.toFixed(2)} · OI {anchor.openInterest}</p>
          <p><b>If not called:</b> you keep ${anchor.premiumTotal.toLocaleString('en-US', { maximumFractionDigits: 2 })} and the shares{anchor.notCalledBasis !== null ? `; cost basis falls to $${anchor.notCalledBasis.toFixed(2)} per share` : ''}.</p>
          {anchor.belowFloor && <p className="text-amber-400">Below your cost basis: if called away this locks in a loss.</p>}
          {anchor.wide && <p className="text-yellow-400">Wide bid/ask spread: the fill may be worse than the mid price.</p>}
          {anchor.thinOi && <p className="text-yellow-400">Thin open interest.</p>}
        </div>
      )}
    </section>
  );
}
