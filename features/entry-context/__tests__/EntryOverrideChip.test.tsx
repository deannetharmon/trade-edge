// features/entry-context/__tests__/EntryOverrideChip.test.tsx

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EntryOverrideChip, entryQualificationCsv, summarizeEntryQualification } from '../EntryOverrideChip';
import { buildEntryQualification } from '@/lib/entry-context/entryQualification';
import type { CreditSpreadEntrySnapshot } from '@/lib/entry-context/types';

const at = '2026-09-25T15:00:00.000Z';
const snap = (state: 'qualified' | 'caution' | 'disqualified', acknowledged = true): CreditSpreadEntrySnapshot => ({
  entryQualification: buildEntryQualification({
    state, failing: state === 'disqualified' ? ['ivr'] : [], warning: state === 'qualified' ? [] : ['oi'],
    reasonFor: key => (key === 'ivr' ? 'IVR 3.7% below the floor' : 'low OI 208/371'), acknowledged, at, scanMode: 'rank',
  }),
}) as unknown as CreditSpreadEntrySnapshot;

describe('Trade Log entry override chip', () => {
  it('shows nothing for qualified entries, missing records, and missing snapshots', () => {
    expect(summarizeEntryQualification(snap('qualified'))).toBeNull();
    expect(summarizeEntryQualification({} as CreditSpreadEntrySnapshot)).toBeNull();
    expect(summarizeEntryQualification(null)).toBeNull();
    const { container } = render(<EntryOverrideChip snapshot={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('marks an overridden disqualified entry in red with every reason in the tooltip', () => {
    const s = summarizeEntryQualification(snap('disqualified'))!;
    expect(s).toMatchObject({ label: 'Overrode scan', tone: 'red' });
    expect(s.title).toContain('✕ IVR 3.7% below the floor');
    expect(s.title).toContain('⚠ low OI 208/371');
    expect(s.title).toContain(`Acknowledged ${at}`);
  });
  it('marks a caution entry in amber', () => {
    expect(summarizeEntryQualification(snap('caution'))).toMatchObject({ label: 'Entered on caution', tone: 'amber' });
    render(<EntryOverrideChip snapshot={snap('caution')} />);
    expect(screen.getByTestId('entry-override-chip')).toHaveTextContent('Entered on caution');
  });
  it('CSV columns: state always, overrides only when the trader overrode', () => {
    expect(entryQualificationCsv(snap('disqualified'))).toEqual({ state: 'disqualified', overrides: 'FAIL IVR 3.7% below the floor | WARN low OI 208/371' });
    expect(entryQualificationCsv(snap('caution', false))).toEqual({ state: 'caution', overrides: '' });
    expect(entryQualificationCsv(undefined)).toEqual({ state: '', overrides: '' });
  });
});
