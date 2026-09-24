// lib/scans/__tests__/pmccScanStatusSuffix.test.ts

import { describe, it, expect } from 'vitest';
import { pmccScanStatusSuffix } from '../pmccScanStatusSuffix';
import { earningsRemovalReceipt } from '../pmccEarningsRemoval';

const snap = (min: unknown, max: unknown) => ({ criteria: { shortDelta: { min, max } } });

describe('pmccScanStatusSuffix', () => {
  it('formats a full window with two decimals and an en dash', () => {
    expect(pmccScanStatusSuffix(snap(0.2, 0.35))).toBe(' · Δ 0.20–0.35');
    expect(pmccScanStatusSuffix(snap(0.2, 0.35))).toContain('–');
  });
  it('rounds to two decimals', () => {
    expect(pmccScanStatusSuffix(snap(0.1, 0.3))).toBe(' · Δ 0.10–0.30');
    expect(pmccScanStatusSuffix(snap(0.204, 0.3456))).toBe(' · Δ 0.20–0.35');
  });
  it('orders reversed bounds', () => {
    expect(pmccScanStatusSuffix(snap(0.35, 0.2))).toBe(' · Δ 0.20–0.35');
  });
  it('is empty when the snapshot or window is missing', () => {
    expect(pmccScanStatusSuffix(undefined)).toBe('');
    expect(pmccScanStatusSuffix(null)).toBe('');
    expect(pmccScanStatusSuffix({})).toBe('');
    expect(pmccScanStatusSuffix({ criteria: {} })).toBe('');
    expect(pmccScanStatusSuffix({ criteria: { shortDelta: null } })).toBe('');
  });
  it('is empty and never renders NaN/null/undefined for non-finite values', () => {
    const cases: Array<[unknown, unknown]> = [[NaN, 0.3], [0.2, Infinity], [undefined, 0.3], [0.2, null], ['0.2', 0.3]];
    cases.forEach(([a, b]) => {
      const out = pmccScanStatusSuffix(snap(a, b));
      expect(out).toBe('');
      expect(out).not.toMatch(/NaN|null|undefined/);
    });
  });
});

// Mirrors how the scan-complete status is composed in app/screener/page.tsx.
function completeStatus(count: number, results: Parameters<typeof earningsRemovalReceipt>[0], snapshot: Parameters<typeof pmccScanStatusSuffix>[0]) {
  return `${count} PMCC result${count === 1 ? '' : 's'} ready${earningsRemovalReceipt(results)}${pmccScanStatusSuffix(snapshot)}`;
}

describe('PMCC scan-complete status line', () => {
  it('shows the snapshot delta window and ignores live control edits made after the scan', () => {
    const live = { min: 0.2, max: 0.35 };
    // The scan captures a copy of the live controls, as page.tsx does when building pmccCriteria.
    const snapshot = { criteria: { shortDelta: { min: live.min, max: live.max } } };
    const before = completeStatus(3, [], snapshot);
    expect(before).toBe('3 PMCC results ready · Δ 0.20–0.35');
    live.min = 0.05;
    live.max = 0.6;
    expect(completeStatus(3, [], snapshot)).toBe(before);
  });
  it('places the delta after the earnings-removed suffix', () => {
    const results = [{ pmccEarningsRemoval: { removedCount: 2 } }] as unknown as Parameters<typeof earningsRemovalReceipt>[0];
    expect(completeStatus(1, results, snap(0.2, 0.35))).toBe('1 PMCC result ready · 2 short calls removed for earnings · Δ 0.20–0.35');
  });
  it('omits the suffix when the snapshot has no window', () => {
    expect(completeStatus(1, [], {})).toBe('1 PMCC result ready');
  });
});
