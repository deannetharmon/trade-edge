// features/entry-context/__tests__/EntryOverrideChip.test.tsx

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EntryOverrideChip, entryQualificationCsv, qualificationForTrade, summarizeEntryQualification } from '../EntryOverrideChip';
import { buildEntryQualification } from '@/lib/entry-context/entryQualification';
import { buildEntryNoteIndex, type EntryNote } from '@/lib/entry-context/entryNote';
import type { CreditSpreadEntrySnapshot } from '@/lib/entry-context/types';
import type { ClosedTrade } from '@/lib/tradeLog/types';

const at = '2026-09-25T15:00:00.000Z';
const rec = (state: 'qualified' | 'caution' | 'disqualified', acknowledged = true) => buildEntryQualification({
  state, failing: state === 'disqualified' ? ['ivr'] : [], warning: state === 'qualified' ? [] : ['oi'],
  reasonFor: key => (key === 'ivr' ? 'IVR 3.7% below the floor' : 'low OI 208/371'), acknowledged, at, scanMode: 'rank',
});

describe('Trade Log entry override chip', () => {
  it('shows nothing for qualified entries and for missing records', () => {
    expect(summarizeEntryQualification(rec('qualified'))).toBeNull();
    expect(summarizeEntryQualification(undefined)).toBeNull();
    expect(summarizeEntryQualification(null)).toBeNull();
    const { container } = render(<EntryOverrideChip qualification={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('marks an overridden disqualified entry in red with every reason in the tooltip', () => {
    const s = summarizeEntryQualification(rec('disqualified'))!;
    expect(s).toMatchObject({ label: 'Overrode scan', tone: 'red' });
    expect(s.title).toContain('✕ IVR 3.7% below the floor');
    expect(s.title).toContain('⚠ low OI 208/371');
    expect(s.title).toContain(`Acknowledged ${at}`);
  });
  it('marks a caution entry in amber', () => {
    expect(summarizeEntryQualification(rec('caution'))).toMatchObject({ label: 'Entered on caution', tone: 'amber' });
    render(<EntryOverrideChip qualification={rec('caution')} />);
    expect(screen.getByTestId('entry-override-chip')).toHaveTextContent('Entered on caution');
  });
  it('CSV columns: state always, overrides only when the trader overrode', () => {
    expect(entryQualificationCsv(rec('disqualified'))).toEqual({ state: 'disqualified', overrides: 'FAIL IVR 3.7% below the floor | WARN low OI 208/371' });
    expect(entryQualificationCsv(rec('caution', false))).toEqual({ state: 'caution', overrides: '' });
    expect(entryQualificationCsv(undefined)).toEqual({ state: '', overrides: '' });
  });
});

describe('qualificationForTrade', () => {
  const trade = { sourceTransactionIds: ['t1', 't2'] } as unknown as ClosedTrade;
  const snapshotFor = (ids: string[], q = rec('disqualified')): CreditSpreadEntrySnapshot => ({ entrySnapshotId: `s:${ids.join()}`, sourceTransactionIds: ids, entryQualification: q }) as unknown as CreditSpreadEntrySnapshot;
  const noteFor = (ids: string[], q = rec('caution')): EntryNote => ({ entryNoteId: `n:${ids.join()}`, sourceTransactionIds: ids, entryQualification: q }) as unknown as EntryNote;
  const snapIndex = (snaps: CreditSpreadEntrySnapshot[]) => { const m = new Map<string, CreditSpreadEntrySnapshot>(); snaps.forEach(s => s.sourceTransactionIds.forEach(id => m.set(id, s))); return m; };

  it('reads the record from the entry snapshot when there is one', () => {
    expect(qualificationForTrade(trade, snapIndex([snapshotFor(['t1', 't2'])]), buildEntryNoteIndex([]))?.state).toBe('disqualified');
  });
  it('falls back to the entry note (cash-secured puts have no snapshot)', () => {
    expect(qualificationForTrade(trade, snapIndex([]), buildEntryNoteIndex([noteFor(['t1'])]))?.state).toBe('caution');
  });
  it('a note covering a transaction outside this trade is not attributed to it (exact match only)', () => {
    expect(qualificationForTrade(trade, snapIndex([]), buildEntryNoteIndex([noteFor(['t1', 'other'])]))).toBeUndefined();
  });
  it('returns nothing when neither exists', () => {
    expect(qualificationForTrade(trade, snapIndex([]), buildEntryNoteIndex([]))).toBeUndefined();
  });
});
