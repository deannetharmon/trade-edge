'use client';

// features/screener/components/CcScanModal.tsx
//
// Covered Call pre-scan modal. Before this component existed, CC's scan
// criteria (DELTA_MIN/MAX, DTE_MIN/MAX, OI_MIN, BID_ASK_MAX) were hardcoded
// constants (DEFAULT_CC_RULES in lib/scans/constants.ts) read directly by
// runCcScan -- no modal, no per-run override, no draft/cancel/persist UX.
// This closes that gap using the same ScanModalShell CSP already proves out
// live, per the fetch/scan/view audit's confirmed finding that CC's
// underlying selection logic (isEligibleCcLeg / selectAllEligibleCcContracts
// in lib/scans/covered-call-finder.ts) is already correct -- this is a pure
// UI/config-exposure change, not an algorithm change.
//
// Deliberately no preset system for V1. CSP's PRESETS/CSP_TARGETED_PRESETS
// pattern was flagged in the same audit as having real problems worth
// avoiding here on day one: a "Custom" option that silently doesn't cover
// every field, and (in Spreads) an accidental duplicate preset table. CC
// ships with plain editable defaults; a preset layer can be added later as
// its own scoped decision rather than inherited by default.
//
// Also deliberately single-mode: CC has no Filter/Rank/Targeted concept the
// way Spreads and CSP do -- the share-coverage capacity check already gates
// the eligible universe (see runCcScan's capacity report, which stays
// upstream of this modal and is not duplicated here), so there is no
// second "mode" for this modal to offer.
//
// CC-SELECT-0001 addition: the modal now also shows the same eligible-
// holdings selection chips as the existing sidebar panel (Dean: keep
// both -- the sidebar stays, the modal reads/writes the exact same
// ccEligibleHoldings/ccHiddenSymbols state, not an independent copy).

import { useMemo, useState } from 'react';
import type { CcRulesType } from '@/lib/scans/constants';
import { ScanModalShell, type ScanModalTheme } from './ScanModalShell';
import { AlwaysAppliedStrip, type StripItem } from './scanConfig/AlwaysAppliedStrip';
import { COMPACT_INPUT, CompactRange, CompactRule, FieldHead } from './scanConfig/CompactControls';
import { CriterionTipBody, InfoTip } from './scanConfig/InfoTip';
import { type CriterionPill } from './scanConfig/CriterionPills';
import { lifecycleTagText } from './scanConfig/LifecycleTag';
import { LifecycleDot } from './scanConfig/LifecycleDot';
import { ScanLegend } from './scanConfig/ScanLegend';
import {
  ccCriteriaForCard, ccFieldErrors, getCcCriterion,
  type CcConfigValues, type CcCriterion,
} from '@/lib/screener/scanConfig/ccRegistry';
import { matchRangePreset } from '@/lib/screener/scanConfig/presets';

// SCREENER-CONFIG-0001B -- every control below is rendered from the covered-call criterion
// registry (lib/screener/scanConfig/ccRegistry.ts): its label, unit, lifecycle, quick selects,
// and hint come from there, and the scan summary is built from the same registry, so the modal and
// the result receipt cannot disagree. The controls, their accessible names, and the validation
// rules are the ones this modal always had.
//
// SCAN-MODAL-UX-0001 -- one-screen layout. The same controls and rules, drawn compactly: a colored dot per
// control (decoded by one legend line) replaces the tag pills, the help text is in a tooltip, the
// fixed rules are one "Always applied" strip, and the scan summary is a short recap by the buttons.
// No rule, default, gate or rescan requirement changed.

export interface CcScanRequest {
  rules: CcRulesType;
}

export interface CcEligibleHoldingSummary {
  symbol: string;
  availableCoveredContracts: number;
}

interface Props {
  th: ScanModalTheme;
  selectedTickerCount: number;
  holdings: CcEligibleHoldingSummary[];
  hiddenSymbols: string[];
  onToggleSymbol: (symbol: string) => void;
  // CC-SELECT-0001 corrective: the broker holdings fetch (loadCcCapacity)
  // runs async, started the same click that opens this modal -- without
  // this flag the modal briefly renders '0 eligible positions' and the
  // 'select at least one' error before real data arrives, which reads as
  // 'you own nothing' when the truth is just 'still loading'.
  holdingsLoading: boolean;
  initial: CcScanRequest;
  onClose: () => void;
  onRun: (request: CcScanRequest) => void;
}

const ATTR = 'data-cc-criterion';

