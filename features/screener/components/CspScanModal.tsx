// features/screener/components/CspScanModal.tsx
'use client';

// SCAN-SIMPLIFY-0001 -- the CSP scan asks for one thing: how far out to look (DTE range). That is
// the only setting that changes how many chains are fetched. Delta, open interest, IVR, return,
// affordability and the Conservative / Balanced / More opportunities presets are results-screen
// controls (CspViewControls): changing them never rescans. There is no Rank/Targeted choice any
// more -- Targeted was a filtered list and Rank was a sort, and the results screen does both.

import { useEffect, useState } from 'react';
import type { CspRulesType } from '@/lib/scans/constants';
import type { CspRankSort, CspRuleSnapshot } from '@/lib/scans/cspRuleSnapshot';
import { cspScanRules } from '@/lib/scans/cspView';
import { ScanModalShell, type ScanModalTheme } from './ScanModalShell';
import { DeferredNumberInput } from './DeferredNumberInput';

export interface CspScanRequest {
  mode: CspRuleSnapshot['mode'];
  preset: string;
  rules: CspRulesType;
  popMin: number | null;
  otmMin: number | null;
  rocMin: number | null;
  rankSecondary: CspRankSort;
  /** Optional lower per-CSP cash ceiling; blank uses verified account funds. */
  capitalLimit?: number | null;
  affordableOnly?: boolean;
}

export type CspScanRequestsByMode = Record<CspScanRequest['mode'], CspScanRequest>;

interface Props {
  th: ScanModalTheme;
  selectedTickerCount: number;
  initial: CspScanRequest;
  requestsByMode?: CspScanRequestsByMode;
  onClose: () => void;
  onRun: (request: CspScanRequest) => void;
}

export const CSP_DEFAULT_DTE: [number, number] = [7, 60];
export const LS_CSP_DTE = 'hunter-csp-dte-range';
const DTE_QUICK: Array<[number, number]> = [[7, 14], [15, 29], [30, 45], [21, 60], [7, 60]];
const DTE_ABSOLUTE_MAX = 365;

/** The last-used DTE range, falling back to 7-60. Never throws (storage can be blocked). */
export function readSavedCspDte(): [number, number] {
  try {
    const raw = localStorage.getItem(LS_CSP_DTE);
    if (raw) {
      const [a, b] = JSON.parse(raw);
      if (Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= a && b <= DTE_ABSOLUTE_MAX) return [a, b];
    }
  } catch {}
  return CSP_DEFAULT_DTE;
}

export function CspScanModal({ th, selectedTickerCount, initial, onClose, onRun }: Props) {
  // A session scanned before this change may hand in Targeted rules; only its DTE range is carried forward.
  const [dteMin, setDteMin] = useState<number>(initial.rules.DTE_MIN);
  const [dteMax, setDteMax] = useState<number>(initial.rules.DTE_MAX);
  useEffect(() => {
    const [a, b] = readSavedCspDte();
    setDteMin(a);
    setDteMax(b);
  }, []);

  const valid = Number.isInteger(dteMin) && Number.isInteger(dteMax) && dteMin >= 1 && dteMax >= dteMin && dteMax <= DTE_ABSOLUTE_MAX;
  const error = valid ? '' : `Enter a DTE range from 1 to ${DTE_ABSOLUTE_MAX} where the minimum is not above the maximum.`;

  const run = () => {
    if (!valid) return;
    try { localStorage.setItem(LS_CSP_DTE, JSON.stringify([dteMin, dteMax])); } catch {}
    onRun({
      mode: 'rank', preset: 'view', rules: cspScanRules(dteMin, dteMax),
      popMin: null, otmMin: null, rocMin: null, rankSecondary: 'none',
      capitalLimit: null, affordableOnly: false,
    });
  };

  return (
    <ScanModalShell
      th={th}
      titleId="csp-scan-title"
      title="CASH-SECURED PUT SCAN"
      subtitle={`${selectedTickerCount} selected ticker${selectedTickerCount === 1 ? '' : 's'} · choose how far out to look`}
      closeLabel="Close Cash-Secured Put scan configuration"
      onClose={onClose}
      maxWidthClassName="max-w-[560px]"
      compact
    >
      <div className="flex flex-col gap-4">
        <section aria-label="DTE range" data-csp-card="search" className="flex flex-col gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-300">
            DTE range <span className="font-normal normal-case tracking-normal text-neutral-500">The only setting that changes how many chains are fetched</span>
          </p>
          <div className="flex items-center gap-2">
            <DeferredNumberInput aria-label="Minimum DTE" value={dteMin} onValueChange={setDteMin} min={1} max={DTE_ABSOLUTE_MAX}
              className="w-16 rounded-md border border-neutral-700 bg-transparent px-2 py-1.5 text-sm tabular-nums" />
            <span className="text-neutral-500">–</span>
            <DeferredNumberInput aria-label="Maximum DTE" value={dteMax} onValueChange={setDteMax} min={1} max={DTE_ABSOLUTE_MAX}
              className="w-16 rounded-md border border-neutral-700 bg-transparent px-2 py-1.5 text-sm tabular-nums" />
          </div>
          <div role="group" aria-label="DTE quick select" className="flex flex-wrap gap-1.5">
            {DTE_QUICK.map(([a, b]) => {
              const on = dteMin === a && dteMax === b;
              return (
                <button key={`${a}-${b}`} type="button" aria-pressed={on} data-csp-dte-chip={`${a}-${b}`}
                  onClick={() => { setDteMin(a); setDteMax(b); }}
                  className={`rounded-full border px-3 py-1 text-xs ${on ? 'border-amber-400 bg-amber-400/15 font-bold text-amber-300' : 'border-neutral-700 text-neutral-400'}`}>
                  {a}–{b} DTE
                </button>
              );
            })}
          </div>
        </section>

        <section aria-label="Always applied" className={`rounded-lg border ${th.border} bg-neutral-900/50 px-3 py-2`}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-300">
            Always applied <span className="font-normal normal-case tracking-normal text-neutral-500">Fixed, cannot be changed</span>
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-neutral-100">
            <li data-csp-criterion="bidAsk" className={`rounded-md border ${th.border} px-2 py-0.5`}>Bid/ask tiers</li>
            <li data-csp-criterion="earnings" className={`rounded-md border ${th.border} px-2 py-0.5`}>Earnings buffer · 10 days</li>
            <li data-csp-note="ivr-unavailable" className="rounded-md border border-amber-500/50 px-2 py-0.5 text-amber-200">No IV rank = disqualified</li>
          </ul>
        </section>

        <p className="text-[11px] leading-snug text-neutral-400">
          Delta, open interest, IVR, affordability and the Conservative / Balanced / More opportunities presets are on the results screen. Change them any time, with no rescan.
        </p>

        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        <div className={`flex items-center justify-between gap-4 border-t ${th.border} pt-3`}>
          <p data-testid="csp-rule-preview" className="min-w-0 text-[11px] text-neutral-400">
            {dteMin}–{dteMax} DTE · {selectedTickerCount} ticker{selectedTickerCount === 1 ? '' : 's'}
          </p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-xs">Cancel</button>
            <button type="button" onClick={run} disabled={!valid}
              className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-extrabold text-neutral-900 disabled:opacity-40">RUN CSP SCAN →</button>
          </div>
        </div>
      </div>
    </ScanModalShell>
  );
}
