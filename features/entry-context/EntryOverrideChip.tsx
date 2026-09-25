// features/entry-context/EntryOverrideChip.tsx
//
// QUAL-STATES-0001 phase 2: the Trade Log's marker for a trade that was entered against the
// scan's verdict. Only Caution and Disqualified entries show a chip; Qualified entries and
// trades with no record show nothing.

'use client';

import type { CreditSpreadEntrySnapshot, IronCondorEntrySnapshot } from '@/lib/entry-context/types';

type EntrySnapshot = CreditSpreadEntrySnapshot | IronCondorEntrySnapshot;

export interface EntryOverrideSummary {
  label: string;
  title: string;
  tone: 'amber' | 'red';
}

export function summarizeEntryQualification(snapshot: EntrySnapshot | null | undefined): EntryOverrideSummary | null {
  const q = snapshot?.entryQualification;
  if (!q || q.state === 'qualified') return null;
  const reasons = [...q.failing.map(r => `✕ ${r.text}`), ...q.warning.map(r => `⚠ ${r.text}`)];
  const when = q.acknowledgedAt ? `\nAcknowledged ${q.acknowledgedAt}` : '';
  return q.state === 'disqualified'
    ? { label: q.overridden ? 'Overrode scan' : 'Disqualified', tone: 'red', title: `${reasons.join('\n')}${when}` }
    : { label: q.overridden ? 'Entered on caution' : 'Caution', tone: 'amber', title: `${reasons.join('\n')}${when}` };
}

/** One line for spreadsheets: the entry state plus each reason. */
export function entryQualificationCsv(snapshot: EntrySnapshot | null | undefined): { state: string; overrides: string } {
  const q = snapshot?.entryQualification;
  if (!q) return { state: '', overrides: '' };
  const parts = [...q.failing.map(r => `FAIL ${r.text}`), ...q.warning.map(r => `WARN ${r.text}`)];
  return { state: q.state, overrides: q.overridden ? parts.join(' | ') : '' };
}

export function EntryOverrideChip({ snapshot }: { snapshot: EntrySnapshot | null | undefined }) {
  const summary = summarizeEntryQualification(snapshot);
  if (!summary) return null;
  const tone = summary.tone === 'red' ? 'border-red-600 text-red-400 bg-red-500/10' : 'border-amber-500 text-amber-400 bg-amber-500/10';
  return (
    <span data-testid="entry-override-chip" title={summary.title} className={`ml-1.5 text-[9px] px-1.5 py-0.5 border rounded font-bold ${tone}`}>
      {summary.label}
    </span>
  );
}
