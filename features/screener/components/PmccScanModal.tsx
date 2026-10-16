'use client';

// features/screener/components/PmccScanModal.tsx
//
// PMCC-SELECT-0001 addition: this modal now shows the ACTUAL held-LEAPS
// positions discovered for this scan (heldCandidates, passed in by the
// caller after discoverHeldPmccCandidates() already ran) as a select-
// one-or-all chip list, defaulting to all selected -- same interaction
// pattern as CC's eligible-holdings chips. Before this, the subtitle here
// claimed "N held LEAPS position(s)" but was actually just displaying the
// Opportunity Universe ticker count, not real held-LEAPS data (Alan
// flagged this as a real, pre-existing label bug while investigating this
// ticket).

import { useMemo, useState } from 'react';
import { ScanModalShell, type ScanModalTheme } from './ScanModalShell';
import { DeferredNumberInput } from './DeferredNumberInput';
import { CriterionPills, type CriterionPill } from './scanConfig/CriterionPills';
import { matchRangePreset } from '@/lib/screener/scanConfig/presets';
import { COMPACT_INPUT, FieldHead, StatusLine } from './scanConfig/CompactControls';
import { InfoTip } from './scanConfig/InfoTip';
import { ScanLegend } from './scanConfig/ScanLegend';
import { AlwaysAppliedStrip, type StripItem } from './scanConfig/AlwaysAppliedStrip';

export interface PmccScanRequest {
  shortDteMin: number;
  shortDteMax: number;
  shortDeltaMin: number;
  shortDeltaMax: number;
  shortOiMin: number;
  maxSpreadPct: number;
  /** SCAN-ALIGN-0001C2: absolute width ceiling ($ per share), applied to the short call only. */
  widthCeiling: number;
}

export interface PmccHeldCandidateSummary {
  underlyingSymbol: string;
  dte: number;
}

// SCAN-ALIGN-0001 F1 (Mock 1): quick-select presets that set BOTH Min and Max delta.
export const PMCC_DELTA_PRESETS = [
  { label: 'Δ .15–.25', min: 0.15, max: 0.25 },
  { label: 'Δ .20–.30', min: 0.2, max: 0.3 },
  { label: 'Δ .25–.35', min: 0.25, max: 0.35 },
] as const;

const fmtDelta = (n: number) => n.toFixed(2).replace(/^0/, '');
const ATTR = 'data-pmcc-rule';

