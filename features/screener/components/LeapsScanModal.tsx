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
import { DeferredNumberInput } from './DeferredNumberInput';
import { COMPACT_INPUT, FieldHead, StatusLine } from './scanConfig/CompactControls';
import { CriterionPills, type CriterionPill } from './scanConfig/CriterionPills';
import { ScanLegend } from './scanConfig/ScanLegend';

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

// SCAN-MODAL-UX-0002A: DTE bounds the broker fetch (search range). Delta, OI and extrinsic start as result
// filters and can change after the scan (adjust after scan).
const LEAPS_DTE_PRESETS = [
  { label: '90–365', min: 90, max: 365 },
  { label: '180–730', min: 180, max: 730 },
  { label: '270–730', min: 270, max: 730 },
] as const;

const fmtDelta = (n: number) => n.toFixed(2).replace(/^0/, '');

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

  const dtePills: CriterionPill[] = LEAPS_DTE_PRESETS.map(r => ({
    key: r.label, label: r.label, pressed: draft.dteMin === r.min && draft.dteMax === r.max,
    onSelect: () => setDraft(prev => ({ ...prev, dteMin: r.min, dteMax: r.max })),
  }));
  const num = (key: keyof LeapsScanRequest, label: string, step: string, widthClass = COMPACT_INPUT) => (
    <DeferredNumberInput aria-label={label} step={step} value={draft[key]} onValueChange={value => setField(key, value)} className={widthClass} />
  );
  const hint = 'DTE bounds the broker fetch. Δ, OI, and extrinsic set result filters and can change later without a rescan.';

  return (
    <ScanModalShell
      th={th}
      titleId="leaps-scan-title"
      title="LEAPS SCAN"
      subtitle={`${selectedTickerCount} ticker${selectedTickerCount === 1 ? '' : 's'} in Opportunity Universe · configure before scanning`}
      closeLabel="Close LEAPS scan configuration"
      onClose={onClose}
      maxWidthClassName="max-w-[600px]"
      compact
    >
      <div className="flex flex-col gap-3">
        <ScanLegend
          lifecycles={['fetch']}
          afterScan={{ attr: { 'data-leaps-rule': 'resultFilters' }, hint }}
          note="Search range needs a new scan. Adjust-after-scan settings can change later without one."
        />

        <section aria-label="Search and result filters" className={`grid grid-cols-1 gap-x-5 gap-y-3 border-t ${th.border} pt-3 sm:grid-cols-2`}>
          <div className="flex min-w-0 flex-col gap-1">
            <FieldHead lifecycle="fetch" fixed={false} rescan name="DTE range" tip={<p>Bounds the broker fetch. Nothing outside this window is seen, so a wider window later needs a new scan.</p>} />
            <div className="flex items-center gap-1.5">
              {num('dteMin', 'Min DTE', '1')}
              <span aria-hidden="true" className="text-neutral-500">–</span>
              {num('dteMax', 'Max DTE', '1')}
              <span className="text-[10px] text-neutral-500">days</span>
            </div>
            <CriterionPills th={th} groupLabel="DTE range quick select" pills={dtePills} compact />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <FieldHead lifecycle="result-filter" fixed={false} rescan={false} name="Delta range" align="right" tip={<p>Starts as a result filter. Change it on the results page without a rescan.</p>} />
            <div className="flex items-center gap-1.5">
              {num('deltaMin', 'Min Δ', '0.01')}
              <span aria-hidden="true" className="text-neutral-500">–</span>
              {num('deltaMax', 'Max Δ', '0.01')}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <FieldHead lifecycle="result-filter" fixed={false} rescan={false} name="OI min" tip={<p>Starts as a result filter. Calls below it are hidden from the current view, not removed.</p>} />
            <div className="flex items-center gap-1.5">
              {num('oiMin', 'OI min', '1')}
              <span className="text-[10px] text-neutral-500">contracts</span>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <FieldHead lifecycle="result-filter" fixed={false} rescan={false} name="Max extrinsic" align="right" tip={<p>Starts as a result filter. Extrinsic value as a percent of the option price.</p>} />
            <div className="flex items-center gap-1.5">
              {num('extrinsicPctMax', 'Max extrinsic %', '1')}
              <span className="text-[10px] text-neutral-500">% max</span>
            </div>
          </div>
        </section>

        {error && (
          <StatusLine message={error} />
        )}

        <div className={`flex items-center justify-between gap-4 border-t ${th.border} pt-3`}>
          <p data-testid="leaps-rule-preview" className="min-w-0 text-[10px] leading-snug text-neutral-400">
            {`${draft.dteMin}–${draft.dteMax}d · Δ ${fmtDelta(draft.deltaMin)}–${fmtDelta(draft.deltaMax)} · OI ≥${draft.oiMin} · extrinsic ≤${draft.extrinsicPctMax}%`}
          </p>
          <div className="flex shrink-0 gap-2">
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
      </div>
    </ScanModalShell>
  );
}