export function CcScanModal({ th, selectedTickerCount, holdings, hiddenSymbols, onToggleSymbol, holdingsLoading, initial, onClose, onRun }: Props) {
  const [draft, setDraft] = useState<CcScanRequest>(initial);
  const [error, setError] = useState('');

  const selected = useMemo(
    () => holdings.filter(h => h.availableCoveredContracts > 0 && !hiddenSymbols.includes(h.symbol)),
    [holdings, hiddenSymbols],
  );
  const selectedCount = selected.length;
  const contractsAvailable = useMemo(() => selected.reduce((sum, h) => sum + h.availableCoveredContracts, 0), [selected]);

  const errors = useMemo(() => ccFieldErrors(draft.rules), [draft.rules]);
  const valid = useMemo(
    () => Object.keys(errors).length === 0 && !holdingsLoading && selectedCount > 0,
    [errors, selectedCount, holdingsLoading],
  );
  const values: CcConfigValues = useMemo(
    () => ({ rules: draft.rules, positionsSelected: holdingsLoading ? null : selectedCount, contractsAvailable: holdingsLoading ? null : contractsAvailable }),
    [draft.rules, holdingsLoading, selectedCount, contractsAvailable],
  );

  const setRule = (key: keyof CcRulesType, value: number) =>
    setDraft(prev => ({ rules: { ...prev.rules, [key]: value } }));
  const setRules = (patch: Partial<CcRulesType>) =>
    setDraft(prev => ({ rules: { ...prev.rules, ...patch } }));

  const tip = (c: CcCriterion) => <CriterionTipBody label={c.label} unit={c.unit || undefined} hint={c.hint} />;

  // A range criterion (DTE, delta): two inputs and the quick selects from the registry.
  const rangeCell = (c: CcCriterion, align: 'left' | 'right') => {
    const control = c.control;
    if (control.kind !== 'range') return null;
    const matched = matchRangePreset(draft.rules[control.minKey], draft.rules[control.maxKey], control.presets);
    const pills: CriterionPill[] = control.presets.map(p => ({
      key: p.label, label: p.label, pressed: matched?.label === p.label,
      onSelect: () => setRules({ [control.minKey]: p.min, [control.maxKey]: p.max } as Partial<CcRulesType>),
    }));
    return (
      <div key={c.id} {...{ [ATTR]: c.id }} className="flex min-w-0 flex-col gap-1">
        <FieldHead lifecycle={c.lifecycle} fixed={c.fixed} rescan={c.rescan} name={c.label} tip={tip(c)} align={align} />
        <CompactRange
          th={th} groupLabel={`${c.label} quick select`}
          minId={control.minKey} maxId={control.maxKey} minLabel={control.minLabel} maxLabel={control.maxLabel}
          minTitle={control.minTitle} maxTitle={control.maxTitle} step={control.step}
          min={draft.rules[control.minKey]} max={draft.rules[control.maxKey]}
          onMin={value => setRule(control.minKey, value)} onMax={value => setRule(control.maxKey, value)}
          minError={errors[control.minKey]} maxError={errors[control.maxKey]} pills={pills}
        />
      </div>
    );
  };

  // A single-value rule criterion (OI preference).
  const ruleCell = (c: CcCriterion, align: 'left' | 'right') => {
    const control = c.control;
    if (control.kind !== 'rule') return null;
    return (
      <div key={c.id} {...{ [ATTR]: c.id }} className="flex min-w-0 flex-col gap-1">
        <FieldHead lifecycle={c.lifecycle} fixed={c.fixed} rescan={c.rescan} name={control.label} tip={tip(c)} align={align} />
        <CompactRule id={control.key} label={control.label} title={control.title} step={control.step} value={draft.rules[control.key]} onValue={next => setRule(control.key, next)} suffix={c.unit} error={errors[control.key]} />
      </div>
    );
  };

  // Max bid/ask width and its dollar ceiling are two registry criteria shown as one field. Both rules apply.
  const widthCell = () => {
    const width = getCcCriterion('width');
    const ceiling = getCcCriterion('widthCeiling');
    if (width.control.kind !== 'rule' || ceiling.control.kind !== 'rule') return null;
    const wc = width.control;
    const cc = ceiling.control;
    return (
      <div key="width" className="flex min-w-0 flex-col gap-1">
        <FieldHead
          lifecycle={width.lifecycle} fixed={width.fixed} rescan={width.rescan} name={width.label} dot={false}
          tip={<>{tip(width)}<div className="mt-2 border-t border-neutral-700 pt-2">{tip(ceiling)}</div></>}
        />
        <div className="flex flex-wrap items-start gap-x-2">
          <span {...{ [ATTR]: width.id }} className="flex flex-col">
            <LifecycleDot lifecycle={width.lifecycle} fixed={width.fixed} rescan={width.rescan} visual={false} />
            <CompactRule id={wc.key} label={wc.label} title={wc.title} step={wc.step} value={draft.rules[wc.key]} onValue={next => setRule(wc.key, next)} suffix="% of mid" error={errors[wc.key]} widthClass="w-14 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white" />
          </span>
          <span aria-hidden="true" className="pt-1.5 text-[10px] text-neutral-500">and</span>
          <span {...{ [ATTR]: ceiling.id }} className="flex flex-col">
            <LifecycleDot lifecycle={ceiling.lifecycle} fixed={ceiling.fixed} rescan={ceiling.rescan} visual={false} />
            <CompactRule id={cc.key} label={cc.label} title={cc.title} step={cc.step} value={draft.rules[cc.key]} onValue={next => setRule(cc.key, next)} suffix="$ cap" error={errors[cc.key]} widthClass={COMPACT_INPUT} />
          </span>
        </div>
      </div>
    );
  };

  const alwaysItems: StripItem[] = ccCriteriaForCard('always').map(c => ({
    id: c.id,
    label: c.chipLabel ?? c.label,
    tag: lifecycleTagText(c.lifecycle, c.fixed, c.rescan),
    tip: tip(c),
    attr: { [ATTR]: c.id },
  }));

  // The recap: what the registry says about the settings that can be changed, plus the capacity line.
  const recapLines = useMemo(() => {
    const settings: string[] = [];
    for (const card of ['search', 'advisory'] as const) {
      for (const c of ccCriteriaForCard(card)) {
        const text = c.summary(values);
        if (text) settings.push(text);
      }
    }
    const capacity = getCcCriterion('capacity').summary(values);
    return { settings: settings.join(' · '), capacity };
  }, [values]);

  const afterScan = getCcCriterion('resultChips');

  return (
    <ScanModalShell
      th={th}
      titleId="cc-scan-title"
      title="COVERED CALL SCAN"
      subtitle={`${selectedTickerCount} eligible position${selectedTickerCount === 1 ? '' : 's'} · configure before scanning`}
      closeLabel="Close Covered Call scan configuration"
      onClose={onClose}
      maxWidthClassName="max-w-[720px]"
      compact
    >
      <div className="flex flex-col gap-3">
        <ScanLegend lifecycles={['fetch', 'advisory']} afterScan={{ attr: { [ATTR]: afterScan.id }, hint: afterScan.hint }} />

        {holdingsLoading ? (
          <p className="text-[11px] text-neutral-400">Loading eligible holdings...</p>
        ) : holdings.length === 0 ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] font-medium leading-relaxed text-amber-400">
            ⚠ No eligible covered-call holdings found in your connected broker account. Only broker-verified covered shares are eligible.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-1" data-testid="cc-holdings-selection" role="group" aria-label="Eligible covered-call positions">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
              Covered shares
              <InfoTip>Only broker-verified covered shares are eligible. A position can be left out of this scan by clicking it.</InfoTip>
            </span>
            {holdings.map(h => {
              const hidden = hiddenSymbols.includes(h.symbol);
              const blocked = h.availableCoveredContracts === 0;
              return (
                <button
                  key={h.symbol}
                  type="button"
                  onClick={() => !blocked && onToggleSymbol(h.symbol)}
                  disabled={blocked}
                  title={blocked ? 'Fully covered -- no available capacity' : undefined}
                  className={`rounded border px-2 py-0.5 text-[10px] font-bold transition-colors ${
                    blocked
                      ? 'cursor-not-allowed border-neutral-700 text-neutral-600 line-through opacity-40'
                      : hidden
                      ? 'border-neutral-700 text-neutral-500 line-through opacity-40'
                      : 'border-amber-500 bg-amber-500/10 text-amber-300'
                  }`}
                >
                  {h.symbol} <span className="opacity-60">({h.availableCoveredContracts})</span>
                </button>
              );
            })}
          </div>
        )}

        <section aria-label="Search and preferences" data-cc-card="search" className={`grid grid-cols-1 gap-x-5 gap-y-3 border-t ${th.border} pt-3 sm:grid-cols-2`}>
          {rangeCell(getCcCriterion('dte'), 'left')}
          {rangeCell(getCcCriterion('delta'), 'right')}
          {widthCell()}
          {ruleCell(getCcCriterion('oi'), 'right')}
        </section>

        <AlwaysAppliedStrip th={th} items={alwaysItems} />

        {!holdingsLoading && holdings.length > 0 && selectedCount === 0 && (
          <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs font-medium leading-relaxed text-amber-400">
            ⚠ Select at least one eligible holding before running.
          </p>
        )}

        {error && (
          <p role="alert" className="text-xs text-red-400">
            {error}
          </p>
        )}

        <div className={`flex items-center justify-between gap-4 border-t ${th.border} pt-3`}>
          <div data-testid="cc-rule-preview" className="min-w-0 text-[10px] leading-snug text-neutral-400">
            <p>{recapLines.settings}</p>
            {recapLines.capacity && <p>{recapLines.capacity}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-xs"
            >
              Cancel
            </button>
            <button
              disabled={!valid}
              onClick={() => {
                if (!valid) {
                  setError('Correct the covered call ranges before running.');
                  return;
                }
                onRun(draft);
              }}
              className="rounded-lg border border-amber-400 bg-amber-400 px-4 py-2 text-xs font-bold text-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              RUN CC SCAN →
            </button>
          </div>
        </div>
      </div>
    </ScanModalShell>
  );
}
