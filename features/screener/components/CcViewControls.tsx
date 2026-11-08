// features/screener/components/CcViewControls.tsx
'use client';

// CC-SIMPLIFY-0001 Phase 2 -- the covered-call results-screen view: delta range and max width (the two rules that used
// to be pre-scan settings), plus the "N hidden by result filters" banner with Reset. Changing a chip re-picks each
// ticker's best call from the calls the scan kept; nothing here scans.

import { useState } from 'react';
import { CC_VIEW_PRESETS, CC_WIDTH_CHOICES, DEFAULT_CC_VIEW, ccViewFromPreset, ccViewWith, type CcHiddenCall, type CcView } from '@/lib/scans/ccView';
import { DeferredNumberInput } from './DeferredNumberInput';
import type { ScanModalTheme } from './ScanModalShell';

export interface CcViewControlsProps {
  view: CcView;
  th: ScanModalTheme;
  /** Calls the delta range or width currently hides, across all tickers. */
  hiddenCount: number;
  onChange: (next: CcView) => void;
  /** The calls the view hides, per ticker. Called only while the list is open. */
  loadHidden?: () => Array<{ symbol: string; floor: number | null; calls: CcHiddenCall[] }>;
}

const MAX_HIDDEN_ROWS = 25;

function reasonText(c: CcHiddenCall, view: CcView): string {
  if (c.reason === 'delta-low') return `Δ below ${view.deltaMin.toFixed(2)}`;
  if (c.reason === 'delta-high') return `Δ above ${view.deltaMax.toFixed(2)}`;
  return `${c.widthPct.toFixed(0)}% wide (max ${view.widthPctMax}%)`;
}

const CHIP = 'min-h-7 rounded-md border px-2.5 py-1 text-xs';
const ON = 'border-sky-400 bg-sky-400/15 font-bold text-sky-200';
const OFF = 'border-neutral-700 text-neutral-300';
const NUM = 'w-14 rounded-md border border-neutral-700 bg-transparent px-1.5 py-1 text-xs tabular-nums';

const isDefault = (v: CcView) => v.deltaMin === DEFAULT_CC_VIEW.deltaMin && v.deltaMax === DEFAULT_CC_VIEW.deltaMax && v.widthPctMax === DEFAULT_CC_VIEW.widthPctMax;

