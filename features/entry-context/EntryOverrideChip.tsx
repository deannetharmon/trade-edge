// features/entry-context/EntryOverrideChip.tsx
//
// QUAL-STATES-0001: the Trade Log's marker for a trade that was entered against the scan's verdict.
// Only Caution and Disqualified entries show a chip; Qualified entries and trades with no record show
// nothing. The record comes from the trade's entry snapshot (spreads) or entry note (cash-secured puts).

'use client';

import type { EntryQualificationRecord } from '@/lib/entry-context/entryQualification';
import type { CreditSpreadEntrySnapshot, IronCondorEntrySnapshot } from '@/lib/entry-context/types';
import type { EntryNote } from '@/lib/entry-context/entryNote';
import { findEntryNoteForTrade } from '@/lib/entry-context/entryNote';
import { findSnapshotForTrade } from '@/lib/entry-context/performance';
import type { ClosedTrade } from '@/lib/tradeLog/types';

type EntrySnapshot = CreditSpreadEntrySnapshot | IronCondorEntrySnapshot;

/** The screener's verdict at entry for a closed trade, from its snapshot or its note. */
export function qualificationForTrade(
  trade: ClosedTrade,
  snapshotIndex: Map<string, EntrySnapshot>,
  noteIndex: Map<string, EntryNote>,
): EntryQualificationRecord | undefined {
  return findSnapshotForTrade(trade, snapshotIndex)?.entryQualification ?? findEntryNoteForTrade(trade, noteIndex)?.entryQualification;
}

export interface EntryOverrideSummary {
  label: string;
  title: string;
  tone: 'amber' | 'red';
}

export function summarizeEntryQualification(q: EntryQualificationRecord | null | undefined): EntryOverrideSummary | null {
  if (!q || q.state === 'qualified') return null;
  const reasons = [...q.failing.map(r => `✕ ${r.text}`), ...q.warning.map(r => `⚠ ${r.text}`)];
  const when = q.acknowledgedAt ? `\nAcknowledged ${q.acknowledgedAt}` : '';
  return q.state === 'disqualified'
    ? { label: q.overridden ? 'Overrode scan' : 'Disqualified', tone: 'red', title: `${reasons.join('\n')}${when}` }
    : { label: q.overridden ? 'Entered on caution' : 'Caution', tone: 'amber', title: `${reasons.join('\n')}${when}` };
}

/** One line for spreadsheets: the entry state plus each reason. */
export function entryQualificationCsv(q: EntryQualificationRecord | null | undefined): { state: string; overrides: string } {
  if (!q) return { state: '', overrides: '' };
  const parts = [...q.failing.map(r => `FAIL ${r.text}`), ...q.warning.map(r => `WARN ${r.text}`)];
  return { state: q.state, overrides: q.overridden ? parts.join(' | ') : '' };
}

export function EntryOverrideChip({ qualification }: { qualification: EntryQualificationRecord | null | undefined }) {
  const summary = summarizeEntryQualification(qualification);
  if (!summary) return null;
  const tone = summary.tone === 'red' ? 'border-red-600 text-red-400 bg-red-500/10' : 'border-amber-500 text-amber-400 bg-amber-500/10';
  return (
    <span data-testid="entry-override-chip" title={summary.title} className={`ml-1.5 text-[9px] px-1.5 py-0.5 border rounded font-bold ${tone}`}>
      {summary.label}
    </span>
  );
}
