'use client';

import { useMemo, useRef, useState } from 'react';
import type { CspRulesType } from '@/lib/scans/constants';
import type { CspRankSort, CspRuleSnapshot } from '@/lib/scans/cspRuleSnapshot';
import { ScanModalShell, ScanModeRadioGroup, type ScanModalTheme } from './ScanModalShell';
import { DeferredNumberInput } from './DeferredNumberInput';
import { CriterionInput } from './scanConfig/CriterionInput';
import { CriterionPills, type CriterionPill } from './scanConfig/CriterionPills';
import { LifecycleTag } from './scanConfig/LifecycleTag';
import { ScanReceiptPanel } from './scanConfig/ScanReceiptPanel';
import {
  CSP_CARD_ORDER, CSP_CARD_TITLE, buildCspReceipt, criteriaForCard,
  type CspConfigValues, type CspCriterion, type CspMode, type CspRuleKey,
} from '@/lib/screener/scanConfig/cspRegistry';
import { cspFieldErrors, hasTargetedGate, isCspConfigValid } from '@/lib/screener/scanConfig/cspValidation';
import { matchRangePreset, sameNumber } from '@/lib/screener/scanConfig/presets';

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
type CspRequestMode = CspScanRequest['mode'];

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

// SCREENER-CONFIG-0001A -- Rank and Targeted only (Filter was removed 2026-09-21).
// Every control below is rendered from the CSP criterion registry
// (lib/screener/scanConfig/cspRegistry.ts): its label, unit, lifecycle tag, quick
// selects, and hint come from there, and the scan summary is built from the same
// registry, so the modal and the receipts cannot disagree.
const toValues = (request: CspScanRequest, mode: CspMode): CspConfigValues => ({
  mode,
  rules: request.rules,
  popMin: request.popMin,
  otmMin: request.otmMin,
  rocMin: request.rocMin,
  rankSecondary: request.rankSecondary,
  affordableOnly: request.affordableOnly ?? false,
  capitalLimit: request.capitalLimit ?? null,
});

const INPUT_CLASS = 'mt-1 w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white';