export function PmccScanModal({
  th, heldCandidates, hiddenSymbols, onToggleSymbol, discoveryLoading, exclusions, initial, onClose, onRun,
}: {
  th: ScanModalTheme;
  heldCandidates: PmccHeldCandidateSummary[];
  hiddenSymbols: string[];
  onToggleSymbol: (symbol: string) => void;
  // PMCC-DISCOVERY-ASYNC-0001: the broker portfolio refresh backing
  // heldCandidates now runs in the background after this modal is
  // already open, same as CC's holdingsLoading -- without this flag the
  // modal would flash an empty-state banner before real data arrives.
  discoveryLoading: boolean;
  // PMCC-EXCLUSIONS-0001: real per-position reasons a held call didn't
  // qualify, shown when symbols.length === 0 so "no eligible" is never a
  // dead end.
  exclusions: Array<{ symbol: string; reason: string }>;
  initial: PmccScanRequest;
  onClose: () => void;
  onRun: (request: PmccScanRequest) => void;
}) {
  const [draft, setDraft] = useState(initial);

  // One chip per unique underlying symbol -- a symbol can appear multiple
  // times in heldCandidates (different expirations/strikes of the same
  // held LEAPS), but selection happens at the symbol level.
  const symbols = useMemo(
    () => Array.from(new Set(heldCandidates.map(c => c.underlyingSymbol))).sort(),
    [heldCandidates],
  );
  const selectedCount = symbols.filter(s => !hiddenSymbols.includes(s)).length;

  const valid = useMemo(() => Object.values(draft).every(Number.isFinite)
    && draft.shortDteMin >= 0 && draft.shortDteMax >= draft.shortDteMin
    && draft.shortDeltaMin >= 0.1 && draft.shortDeltaMax <= 0.4 && draft.shortDeltaMax >= draft.shortDeltaMin
    && draft.shortOiMin >= 0 && draft.maxSpreadPct >= 0 && draft.widthCeiling >= 0.01
    && !discoveryLoading && selectedCount > 0, [draft, selectedCount, discoveryLoading]);
  // Same delta predicate as `valid` above; surfaced so a disabled Run is never silent.
  const deltaInvalid = !(draft.shortDeltaMin >= 0.1 && draft.shortDeltaMax <= 0.4 && draft.shortDeltaMax >= draft.shortDeltaMin);
  const num = (key: keyof PmccScanRequest, label: string, step: string, widthClass = COMPACT_INPUT) => <DeferredNumberInput aria-label={label} step={step} value={draft[key]} onValueChange={next => setDraft(value => ({ ...value, [key]: next }))} className={widthClass} />;
  const matchedDeltaPreset = matchRangePreset(draft.shortDeltaMin, draft.shortDeltaMax, PMCC_DELTA_PRESETS);
  const deltaPills: CriterionPill[] = PMCC_DELTA_PRESETS.map(p => ({
    key: p.label, label: p.label, pressed: matchedDeltaPreset?.label === p.label,
    onSelect: () => setDraft(value => ({ ...value, shortDeltaMin: p.min, shortDeltaMax: p.max })),
  }));
  const alwaysItems: StripItem[] = [
    { id: 'shortOtm', label: 'Short strike above price', tag: 'GATE · FIXED', attr: { [ATTR]: 'shortOtm' }, tip: <p>The short call must be out of the money: its strike is above the stock price.</p> },
    { id: 'quote', label: 'Two-sided quote', tag: 'GATE · FIXED', attr: { [ATTR]: 'quote' }, tip: <p>A call needs a usable bid and ask under the PMCC quote rules. Your held LEAP is exempt.</p> },
    { id: 'earnings', label: 'Earnings before expiry = excluded', tag: 'GATE · FIXED', attr: { [ATTR]: 'earnings' }, tip: <p>A short call that expires on or after a coming earnings date is removed before pairing. Earnings dates are estimates that can move.</p> },
    { id: 'netDebit', label: 'Net debit below width', tag: 'GATE · FIXED', attr: { [ATTR]: 'netDebit' }, tip: <p>The pair must cost a positive net debit that is below the strike gap between the two legs.</p> },
    { id: 'heldExempt', label: 'Held LEAP exempt', tag: 'READ ONLY', attr: { [ATTR]: 'heldExempt' }, tip: <p>Your held LEAP is not rejected by the DTE range, the delta range or the open-interest check, because you already own it.</p> },
    { id: 'noShortOi', label: 'No short OI = rejected', tag: 'GATE · FIXED', attr: { [ATTR]: 'noShortOi' }, emphasis: true, tip: <p>A short call with no open interest on file is rejected. Low open interest is kept and flagged.</p> },
  ];
  const recap = `${draft.shortDteMin}–${draft.shortDteMax}d · Δ ${fmtDelta(draft.shortDeltaMin)}–${fmtDelta(draft.shortDeltaMax)} · ≤${draft.maxSpreadPct}% / $${draft.widthCeiling.toFixed(2)} · OI pref ${draft.shortOiMin}`;
  return <ScanModalShell th={th} titleId="pmcc-scan-title" title="PMCC SCAN" subtitle={`${selectedCount} of ${symbols.length} held LEAPS position${symbols.length === 1 ? '' : 's'} selected · configure short-call search`} closeLabel="Close PMCC scan configuration" onClose={onClose} maxWidthClassName="max-w-[720px]" compact>
    <div className="flex flex-col gap-3">
      <ScanLegend lifecycles={['fetch', 'advisory']} />
      {discoveryLoading ? (
        <p className="text-[11px] text-neutral-400">Loading held LEAPS positions…</p>
      ) : symbols.length === 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] font-medium leading-relaxed text-amber-400">
          <p>⚠ No eligible held long calls were found in your connected broker account.</p>
          {exclusions.length > 0 && (
            <ul className="mt-1.5 list-inside list-disc font-normal">
              {exclusions.map((e, i) => (
                <li key={i}>{e.symbol}: {e.reason}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1" data-testid="pmcc-held-leaps-selection" role="group" aria-label="Held LEAPS positions">
          <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            Held LEAPS
            <InfoTip>Searches short calls to sell against your held LEAPS. A position can be left out of this scan by clicking it.</InfoTip>
          </span>
          {symbols.map(symbol => {
            const hidden = hiddenSymbols.includes(symbol);
            return (
              <button
                key={symbol}
                type="button"
                onClick={() => onToggleSymbol(symbol)}
                className={`rounded border px-2 py-0.5 text-[10px] font-bold transition-colors ${
                  hidden
                    ? 'border-neutral-700 text-neutral-500 line-through opacity-40'
                    : 'border-amber-500 bg-amber-500/10 text-amber-300'
                }`}
              >
                {symbol}
              </button>
            );
          })}
        </div>
      )}
      <section aria-label="Search and preferences" className={`grid grid-cols-1 gap-x-5 gap-y-3 border-t ${th.border} pt-3 sm:grid-cols-2`}>
        <div className="flex min-w-0 flex-col gap-1">
          <FieldHead lifecycle="fetch" fixed={false} rescan name="DTE range" tip={<p>Short calls outside this window are never considered. Your held LEAP is not filtered by it.</p>} />
          <div className="flex items-center gap-1.5">
            {num('shortDteMin', 'Min DTE', '1')}
            <span aria-hidden="true" className="text-neutral-500">–</span>
            {num('shortDteMax', 'Max DTE', '1')}
            <span className="text-[10px] text-neutral-500">days</span>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <FieldHead lifecycle="fetch" fixed={false} rescan name="Delta range" align="right" tip={<><p>Delta range, absolute.</p><p data-testid="pmcc-delta-hint" className="mt-1">Absolute delta of the short call. Lower = further OTM.</p></>} />
          <div className="flex items-center gap-1.5">
            {num('shortDeltaMin', 'Min Δ', '0.01')}
            <span aria-hidden="true" className="text-neutral-500">–</span>
            {num('shortDeltaMax', 'Max Δ', '0.01')}
          </div>
          {deltaInvalid && <StatusLine message="Delta must be between 0.10 and 0.40, and Max at least Min." />}
          <CriterionPills th={th} groupLabel="Delta range quick select" pills={deltaPills} compact />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <FieldHead lifecycle="fetch" fixed={false} rescan name="Max bid/ask width" tip={<>
            <p data-testid="pmcc-spread-help">Calls with a wider bid/ask gap than this are removed (minimum allowance $0.05).</p>
            <p data-testid="pmcc-ceiling-help" className="mt-1">Removes calls whose gap exceeds this many dollars per share, even if the percent rule passes.</p>
            <p data-testid="pmcc-width-hint" className="mt-1">Short call only. Rejects wider than max(10% of mid, $0.05), or over the ceiling.</p>
          </>} />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {num('maxSpreadPct', 'Max spread %', '1', 'w-14 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white')}
            <span className="text-[10px] text-neutral-500">% of mid</span>
            <span aria-hidden="true" className="text-[10px] text-neutral-500">and</span>
            {num('widthCeiling', 'Width ceiling ($)', '0.01')}
            <span className="text-[10px] text-neutral-500">$ cap</span>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <FieldHead lifecycle="advisory" fixed={false} rescan name="Short OI pref." align="right" tip={<p>A short call below this open interest is kept and flagged. Fills may be slower. It does not disqualify the structure.</p>} />
          <div className="flex items-center gap-1.5">
            {num('shortOiMin', 'Short OI pref.', '1')}
            <span className="text-[10px] text-neutral-500">contracts · lower is kept, flagged</span>
          </div>
        </div>
      </section>
      <AlwaysAppliedStrip th={th} items={alwaysItems} />
      {!discoveryLoading && symbols.length > 0 && selectedCount === 0 && (
        <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs font-medium leading-relaxed text-amber-400">
          ⚠ Select at least one held LEAPS position before running.
        </p>
      )}
      <div className={`flex items-center justify-between gap-4 border-t ${th.border} pt-3`}>
        <div data-testid="pmcc-rule-preview" className="min-w-0 text-[10px] leading-snug text-neutral-400">
          <p>{recap}</p>
          <p>{discoveryLoading ? 'Loading held LEAPS positions…' : `${selectedCount} LEAPS selected`}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-xs">Cancel</button>
          <button disabled={!valid} onClick={() => onRun(draft)} className="rounded-lg border border-amber-400 bg-amber-400 px-4 py-2 text-xs font-bold text-black disabled:cursor-not-allowed disabled:opacity-40">RUN PMCC SCAN →</button>
        </div>
      </div>
    </div>
  </ScanModalShell>;
}
