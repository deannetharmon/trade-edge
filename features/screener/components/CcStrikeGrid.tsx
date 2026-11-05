'use client';

// features/screener/components/CcStrikeGrid.tsx
// CC-WHEEL-0001 S4 (grid v2) -- the covered-call strike grid. A small window: the first few expirations across, a few
// strikes down around the selected trade. Each cell leads with the result that matters, the total if the shares are called
// away, with the premium and delta beneath. One sentence above the grid describes the selected trade. The goal
// (Upside, Balanced, Income) picks the starting trade and outlines the cells in its delta range; nothing is removed by it.
// Strikes below the cost basis are hidden until the switch is turned on.

import { useEffect, useMemo, useState } from 'react';
import type { CcGrid, CcGridCell } from '@/lib/scans/ccGridTypes';
import { CC_GOALS, DEFAULT_CC_GOAL, ccCellNumbers, ccChanceCalledPct, ccGridSummary, cellInGoal, pickCellForSellPrice, pickQuickCell, CC_QUICK_PICKS, selectCcGridWindow, type CcGoal } from '@/lib/scans/ccGridView';

interface Theme { border: string; text: string; textMuted: string; textFaint: string }

const signed = (n: number) => `${n < 0 ? '-' : '+'}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export function CcStrikeGrid({ grid, th, symbol, initial, onAnchorChange, hideGoalNote }: {
  grid: CcGrid; th: Theme; symbol?: string;
  /** The card already says the call is outside the delta range, so the grid does not say it again. */
  hideGoalNote?: boolean;
  /** The trade the scan picked: the grid starts on it, so the grid and the Trade button agree from the first frame. */
  initial?: { expiration: string; strike: number } | null;
  /** Called with the trade the summary describes whenever it changes, so the card's Trade button orders exactly that. */
  onAnchorChange?: (cell: CcGridCell | null) => void;
}) {
  const [goal, setGoal] = useState<CcGoal>(DEFAULT_CC_GOAL);
  const [showBelowFloor, setShowBelowFloor] = useState(false);
  const [allExpirations, setAllExpirations] = useState(false);
  const [selected, setSelected] = useState<{ expiration: string; strike: number } | null>(initial ?? null);
  // The frame is what the table is drawn around. Clicking a cell moves only the highlight; the frame changes when the goal or the
  // below-basis tick changes, or when the "sell at" picker jumps to a call, so the table never shuffles under the cursor.
  const [frame, setFrame] = useState<{ expiration: string; strike: number } | null>(initial ?? null);
  const [extraAbove, setExtraAbove] = useState(0);
  const [extraBelow, setExtraBelow] = useState(0);
  const [sellAt, setSellAt] = useState('');
  const [sellNote, setSellNote] = useState<string | null>(null);

  const view = useMemo(
    () => selectCcGridWindow(grid, goal, { showBelowFloor, allExpirations, selected: frame, extraAbove, extraBelow }),
    [grid, goal, showBelowFloor, allExpirations, frame, extraAbove, extraBelow],
  );

  const clicked = selected ? view.cell(selected.expiration, selected.strike) ?? null : null;
  const anchor = clicked ?? view.anchor;
  const anchorKey = anchor ? `${anchor.expiration}|${anchor.strike}` : '';
  useEffect(() => { onAnchorChange?.(anchor); }, [anchorKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (grid.cells.length === 0) {
    return <p className={`text-[10px] ${th.textFaint}`}>No calls passed the safety checks for the strike grid.</p>;
  }

  const pickGoal = (g: CcGoal) => { setGoal(g); setSelected(null); setFrame(null); setExtraAbove(0); setExtraBelow(0); };
  const anchorN = anchor ? ccCellNumbers(grid, anchor) : null;

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
            <input type="checkbox" checked={showBelowFloor} onChange={e => { setShowBelowFloor(e.target.checked); setSelected(null); setFrame(null); setExtraAbove(0); setExtraBelow(0); }} />
            Show below cost basis{view.hiddenBelowFloor > 0 ? ` (${view.hiddenBelowFloor} hidden)` : ''}
          </label>
        )}
      </div>

      {anchor && (
        <>
        <div role="group" aria-label="Quick picks" className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className={th.textFaint}>Jump to:</span>
          {CC_QUICK_PICKS.map(q => (
            <button key={q.kind} type="button"
              onClick={() => {
                const c = pickQuickCell(grid, q.kind, { allowBelowFloor: showBelowFloor || anchor.belowFloor });
                if (c) { const at = { expiration: c.expiration, strike: c.strike }; setSelected(at); setFrame(at); setSellNote(null); } else setSellNote('No call qualifies for that pick.');
              }}
              className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300">{q.label}</button>
          ))}
        </div>
        <form
          data-testid="cc-sell-price"
          className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px]"
          onSubmit={e => {
            e.preventDefault();
            const pick = pickCellForSellPrice(grid, Number(sellAt.replace(/[$,\s]/g, '')), { expiration: anchor.expiration, allowBelowFloor: showBelowFloor || anchor.belowFloor });
            setSellNote(pick.note);
            if (pick.cell) { const at = { expiration: pick.cell.expiration, strike: pick.cell.strike }; setSelected(at); setFrame(at); }
          }}
        >
          <label className={th.textFaint}>I would sell my shares at $
            <input aria-label="Price I would sell my shares at" inputMode="decimal" value={sellAt} onChange={e => setSellAt(e.target.value)}
              className="ml-1 w-20 rounded border border-white/20 bg-transparent px-1.5 py-0.5 font-mono text-white" />
          </label>
          <button type="submit" className="rounded border border-teal-500/50 px-2 py-0.5 text-teal-300">Find the call</button>
          {sellNote && <span role="status" className="text-amber-300">{sellNote}</span>}
        </form>
        </>
      )}

      {anchor && (
        <p data-testid="cc-grid-summary" className={`mb-1.5 rounded border ${th.border} px-2.5 py-2 text-sm font-semibold leading-snug ${th.text}`}>
          {ccGridSummary(grid, anchor, symbol)}
        </p>
      )}

      {view.strikes.length === 0 && view.hiddenBelowFloor > 0 && (
        <p data-testid="cc-grid-all-below" className="mb-1 text-[10px] text-amber-400">
          Every call that passed the safety checks is below your cost basis{grid.basis !== null ? ` ($${grid.basis.toFixed(2)})` : ''}. Tick &quot;Show below cost basis&quot; to see them; each one would lock in a loss if called away.
        </p>
      )}
      {!hideGoalNote && !view.anyInGoal && view.strikes.length > 0 && (
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
                    const n = ccCellNumbers(grid, cell);
                    const total = n.calledAwayTotal;
                    const tone = total === null ? th.textMuted : total < 0 ? 'text-red-400' : 'text-emerald-400';
                    return (
                      <td key={e.expiration} className="p-0.5">
                        <button type="button" onClick={() => setSelected({ expiration: cell.expiration, strike: cell.strike })}
                          aria-label={`${cell.strike} call ${cell.expiration}`} aria-pressed={isSel}
                          title={`Bid $${cell.bid.toFixed(2)} / ask $${cell.ask.toFixed(2)} (mid $${cell.premiumPerShare.toFixed(2)}). Delta ${cell.delta.toFixed(2)} is the market's estimate of the chance this call finishes in the money.`}
                          className={`w-full rounded border p-1.5 text-left ${isSel ? 'border-white' : cell.belowFloor ? 'border-amber-500/50' : cellInGoal(cell, goal) ? 'border-emerald-500/60' : 'border-neutral-800'}`}>
                          <span className="block text-sm font-bold text-emerald-400">${n.premiumTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })} <span className="text-[10px] font-normal opacity-80">{n.usedBid ? 'at bid' : 'now'}</span>{(cell.wide || cell.thinOi) && <span className="ml-1 text-yellow-400" title={cell.wide ? `Wide spread: bid $${cell.bid.toFixed(2)} / ask $${cell.ask.toFixed(2)}` : 'Thin open interest'} aria-label={cell.wide ? 'wide spread' : 'thin open interest'}>⚠</span>}</span>
                          <span className={`block text-[11px] ${total === null ? th.textFaint : tone}`}>
                            {total !== null ? `${total < 0 ? '-' : '+'}$${Math.abs(total).toLocaleString('en-US', { maximumFractionDigits: 0 })} if called` : ''}<span className={th.textFaint}>{total !== null ? ' · ' : ''}~{ccChanceCalledPct(cell)}% called</span>
                          </span>
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
        <details className={`w-full text-[9px] ${th.textFaint}`}>
          <summary className="cursor-pointer">How to read this grid</summary>
          Big number: what you are paid now. &quot;If called&quot;: your total if the shares are called away, against your cost basis, before fees. A dash means no usable price ({grid.left.unusableQuote + grid.left.farOtm} calls had no bid, a crossed quote, or under a 2% chance of being reached). Click a cell to change the trade above.
        </details>
      </div>

      {anchor && (
        <div data-testid="cc-grid-detail" className={`mt-2 rounded border ${th.border} p-2 text-[10px] leading-relaxed ${th.textMuted}`}>
          <p className={`font-bold ${th.text}`}>${anchor.strike} call · {anchor.expiration} ({anchor.dte}d) · Δ{anchor.delta.toFixed(2)} · bid ${anchor.bid.toFixed(2)} / ask ${anchor.ask.toFixed(2)} · OI {anchor.openInterest}</p>
          <p><b>If not called:</b> you keep ${anchorN!.premiumTotal.toLocaleString('en-US', { maximumFractionDigits: 2 })}{anchorN!.usedBid ? ' (counted at the bid)' : ''} and the shares{anchorN!.notCalledBasis !== null ? `; cost basis falls to $${anchorN!.notCalledBasis.toFixed(2)} per share` : ''}.</p>
          {anchor.belowFloor && <p className="text-amber-400">Below your cost basis: if called away this locks in a loss.</p>}
          {anchor.wide && <p className="text-yellow-400">Wide bid/ask spread (mid ${anchor.premiumPerShare.toFixed(2)}): you will probably be filled near the bid, so the numbers above use the bid.</p>}
          {anchor.thinOi && <p className="text-yellow-400">Thin open interest.</p>}
        </div>
      )}
    </section>
  );
}
