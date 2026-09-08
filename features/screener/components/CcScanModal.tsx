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

const CC_FIELDS: Array<[keyof CcRulesType, string, string]> = [
  ['DTE_MIN', 'Min DTE', '1'],
  ['DTE_MAX', 'Max DTE', '1'],
  ['DELTA_MIN', 'Min delta', '0.01'],
  ['DELTA_MAX', 'Max delta', '0.01'],
  ['OI_MIN', 'Min OI', '1'],
  ['BID_ASK_MAX', 'Max bid/ask width', '0.01'],
];

export function CcScanModal({ th, selectedTickerCount, holdings, hiddenSymbols, onToggleSymbol, holdingsLoading, initial, onClose, onRun }: Props) {
  const [draft, setDraft] = useState<CcScanRequest>(initial);
  const [error, setError] = useState('');

  const selectedCount = useMemo(
    () => holdings.filter(h => h.availableCoveredContracts > 0 && !hiddenSymbols.includes(h.symbol)).length,
    [holdings, hiddenSymbols],
  );

  const valid = useMemo(() => {
    const r = draft.rules;
    return Object.values(r).every(Number.isFinite)
      && r.DTE_MIN >= 0 && r.DTE_MAX > r.DTE_MIN
      && r.DELTA_MIN >= 0 && r.DELTA_MAX <= 1 && r.DELTA_MAX > r.DELTA_MIN
      && r.OI_MIN >= 0 && r.BID_ASK_MAX >= 0
      && !holdingsLoading && selectedCount > 0;
  }, [draft, selectedCount, holdingsLoading]);

  const setRule = (key: keyof CcRulesType, value: number) =>
    setDraft(prev => ({ rules: { ...prev.rules, [key]: value } }));

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
        <p className="text-[10px] text-neutral-400">
          Share-coverage capacity is verified separately against your connected broker
          account. A watchlist or universe can narrow which of your holdings are eligible,
          but it cannot create coverage that doesn&rsquo;t exist. The fields below only affect
          which calls qualify against your already-eligible lots.
        </p>

        {holdingsLoading ? (
          <p className="mt-3 text-[10px] text-neutral-400">Loading eligible holdings…</p>
        ) : holdings.length === 0 ? (
          <p className="mt-3 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 leading-relaxed font-medium">
            ⚠ No eligible covered-call holdings found in your connected broker account.
          </p>
        ) : (
        <div className="mt-3 flex flex-wrap gap-1" data-testid="cc-holdings-selection">
            {holdings.map(h => {
              const hidden = hiddenSymbols.includes(h.symbol);
              const blocked = h.availableCoveredContracts === 0;
              return (
                <button
                  key={h.symbol}
                  type="button"
                  onClick={() => !blocked && onToggleSymbol(h.symbol)}
                  disabled={blocked}
                  title={blocked ? 'Fully covered — no available capacity' : undefined}
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

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CC_FIELDS.map(([key, label, step]) => (
            <label key={key} className="flex flex-col gap-1 text-[10px] text-neutral-400">
              {label}
              <input
                aria-label={label}
                type="number"
                step={step}
                value={draft.rules[key]}
                onChange={e => setRule(key, Number(e.target.value))}
                className="mt-1 w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white"
              />
            </label>
          ))}
        </div>

        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] text-neutral-500">DTE</span>
          {[
            { label: '14\u201321', min: 14, max: 21 },
            { label: '21\u201345', min: 21, max: 45 },
            { label: '30\u201345', min: 30, max: 45 },
            { label: '45\u201360', min: 45, max: 60 },
          ].map(r => (
            <button key={r.label} type="button" onClick={() => setDraft(prev => ({ ...prev, rules: { ...prev.rules, DTE_MIN: r.min, DTE_MAX: r.max } }))}
              className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                draft.rules.DTE_MIN === r.min && draft.rules.DTE_MAX === r.max
                  ? 'border-amber-500 text-amber-300 bg-amber-500/15'
                  : 'border-neutral-700 text-neutral-400 hover:border-amber-500/50'
              }`}>{r.label}</button>
          ))}
        </div>

        <div
          className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-[10px] text-neutral-300"
          data-testid="cc-rule-preview"
        >
          DTE {draft.rules.DTE_MIN}–{draft.rules.DTE_MAX} · Δ{' '}
          {draft.rules.DELTA_MIN.toFixed(2)}–{draft.rules.DELTA_MAX.toFixed(2)} · min OI{' '}
          {draft.rules.OI_MIN} · max bid/ask width {draft.rules.BID_ASK_MAX.toFixed(2)} ·
          strike must clear cost basis and current price · earnings inside expiration
          disqualify
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
