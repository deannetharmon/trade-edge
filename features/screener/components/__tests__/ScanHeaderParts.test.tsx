// features/screener/components/__tests__/ScanHeaderParts.test.tsx

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { formatScanAge, QualificationCounts, ScanProvenanceChip } from '../ScanHeaderParts';

describe('SCAN-HEADER-0001 shared header parts', () => {
  it('formats the age of the scan data in minutes, then hours, never negative', () => {
    const now = 1_000_000_000_000;
    expect(formatScanAge(now, now)).toBe('0m ago');
    expect(formatScanAge(now - 3 * 60_000, now)).toBe('3m ago');
    expect(formatScanAge(now - 59 * 60_000, now)).toBe('59m ago');
    expect(formatScanAge(now - 2 * 3_600_000, now)).toBe('2h ago');
    expect(formatScanAge(now + 5 * 60_000, now)).toBe('0m ago');
  });

  it('shows one chip wording for live and restored results, with the icon and tooltip telling them apart', () => {
    const { rerender } = render(<ScanProvenanceChip completedAt={Date.now()} restored={false} />);
    const live = screen.getByTestId('scan-provenance-chip');
    expect(live).toHaveTextContent(/⚡ scan 0m ago/);
    expect(live).toHaveAttribute('title', expect.stringContaining('this session'));
    rerender(<ScanProvenanceChip completedAt={Date.now() - 3 * 60_000} restored />);
    const restored = screen.getByTestId('scan-provenance-chip');
    expect(restored).toHaveTextContent(/↺ scan 3m ago/);
    expect(restored).toHaveAttribute('title', expect.stringContaining('restored'));
    expect(restored).not.toHaveTextContent(/cached|restored/i);
  });

  it('leads with qualified then disqualified, as absolute counts', () => {
    render(<div><QualificationCounts qualified={0} disqualified={4224} /></div>);
    expect(screen.getByText('0 QUALIFIED')).toBeInTheDocument();
    expect(screen.getByText('4224 DISQUALIFIED')).toBeInTheDocument();
  });

  it('allows the second label to be renamed (LEAPS-style)', () => {
    render(<div><QualificationCounts qualified={8} disqualified={2} disqualifiedLabel="INSUFFICIENT DATA" /></div>);
    expect(screen.getByText('2 INSUFFICIENT DATA')).toBeInTheDocument();
  });
});
