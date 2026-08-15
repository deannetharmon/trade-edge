'use client';

import { useMemo, useRef, useState } from 'react';
import type { CspRulesType } from '@/lib/scans/constants';
import type { CspRankSort, CspRuleSnapshot } from '@/lib/scans/cspRuleSnapshot';
import { ScanModalShell, ScanModeRadioGroup, type ScanModalTheme } from './ScanModalShell';

export interface CspScanRequest {
  mode: CspRuleSnapshot['mode'];
  preset: string;
  rules: CspRulesType;
  popMin: number | null;
  otmMin: number | null;
  rocMin: number | null;
  rankSecondary: CspRankSort;
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

const PRESETS: Array<{ key: string; label: string; description: string; rules: CspRulesType }> = [
  { key: 'conservative', label: 'Conservative', description: 'Lower delta and stronger entry cushion.', rules: { IVR_MIN: 30, IVR_MAX: 70, DELTA_MIN: 0.12, DELTA_MAX: 0.20, DTE_MIN: 30, DTE_MAX: 45, OI_MIN: 500, BID_ASK_MAX: 0.10 } },
  { key: 'balanced', label: 'Balanced', description: 'Default CSP discovery range.', rules: { IVR_MIN: 30, IVR_MAX: 70, DELTA_MIN: 0.15, DELTA_MAX: 0.25, DTE_MIN: 30, DTE_MAX: 45, OI_MIN: 500, BID_ASK_MAX: 0.10 } },
  { key: 'opportunity', label: 'More opportunities', description: 'Wider delta and DTE search.', rules: { IVR_MIN: 20, IVR_MAX: 75, DELTA_MIN: 0.12, DELTA_MAX: 0.30, DTE_MIN: 21, DTE_MAX: 60, OI_MIN: 250, BID_ASK_MAX: 0.10 } },
];
const PRESET_CHOICES = [...PRESETS, { key: 'custom', label: 'Custom', description: 'Your manually adjusted CSP rules.', rules: null }] as const;

// Targeted-mode presets. Mirrors the shape and naming of Spreads' RunModeModal
// FILTER_PRESETS (Strict/Course/Relaxed/Low Vol/Short Term/Intermediate) so the
// two strategies read as the same product concept, but the numeric values are
// CSP-specific: CSP's rule dimensions are delta/IVR-based (short-put delta as
// the POP proxy), not credit-ratio/ROC-based like Spreads. Selecting a preset
// prefills the same rule fields and Targeted POP/OTM/ROC minimums that manual
// entry or a quick-select chip would set -- nothing here is locked, every
// field stays editable afterward, matching how chips already behave.
export interface CspTargetedPreset {
  key: string;
  label: string;
  description: string;
  color: string;
  rules: CspRulesType;
  popMin: number;
  otmMin: number;
  rocMin: number;
}

export const CSP_TARGETED_PRESETS: CspTargetedPreset[] = [
  {
    key: 'strict', label: 'Strict', description: 'A+ setups only -- richest IV, tightest delta, widest cushion.',
    color: 'border-red-500 text-red-400',
    rules: { IVR_MIN: 40, IVR_MAX: 70, DELTA_MIN: 0.10, DELTA_MAX: 0.16, DTE_MIN: 30, DTE_MAX: 45, OI_MIN: 500, BID_ASK_MAX: 0.10 },
    popMin: 80, otmMin: 15, rocMin: 2.0,
  },
  {
    key: 'course', label: 'Course', description: 'Baseline rules -- balanced approach.',
    color: 'ac-btn',
    rules: { IVR_MIN: 30, IVR_MAX: 70, DELTA_MIN: 0.15, DELTA_MAX: 0.25, DTE_MIN: 30, DTE_MAX: 45, OI_MIN: 500, BID_ASK_MAX: 0.10 },
    popMin: 70, otmMin: 8, rocMin: 1.5,
  },
  {
    key: 'relaxed', label: 'Relaxed', description: 'Looser rules -- more opportunities.',
    color: 'border-emerald-500 text-emerald-400',
    rules: { IVR_MIN: 20, IVR_MAX: 80, DELTA_MIN: 0.20, DELTA_MAX: 0.35, DTE_MIN: 21, DTE_MAX: 60, OI_MIN: 300, BID_ASK_MAX: 0.15 },
    popMin: 65, otmMin: 5, rocMin: 1.0,
  },
  {
    key: 'lowvol', label: 'Low Vol', description: 'Adapted for low IVR environments -- caps IVR, pushes DTE out for premium.',
    color: 'border-yellow-500 text-yellow-400',
    rules: { IVR_MIN: 10, IVR_MAX: 50, DELTA_MIN: 0.18, DELTA_MAX: 0.30, DTE_MIN: 30, DTE_MAX: 60, OI_MIN: 200, BID_ASK_MAX: 0.20 },
    popMin: 65, otmMin: 6, rocMin: 0.8,
  },
  {
    key: 'shortterm', label: 'Short Term', description: '7-14 DTE -- very active management, sits closer to strike for premium.',
    color: 'border-orange-500 text-orange-400',
    rules: { IVR_MIN: 35, IVR_MAX: 75, DELTA_MIN: 0.20, DELTA_MAX: 0.35, DTE_MIN: 7, DTE_MAX: 14, OI_MIN: 500, BID_ASK_MAX: 0.10 },
    popMin: 70, otmMin: 6, rocMin: 0.8,
  },
  {
    key: 'intermediate', label: 'Intermediate', description: '15-29 DTE -- active management.',
    color: 'border-amber-500 text-amber-400',
    rules: { IVR_MIN: 30, IVR_MAX: 70, DELTA_MIN: 0.18, DELTA_MAX: 0.28, DTE_MIN: 15, DTE_MAX: 29, OI_MIN: 500, BID_ASK_MAX: 0.10 },
    popMin: 70, otmMin: 8, rocMin: 1.2,
  },
];

export function CspScanModal({ th, selectedTickerCount, initial, requestsByMode, onClose, onRun }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const selectedPresetRef = useRef<HTMLButtonElement>(null);
  const defaultFor = (mode: CspScanRequest['mode']): CspScanRequest => ({
    mode, preset: 'balanced', rules: { ...PRESETS[1].rules }, popMin: null,
    otmMin: null, rocMin: null, rankSecondary: 'none',
  });
  const [drafts, setDrafts] = useState<CspScanRequestsByMode>(() => requestsByMode ?? {
    filter: initial.mode === 'filter' ? initial : defaultFor('filter'),
    rank: initial.mode === 'rank' ? initial : defaultFor('rank'),
    targeted: initial.mode === 'targeted' ? initial : defaultFor('targeted'),
  });
  const [mode, setMode] = useState<CspScanRequest['mode']>(initial.mode);
  const request = drafts[mode];
  const [targetedConfirmed, setTargetedConfirmed] = useState(false);
  const [error, setError] = useState('');

  // Dialog chrome (portal, backdrop, focus trap, Escape-to-close, autofocus)
  // now lives in ScanModalShell -- no local keydown/focus effect needed here.

  const valid = useMemo(() => {
    const r = request.rules;
    const optional = [request.popMin, request.otmMin, request.rocMin];
    const hasTarget = optional.some(value => value != null);
    return Object.values(r).every(Number.isFinite)
      && r.IVR_MIN >= 0 && r.IVR_MAX <= 100 && r.IVR_MAX > r.IVR_MIN
      && r.DTE_MIN >= 0 && r.DTE_MAX > r.DTE_MIN
      && r.DELTA_MIN >= 0 && r.DELTA_MAX <= 1 && r.DELTA_MAX > r.DELTA_MIN
      && r.OI_MIN >= 0 && r.BID_ASK_MAX >= 0
      && optional.every(value => value == null || Number.isFinite(value))
      && (request.popMin == null || (request.popMin >= 0 && request.popMin <= 100))
      && (request.otmMin == null || request.otmMin >= 0)
      && (request.rocMin == null || request.rocMin >= 0)
      && (mode !== 'targeted' || hasTarget);
  }, [mode, request]);

  const updateDraft = (updater: (current: CspScanRequest) => CspScanRequest) => {
    setDrafts(prev => ({ ...prev, [mode]: updater(prev[mode]) }));
    if (mode === 'targeted') setTargetedConfirmed(false);
  };
  const setRule = (key: keyof CspRulesType, value: number) => updateDraft(prev => ({ ...prev, preset: 'custom', rules: { ...prev.rules, [key]: value } }));
  const applyPreset = (key: string) => {
    if (key === 'custom') {
      updateDraft(prev => ({ ...prev, preset: 'custom' }));
      return;
    }
    const preset = PRESETS.find(p => p.key === key);
    if (preset) updateDraft(prev => ({ ...prev, preset: key, rules: { ...preset.rules } }));
  };
  // Targeted-mode preset: same idea as applyPreset above, but also seeds the
  // Targeted-only POP/OTM/ROC minimums. A field set this way is not locked --
  // it behaves exactly like a chip selection, remaining freely editable
  // afterward via the normal DTE/POP/OTM/ROC inputs.
  const applyTargetedPreset = (key: string) => {
    const preset = CSP_TARGETED_PRESETS.find(p => p.key === key);
    if (!preset) return;
    updateDraft(prev => ({
      ...prev,
      preset: key,
      rules: { ...preset.rules },
      popMin: preset.popMin,
      otmMin: preset.otmMin,
      rocMin: preset.rocMin,
    }));
  };
  const chooseMode = (next: CspScanRequest['mode']) => { setMode(next); setError(''); if (next === 'targeted') setTargetedConfirmed(false); };
  const onPresetKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const nextIndex = (index + delta + PRESET_CHOICES.length) % PRESET_CHOICES.length;
    applyPreset(PRESET_CHOICES[nextIndex].key);
    contentRef.current?.querySelector<HTMLButtonElement>(`[data-csp-preset="${PRESET_CHOICES[nextIndex].key}"]`)?.focus();
  };

