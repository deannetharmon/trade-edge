// features/portfolio/positions-workspace/__tests__/leapsCloseSummary.test.ts

import { describe, expect, it } from 'vitest';
import { summarizeLeapsClose } from '../model/leapsCloseSummary';
import type { ExistingIncomeOpportunity } from '../model/types';

const leaps = (entry: number | null, closeValue: number | null, extra: Partial<ExistingIncomeOpportunity> = {}) => ({
  kind: 'pmcc-short-call', heldPmccLong: { expiration: '2027-09-17', dte: 328, strike: 60, quantity: 1, entryDebitPerShare: entry, closeValue },
  ...extra,
}) as unknown as ExistingIncomeOpportunity;

describe('summarizeLeapsClose', () => {
  it('sums what closing every LEAPS now would realize against what was paid', () => {
    const s = summarizeLeapsClose([leaps(21.3, 1025), leaps(20.85, 830)])!;
    expect(s.paid).toBe(4215); expect(s.back).toBe(1855); expect(s.result).toBe(-2360);
    expect(s.resultPct).toBeCloseTo(-55.99, 1);
  });
  it('needs two LEAPS with a bid and an entry cost, so a single or unpriced position never shows a misleading total', () => {
    expect(summarizeLeapsClose([leaps(21.3, 1025)])).toBeNull();
    expect(summarizeLeapsClose([leaps(21.3, 1025), leaps(20.85, null)])).toBeNull();
    expect(summarizeLeapsClose([leaps(21.3, 1025), leaps(null, 830)])).toBeNull();
  });
  it('counts the unpriced one as not included when three are held', () => {
    const s = summarizeLeapsClose([leaps(21.3, 1025), leaps(20.85, 830), leaps(10, null)])!;
    expect(s.count).toBe(2); expect(s.of).toBe(3);
  });
  it('leaves out a LEAPS that already has a short call (a PMCC pair is not a plain close)', () => {
    expect(summarizeLeapsClose([leaps(21.3, 1025), leaps(20.85, 830, { pairedShort: { positionKey: 'x' } as never })])).toBeNull();
  });
});
