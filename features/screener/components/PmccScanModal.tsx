'use client';

// features/screener/components/PmccScanModal.tsx
//
// PMCC-SELECT-0001 addition: this modal now shows the ACTUAL held-LEAPS
// positions discovered for this scan (heldCandidates, passed in by the
// caller after discoverHeldPmccCandidates() already ran) as a select-
// one-or-all chip list, defaulting to all selected -- same interaction
// pattern as CC's eligible-holdings chips. Before this, the subtitle here
// claimed "N held LEAPS position(s)" but was actually just displaying the
// Opportunity Universe ticker count, not real held-LEAPS data (Alan
// flagged this as a real, pre-existing label bug while investigating this
// ticket).

import { useMemo, useState } from 'react';
import { ScanModalShell, type ScanModalTheme } from './ScanModalShell';

export interface PmccScanRequest {
  shortDteMin: number;
  shortDteMax: number;
  shortDeltaMin: number;
  shortDeltaMax: number;
  shortOiMin: number;
  maxSpreadPct: number;
}

export interface PmccHeldCandidateSummary {
  underlyingSymbol: string;
  dte: number;
}

export function PmccScanModal({
  th, heldCandidates, hiddenSymbols, onToggleSymbol, initial, onClose, onRun,
}: {
  th: ScanModalTheme;
  heldCandidates: PmccHeldCandidateSummary[];
  hiddenSymbols: string[];
  onToggleSymbol: (symbol: string) => void;
  initial: PmccScanRequest;
  onClose: () => void;
  onRun: (request: PmccScanRequest) => void;
}) {
  const [draft, setDraft] = useState(initial);

  // One chip per unique underlying symbol -- a symbol can appear multiple
  // times in heldCandidates (different expirations/strikes of the same
  // held LEAPS), but selection happens at the symbol level.
  const symbols = useMemo(
    () => Array.from(new Set(heldCandidates.map(c => c.underlyingSymbol))).sort(),
    [heldCandidates],
  );
  const selectedCount = symbols.filter(s => !hiddenSymbols.includes(s)).length;

  const valid = useMemo(() => Object.values(draft).every(Number.isFinite)
    && draft.shortDteMin >= 0 && draft.shortDteMax >= draft.shortDteMin
    && draft.shortDeltaMin >= 0.1 && draft.shortDeltaMax <= 0.4 && draft.shortDeltaMax >= draft.shortDeltaMin
    && draft.shortOiMin >= 0 && draft.maxSpreadPct >= 0
    && selectedCount > 0, [draft, selectedCount]);
  const field = (key: keyof PmccScanRequest, label: string, step: string) => <label className="flex flex-col gap-1 text-[10px] text-neutral-400"><span>{label}</span><input aria-label={label} type="number" step={step} value={draft[key]} onChange={event => setDraft(value => ({ ...value, [key]: Number(event.target.value) }))} className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white" /></label>;
  return <ScanModalShell th={th} titleId="pmcc-scan-title" title="PMCC SCAN" subtitle={`${selectedCount} of ${symbols.length} held LEAPS position${symbols.length === 1 ? '' : 's'} selected · configure short-call search`} closeLabel="Close PMCC scan configuration" onClose={onClose}>
    <p className="text-[10px] text-neutral-400">Your held LEAPS is the existing cover. These filters search and rank only the short calls to sell against it; no new long call is selected or purchased.</p>
    {symbols.length === 0 ? (
      <p className="mt-3 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 leading-relaxed font-medium">
        ⚠ No eligible held long calls were found in your connected broker account.
      </p>
    ) : (
      <div className="mt-3 flex flex-wrap gap-1" data-testid="pmcc-held-leaps-selection">
        {symbols.map(symbol => {
          const hidden = hiddenSymbols.includes(symbol);
          return (
            <button
              key={symbol}
              type="button"
              onClick={() => onToggleSymbol(symbol)}
              className={`text-[9px] px-2 py-0.5 rounded border font-bold transition-colors ${
                hidden
                  ? 'border-neutral-700 text-neutral-500 line-through opacity-40'
                  : 'border-amber-500 text-amber-300 bg-amber-500/10'
              }`}
            >
              {symbol}
            </button>
          );
        })}
      </div>
    )}
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {field('shortDteMin', 'Short call min DTE', '1')}
      {field('shortDteMax', 'Short call max DTE', '1')}
      {field('shortDeltaMin', 'Preferred short delta min', '0.01')}
      {field('shortDeltaMax', 'Preferred short delta max', '0.01')}
      {field('shortOiMin', 'Minimum short OI', '1')}
      {field('maxSpreadPct', 'Maximum bid/ask spread %', '1')}
    </div>
    <p className="mt-3 rounded border border-neutral-800 bg-neutral-900/60 p-3 text-[10px] text-neutral-300">DTE {draft.shortDteMin}–{draft.shortDteMax} · preferred Δ {draft.shortDeltaMin.toFixed(2)}–{draft.shortDeltaMax.toFixed(2)} · min OI {draft.shortOiMin} · max spread {draft.maxSpreadPct.toFixed(0)}%. Delta ranks candidates; it does not hide an otherwise tradable short call.</p>
    {symbols.length > 0 && selectedCount === 0 && (
      <p role="alert" className="mt-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 leading-relaxed font-medium">
        ⚠ Select at least one held LEAPS position before running.
      </p>
    )}
    <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-xs">Cancel</button><button disabled={!valid} onClick={() => onRun(draft)} className="rounded-lg border border-amber-400 bg-amber-400 px-4 py-2 text-xs font-bold text-black disabled:cursor-not-allowed disabled:opacity-40">RUN PMCC SCAN →</button></div>
  </ScanModalShell>;
}
