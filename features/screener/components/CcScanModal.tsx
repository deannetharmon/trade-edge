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
import { CriterionInput } from './scanConfig/CriterionInput';
import { CriterionPills, type CriterionPill } from './scanConfig/CriterionPills';
import { LifecycleTag } from './scanConfig/LifecycleTag';
import { CcReceiptPanel } from './scanConfig/ScanReceiptPanel';
import {
  CC_CARD_ORDER, CC_CARD_TITLE, buildCcReceipt, ccCriteriaForCard, ccFieldErrors,
  type CcConfigValues, type CcCriterion,
} from '@/lib/screener/scanConfig/ccRegistry';
import { matchRangePreset, sameNumber } from '@/lib/screener/scanConfig/presets';

// SCREENER-CONFIG-0001B -- every control below is rendered from the covered-call criterion
// registry (lib/screener/scanConfig/ccRegistry.ts): its label, unit, lifecycle tag, quick selects,
// and hint come from there, and the scan summary is built from the same registry, so the modal and
// the result receipt cannot disagree. The controls, their accessible names, and the validation
// rules are the ones this modal always had; the tags, quick selects, summary, and the fixed
// always-applied rows are new.

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
  const receipt = useMemo(() => buildCcReceipt(values), [values]);

  const setRule = (key: keyof CcRulesType, value: number) =>
    setDraft(prev => ({ rules: { ...prev.rules, [key]: value } }));
  const setRules = (patch: Partial<CcRulesType>) =>
    setDraft(prev => ({ rules: { ...prev.rules, ...patch } }));

  // Renders the control of one registry criterion. The kind decides the widget; the registry
  // supplies every label, title, step, and quick-select value.
  const renderControl = (criterion: CcCriterion) => {
    const control = criterion.control;
    if (control.kind === 'range') {
      const min = draft.rules[control.minKey];
      const max = draft.rules[control.maxKey];
      const matched = matchRangePreset(min, max, control.presets);
      const pills: CriterionPill[] = control.presets.map(p => ({
        key: p.label, label: p.label, pressed: matched?.label === p.label,
        onSelect: () => setRules({ [control.minKey]: p.min, [control.maxKey]: p.max } as Partial<CcRulesType>),
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
    if (control.kind === 'rule') {
      const value = draft.rules[control.key];
      const pills: CriterionPill[] = control.presets.map(p => ({
        key: p.label, label: p.label, pressed: sameNumber(p.value, value),
        onSelect: () => setRule(control.key, p.value as number),
      }));
      return (
        <>
          <CriterionInput id={control.key} label={control.label} title={control.title} step={control.step} value={value} onValueChange={next => setRule(control.key, next)} unit={control.unit} error={errors[control.key]} />
          <CriterionPills th={th} groupLabel={`${criterion.label} quick select`} pills={pills} />
        </>
      );
    }
    return null;
  };

  return (
    <ScanModalShell
      th={th}
      titleId="cc-scan-title"
      title="COVERED CALL SCAN"
      subtitle={`${selectedTickerCount} eligible position${selectedTickerCount === 1 ? '' : 's'} · configure before scanning`}
      closeLabel="Close Covered Call scan configuration"
      onClose={onClose}
    >
      <div className="flex flex-col gap-0">
        <p className="text-[10px] text-neutral-400">Only broker-verified covered shares are eligible.</p>

        {holdingsLoading ? (
          <p className="mt-3 text-[10px] text-neutral-400">Loading eligible holdings...</p>
        ) : holdings.length === 0 ? (
          <p className="mt-3 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 leading-relaxed font-medium">
            ⚠ No eligible covered-call holdings found in your connected broker account.
          </p>
        ) : (
        <div className="mt-3 flex flex-wrap gap-1" data-testid="cc-holdings-selection" role="group" aria-label="Eligible covered-call positions">
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
                  className={`text-[9px] px-2 py-0.5 rounded border font-bold transition-colors ${
                    blocked
                      ? 'border-neutral-700 text-neutral-600 line-through opacity-40 cursor-not-allowed'
                      : hidden
                      ? 'border-neutral-700 text-neutral-500 line-through opacity-40'
                      : 'border-amber-500 text-amber-300 bg-amber-500/10'
                  }`}
                >
                  {h.symbol} <span className="opacity-60">({h.availableCoveredContracts})</span>
                </button>
              );
            })}
        </div>
        )}

        {CC_CARD_ORDER.map(card => {
          const criteria = ccCriteriaForCard(card);
          if (criteria.length === 0) return null;
          return (
            <section key={card} data-cc-card={card} aria-label={CC_CARD_TITLE[card]} className="mt-5 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-200">{CC_CARD_TITLE[card]}</h3>
              <div className="mt-2 flex flex-col gap-4">
                {criteria.map(c => (
                  <div key={c.id} data-cc-criterion={c.id}>
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
          <CcReceiptPanel th={th} receipt={receipt} heading="Scan summary" testId="cc-rule-preview" />
        </div>

        {!holdingsLoading && holdings.length > 0 && selectedCount === 0 && (
          <p role="alert" className="mt-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 leading-relaxed font-medium">
            ⚠ Select at least one eligible holding before running.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-2 text-xs text-red-400">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
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
    </ScanModalShell>
  );
}
