'use client';

import { useMemo, useRef, useState } from 'react';
import type { CspRulesType } from '@/lib/scans/constants';
import type { CspRankSort, CspRuleSnapshot } from '@/lib/scans/cspRuleSnapshot';
import { ScanModalShell, ScanModeRadioGroup, type ScanModalTheme } from './ScanModalShell';
import { DeferredNumberInput } from './DeferredNumberInput';
import { AlwaysAppliedStrip, type StripItem } from './scanConfig/AlwaysAppliedStrip';
import { COMPACT_INPUT, CompactRange, CompactRule, FieldHead, StatusLine } from './scanConfig/CompactControls';
import { CriterionPills, type CriterionPill } from './scanConfig/CriterionPills';
import { CriterionInput } from './scanConfig/CriterionInput';
import { CriterionTipBody } from './scanConfig/InfoTip';
import { lifecycleTagText } from './scanConfig/LifecycleTag';
import { ScanLegend } from './scanConfig/ScanLegend';
import {
  IVR_UNAVAILABLE_NOTE, criteriaForCard, criteriaForMode, getCriterion,
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

// SCAN-MODAL-UX-0001 -- one-screen layout: dots decoded by one legend line replace the tag pills, help text is in
// tooltips, the fixed rules are one "Always applied" strip, and the scan summary is a short recap by the
// buttons. The controls, defaults, gates and rescan requirements are unchanged. "Then order by" moved
// out of this modal: it only seeds the sort the results view already offers, and the request still
// carries its current value (default None).
//
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

  const tip = (c: CspCriterion) => <CriterionTipBody label={c.label} unit={c.unit || undefined} hint={c.hint} />;
  const present = (id: string): CspCriterion | null => {
    const c = getCriterion(id);
    return c.modes.includes(mode) ? c : null;
  };

  // A range criterion (DTE, preferred delta): two inputs and the quick selects from the registry.
  const rangeCell = (c: CspCriterion, align: 'left' | 'right') => {
    const control = c.control;
    if (control.kind !== 'range') return null;
    const matched = matchRangePreset(request.rules[control.minKey], request.rules[control.maxKey], control.presets);
    const pills: CriterionPill[] = control.presets.map(p => ({
      key: p.label, label: p.label, pressed: matched?.label === p.label,
      onSelect: () => setRules({ [control.minKey]: p.min, [control.maxKey]: p.max }),
    }));
    return (
      <div key={c.id} data-csp-criterion={c.id} className="flex min-w-0 flex-col gap-1">
        <FieldHead lifecycle={c.lifecycle} fixed={c.fixed} rescan={c.rescan} name={c.label} tip={tip(c)} align={align} />
        <CompactRange
          th={th} groupLabel={`${c.label} quick select`}
          minId={control.minKey} maxId={control.maxKey} minLabel={control.minLabel} maxLabel={control.maxLabel}
          minTitle={control.minTitle} maxTitle={control.maxTitle} step={control.step}
          min={request.rules[control.minKey]} max={request.rules[control.maxKey]}
          onMin={value => setRule(control.minKey, value)} onMax={value => setRule(control.maxKey, value)}
          minError={errors[control.minKey]} maxError={errors[control.maxKey]} pills={pills}
        />
      </div>
    );
  };

  // A single-value rule criterion (OI preference, IVR cap, IVR preference).
  const ruleCell = (c: CspCriterion, suffix: string, align: 'left' | 'right') => {
    const control = c.control;
    if (control.kind !== 'rule') return null;
    return (
      <div key={c.id} data-csp-criterion={c.id} className="flex min-w-0 flex-col gap-1">
        <FieldHead lifecycle={c.lifecycle} fixed={c.fixed} rescan={c.rescan} name={control.label} tip={tip(c)} align={align} />
        <CompactRule id={control.key} label={control.label} title={control.title} step={control.step} value={request.rules[control.key]} onValue={next => setRule(control.key, next)} suffix={suffix} error={errors[control.key]} />
      </div>
    );
  };

  // Targeted POP / OTM / ROC: a gate with an explicit Any (off) state. The input's accessible name stays the registry's ariaLabel.
  const targetInput = (c: CspCriterion) => {
    const control = c.control;
    if (control.kind !== 'target') return null;
    const current = request[control.field];
    return (
      <CriterionInput id={control.field} label={control.label} ariaLabel={control.ariaLabel} title={control.title} step={control.step} value={current ?? 0} onValueChange={next => setTarget(control.field, next)} hideLabel hideStatus invalid={!!errors[control.field]} inputClassName="w-14 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white" />
    );
  };

  const capital = present('capital');

  const alwaysItems: StripItem[] = criteriaForCard(mode, 'always')
    .filter(c => c.fixed)
    .map(c => ({
      id: c.id,
      label: c.chipLabel ?? c.label,
      tag: lifecycleTagText(c.lifecycle, c.fixed, c.rescan),
      tip: tip(c),
      attr: { 'data-csp-criterion': c.id },
    }));
  // A symbol with no IV rank is removed, and nothing else on the screen would say so: it keeps its own chip.
  alwaysItems.push({
    id: 'ivrUnavailable',
    label: 'No IV rank = disqualified',
    tag: 'GATE · FIXED',
    tip: <p>{IVR_UNAVAILABLE_NOTE}</p>,
    attr: { 'data-csp-note': 'ivr-unavailable' },
    emphasis: true,
  });

  // The recap: what the registry says about the settings that can be changed.
  const recap = useMemo(() => {
    const parts: string[] = [];
    for (const c of criteriaForMode(mode)) {
      if (c.fixed || c.lifecycle === 'result-filter' || c.id === 'rankSecondary') continue;
      const text = c.summary(values);
      if (text) parts.push(text);
    }
    return parts.join(' · ');
  }, [mode, values]);

  const afterScan = present('resultChips');
  const lifecycles = Array.from(new Set(criteriaForMode(mode).filter(c => !c.fixed && c.lifecycle !== 'result-filter' && c.id !== 'rankSecondary').map(c => c.lifecycle)));
  const gates = criteriaForCard(mode, 'gates');

  return (
    <ScanModalShell
      th={th}
      titleId="csp-scan-title"
      title="CASH-SECURED PUT SCAN"
      subtitle={`${selectedTickerCount} selected ticker${selectedTickerCount === 1 ? '' : 's'} · configure before scanning`}
      closeLabel="Close Cash-Secured Put scan configuration"
      onClose={onClose}
      maxWidthClassName="max-w-[760px]"
      compact
    >
      <div ref={contentRef} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <ScanModeRadioGroup
            th={th}
            ariaLabel="Cash-Secured Put scan mode"
            value={mode}
            onChange={chooseMode}
            compact
            descriptions={{
              filter: 'Apply CSP qualification rules',
              rank: 'Order the CSP universe by score',
              targeted: 'Search a deliberately narrowed CSP area',
            }}
          />

          {mode !== 'targeted' && <fieldset className="min-w-0"><legend className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">CSP preset</legend><div role="radiogroup" aria-label="Cash-Secured Put preset" className={`inline-flex flex-wrap overflow-hidden rounded-lg border ${th.border}`}>
            {PRESET_CHOICES.map((p, index) => <button ref={request.preset === p.key ? selectedPresetRef : undefined} data-csp-preset={p.key} key={p.key} role="radio" aria-checked={request.preset === p.key} tabIndex={request.preset === p.key ? 0 : -1} title={p.description} onKeyDown={event => onPresetKeyDown(event, index)} onClick={() => applyPreset(p.key)} className={`px-3 py-1.5 text-[11px] ${request.preset === p.key ? 'border-amber-400 bg-amber-400/10 font-bold text-amber-200' : 'text-neutral-300'}`}>{request.preset === p.key ? '✓ ' : ''}{p.label}{request.preset === p.key && <span className="sr-only"> Selected</span>}</button>)}
          </div></fieldset>}

          {mode === 'targeted' && <fieldset className="min-w-0"><legend className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Targeted preset</legend><div role="radiogroup" aria-label="Cash-Secured Put targeted preset" className="flex flex-wrap gap-1">
            {CSP_TARGETED_PRESETS.map(p => <button key={p.key} data-csp-targeted-preset={p.key} role="radio" aria-checked={request.preset === p.key} aria-label={`${p.label} targeted preset${request.preset === p.key ? ', selected' : ''}`} title={p.description} onClick={() => applyTargetedPreset(p.key)} className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${request.preset === p.key ? `${p.color} bg-white/5 font-bold` : 'border-neutral-700 text-neutral-300'}`}>{request.preset === p.key ? '✓ ' : ''}{p.label}</button>)}
          </div></fieldset>}
        </div>

        <ScanLegend lifecycles={lifecycles} afterScan={afterScan ? { attr: { 'data-csp-criterion': afterScan.id }, hint: afterScan.hint } : undefined} />

        <section aria-label="Search range" data-csp-card="search" className={`grid grid-cols-1 gap-x-5 gap-y-3 border-t ${th.border} pt-3 sm:grid-cols-2`}>
          {rangeCell(getCriterion('dte'), 'left')}
          {rangeCell(getCriterion('delta'), 'right')}
        </section>

        <section aria-label="Volatility, liquidity and capital" data-csp-card="advisory" className={`grid grid-cols-2 gap-x-4 gap-y-3 border-t ${th.border} pt-3 sm:grid-cols-4`}>
          {ruleCell(getCriterion('oi'), 'contracts', 'left')}
          {ruleCell(getCriterion('ivrCap'), '% max', 'left')}
          {ruleCell(getCriterion('ivrFloor'), '% floor', 'right')}
          {capital && (
            <div data-csp-criterion={capital.id} data-csp-card="capital" className="flex min-w-0 flex-col gap-1">
              <FieldHead lifecycle={capital.lifecycle} fixed={capital.fixed} rescan={capital.rescan} name="Capital" align="right"
                tip={<><p>{capital.hint}</p><p className="mt-1">Collateral = strike × 100 × contracts. Blank uses available account cash.</p></>} />
              <label className="flex items-start gap-2 text-[11px] text-neutral-300"><input type="checkbox" className="mt-0.5" checked={request.affordableOnly} onChange={event => updateDraft(prev => ({ ...prev, affordableOnly: event.target.checked }))} />Only show affordable CSPs</label>
              {request.affordableOnly && <label className="flex flex-col gap-1 text-[10px] text-neutral-400">Cash cap <span className="text-neutral-500">(optional)</span><DeferredNumberInput aria-label="Cash cap per CSP" step="1" value={request.capitalLimit ?? 0} onValueChange={value => updateDraft(prev => ({ ...prev, capitalLimit: value || null }))} className="w-28 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white" /></label>}
              <StatusLine message={errors.capitalLimit} />
            </div>
          )}
        </section>

        {mode === 'targeted' && gates.length > 0 && (
          <section aria-label="Targets" data-csp-card="gates" className={`border-t ${th.border} pt-3`}>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
              Targets <span className="font-normal normal-case tracking-normal">{hasTargetedGate(values) ? 'Set at least one to narrow this scan' : ''}</span>
            </p>
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
              {gates.map((c, index) => {
                const control = c.control;
                if (control.kind !== 'target') return null;
                return (
                  <div key={c.id} data-csp-criterion={c.id} className="flex min-w-0 flex-col gap-1">
                    <FieldHead lifecycle={c.lifecycle} fixed={c.fixed} rescan={c.rescan} name={control.label} tip={tip(c)} align={index === gates.length - 1 ? 'right' : 'left'} />
                    <div className="flex items-center gap-1.5">
                      {targetInput(c)}
                      <span className="text-[10px] text-neutral-500">%</span>
                    </div>
                    <StatusLine message={errors[control.field]} />
                    <CriterionPills
                      th={th}
                      groupLabel={`${c.label} quick select`}
                      compact
                      pills={control.presets.map(p => ({
                        key: p.label, label: p.value == null ? `${c.off ?? 'Any'}` : p.label, pressed: sameNumber(p.value, request[control.field]), off: p.value == null,
                        onSelect: () => setTarget(control.field, p.value),
                      }))}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <AlwaysAppliedStrip th={th} items={alwaysItems} />

        {mode === 'targeted' && !hasTargetedGate(values) && <p role="alert" className="text-xs text-amber-300">Set at least one POP, OTM, or period ROC target to narrow this scan.</p>}
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        <div className={`flex items-center justify-between gap-4 border-t ${th.border} pt-3`}>
          <p data-testid="csp-rule-preview" className="min-w-0 text-[10px] leading-snug text-neutral-400">{recap}</p>
          <div className="flex shrink-0 gap-2"><button onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-xs">Cancel</button>{mode === 'targeted' && !targetedConfirmed && <button disabled={!valid} onClick={() => setTargetedConfirmed(true)} className="rounded-lg border border-amber-400 px-4 py-2 text-xs font-bold text-amber-300 disabled:opacity-50">CONFIRM TARGETS</button>}<button disabled={!valid || (mode === 'targeted' && !targetedConfirmed)} onClick={() => { if (!valid) { setError('Correct the CSP ranges before running.'); return; } onRun(request); }} className="rounded-lg border border-amber-400 bg-amber-400 px-4 py-2 text-xs font-bold text-black disabled:cursor-not-allowed disabled:opacity-40">RUN CSP SCAN →</button></div>
        </div>
      </div>
    </ScanModalShell>
  );
}
