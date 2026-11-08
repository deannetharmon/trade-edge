// features/screener/components/CcViewControls.tsx
'use client';

// CC-SIMPLIFY-0001 Phase 2 -- the covered-call results-screen view: delta range and max width (the two rules that used
// to be pre-scan settings), plus the "N hidden by result filters" banner with Reset. Changing a chip re-picks each
// ticker's best call from the calls the scan kept; nothing here scans.

import { useState } from 'react';
import { CC_VIEW_PRESETS, CC_WIDTH_CHOICES, DEFAULT_CC_VIEW, ccViewFromPreset, ccViewWith, type CcView } from '@/lib/scans/ccView';
import { DeferredNumberInput } from './DeferredNumberInput';
import type { ScanModalTheme } from './ScanModalShell';

export interface CcViewControlsProps {
  view: CcView;
  th: ScanModalTheme;
  /** Calls the delta range or width currently hides, across all tickers. */
  hiddenCount: number;
  onChange: (next: CcView) => void;
}

const CHIP = 'min-h-7 rounded-md border px-2.5 py-1 text-xs';
const ON = 'border-sky-400 bg-sky-400/15 font-bold text-sky-200';
const OFF = 'border-neutral-700 text-neutral-300';
const NUM = 'w-14 rounded-md border border-neutral-700 bg-transparent px-1.5 py-1 text-xs tabular-nums';

const isDefault = (v: CcView) => v.deltaMin === DEFAULT_CC_VIEW.deltaMin && v.deltaMax === DEFAULT_CC_VIEW.deltaMax && v.widthPctMax === DEFAULT_CC_VIEW.widthPctMax;

export function CcViewControls({ view, th, hiddenCount, onChange }: CcViewControlsProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const showCustom = customOpen || view.preset === 'custom';
  const atDefault = isDefault(view);
  return (
    <div data-testid="cc-view-controls" className="mb-3 flex flex-col gap-2">
      {hiddenCount > 0 && (
        <div role="status" data-testid="cc-view-hidden" className="flex items-center justify-between gap-3 rounded-lg border border-amber-700 bg-amber-400/10 px-3 py-2">
          <span className="text-xs text-amber-300">{hiddenCount} call{hiddenCount === 1 ? '' : 's'} hidden by result filters</span>
          <button type="button" onClick={() => { setCustomOpen(false); onChange(DEFAULT_CC_VIEW); }} disabled={atDefault}
            className="min-h-7 rounded-md border border-amber-400 px-3 text-xs text-amber-300 disabled:opacity-40">Reset filters</button>
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
