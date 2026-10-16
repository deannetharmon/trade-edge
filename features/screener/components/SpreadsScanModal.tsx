'use client';

// features/screener/components/SpreadsScanModal.tsx
//
// SCAN-MODAL-UX-0002B: the one-screen layout of the Spreads scan modal (Rank and Targeted), on the same
// system as the Covered Call, CSP, PMCC and LEAPS modals: a colored dot per setting, one legend line,
// help text in "i" tooltips, a short recap by the buttons.
//
// This component only draws. The state, the preset logic, the clamps and the run request stay in
// RunModeModal (app/screener/page.tsx), which passes values and handlers in, so nothing about what a scan
// does changed.

import type { ReactNode } from 'react';
import { ScanModalShell, ScanModeRadioGroup, type ScanModalTheme } from './ScanModalShell';
import { DeferredNumberInput } from './DeferredNumberInput';
import { COMPACT_INPUT, FieldHead } from './scanConfig/CompactControls';
import { CriterionPills, type CriterionPill } from './scanConfig/CriterionPills';
import { ScanLegend } from './scanConfig/ScanLegend';

export type SpreadsScanMode = 'filter' | 'rank' | 'targeted';

export interface SpreadsRankRulesView {
  IVR_MIN: number;
  OI_MIN: number;
  BID_ASK_MAX?: number;
  CREDIT_RATIO_MIN: number;
  ROC_MIN_SPREAD: number;
  ROC_MIN_IC: number;
}

export interface SpreadsScanModalProps {
  th: ScanModalTheme;
  mode: SpreadsScanMode;
  onMode: (mode: SpreadsScanMode) => void;
  scanWidth: { min: number; max: number };
  widthChoices: readonly number[];
  /** The widths the scan will cover, for the "Scan $5, $10 ..." line. */
  scannedWidths: readonly number[];
  onMinWidth: (value: number) => void;
  onMaxWidth: (value: number) => void;
  presets: ReadonlyArray<{ key: string; label: string; desc: string }>;
  preset: string;
  onPreset: (key: string) => void;
  dteMin: number;
  dteMax: number;
  onDteMin: (value: number) => void;
  onDteMax: (value: number) => void;
  onDtePick: (min: number, max: number) => void;
  creditRatioMin: number;
  onCreditPick: (value: number) => void;
  onCreditInput: (value: number) => void;
  popMin: number;
  onPopMin: (value: number) => void;
  otmMin: number;
  onOtmMin: (value: number) => void;
  ivrMin: number;
  onIvrMin: (value: number) => void;
  activeRankRules: SpreadsRankRulesView;
  /** The old Filter-mode preset list. Filter is not offered in the mode selector; kept so nothing is deleted. */
  filterBlock: ReactNode;
  onRun: () => void;
  onClose: () => void;
}

const DTE_CHOICES = [
  { label: '7–13', min: 7, max: 13 },
  { label: '14–20', min: 14, max: 20 },
  { label: '21–29', min: 21, max: 29 },
  { label: '30–45', min: 30, max: 45 },
  { label: '46–60', min: 46, max: 60 },
  { label: '21–60', min: 21, max: 60 },
] as const;
const CREDIT_CHOICES = [0, 15, 20, 25, 33, 35] as const;
const POP_CHOICES = [65, 70, 75, 80] as const;
const OTM_CHOICES = [4, 8, 12, 16, 20] as const;
const IVR_CHOICES = [0, 10, 15, 20, 30, 40, 50] as const;

const WIDE_INPUT = 'w-14 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white';
const SELECT = 'rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white';

