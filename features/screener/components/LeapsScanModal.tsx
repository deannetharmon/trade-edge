'use client';

// features/screener/components/LeapsScanModal.tsx
//
// LEAPS pre-scan modal. Before this component existed, FIND LEAPS ran
// immediately with no configuration step -- Delta/DTE/OI/Extrinsic were
// only ever adjustable AFTER the scan, as chips on the results page. Dean
// expected the same "configure before scanning" pattern already live for
// Filter/Rank/Targeted, CSP, and CC (this closes the one gap -- PMCC
// already had its own modal).
//
// Deliberately single-mode, no presets -- same reasoning as CcScanModal:
// LEAPS has no Filter/Rank/Targeted concept, and a preset layer is a
// separate scoped decision, not something to inherit by default.
//
// IMPORTANT ARCHITECTURE NOTE, not just a UI detail: of the fields below,
// only DTE min/max actually bounds the broker chain fetch (see
// runLeapsScan in app/screener/page.tsx). Delta/OI/Extrinsic are NOT
// scan-time hard filters -- LEAPS-0001 deliberately fetches the full set
// of legs across the chosen DTE window and lets the results-page chips
// narrow Delta/OI/Extrinsic afterward, on the full fetched dataset (a
// candidate outside those ranges still exists, flagged rather than
// dropped). That's why only the post-scan DTE chips get clamped to the
// scanned range elsewhere in page.tsx -- Delta/OI/Extrinsic chips can
// freely widen after the fact because the underlying data already covers
// their full range; DTE cannot, because the broker was never asked for
// anything outside what's chosen here.

import { useMemo, useState } from 'react';
import { ScanModalShell, type ScanModalTheme } from './ScanModalShell';

export interface LeapsScanRequest {
  deltaMin: number;
  deltaMax: number;
  dteMin: number;
  dteMax: number;
  oiMin: number;
  extrinsicPctMax: number;
}

interface Props {
  th: ScanModalTheme;
  selectedTickerCount: number;
  initial: LeapsScanRequest;
  onClose: () => void;
  onRun: (request: LeapsScanRequest) => void;
}

const LEAPS_FIELDS: Array<[keyof LeapsScanRequest, string, string]> = [
  ['deltaMin', 'Min delta', '0.01'],
  ['deltaMax', 'Max delta', '0.01'],
  ['dteMin', 'Min DTE', '1'],
  ['dteMax', 'Max DTE', '1'],
  ['oiMin', 'Min OI', '1'],
  ['extrinsicPctMax', 'Max extrinsic % of cost (0 = Any)', '1'],
];

export function LeapsScanModal({ th, selectedTickerCount, initial, onClose, onRun }: Props) {
  const [draft, setDraft] = useState<LeapsScanRequest>(initial);
  const [error, setError] = useState('');

  const valid = useMemo(() => {
    return Object.values(draft).every(Number.isFinite)
      && draft.deltaMin >= 0 && draft.deltaMax <= 1 && draft.deltaMax > draft.deltaMin
      && draft.dteMin >= 0 && draft.dteMax > draft.dteMin
      && draft.oiMin >= 0 && draft.extrinsicPctMax >= 0;
  }, [draft]);

  const setField = (key: keyof LeapsScanRequest, value: number) =>
    setDraft(prev => ({ ...prev, [key]: value }));

  return (
    <ScanModalShell
      th={th}
      titleId="leaps-scan-title"
      title="LEAPS SCAN"
      subtitle={`${selectedTickerCount} ticker${selectedTickerCount === 1 ? '' : 's'} in Opportunity Universe · configure before scanning`}
      closeLabel="Close LEAPS scan configuration"
      onClose={onClose}
    >
      <div className="flex flex-col gap-0">
        <p className="text-[10px] text-neutral-400">
          Only Min/Max DTE actually bound what gets fetched from the broker. Delta, OI, and
          Extrinsic here just set your starting point on the results page -- every candidate
          in the chosen DTE window is fetched regardless, and those three stay freely
          adjustable afterward without rescanning.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {LEAPS_FIELDS.map(([key, label, step]) => (
            <label key={key} className="flex flex-col gap-1 text-[10px] text-neutral-400">
              {label}
              <input
                aria-label={label}
                type="number"
                step={step}
                value={draft[key]}
                onChange={e => setField(key, Number(e.target.value))}
                className="mt-1 w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white"
              />
            </label>
          ))}
        </div>

        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] text-neutral-500">DTE</span>
          {[
            { label: '90–365', min: 90, max: 365 },
            { label: '180–730', min: 180, max: 730 },
            { label: '270–730', min: 270, max: 730 },
          ].map(r => (
            <button
              key={r.label}
              type="button"
              onClick={() => setDraft(prev => ({ ...prev, dteMin: r.min, dteMax: r.max }))}
              className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                draft.dteMin === r.min && draft.dteMax === r.max
                  ? 'border-amber-500 text-amber-300 bg-amber-500/15'
                  : 'border-neutral-700 text-neutral-400 hover:border-amber-500/50'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div
          className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-[10px] text-neutral-300"
          data-testid="leaps-scan-preview"
        >
          DTE {draft.dteMin}–{draft.dteMax} (bounds the fetch) · Δ{' '}
          {draft.deltaMin.toFixed(2)}–{draft.deltaMax.toFixed(2)} · min OI {draft.oiMin} · max
          extrinsic {draft.extrinsicPctMax === 0 ? 'Any' : `${draft.extrinsicPctMax}%`} -- starting
          point for the results filters, adjustable after scanning without a rescan.
        </div>

        {error && (
          <p role="alert" className="mt-2 text-xs text-red-400">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-xs">
            Cancel
          </button>
          <button
            disabled={!valid}
            onClick={() => {
              if (!valid) {
                setError('Correct the LEAPS ranges before running.');
                return;
              }
              onRun(draft);
            }}
            className="rounded-lg border border-amber-400 bg-amber-400 px-4 py-2 text-xs font-bold text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            RUN LEAPS SCAN →
          </button>
        </div>
      </div>
    </ScanModalShell>
  );
}
