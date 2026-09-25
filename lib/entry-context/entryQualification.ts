// lib/entry-context/entryQualification.ts
//
// QUAL-STATES-0001 phase 2: what the screener said about a trade at the moment the order was
// placed, and whether the trader acknowledged and overrode it. Stored with the pending entry,
// carried into the immutable entry snapshot when the fill is confirmed, and shown in the Trade Log.

import type { QualificationState } from '@/lib/scans/qualificationState';

export interface EntryQualificationReason {
  key: string;
  /** Human text with the real numbers, e.g. "IVR 3.7% below the floor: Below 30% minimum". */
  text: string;
}

export interface EntryQualificationRecord {
  state: QualificationState;
  failing: EntryQualificationReason[];
  warning: EntryQualificationReason[];
  /** True when the order was placed after acknowledging a Caution or Disqualified state. */
  overridden: boolean;
  acknowledgedAt: string | null;
  scanMode: 'rank' | 'targeted' | null;
}

export interface BuildEntryQualificationInput {
  state: QualificationState;
  failing: readonly string[];
  warning: readonly string[];
  reasonFor: (key: string) => string;
  acknowledged: boolean;
  at: string;
  scanMode: 'rank' | 'targeted' | null;
}

export function buildEntryQualification(input: BuildEntryQualificationInput): EntryQualificationRecord {
  const overridden = input.state !== 'qualified' && input.acknowledged;
  return {
    state: input.state,
    failing: input.failing.map(key => ({ key, text: input.reasonFor(key) })),
    warning: input.warning.map(key => ({ key, text: input.reasonFor(key) })),
    overridden,
    acknowledgedAt: input.acknowledged ? input.at : null,
    scanMode: input.scanMode,
  };
}

const STATES = new Set(['qualified', 'caution', 'disqualified']);

function sanitizeReasons(value: unknown): EntryQualificationReason[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const out: EntryQualificationReason[] = [];
  for (const item of value) {
    if (item == null || typeof item !== 'object') return null;
    const { key, text } = item as Record<string, unknown>;
    if (typeof key !== 'string' || typeof text !== 'string') return null;
    out.push({ key: key.slice(0, 40), text: text.slice(0, 300) });
  }
  return out;
}

/** Keeps only a well-formed record; anything malformed is dropped (the order is already placed, so never throw). */
export function sanitizeEntryQualification(input: unknown): EntryQualificationRecord | undefined {
  if (input == null || typeof input !== 'object') return undefined;
  const r = input as Record<string, unknown>;
  if (typeof r.state !== 'string' || !STATES.has(r.state)) return undefined;
  const failing = sanitizeReasons(r.failing);
  const warning = sanitizeReasons(r.warning);
  if (!failing || !warning || typeof r.overridden !== 'boolean') return undefined;
  if (r.acknowledgedAt != null && typeof r.acknowledgedAt !== 'string') return undefined;
  const scanMode = r.scanMode === 'rank' || r.scanMode === 'targeted' ? r.scanMode : null;
  return {
    state: r.state as QualificationState,
    failing, warning,
    overridden: r.overridden,
    acknowledgedAt: typeof r.acknowledgedAt === 'string' ? r.acknowledgedAt : null,
    scanMode,
  };
}
