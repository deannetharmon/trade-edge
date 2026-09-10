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
import { DeferredNumberInput } from './DeferredNumberInput';

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
  th, heldCandidates, hiddenSymbols, onToggleSymbol, discoveryLoading, exclusions, initial, onClose, onRun,
}: {
  th: ScanModalTheme;
  heldCandidates: PmccHeldCandidateSummary[];
  hiddenSymbols: string[];
  onToggleSymbol: (symbol: string) => void;
  // PMCC-DISCOVERY-ASYNC-0001: the broker portfolio refresh backing
  // heldCandidates now runs in the background after this modal is
  // already open, same as CC's holdingsLoading -- without this flag the
  // modal would flash an empty-state banner before real data arrives.
  discoveryLoading: boolean;
  // PMCC-EXCLUSIONS-0001: real per-position reasons a held call didn't
  // qualify, shown when symbols.length === 0 so "no eligible" is never a
  // dead end.
  exclusions: Array<{ symbol: string; reason: string }>;
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
    && !discoveryLoading && selectedCount > 0, [draft, selectedCount, discoveryLoading]);
  const field = (key: keyof PmccScanRequest, label: string, step: string) => <label className="flex flex-col gap-1 text-[10px] text-neutral-400"><span>{label}</span><DeferredNumberInput aria-label={label} step={step} value={draft[key]} onValueChange={next => setDraft(value => ({ ...value, [key]: next }))} className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white" /></label>;
  return <ScanModalShell th={th} titleId="pmcc-scan-title" title="PMCC SCAN" subtitle={`${selectedCount} of ${symbols.length} held LEAPS position${symbols.length === 1 ? '' : 's'} selected · configure short-call search`} closeLabel="Close PMCC scan configuration" onClose={onClose}>
    <p className="text-[10px] text-neutral-400">Searches short calls to sell against your held LEAPS.</p>
    {discoveryLoading ? (
      <p className="mt-3 text-[10px] text-neutral-400">Loading held LEAPS positions…</p>
    ) : symbols.length === 0 ? (
      <div className="mt-3 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 leading-relaxed font-medium">
        <p>⚠ No eligible held long calls were found in your connected broker account.</p>
        {exclusions.length > 0 && (
          <ul className="mt-1.5 list-disc list-inside font-normal">
            {exclusions.map((e, i) => (
              <li key={i}>{e.symbol}: {e.reason}</li>
            ))}
          </ul>
        )}
      </div>
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
      {field('shortDteMin', 'Min DTE', '1')}
      {field('shortDteMax', 'Max DTE', '1')}
      {field('shortDeltaMin', 'Min Δ', '0.01')}
      {field('shortDeltaMax', 'Max Δ', '0.01')}
      {field('shortOiMin', 'Short OI min', '1')}
      {field('maxSpreadPct', 'Max spread %', '1')}
    </div>
    <p className="mt-3 rounded border border-neutral-800 bg-neutral-900/60 p-3 text-[10px] text-neutral-300">Delta guides rank; it does not hide an otherwise tradable short call.</p>
    {!discoveryLoading && symbols.length > 0 && selectedCount === 0 && (
      <p role="alert" className="mt-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 leading-relaxed font-medium">
        ⚠ Select at least one held LEAPS position before running.
      </p>
    )}
    <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-xs">Cancel</button><button disabled={!valid} onClick={() => onRun(draft)} className="rounded-lg border border-amber-400 bg-amber-400 px-4 py-2 text-xs font-bold text-black disabled:cursor-not-allowed disabled:opacity-40">RUN PMCC SCAN →</button></div>
  </ScanModalShell>;
}
