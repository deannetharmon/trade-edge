'use client';

// features/screener/components/PmccScanModal.tsx
//
// PMCC pre-scan modal. Before this component existed, "FIND PMCCs" ran the
// scan immediately on click using entirely hardcoded criteria (delta ranges,
// OI floors, requireDebitBelowWidth) from lib/scans/pmccConfig.ts's
// DEFAULT_* constants -- only DTE was editable, via a collapsed inline
// <details> disclosure on the main page rather than a pre-scan modal, an
// inconsistency with the CSP/CC/Spreads pattern already fixed in their own
// tickets. This closes that gap the same way: built on the existing
// ScanModalShell, exposing every field runPMCCScan already sends to the
// (already-merged, already-tested) pairing engine.
//
// DTE fields keep their existing aria-labels ("Short call DTE minimum" etc.)
// on purpose -- ScreenerPage.test.tsx has a real DTE-validation acceptance
// test that queries those exact labels; moving the fields into this modal
// without preserving the labels would have broken that test's intent, not
// just its click sequence.
//
// Deliberately does NOT expose quotePolicy or limits (spread/age thresholds,
// combination caps) -- those are pairing-engine safety/quality parameters
// approved in the PMCC pairing ticket's decision register, not scan-entry
// criteria a trader tunes per run. Exposing them here would blur "what am I
// searching for" with "how is the search allowed to behave internally."

import { useMemo, useState } from 'react';
import type { PmccDeltaRange } from '@/lib/scans/pmccTypes';
import { isValidPmccDteRanges } from '@/lib/scans/pmccDteRanges';
import {
  PMCC_LONG_DELTA_BOUNDS,
  PMCC_SHORT_DELTA_BOUNDS,
  isValidPmccDeltaRange,
} from '@/lib/scans/pmccConfig';
import { ScanModalShell, type ScanModalTheme } from './ScanModalShell';

export interface PmccScanCriteria {
  dte: { shortMin: number; shortMax: number; longMin: number; longMax: number };
  longDelta: PmccDeltaRange;
  shortDelta: PmccDeltaRange;
  longOiMin: number;
  shortOiMin: number;
  requireDebitBelowWidth: boolean;
  // PMCC-TREND-GATE-0001 -- default true, same "trust the qualified realm,
  // adjust the criterion" pattern as requireDebitBelowWidth above.
  // Explicitly PMCC-scoped, not a generic trend toggle, per Ian's
  // explicit naming requirement.
  requireTrendAlignmentForPmcc: boolean;
}

interface Props {
  th: ScanModalTheme;
  selectedTickerCount: number;
  heldLongCandidateCount: number;
  initial: PmccScanCriteria;
  onClose: () => void;
  onRun: (criteria: PmccScanCriteria) => void;
}

