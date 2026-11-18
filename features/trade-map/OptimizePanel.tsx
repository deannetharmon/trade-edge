// features/trade-map/OptimizePanel.tsx
//
// OPTMAP-0001 S5: the screener's own pick for this symbol at the trader's width, plus the screener's best at each width.
// Display only: every number comes from the screener's finders (lib/trademap/optimize.ts); nothing here scores or ranks.

'use client';

import type { SpreadCandidate } from '@/lib/scans/types';

export interface OptimizePanelProps {
  th: any;
  /** The width in dollars the pick was searched at; null when every width was searched. */
  widthDollars: number | null;
  pick: SpreadCandidate | null;
  atEachWidth: SpreadCandidate[];
  noQuotes: boolean;
  /** Short strike currently on the map, to mark the loaded row. */
  loadedShort: number | null;
  loadedLong: number | null;
  canUndo: boolean;
  onLoad: (c: SpreadCandidate) => void;
  onUndo: () => void;
  onClose: () => void;
}

const widthText = (w: number) => `$${Number.isInteger(w) ? w : w.toFixed(2)}`;

export default function OptimizePanel(p: OptimizePanelProps) {
  const { th } = p;
  const head = p.noQuotes
    ? 'No usable quotes for these strikes yet'
    : p.pick
      ? `Screener pick at ${p.widthDollars != null ? `your ${widthText(p.widthDollars)} width` : 'its best width'}`
      : `Nothing passes your scan criteria at ${p.widthDollars != null ? `${widthText(p.widthDollars)} wide` : 'any width'}`;
  return (
    <div data-testid="optimize-panel" className={`${th.card} ${th.border} border rounded-lg p-3 flex flex-col gap-2`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`text-sm font-bold ${th.text}`}>{head}</span>
        <span className="ml-auto flex gap-3 text-xs">
          {p.canUndo && <button type="button" onClick={p.onUndo} className="text-[var(--accent,#3b82f6)] underline decoration-dotted">Undo</button>}
          <button type="button" onClick={p.onClose} className={`${th.textFaint} underline decoration-dotted`}>Close</button>
        </span>
      </div>
      {p.noQuotes && <div className={`text-xs ${th.textFaint}`}>The broker returned no complete two-sided quotes for this expiration. Try again when the market is open.</div>}
      {!p.noQuotes && !p.pick && (
        <div className={`text-xs ${th.textFaint}`}>No short strike meets your saved delta, market, credit ratio, return on risk and POP rules at this width. Your strikes were not changed. {p.atEachWidth.length > 0 ? 'The screener does find these at other widths:' : 'Try another width or expiration.'}</div>
      )}
      {p.pick && <div className={`text-xs ${th.textFaint}`}>Loaded onto the map. Chosen with your saved scan criteria, using the same logic as the screener.</div>}
      {p.atEachWidth.length > 0 && (
        <>
          <div className={`text-[11px] tracking-wider ${th.textFaint}`}>THE SCREENER&apos;S BEST AT EACH WIDTH (click one to load it)</div>
          <div className="flex flex-col gap-0.5">
            {p.atEachWidth.map((c, i) => {
              const loaded = c.shortStrike === p.loadedShort && c.longStrike === p.loadedLong;
              return (
                <button
                  key={`${c.shortStrike}-${c.longStrike}`}
                  type="button"
                  onClick={() => p.onLoad(c)}
                  className={`grid grid-cols-[90px_150px_1fr] gap-2 text-left text-xs rounded px-2 py-1.5 ${loaded ? 'bg-[#16233a]' : ''} ${th.text}`}
                >
                  <span className={th.textFaint}>{widthText(c.spreadWidth)} wide</span>
                  <span className="font-semibold">
                    {c.shortStrike} / {c.longStrike}
                    {i === 0 && <span className="ml-2 px-2 py-0.5 rounded-full border border-emerald-700 bg-emerald-500/10 text-emerald-400 text-[10px] font-semibold">Best opportunity</span>}
                  </span>
                  <span className={th.textFaint}>credit ${c.credit.toFixed(2)} · POP {Math.round(c.pop ?? 0)}% · ROC {Math.round(c.roc)}%</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      <div className={`text-[11px] ${th.textFaint}`}>Same finders and saved criteria as the screener; Trade Map adds no scoring. Bull put and bear call spreads for now.</div>
    </div>
  );
}