export function SpreadsScanModal(p: SpreadsScanModalProps) {
  const { th, mode } = p;
  const widthList = p.scannedWidths.map(width => `$${width}`).join(', ');
  const widthTip = <p>Scan {widthList}. Narrow the results afterward without another scan.</p>;

  const pill = (label: string, pressed: boolean, onSelect: () => void, off = false): CriterionPill => ({ key: label, label, pressed, off, onSelect });

  const widthField = (
    <div className="flex min-w-0 flex-col gap-1" data-spreads-field="widths">
      <FieldHead lifecycle="fetch" fixed={false} rescan name="Spread widths to scan" align={mode === 'targeted' ? 'right' : 'left'} tip={widthTip} />
      <div className="flex items-center gap-1.5">
        <select aria-label="Minimum spread width to scan" value={p.scanWidth.min} onChange={e => p.onMinWidth(Number(e.target.value))} className={SELECT}>
          {p.widthChoices.map(width => <option key={width} value={width}>${width}</option>)}
        </select>
        <span aria-hidden="true" className="text-neutral-500">–</span>
        <select aria-label="Maximum spread width to scan" value={p.scanWidth.max} onChange={e => p.onMaxWidth(Number(e.target.value))} className={SELECT}>
          {p.widthChoices.map(width => <option key={width} value={width}>${width}</option>)}
        </select>
      </div>
      <p className="text-[10px] text-neutral-500">{widthList}</p>
    </div>
  );

  const r = p.activeRankRules;
  const rankChips = [
    `IVR ≥ ${r.IVR_MIN}%`,
    `OI ≥ ${r.OI_MIN}`,
    `bid/ask ≤ $${r.BID_ASK_MAX?.toFixed(2)}`,
    `credit ≥ ${(r.CREDIT_RATIO_MIN * 100).toFixed(0)}% of width`,
    `ROC ≥ ${r.ROC_MIN_SPREAD}% (spread) / ${r.ROC_MIN_IC}% (IC)`,
  ];

  const widthRecap = `$${p.scanWidth.min}–$${p.scanWidth.max}`;
  const recap = mode === 'targeted'
    ? `${p.dteMin}–${p.dteMax}d · ${widthRecap} · credit ${p.creditRatioMin > 0 ? `≥${p.creditRatioMin}%` : 'any'} · POP ≥${p.popMin}% · OTM ≥${p.otmMin}% · IVR ${p.ivrMin > 0 ? `≥${p.ivrMin}%` : 'any'}`
    : `${widthRecap} widths · active ruleset`;

  const gate = (name: string, tip: ReactNode, align: 'left' | 'right', input: ReactNode, suffix: string | null, pills: CriterionPill[], groupLabel: string) => (
    <div className="flex min-w-0 flex-col gap-1">
      <FieldHead lifecycle="gate" fixed={false} rescan name={name} align={align} tip={tip} />
      <div className="flex items-center gap-1.5">
        {input}
        {suffix ? <span className="text-[10px] text-neutral-500">{suffix}</span> : null}
      </div>
      <CriterionPills th={th} groupLabel={groupLabel} pills={pills} compact />
    </div>
  );

  return (
    <ScanModalShell
      th={th}
      titleId="run-mode-modal-title"
      title="SCAN SELECTED INDEXES, ETFS, EQUITIES"
      closeLabel="Close scan configuration"
      onClose={p.onClose}
      maxWidthClassName="max-w-[720px]"
      compact
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <ScanModeRadioGroup
            th={th}
            ariaLabel="Scan mode"
            value={mode}
            onChange={p.onMode}
            compact
            descriptions={{ filter: 'Gate by rules — pass/fail', rank: 'Score & sort all tickers', targeted: 'Deep scan by DTE + POP' }}
          />
          {mode === 'targeted' && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Start from a preset</span>
              <div role="group" aria-label="Start from a preset" className={`inline-flex flex-wrap overflow-hidden rounded-lg border ${th.border}`}>
                {p.presets.map(preset => (
                  <button
                    key={preset.key}
                    type="button"
                    aria-pressed={p.preset === preset.key}
                    title={preset.desc}
                    onClick={() => p.onPreset(preset.key)}
                    className={`px-2.5 py-1.5 text-[11px] font-bold transition-colors ${p.preset === preset.key ? 'bg-teal-500/20 text-teal-300' : `${th.card} ${th.textFaint}`}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <ScanLegend
          lifecycles={mode === 'targeted' ? ['fetch', 'gate'] : ['fetch']}
          note={mode === 'targeted' ? 'Changing any setting here needs a new scan.' : 'Changing the spread widths needs a new scan.'}
        />

        {mode === 'targeted' ? (
          <>
            <section aria-label="Search range" className={`grid grid-cols-1 gap-x-5 gap-y-3 border-t ${th.border} pt-3 sm:grid-cols-2`}>
              <div className="flex min-w-0 flex-col gap-1">
                <FieldHead lifecycle="fetch" fixed={false} rescan name="DTE range" tip={<p>Expirations outside this window are not scanned.</p>} />
                <div className="flex items-center gap-1.5">
                  <DeferredNumberInput aria-label="Minimum DTE" step="1" value={p.dteMin} onValueChange={p.onDteMin} className={COMPACT_INPUT} />
                  <span aria-hidden="true" className="text-neutral-500">–</span>
                  <DeferredNumberInput aria-label="Maximum DTE" step="1" value={p.dteMax} onValueChange={p.onDteMax} className={COMPACT_INPUT} />
                  <span className="text-[10px] text-neutral-500">days</span>
                </div>
                <CriterionPills
                  th={th} groupLabel="DTE range quick select" compact
                  pills={DTE_CHOICES.map(c => pill(c.label, p.dteMin === c.min && p.dteMax === c.max, () => p.onDtePick(c.min, c.max)))}
                />
              </div>
              {widthField}
            </section>

            <section aria-label="Targets" className={`grid grid-cols-1 gap-x-5 gap-y-3 border-t ${th.border} pt-3 sm:grid-cols-2`}>
              {gate(
                'Min credit / risk',
                <p>Only show trades where conservative entry credit is at least this share of spread width. Higher minimums reduce results; they do not guarantee fills.</p>,
                'left',
                <DeferredNumberInput aria-label="Custom minimum credit risk percentage" step="1" value={p.creditRatioMin} onValueChange={p.onCreditInput} className={WIDE_INPUT} />,
                '%',
                CREDIT_CHOICES.map(v => pill(v === 0 ? 'Any' : `${v}%`, p.creditRatioMin === v, () => p.onCreditPick(v), v === 0)),
                'Minimum credit risk quick select',
              )}
              {gate(
                'POP est. min',
                <p>Candidates below this estimated probability of profit are rejected.</p>,
                'right',
                <DeferredNumberInput aria-label="Minimum estimated POP" step="1" value={p.popMin} onValueChange={p.onPopMin} className={WIDE_INPUT} />,
                '%',
                POP_CHOICES.map(v => pill(`${v}%`, p.popMin === v, () => p.onPopMin(v))),
                'POP quick select',
              )}
              {gate(
                'Min OTM',
                <><p>Candidates closer to the stock price than this are rejected.</p><p className="mt-1">For Iron Condors, gates on the tighter of put/call side</p></>,
                'left',
                <DeferredNumberInput aria-label="Minimum OTM percentage" step="0.1" value={p.otmMin} onValueChange={p.onOtmMin} className={WIDE_INPUT} />,
                '% · Iron Condor: tighter side',
                OTM_CHOICES.map(v => pill(`${v}%`, p.otmMin === v, () => p.onOtmMin(v))),
                'OTM quick select',
              )}
              {gate(
                'Min IVR',
                <p>Guide: stocks 30%+ · ETFs and indexes 15%+ (their IV runs in a narrower range). One floor applies to every selected ticker, so 30% will filter out most ETFs and indexes; scan them separately at 15%.</p>,
                'right',
                <DeferredNumberInput aria-label="Minimum IVR percentage" step="0.1" value={p.ivrMin} onValueChange={p.onIvrMin} className={WIDE_INPUT} />,
                '% · stocks 30+, ETFs 15+',
                IVR_CHOICES.map(v => pill(v === 0 ? 'Any' : `${v}%`, p.ivrMin === v, () => p.onIvrMin(v), v === 0)),
                'IVR quick select',
              )}
            </section>
          </>
        ) : (
          <section aria-label="Search range" className={`border-t ${th.border} pt-3`}>
            {widthField}
          </section>
        )}

        {mode === 'filter' && p.filterBlock}

        {mode === 'rank' && (
          <section aria-label="Active ruleset" className={`rounded-lg border ${th.border} bg-neutral-900/50 px-3 py-2`}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-300">
              Active ruleset <span className="font-normal normal-case tracking-normal text-neutral-500">Read only. Rank scores and sorts every ticker using your currently active saved rules — set via RULES, not selected here.</span>
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5" data-testid="rank-active-rules-preview">
              {rankChips.map(text => (
                <li key={text} className={`inline-flex items-center rounded-md border bg-neutral-900 px-2 py-0.5 text-[11px] text-neutral-100 ${th.border}`}>{text}</li>
              ))}
            </ul>
          </section>
        )}

        <div className={`flex items-center justify-between gap-4 border-t ${th.border} pt-3`}>
          <p data-testid="spreads-rule-preview" className="min-w-0 text-[10px] leading-snug text-neutral-400">{recap}</p>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={p.onClose} className="rounded-lg border border-neutral-700 px-4 py-2 text-xs">Cancel</button>
            <button type="button" onClick={p.onRun} className="ac-btn-solid rounded-lg border ac-border/30 px-4 py-2 text-xs font-bold tracking-widest text-white">RUN SCREENER →</button>
          </div>
        </div>
      </div>
    </ScanModalShell>
  );
}
