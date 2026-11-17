'use client';

// features/screener/components/CcOutsideView.tsx
// CC-PMCC-GUIDANCE-0001 slice A2 -- the scan row for a covered call that did not qualify: Calls Ready/Wait/Recovery, the
// plain timing reasons, the cost basis and where it came from, and the calls outside your view (information only, never a pick).

import { useState } from 'react';
import type { ScreenResult } from '@/lib/scans/types';
import { ccCellNumbers, DEFAULT_CC_GOAL } from '@/lib/scans/ccGridView';
import { ccMidPerShare, ccExpirationLabel, ccGoalPopRange, ccOutsideTheView, ccPopPct, ccPriceGapPct, ccStockMovePctSafe, ccStrikeLabel, ccTimingNote } from '@/lib/scans/ccGuidance';
import { trendRsiForDisplay } from '@/lib/scans/trendRsi';
import { useCcRsiCutoff } from '@/features/screener/useCcRsiCutoff';
import { CcBasisLine } from './CcBasisLine';

export function CcOutsideView({ result, textFaint }: { result: ScreenResult; textFaint: string }) {
  const [cutoff] = useCcRsiCutoff();
  const [open, setOpen] = useState(false);
  const basis = result.ccBasis?.basis ?? null;
  const note = ccTimingNote({ symbol: result.symbol, rsi: trendRsiForDisplay(result.trendResult?.metrics), price: result.price, basis, cutoff });
  const grid = result.ccGrid;
  const outside = grid ? ccOutsideTheView(grid, DEFAULT_CC_GOAL) : [];
  const { lo, hi } = ccGoalPopRange(DEFAULT_CC_GOAL);
  return (
    <div data-testid="cc-outside-view" className="space-y-1 px-3 pb-2 text-[13px]">
      {/* The row already carries the Calls chip; the floor sentence is left out when a timing line says the same thing. */}
      <CcBasisLine basis={result.ccBasis} floor={note.lines.length > 0 ? undefined : result.ccFloorInfo?.floor} price={note.lines.length > 0 ? undefined : result.ccFloorInfo?.price} />
      {note.lines.map(l => <p key={l} className="text-amber-300">{l}</p>)}
      {outside.length > 0 && (
        <div>
          <p className={textFaint}>{outside.length} call{outside.length === 1 ? ' is' : 's are'} outside your view (chance of keeping your shares {lo} to {hi}%, or price gap)</p>
          <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300">{open ? 'Hide the calls' : 'Show the calls'}</button>
          {open && grid && (
            <div className="mt-1 overflow-x-auto">
              <p className={textFaint}>Information only, never a pick.</p>
              <table data-testid="cc-outside-table" className="w-full border-collapse">
                <thead><tr className={textFaint}>{['Expiry', 'Strike', '% above price', 'POP', 'You would collect', 'Price gap', 'Why outside your view'].map(h => <th key={h} className="p-1 text-left font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {outside.map(({ cell, why }) => {
                    const n = ccCellNumbers(grid, cell);
                    const gap = ccPriceGapPct(cell.bid, cell.ask);
                    const up = ccStockMovePctSafe(grid, cell);
                    return (
                      <tr key={`${cell.expiration}|${cell.strike}`}>
                        <td className="p-1">{ccExpirationLabel(cell.expiration)} · {cell.dte}d</td>
                        <td className="p-1">{ccStrikeLabel(cell.strike)}</td>
                        <td className="p-1">{up !== null ? `${up.toFixed(1)}%` : '—'}</td>
                        <td className="p-1">{ccPopPct(cell.delta)}%</td>
                        <td className="p-1">${Math.round(n.premiumTotal)} <span className="opacity-70">(bid {cell.bid.toFixed(2)} · mid {ccMidPerShare(cell.bid, cell.ask).toFixed(2)} · ask {cell.ask.toFixed(2)})</span></td>
                        <td className="p-1">{gap !== null ? `${gap.toFixed(1)}%` : '—'}</td>
                        <td className="p-1">{why}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