export function CspScanModal({ th, selectedTickerCount, initial, requestsByMode, onClose, onRun }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const selectedPresetRef = useRef<HTMLButtonElement>(null);
  const defaultFor = (mode: CspMode): CspScanRequest => ({
    mode, preset: 'balanced', rules: { ...PRESETS[1].rules }, popMin: null,
    otmMin: null, rocMin: null, rankSecondary: 'none', capitalLimit: null, affordableOnly: false,
  });
  const normalizeRequest = (request: CspScanRequest, mode: CspMode): CspScanRequest => ({
    ...request,
    mode,
    capitalLimit: request.capitalLimit ?? null,
    affordableOnly: request.affordableOnly ?? false,
  });
  // A caller may still hand in a request from the removed Filter mode (an older
  // cached session). It opens as a Rank draft with the same rules.
  const seedDraft = (mode: CspMode): CspScanRequest => normalizeRequest(
    requestsByMode?.[mode] ?? (initial.mode === mode || (mode === 'rank' && initial.mode === 'filter') ? initial : defaultFor(mode)),
    mode,
  );
  const [drafts, setDrafts] = useState<Record<CspMode, CspScanRequest>>(() => ({ rank: seedDraft('rank'), targeted: seedDraft('targeted') }));
  const [mode, setMode] = useState<CspMode>(initial.mode === 'targeted' ? 'targeted' : 'rank');
  const request = drafts[mode];
  const [targetedConfirmed, setTargetedConfirmed] = useState(false);
  const [error, setError] = useState('');

  // Dialog chrome (portal, backdrop, focus trap, Escape-to-close, autofocus)
  // lives in ScanModalShell -- no local keydown/focus effect needed here.

  const values = useMemo(() => toValues(request, mode), [mode, request]);
  const errors = useMemo(() => cspFieldErrors(values), [values]);
  const valid = useMemo(() => isCspConfigValid(values), [values]);
  const receipt = useMemo(() => buildCspReceipt(values), [values]);

  const updateDraft = (updater: (current: CspScanRequest) => CspScanRequest) => {
    setDrafts(prev => ({ ...prev, [mode]: updater(prev[mode]) }));
    if (mode === 'targeted') setTargetedConfirmed(false);
  };
  const setRule = (key: CspRuleKey, value: number) => updateDraft(prev => ({ ...prev, preset: 'custom', rules: { ...prev.rules, [key]: value } }));
  const setRules = (patch: Partial<Record<CspRuleKey, number>>) => updateDraft(prev => ({ ...prev, preset: 'custom', rules: { ...prev.rules, ...patch } }));
  const setTarget = (field: 'popMin' | 'otmMin' | 'rocMin', value: number | null) => updateDraft(prev => ({ ...prev, preset: 'custom', [field]: value }));
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
  const chooseMode = (next: CspRequestMode) => {
    if (next === 'filter') return; // Filter mode was removed; the radio group never offers it.
    setMode(next); setError(''); if (next === 'targeted') setTargetedConfirmed(false);
  };
  const onPresetKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const nextIndex = (index + delta + PRESET_CHOICES.length) % PRESET_CHOICES.length;
    applyPreset(PRESET_CHOICES[nextIndex].key);
    contentRef.current?.querySelector<HTMLButtonElement>(`[data-csp-preset="${PRESET_CHOICES[nextIndex].key}"]`)?.focus();
  };

  // Renders the control of one registry criterion. The kind decides the widget; the
  // registry supplies every label, title, step, and quick-select value.
  const renderControl = (criterion: CspCriterion) => {
    const control = criterion.control;
    switch (control.kind) {
      case 'range': {
        const min = request.rules[control.minKey];
        const max = request.rules[control.maxKey];
        const matched = matchRangePreset(min, max, control.presets);
        const pills: CriterionPill[] = control.presets.map(p => ({
          key: p.label, label: p.label, pressed: matched?.label === p.label,
          onSelect: () => setRules({ [control.minKey]: p.min, [control.maxKey]: p.max }),
        }));
        return (
          <>
            <div className="flex flex-wrap gap-3">
              <CriterionInput id={control.minKey} label={control.minLabel} title={control.minTitle} step={control.step} value={min} onValueChange={value => setRule(control.minKey, value)} error={errors[control.minKey]} />
              <CriterionInput id={control.maxKey} label={control.maxLabel} title={control.maxTitle} step={control.step} value={max} onValueChange={value => setRule(control.maxKey, value)} error={errors[control.maxKey]} />
            </div>
            <CriterionPills th={th} groupLabel={`${criterion.label} quick select`} pills={pills} />
          </>
        );
      }
      case 'rule': {
        const value = request.rules[control.key];
        const pills: CriterionPill[] = control.presets.map(p => ({
          key: p.label, label: p.label, pressed: sameNumber(p.value, value),
          onSelect: () => setRule(control.key, p.value as number),
        }));
        return (
          <>
            <CriterionInput id={control.key} label={control.label} title={control.title} step={control.step} value={value} onValueChange={next => setRule(control.key, next)} unit={criterion.unit} error={errors[control.key]} />
            <CriterionPills th={th} groupLabel={`${criterion.label} quick select`} pills={pills} />
          </>
        );
      }
      case 'target': {
        const current = request[control.field];
        const pills: CriterionPill[] = control.presets.map(p => ({
          key: p.label, label: p.value == null ? `${criterion.off ?? 'Any'}` : p.label, pressed: sameNumber(p.value, current), off: p.value == null,
          onSelect: () => setTarget(control.field, p.value),
        }));
        return (
          <>
            <CriterionInput id={control.field} label={control.label} ariaLabel={control.ariaLabel} title={control.title} step={control.step} value={current ?? 0} onValueChange={next => setTarget(control.field, next)} unit={criterion.unit} error={errors[control.field]} />
            <CriterionPills th={th} groupLabel={`${criterion.label} quick select`} pills={pills} />
          </>
        );
      }
      case 'secondary-sort':
        return (
          <label className="flex flex-col gap-1 text-[10px] text-neutral-400">{criterion.label}
            <select aria-label={control.ariaLabel} value={request.rankSecondary} onChange={e => updateDraft(prev => ({ ...prev, rankSecondary: e.target.value as CspRankSort }))} className={INPUT_CLASS}>
              {control.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        );
      case 'capital':
        return (
          <fieldset className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-[10px] text-neutral-300"><legend className="px-1 text-xs font-bold text-neutral-300">Capital</legend><label className="flex items-center gap-2"><input type="checkbox" checked={request.affordableOnly} onChange={event => updateDraft(prev => ({ ...prev, affordableOnly: event.target.checked }))} />Only show affordable CSPs</label>{request.affordableOnly && <label className="mt-3 flex flex-col gap-1">Cash cap <span className="text-neutral-500">(optional)</span><DeferredNumberInput aria-label="Cash cap per CSP" step="1" value={request.capitalLimit ?? 0} onValueChange={value => updateDraft(prev => ({ ...prev, capitalLimit: value || null }))} className="w-48 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white" /></label>}<span role="status" aria-live="polite" className="block min-h-0 text-[9px] text-red-400">{errors.capitalLimit ?? ''}</span><p className="mt-2 text-neutral-400">Collateral = strike × 100 × contracts. Blank uses available account cash.</p></fieldset>
        );
      case 'info':
        return null;
      default:
        return null;
    }
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

        {CSP_CARD_ORDER.map(card => {
          const criteria = criteriaForCard(mode, card);
          if (criteria.length === 0) return null;
          if (card === 'capital') {
            return <div key={card} className="mt-5" data-csp-card={card}>{criteria.map(c => <div key={c.id}>{renderControl(c)}</div>)}</div>;
          }
          return (
            <section key={card} data-csp-card={card} aria-label={CSP_CARD_TITLE[card]} className="mt-5 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-200">{CSP_CARD_TITLE[card]}</h3>
              <div className="mt-2 flex flex-col gap-4">
                {criteria.map(c => (
                  <div key={c.id} data-csp-criterion={c.id}>
                    <p className="text-[10px] font-bold text-neutral-300">{c.label}<LifecycleTag lifecycle={c.lifecycle} fixed={c.fixed} rescan={c.rescan} /></p>
                    <p className="mb-2 mt-1 text-[10px] text-neutral-400">{c.hint}</p>
                    {renderControl(c)}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        <div className="mt-4">
          <ScanReceiptPanel th={th} receipt={receipt} heading="Scan summary" testId="csp-rule-preview" showLimits />
        </div>
        {mode === 'targeted' && !hasTargetedGate(values) && <p role="alert" className="mt-2 text-xs text-amber-300">Set at least one POP, OTM, or period ROC target to narrow this scan.</p>}
        {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-xs">Cancel</button>{mode === 'targeted' && !targetedConfirmed && <button disabled={!valid} onClick={() => setTargetedConfirmed(true)} className="rounded-lg border border-amber-400 px-4 py-2 text-xs font-bold text-amber-300 disabled:opacity-50">CONFIRM TARGETS</button>}<button disabled={!valid || (mode === 'targeted' && !targetedConfirmed)} onClick={() => { if (!valid) { setError('Correct the CSP ranges before running.'); return; } onRun(request); }} className="rounded-lg border border-amber-400 bg-amber-400 px-4 py-2 text-xs font-bold text-black disabled:cursor-not-allowed disabled:opacity-40">RUN CSP SCAN →</button></div>
      </div>
    </ScanModalShell>
  );
}
