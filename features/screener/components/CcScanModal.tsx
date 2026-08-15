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

import { useMemo, useState } from 'react';
import type { CcRulesType } from '@/lib/scans/constants';
import { ScanModalShell, type ScanModalTheme } from './ScanModalShell';

export interface CcScanRequest {
  rules: CcRulesType;
}

interface Props {
  th: ScanModalTheme;
  selectedTickerCount: number;
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

export function CcScanModal({ th, selectedTickerCount, initial, onClose, onRun }: Props) {
  const [draft, setDraft] = useState<CcScanRequest>(initial);
  const [error, setError] = useState('');

  const valid = useMemo(() => {
    const r = draft.rules;
    return Object.values(r).every(Number.isFinite)
      && r.DTE_MIN >= 0 && r.DTE_MAX > r.DTE_MIN
      && r.DELTA_MIN >= 0 && r.DELTA_MAX <= 1 && r.DELTA_MAX > r.DELTA_MIN
      && r.OI_MIN >= 0 && r.BID_ASK_MAX >= 0;
  }, [draft]);

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

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CC_FIELDS.map(([key, label, step]) => (
            <label key={key} className="text-[10px] text-neutral-400">
              {label}
              <input
                aria-label={label}
                type="number"
                step={step}
                value={draft.rules[key]}
                onChange={e => setRule(key, Number(e.target.value))}
                className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white"
              />
            </label>
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

