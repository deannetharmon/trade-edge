// features/screener/components/CspViewControls.tsx
'use client';

// SCAN-SIMPLIFY-0001 -- the CSP results-screen view: presets plus every control that used to live
// in the pre-scan modal (delta band, IVR band, open-interest preference, DTE window, return,
// affordability). Changing any of them re-grades the contracts already fetched. Nothing here scans.

import { CSP_VIEW_PRESETS, type CspView, type CspViewPresetKey } from '@/lib/scans/cspView';
import { DeferredNumberInput } from './DeferredNumberInput';
import type { ScanModalTheme } from './ScanModalShell';

export interface CspViewControlsProps {
  view: CspView;
  th: ScanModalTheme;
  onPreset: (key: Exclude<CspViewPresetKey, 'custom'>) => void;
  onChange: (patch: Partial<Omit<CspView, 'preset'>>) => void;
  affordableOnly: boolean;
  setAffordableOnly: (v: boolean) => void;
  /** Optional: when provided, shows the "Group by expiration" checkbox. Off = one flat list ordered by the Sort chips. */
  groupByExpiration?: boolean;
  setGroupByExpiration?: (v: boolean) => void;
}

const NUM = 'w-14 rounded-md border border-neutral-700 bg-transparent px-1.5 py-1 text-xs tabular-nums';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-neutral-400">
      <span className="whitespace-nowrap">{label}</span>
      {children}
    </label>
  );
}

export function CspViewControls({ view, th, onPreset, onChange, affordableOnly, setAffordableOnly, groupByExpiration, setGroupByExpiration }: CspViewControlsProps) {
  return (
    <div data-testid="csp-view-controls" className="mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-[10px] font-bold uppercase tracking-wider ${th.textMuted}`}>View preset</span>
        <div role="radiogroup" aria-label="CSP view preset" className="flex flex-wrap gap-1.5">
          {CSP_VIEW_PRESETS.map(p => (
            <button key={p.key} type="button" role="radio" aria-checked={view.preset === p.key} data-csp-view-preset={p.key}
              title={p.description} onClick={() => onPreset(p.key)}
              className={`rounded-full border px-3 py-1 text-xs ${view.preset === p.key ? 'border-amber-400 bg-amber-400/15 font-bold text-amber-300' : 'border-neutral-700 text-neutral-400'}`}>
              {p.label}
            </button>
          ))}
          <span role="radio" aria-checked={view.preset === 'custom'} aria-disabled="true" data-csp-view-preset="custom"
            className={`rounded-full border px-3 py-1 text-xs ${view.preset === 'custom' ? 'border-amber-400 bg-amber-400/15 font-bold text-amber-300' : 'border-neutral-800 text-neutral-600'}`}>
            Custom
          </span>
        </div>
        <span className="text-[10px] text-neutral-500">Re-grades the contracts already scanned. No rescan.</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Field label="Delta">
          <DeferredNumberInput aria-label="Delta minimum" step="0.01" value={view.deltaMin} onValueChange={v => onChange({ deltaMin: v })} className={NUM} />
          <span>–</span>
          <DeferredNumberInput aria-label="Delta maximum" step="0.01" value={view.deltaMax} onValueChange={v => onChange({ deltaMax: v })} className={NUM} />
        </Field>
        <Field label="DTE">
          <DeferredNumberInput aria-label="View DTE minimum" value={view.dteMin} onValueChange={v => onChange({ dteMin: v })} className={NUM} />
          <span>–</span>
          <DeferredNumberInput aria-label="View DTE maximum" value={view.dteMax} onValueChange={v => onChange({ dteMax: v })} className={NUM} />
        </Field>
        <Field label="IVR preferred ≥">
          <DeferredNumberInput aria-label="IVR preferred minimum" value={view.ivrMin} onValueChange={v => onChange({ ivrMin: v })} className={NUM} />
        </Field>
        <Field label="IVR cap ≤">
          <DeferredNumberInput aria-label="IVR cap maximum" value={view.ivrMax} onValueChange={v => onChange({ ivrMax: v })} className={NUM} />
        </Field>
        <Field label="Prefer OI ≥">
          <DeferredNumberInput aria-label="Preferred open interest" value={view.oiMin} onValueChange={v => onChange({ oiMin: v })} className={NUM} />
        </Field>
        <Field label="Return ≥">
          <DeferredNumberInput aria-label="Return minimum" step="0.1" value={view.returnMin} onValueChange={v => onChange({ returnMin: v })} className={NUM} />
          <span>%</span>
        </Field>
        <label className="flex items-center gap-1.5 text-[11px] text-neutral-300">
          <input type="checkbox" checked={affordableOnly} onChange={e => setAffordableOnly(e.target.checked)} />
          Affordable only
        </label>
        {setGroupByExpiration && (
          <label className="flex items-center gap-1.5 text-[11px] text-neutral-300">
            <input type="checkbox" checked={!!groupByExpiration} onChange={e => setGroupByExpiration(e.target.checked)} />
            Group by expiration
          </label>
        )}
      </div>
    </div>
  );
}