export function CcViewControls({ view, th, hiddenCount, onChange, loadHidden }: CcViewControlsProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const showCustom = customOpen || view.preset === 'custom';
  const atDefault = isDefault(view);
  return (
    <div data-testid="cc-view-controls" className="mb-3 flex flex-col gap-2">
      {hiddenCount > 0 && (
        <div role="status" data-testid="cc-view-hidden" className="flex items-center justify-between gap-3 rounded-lg border border-amber-700 bg-amber-400/10 px-3 py-2">
          <span className="text-xs text-amber-300">{hiddenCount} call{hiddenCount === 1 ? '' : 's'} outside this delta and width view</span>
          <span className="flex items-center gap-2">
            {loadHidden && (
              <button type="button" onClick={() => setListOpen(open => !open)} aria-expanded={listOpen}
                className="min-h-7 rounded-md border border-amber-400 px-3 text-xs text-amber-300">{listOpen ? 'Hide the calls' : 'Show the calls'}</button>
            )}
            <button type="button" onClick={() => { setCustomOpen(false); onChange(DEFAULT_CC_VIEW); }} disabled={atDefault}
              className="min-h-7 rounded-md border border-amber-400 px-3 text-xs text-amber-300 disabled:opacity-40">Reset filters</button>
          </span>
        </div>
      )}
      {hiddenCount > 0 && listOpen && loadHidden && (
        <div data-testid="cc-view-hidden-list" className="rounded-lg border border-neutral-700 p-3 text-[11px] text-neutral-300">
          <p className="mb-2 text-[10px] text-neutral-500">For information only: these calls are not picks and cannot be ordered here. Strikes below your cost-basis floor are not listed; the strike grid shows them under &quot;Show below cost basis&quot;.</p>
          {loadHidden().filter(t => t.calls.length > 0).map(t => (
            <div key={t.symbol} className="mb-3 last:mb-0" data-testid={`cc-view-hidden-${t.symbol}`}>
              <p className="font-bold text-neutral-100">{t.symbol} <span className="font-normal text-neutral-400">· {t.calls.length} call{t.calls.length === 1 ? '' : 's'}{t.floor !== null ? ` at or above the $${t.floor.toFixed(2)} floor` : ''}</span></p>
              <table className="mt-1 w-full text-left tabular-nums">
                <thead className="text-[10px] uppercase tracking-wider text-neutral-500"><tr><th className="pr-3 font-medium">Expiry</th><th className="pr-3 font-medium">Strike</th><th className="pr-3 font-medium">Delta</th><th className="pr-3 font-medium">Bid / Ask</th><th className="font-medium">Why it is outside</th></tr></thead>
                <tbody>
                  {t.calls.slice(0, MAX_HIDDEN_ROWS).map(c => (
                    <tr key={`${c.expiration}-${c.strike}`}><td className="pr-3">{c.expiration} <span className="text-neutral-500">({c.dte}d)</span></td><td className="pr-3">${c.strike}</td><td className="pr-3">{c.delta.toFixed(2)}</td><td className="pr-3">{c.bid.toFixed(2)} / {c.ask.toFixed(2)}</td><td className="text-amber-300">{reasonText(c, view)}</td></tr>
                  ))}
                </tbody>
              </table>
              {t.calls.length > MAX_HIDDEN_ROWS && <p className="mt-1 text-[10px] text-neutral-500">Showing the {MAX_HIDDEN_ROWS} nearest to your range.</p>}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`w-14 text-[10px] font-bold uppercase tracking-wider ${th.textMuted}`}>Delta</span>
        {CC_VIEW_PRESETS.map(p => (
          <button key={p.key} type="button" aria-pressed={view.preset === p.key} data-cc-delta-preset={p.key}
            onClick={() => { setCustomOpen(false); onChange(ccViewFromPreset(p.key, view)); }}
            className={`${CHIP} ${view.preset === p.key ? ON : OFF}`}>
            {p.label} <span className="text-neutral-500">Δ{p.deltaMin.toFixed(2)}–{p.deltaMax.toFixed(2)}</span>
          </button>
        ))}
        <button type="button" aria-pressed={showCustom} data-cc-delta-preset="custom" onClick={() => setCustomOpen(true)} className={`${CHIP} ${showCustom ? ON : OFF}`}>Custom</button>
        {showCustom && (
          <span className="flex items-center gap-1 text-[11px] text-neutral-400">
            <DeferredNumberInput aria-label="Delta minimum" step="0.01" value={view.deltaMin} onValueChange={v => onChange(ccViewWith(view, { deltaMin: v }))} className={NUM} />
            <span>–</span>
            <DeferredNumberInput aria-label="Delta maximum" step="0.01" value={view.deltaMax} onValueChange={v => onChange(ccViewWith(view, { deltaMax: v }))} className={NUM} />
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`w-14 text-[10px] font-bold uppercase tracking-wider ${th.textMuted}`}>Width</span>
        {CC_WIDTH_CHOICES.map(w => (
          <button key={w} type="button" aria-pressed={view.widthPctMax === w} data-cc-width={w}
            onClick={() => onChange(ccViewWith(view, { widthPctMax: w }))} className={`${CHIP} ${view.widthPctMax === w ? ON : OFF}`}>{w}%</button>
        ))}
        <span className="text-[10px] text-neutral-500">Max bid/ask width, % of mid (ceiling ${view.widthCeiling.toFixed(2)}). Re-picks the best call from what was scanned. No rescan.</span>
      </div>
    </div>
  );
}