  return (
    <ScanModalShell
      th={th}
      titleId="csp-scan-title"
      title="CASH-SECURED PUT SCAN"
      subtitle={`${selectedTickerCount} selected ticker${selectedTickerCount === 1 ? '' : 's'} · configure before scanning`}
      closeLabel="Close Cash-Secured Put scan configuration"
      onClose={onClose}
    >
      <div ref={contentRef} className="flex flex-col gap-0">
        <ScanModeRadioGroup
          th={th}
          ariaLabel="Cash-Secured Put scan mode"
          value={mode}
          onChange={chooseMode}
          descriptions={{
            filter: 'Apply CSP qualification rules',
            rank: 'Order the CSP universe by score',
            targeted: 'Search a deliberately narrowed CSP area',
          }}
        />

        {mode !== 'targeted' && <fieldset className="mt-5"><legend className="text-xs font-bold text-neutral-300">CSP preset</legend><div role="radiogroup" aria-label="Cash-Secured Put preset" className="mt-2 grid gap-2 sm:grid-cols-3">
          {PRESET_CHOICES.map((p, index) => <button ref={request.preset === p.key ? selectedPresetRef : undefined} data-csp-preset={p.key} key={p.key} role="radio" aria-checked={request.preset === p.key} tabIndex={request.preset === p.key ? 0 : -1} onKeyDown={event => onPresetKeyDown(event, index)} onClick={() => applyPreset(p.key)} className={`rounded-lg border p-3 text-left ${request.preset === p.key ? 'border-amber-400 bg-amber-400/10' : 'border-neutral-700'}`}><span className="block text-xs font-bold">{request.preset === p.key ? '✓ ' : ''}{p.label}</span>{request.preset === p.key && <span className="block text-[9px] font-bold">Selected</span>}<span className="text-[10px] text-neutral-400">{p.description}</span></button>)}
        </div></fieldset>}

        {mode === 'targeted' && <fieldset className="mt-5"><legend className="text-xs font-bold text-neutral-300">Targeted preset</legend><div role="radiogroup" aria-label="Cash-Secured Put targeted preset" className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CSP_TARGETED_PRESETS.map(p => <button key={p.key} data-csp-targeted-preset={p.key} role="radio" aria-checked={request.preset === p.key} aria-label={`${p.label} targeted preset${request.preset === p.key ? ', selected' : ''}`} onClick={() => applyTargetedPreset(p.key)} className={`rounded-lg border p-2 text-left ${request.preset === p.key ? `${p.color} bg-white/5` : 'border-neutral-700 text-neutral-300'}`}><span className="block text-[11px] font-bold">{request.preset === p.key ? '✓ ' : ''}{p.label}</span></button>)}
        </div></fieldset>}

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([['DTE_MIN','Min DTE'],['DTE_MAX','Max DTE'],['DELTA_MIN','Min delta'],['DELTA_MAX','Max delta'],['OI_MIN','Preferred OI'],['IVR_MIN','Min IVR %'],['IVR_MAX','Max IVR %'],['BID_ASK_MAX','Max bid/ask width']] as Array<[keyof CspRulesType,string]>).map(([key,label]) => <label key={key} className="text-[10px] text-neutral-400">{label}<input aria-label={label} type="number" step={key.includes('DELTA') || key === 'BID_ASK_MAX' ? '0.01' : '1'} value={request.rules[key]} onChange={e => setRule(key, Number(e.target.value))} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white" /></label>)}
          {mode === 'targeted' && <><label className="text-[10px] text-neutral-400">Min POP %<input aria-label="Minimum POP" type="number" value={request.popMin ?? ''} onChange={e => updateDraft(prev => ({ ...prev, preset: 'custom', popMin: e.target.value === '' ? null : Number(e.target.value) }))} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white" /></label>
          <label className="text-[10px] text-neutral-400">Min OTM %<input aria-label="Minimum OTM percentage" type="number" value={request.otmMin ?? ''} onChange={e => updateDraft(prev => ({ ...prev, preset: 'custom', otmMin: e.target.value === '' ? null : Number(e.target.value) }))} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white" /></label>
          <label className="text-[10px] text-neutral-400">Min period ROC %<input aria-label="Minimum period ROC" type="number" value={request.rocMin ?? ''} onChange={e => updateDraft(prev => ({ ...prev, preset: 'custom', rocMin: e.target.value === '' ? null : Number(e.target.value) }))} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white" /></label></>}
          {mode === 'rank' && <label className="text-[10px] text-neutral-400">Secondary sort<select aria-label="CSP secondary sort" value={request.rankSecondary} onChange={e => updateDraft(prev => ({ ...prev, rankSecondary: e.target.value as CspRankSort }))} className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white"><option value="none">None</option><option value="creditDollars">Credit</option><option value="rocPct">ROC</option><option value="otmPct">OTM %</option><option value="pop">POP</option><option value="relevantLegOI">Relevant-leg OI</option><option value="dte">DTE</option></select></label>}
        </div>

        <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-[10px] text-neutral-300" data-testid="csp-rule-preview">DTE {request.rules.DTE_MIN}–{request.rules.DTE_MAX} · Δ {request.rules.DELTA_MIN.toFixed(2)}–{request.rules.DELTA_MAX.toFixed(2)} · preferred OI {request.rules.OI_MIN} · TradeEdge-enforced liquidity policy: strong ≤ max($0.10, 10% of mid), borderline through 15% · TradeEdge earnings policy: earnings inside expiration disqualify</div>
        <p className="mt-2 text-[10px] text-amber-300">Account capital is verified against the connected broker account. If multiple accounts are available, the scan fails closed until explicit account selection is available.</p>
        {mode === 'targeted' && request.popMin == null && request.otmMin == null && request.rocMin == null && <p role="alert" className="mt-2 text-xs text-amber-300">Set at least one POP, OTM, or period ROC target to narrow this scan.</p>}
        {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-xs">Cancel</button>{mode === 'targeted' && !targetedConfirmed && <button disabled={!valid} onClick={() => setTargetedConfirmed(true)} className="rounded-lg border border-amber-400 px-4 py-2 text-xs font-bold text-amber-300 disabled:opacity-50">CONFIRM TARGETS</button>}<button disabled={!valid || (mode === 'targeted' && !targetedConfirmed)} onClick={() => { if (!valid) { setError('Correct the CSP ranges before running.'); return; } onRun(request); }} className="rounded-lg border border-amber-400 bg-amber-400 px-4 py-2 text-xs font-bold text-black disabled:cursor-not-allowed disabled:opacity-40">RUN CSP SCAN →</button></div>
      </div>
    </ScanModalShell>
  );
}
