// features/screener/components/scanConfig/CompactControls.tsx
//
// SCAN-MODAL-UX-0001: the compact field pieces shared by the Covered Call and CSP modals. They draw the same
// registry-driven controls as before (same inputs, same accessible names, same quick selects); only the
// spacing, the visible label, and where the help text lives changed.

import type { ReactNode } from 'react';
import type { Lifecycle } from '@/lib/screener/scanConfig/types';
import type { ScanModalTheme } from '../ScanModalShell';
import { CriterionInput } from './CriterionInput';
import { CriterionPills, type CriterionPill } from './CriterionPills';
import { CriterionTipBody, InfoTip } from './InfoTip';
import { LifecycleDot } from './LifecycleDot';

export const COMPACT_INPUT = 'w-16 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-white';

/** The visible name of a control: its dot, its short name, and the "i" with the full explanation. */
export function FieldHead({ lifecycle, fixed, rescan, name, tip, align = 'left', dot = true }: {
  lifecycle: Lifecycle;
  fixed: boolean;
  rescan: boolean;
  name: string;
  tip: ReactNode;
  align?: 'left' | 'right';
  /** False when the caller labels the tag text itself (a field made of two criteria). */
  dot?: boolean;
}) {
  return (
    <div className="flex items-center text-[11px] font-bold text-neutral-200">
      {dot ? <LifecycleDot lifecycle={lifecycle} fixed={fixed} rescan={rescan} /> : <LifecycleDot lifecycle={lifecycle} text={false} />}
      {name}
      <InfoTip align={align}>{tip}</InfoTip>
    </div>
  );
}

export function StatusLine({ message }: { message?: string }) {
  return <span role="status" aria-live="polite" className="block min-h-0 text-[10px] text-red-400">{message ?? ''}</span>;
}

export function CompactRange({ th, groupLabel, minId, maxId, minLabel, maxLabel, minTitle, maxTitle, step, min, max, onMin, onMax, minError, maxError, pills }: {
  th: ScanModalTheme;
  groupLabel: string;
  minId: string; maxId: string;
  minLabel: string; maxLabel: string;
  minTitle: string; maxTitle: string;
  step: string;
  min: number; max: number;
  onMin: (value: number) => void; onMax: (value: number) => void;
  minError?: string; maxError?: string;
  pills: CriterionPill[];
}) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <CriterionInput id={minId} label={minLabel} title={minTitle} step={step} value={min} onValueChange={onMin} hideLabel hideStatus invalid={!!minError} inputClassName={COMPACT_INPUT} />
        <span aria-hidden="true" className="text-neutral-500">–</span>
        <CriterionInput id={maxId} label={maxLabel} title={maxTitle} step={step} value={max} onValueChange={onMax} hideLabel hideStatus invalid={!!maxError} inputClassName={COMPACT_INPUT} />
      </div>
      <StatusLine message={minError} />
      <StatusLine message={maxError} />
      <CriterionPills th={th} groupLabel={groupLabel} pills={pills} compact />
    </>
  );
}

export function CompactRule({ id, label, title, step, value, onValue, suffix, error, widthClass }: {
  id: string;
  label: string;
  title: string;
  step: string;
  value: number;
  onValue: (value: number) => void;
  suffix?: string;
  error?: string;
  widthClass?: string;
}) {
  return (
    <>
      <div className="flex items-center gap-1.5">
        <CriterionInput id={id} label={label} title={title} step={step} value={value} onValueChange={onValue} hideLabel hideStatus invalid={!!error} inputClassName={widthClass ?? COMPACT_INPUT} />
        {suffix ? <span className="text-[10px] text-neutral-500">{suffix}</span> : null}
      </div>
      <StatusLine message={error} />
    </>
  );
}

export { CriterionTipBody };