export function PmccScanModal({ th, selectedTickerCount, heldLongCandidateCount, initial, onClose, onRun }: Props) {
  const [draft, setDraft] = useState<PmccScanCriteria>(initial);
  const [error, setError] = useState('');

  const valid = useMemo(() => {
    return isValidPmccDteRanges(draft.dte)
      && isValidPmccDeltaRange(draft.longDelta, PMCC_LONG_DELTA_BOUNDS)
      && isValidPmccDeltaRange(draft.shortDelta, PMCC_SHORT_DELTA_BOUNDS)
      && Number.isInteger(draft.longOiMin) && draft.longOiMin >= 0
      && Number.isInteger(draft.shortOiMin) && draft.shortOiMin >= 0;
  }, [draft]);

  const setDte = (key: keyof PmccScanCriteria['dte'], value: number) =>
    setDraft(prev => ({ ...prev, dte: { ...prev.dte, [key]: value } }));
  const setLongDelta = (key: keyof PmccDeltaRange, value: number) =>
    setDraft(prev => ({ ...prev, longDelta: { ...prev.longDelta, [key]: value } }));
  const setShortDelta = (key: keyof PmccDeltaRange, value: number) =>
    setDraft(prev => ({ ...prev, shortDelta: { ...prev.shortDelta, [key]: value } }));

  return (
    <ScanModalShell
      th={th}
      titleId="pmcc-scan-title"
      title="PMCC SCAN"
      subtitle={`${selectedTickerCount} selected ticker${selectedTickerCount === 1 ? '' : 's'} · ${heldLongCandidateCount} held long call${heldLongCandidateCount === 1 ? '' : 's'} · configure before scanning`}
      closeLabel="Close PMCC scan configuration"
      onClose={onClose}
    >
      <div className="flex flex-col gap-0">
        <div className="grid grid-cols-2 gap-3">
          <fieldset className="rounded-lg border border-neutral-700 p-2">
            <legend className="px-1 text-[10px] text-neutral-400">Short call DTE</legend>
            <div className="flex items-center gap-1">
              <input aria-label="Short call DTE minimum" type="number" min={0}
                value={draft.dte.shortMin}
                onChange={e => setDte('shortMin', Number(e.target.value))}
                className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-xs text-white" />
              <span className="text-neutral-500 text-xs">to</span>
              <input aria-label="Short call DTE maximum" type="number" min={0}
                value={draft.dte.shortMax}
                onChange={e => setDte('shortMax', Number(e.target.value))}
                className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-xs text-white" />
            </div>
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {[
                { label: '14\u201321', min: 14, max: 21 },
                { label: '21\u201345', min: 21, max: 45 },
                { label: '30\u201345', min: 30, max: 45 },
                { label: '45\u201360', min: 45, max: 60 },
              ].map(r => (
                <button key={r.label} type="button" onClick={() => setDraft(prev => ({ ...prev, dte: { ...prev.dte, shortMin: r.min, shortMax: r.max } }))}
                  className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                    draft.dte.shortMin === r.min && draft.dte.shortMax === r.max
                      ? 'border-teal-500 text-teal-300 bg-teal-500/15'
                      : 'border-neutral-700 text-neutral-400 hover:border-teal-500/50'
                  }`}>{r.label}</button>
              ))}
            </div>
          </fieldset>
          <fieldset className="rounded-lg border border-neutral-700 p-2">
            <legend className="px-1 text-[10px] text-neutral-400">Long call DTE</legend>
            <div className="flex items-center gap-1">
              <input aria-label="Long call DTE minimum" type="number" min={0}
                value={draft.dte.longMin}
                onChange={e => setDte('longMin', Number(e.target.value))}
                className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-xs text-white" />
              <span className="text-neutral-500 text-xs">to</span>
              <input aria-label="Long call DTE maximum" type="number" min={0}
                value={draft.dte.longMax}
                onChange={e => setDte('longMax', Number(e.target.value))}
                className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-xs text-white" />
            </div>
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {[
                { label: '90\u2013180', min: 90, max: 180 },
                { label: '180\u2013365', min: 180, max: 365 },
                { label: '365\u2013730', min: 365, max: 730 },
                { label: '180\u2013730', min: 180, max: 730 },
              ].map(r => (
                <button key={r.label} type="button" onClick={() => setDraft(prev => ({ ...prev, dte: { ...prev.dte, longMin: r.min, longMax: r.max } }))}
                  className={`text-[9px] px-2 py-0.5 rounded border transition-colors font-bold ${
                    draft.dte.longMin === r.min && draft.dte.longMax === r.max
                      ? 'border-teal-500 text-teal-300 bg-teal-500/15'
                      : 'border-neutral-700 text-neutral-400 hover:border-teal-500/50'
                  }`}>{r.label}</button>
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-neutral-700 p-2">
            <legend className="px-1 text-[10px] text-neutral-400">Long call delta</legend>
            <div className="flex items-center gap-1">
              <input aria-label="Long call delta minimum" type="number" step="0.01"
                min={PMCC_LONG_DELTA_BOUNDS.min} max={PMCC_LONG_DELTA_BOUNDS.max}
                value={draft.longDelta.min}
                onChange={e => setLongDelta('min', Number(e.target.value))}
                className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-xs text-white" />
              <span className="text-neutral-500 text-xs">to</span>
              <input aria-label="Long call delta maximum" type="number" step="0.01"
                min={PMCC_LONG_DELTA_BOUNDS.min} max={PMCC_LONG_DELTA_BOUNDS.max}
                value={draft.longDelta.max}
                onChange={e => setLongDelta('max', Number(e.target.value))}
                className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-xs text-white" />
            </div>
          </fieldset>
          <fieldset className="rounded-lg border border-neutral-700 p-2">
            <legend className="px-1 text-[10px] text-neutral-400">Short call delta</legend>
            <div className="flex items-center gap-1">
              <input aria-label="Short call delta minimum" type="number" step="0.01"
                min={PMCC_SHORT_DELTA_BOUNDS.min} max={PMCC_SHORT_DELTA_BOUNDS.max}
                value={draft.shortDelta.min}
                onChange={e => setShortDelta('min', Number(e.target.value))}
                className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-xs text-white" />
              <span className="text-neutral-500 text-xs">to</span>
              <input aria-label="Short call delta maximum" type="number" step="0.01"
                min={PMCC_SHORT_DELTA_BOUNDS.min} max={PMCC_SHORT_DELTA_BOUNDS.max}
                value={draft.shortDelta.max}
                onChange={e => setShortDelta('max', Number(e.target.value))}
                className="w-16 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-xs text-white" />
            </div>
          </fieldset>

          <label className="flex flex-col gap-1 text-[10px] text-neutral-400">
            Long OI min
            <input aria-label="Long call open interest minimum" type="number" min={0}
              value={draft.longOiMin}
              onChange={e => setDraft(prev => ({ ...prev, longOiMin: Number(e.target.value) }))}
              className="mt-1 w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-neutral-400">
            Short OI min
            <input aria-label="Short call open interest minimum" type="number" min={0}
              value={draft.shortOiMin}
              onChange={e => setDraft(prev => ({ ...prev, shortOiMin: Number(e.target.value) }))}
              className="mt-1 w-20 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-white" />
          </label>
        </div>

        <label className="mt-3 flex items-center gap-2 text-[10px] text-neutral-400">
          <input aria-label="Require net debit below strike width" type="checkbox"
            checked={draft.requireDebitBelowWidth}
            onChange={e => setDraft(prev => ({ ...prev, requireDebitBelowWidth: e.target.checked }))}
            className="rounded border-neutral-700" />
          Require net debit below strike width (qualified pairs only — failing pairs are retained in the audit set either way)
        </label>

        {/* PMCC-TREND-GATE-0001 -- same pattern as the toggle above.
            Explicitly PMCC-scoped label per Ian's requirement -- not a
            generic "trend" toggle that could be confused for applying to
            other strategies later. */}
        <label className="mt-2 flex items-center gap-2 text-[10px] text-neutral-400">
          <input aria-label="Require trend alignment for PMCC" type="checkbox"
            checked={draft.requireTrendAlignmentForPmcc}
            onChange={e => setDraft(prev => ({ ...prev, requireTrendAlignmentForPmcc: e.target.checked }))}
            className="rounded border-neutral-700" />
          Require trend alignment for PMCC (qualified pairs only — a structure on a confirmed downtrending underlying is retained in the near-miss set either way)
        </label>

        <div
          className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-[10px] text-neutral-300"
          data-testid="pmcc-rule-preview"
        >
          Short DTE {draft.dte.shortMin}–{draft.dte.shortMax} · Long DTE {draft.dte.longMin}–{draft.dte.longMax} ·
          {' '}Long Δ {draft.longDelta.min.toFixed(2)}–{draft.longDelta.max.toFixed(2)} ·
          {' '}Short Δ {draft.shortDelta.min.toFixed(2)}–{draft.shortDelta.max.toFixed(2)} ·
          {' '}OI ≥ {draft.longOiMin}/{draft.shortOiMin}
        </div>

        {error && (
          <p role="alert" className="mt-2 text-xs text-red-400">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-xs">
            Cancel
          </button>
          <button
            disabled={!valid}
            onClick={() => {
              if (!valid) {
                setError('PMCC DTE ranges are invalid. Each minimum must be zero or greater and no larger than its maximum.');
                return;
              }
              onRun(draft);
            }}
            className="rounded-lg border border-amber-400 bg-amber-400 px-4 py-2 text-xs font-bold text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            RUN PMCC SCAN →
          </button>
        </div>
      </div>
    </ScanModalShell>
  );
}

