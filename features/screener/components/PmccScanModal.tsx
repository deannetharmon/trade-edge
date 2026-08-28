'use client';

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

export function PmccScanModal({ th, selectedTickerCount, initial, onClose, onRun }: {
  th: ScanModalTheme;
  selectedTickerCount: number;
  initial: PmccScanRequest;
  onClose: () => void;
  onRun: (request: PmccScanRequest) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const valid = useMemo(() => Object.values(draft).every(Number.isFinite)
    && draft.shortDteMin >= 0 && draft.shortDteMax >= draft.shortDteMin
    && draft.shortDeltaMin >= 0.1 && draft.shortDeltaMax <= 0.4 && draft.shortDeltaMax >= draft.shortDeltaMin
    && draft.shortOiMin >= 0 && draft.maxSpreadPct >= 0, [draft]);
  const field = (key: keyof PmccScanRequest, label: string, step: string) => <label className="flex flex-col gap-1 text-[10px] text-neutral-400"><span>{label}</span><input aria-label={label} type="number" step={step} value={draft[key]} onChange={event => setDraft(value => ({ ...value, [key]: Number(event.target.value) }))} className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white" /></label>;
  return <ScanModalShell th={th} titleId="pmcc-scan-title" title="PMCC SCAN" subtitle={`${selectedTickerCount} held LEAPS position${selectedTickerCount === 1 ? '' : 's'} · configure short-call search`} closeLabel="Close PMCC scan configuration" onClose={onClose}>
    <p className="text-[10px] text-neutral-400">Your held LEAPS is the existing cover. These filters search and rank only the short calls to sell against it; no new long call is selected or purchased.</p>
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {field('shortDteMin', 'Short call min DTE', '1')}
      {field('shortDteMax', 'Short call max DTE', '1')}
      {field('shortDeltaMin', 'Preferred short delta min', '0.01')}
      {field('shortDeltaMax', 'Preferred short delta max', '0.01')}
      {field('shortOiMin', 'Minimum short OI', '1')}
      {field('maxSpreadPct', 'Maximum bid/ask spread %', '1')}
    </div>
    <p className="mt-3 rounded border border-neutral-800 bg-neutral-900/60 p-3 text-[10px] text-neutral-300">DTE {draft.shortDteMin}–{draft.shortDteMax} · preferred Δ {draft.shortDeltaMin.toFixed(2)}–{draft.shortDeltaMax.toFixed(2)} · min OI {draft.shortOiMin} · max spread {draft.maxSpreadPct.toFixed(0)}%. Delta ranks candidates; it does not hide an otherwise tradable short call.</p>
    <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-xs">Cancel</button><button disabled={!valid} onClick={() => onRun(draft)} className="rounded-lg border border-amber-400 bg-amber-400 px-4 py-2 text-xs font-bold text-black disabled:cursor-not-allowed disabled:opacity-40">RUN PMCC SCAN →</button></div>
  </ScanModalShell>;
}
