// lib/scans/__tests__/assignmentCash.test.ts

import { describe, expect, it } from 'vitest';
import {
  evaluateAssignmentCash, guardAssignmentCash, tierForUtilization, usableCashAfterReserve,
  type AssignmentCashInput,
} from '../assignmentCash';

const shortPut = (strike: number, quantity: number) => ({
  legs: [{ symbol: 'X', optionType: 'P' as const, strikePrice: strike, direction: 'Short' as const, quantity, avgOpenPrice: 1, currentPrice: 1 }],
});

const base = (over: Partial<AssignmentCashInput> = {}): AssignmentCashInput => ({
  cashBalance: 100000,
  reserve: { kind: 'percent', value: 0 }, // usable = 100,000 so utilization is easy to read
  positions: [],
  pendingOrders: [],
  proposed: { opens: [], closes: [] },
  ...over,
});

/** Order that opens one put sized so assignment cash lands exactly on `dollars` (strike 100 x 100 x contracts). */
const opening = (dollars: number) => ({ opens: [{ strike: dollars / 100, contracts: 1 }], closes: [] });

describe('obligation basis', () => {
  it('counts strike x 100 x contracts for every open short put, not max risk', () => {
    const r = evaluateAssignmentCash(base({ positions: [shortPut(50, 2), shortPut(30, 1)] }));
    expect(r.assignmentCashBefore).toBe(50 * 100 * 2 + 30 * 100);
  });
  it('ignores long puts and short calls', () => {
    const positions = [{ legs: [
      { symbol: 'A', optionType: 'P' as const, strikePrice: 40, direction: 'Long' as const, quantity: 1, avgOpenPrice: 1, currentPrice: 1 },
      { symbol: 'B', optionType: 'C' as const, strikePrice: 40, direction: 'Short' as const, quantity: 1, avgOpenPrice: 1, currentPrice: 1 },
    ] }];
    expect(evaluateAssignmentCash(base({ positions })).assignmentCashBefore).toBe(0);
  });
  it('does not net a long put against a short put', () => {
    const positions = [{ legs: [
      { symbol: 'S', optionType: 'P' as const, strikePrice: 50, direction: 'Short' as const, quantity: 1, avgOpenPrice: 1, currentPrice: 1 },
      { symbol: 'L', optionType: 'P' as const, strikePrice: 45, direction: 'Long' as const, quantity: 1, avgOpenPrice: 1, currentPrice: 1 },
    ] }];
    expect(evaluateAssignmentCash(base({ positions })).assignmentCashBefore).toBe(5000);
  });
  it('adds working sell-to-open puts and ignores working closing orders', () => {
    const pendingOrders = [
      { id: 'o1', legs: [{ symbol: 'P', action: 'Sell to Open', optionType: 'P' as const, strikePrice: 20, quantity: 3 }] },
      { id: 'o2', legs: [{ symbol: 'P', action: 'Buy to Close', optionType: 'P' as const, strikePrice: 20, quantity: 3 }] },
    ];
    expect(evaluateAssignmentCash(base({ pendingOrders })).assignmentCashBefore).toBe(6000);
  });
  it('does not double count a working order the proposed order replaces', () => {
    const pendingOrders = [{ id: 'o1', legs: [{ symbol: 'P', action: 'Sell to Open', optionType: 'P' as const, strikePrice: 20, quantity: 3 }] }];
    const r = evaluateAssignmentCash(base({ pendingOrders, proposed: { opens: [{ strike: 20, contracts: 3 }], closes: [], replacesOrderIds: ['o1'] } }));
    expect(r.assignmentCashBefore).toBe(0);
    expect(r.assignmentCashAfter).toBe(6000);
  });
});

describe('usable cash after reserve', () => {
  it('applies a percent reserve to cash', () => {
    expect(usableCashAfterReserve(100000, { kind: 'percent', value: 5 })).toBe(95000);
  });
  it('applies a fixed reserve', () => {
    expect(usableCashAfterReserve(100000, { kind: 'fixed', value: 7500 })).toBe(92500);
  });
  it('rejects an invalid reserve', () => {
    expect(usableCashAfterReserve(100000, { kind: 'percent', value: 101 })).toBeNull();
    expect(usableCashAfterReserve(100000, { kind: 'fixed', value: -1 })).toBeNull();
  });
});

describe('tier boundaries (compared unrounded)', () => {
  it.each([
    [0.699999, 'none'],
    [0.7, 'warn'],
    [0.899999, 'warn'],
    [0.9, 'acknowledge'],
    [1.0, 'acknowledge'],
    [1.0000001, 'blocked'],
  ])('utilization %s is %s', (u, tier) => {
    expect(tierForUtilization(u as number)).toBe(tier);
  });

  it('evaluates 69.9% as none, 70.0% as warn, 90.0% and 100.0% as acknowledge, 100.01% as blocked', () => {
    expect(evaluateAssignmentCash(base({ proposed: opening(69900) })).tier).toBe('none');
    expect(evaluateAssignmentCash(base({ proposed: opening(70000) })).tier).toBe('warn');
    expect(evaluateAssignmentCash(base({ proposed: opening(90000) })).tier).toBe('acknowledge');
    const at100 = evaluateAssignmentCash(base({ proposed: opening(100000) }));
    expect(at100.tier).toBe('acknowledge');
    expect(at100.submit).toBe('needs_acknowledgment');
    const over = evaluateAssignmentCash(base({ proposed: opening(100010) }));
    expect(over.tier).toBe('blocked');
    expect(over.submit).toBe('blocked');
  });
});

describe('submit state', () => {
  it('allows below the acknowledgment band, including the warn band', () => {
    expect(evaluateAssignmentCash(base({ proposed: opening(75000) })).submit).toBe('allowed');
  });
  it('reports surplus and shortfall with the right sign', () => {
    expect(evaluateAssignmentCash(base({ proposed: opening(60000) })).surplusShortfall).toBe(40000);
    expect(evaluateAssignmentCash(base({ proposed: opening(110000) })).surplusShortfall).toBe(-10000);
  });
  it('over 100% with margin-backed off blocks; on requires the borrowing confirmation for the shortfall', () => {
    const off = evaluateAssignmentCash(base({ proposed: opening(110000) }));
    expect(off.submit).toBe('blocked');
    const on = evaluateAssignmentCash(base({ proposed: opening(110000), marginBackedEnabled: true }));
    expect(on.submit).toBe('needs_borrowing_confirmation');
    expect(on.borrowedAmount).toBe(10000);
    expect(guardAssignmentCash(on, { acknowledged: true, borrowingConfirmed: false }).allowed).toBe(false);
    expect(guardAssignmentCash(on, { acknowledged: false, borrowingConfirmed: true }).allowed).toBe(true);
  });
  it('the guard rejects an unacknowledged acknowledgment-band order and accepts an acknowledged one', () => {
    const r = evaluateAssignmentCash(base({ proposed: opening(95000) }));
    expect(guardAssignmentCash(r, { acknowledged: false, borrowingConfirmed: false }).allowed).toBe(false);
    expect(guardAssignmentCash(r, { acknowledged: true, borrowingConfirmed: false }).allowed).toBe(true);
  });
});

describe('adjustments', () => {
  it('a close lowers the obligation and is never blocked, even when the account is already over 100%', () => {
    const r = evaluateAssignmentCash(base({
      positions: [shortPut(1200, 1)], // 120,000 against 100,000 usable
      proposed: { opens: [], closes: [{ strike: 1200, contracts: 1 }] },
    }));
    expect(r.assignmentCashBefore).toBe(120000);
    expect(r.assignmentCashAfter).toBe(0);
    expect(r.reducesObligation).toBe(true);
    expect(r.submit).toBe('allowed');
  });
  it('a partial close that leaves the account over 100% is still allowed', () => {
    const r = evaluateAssignmentCash(base({
      positions: [shortPut(600, 2)], // 120,000
      proposed: { opens: [], closes: [{ strike: 600, contracts: 1 }] }, // 60,000
    }));
    expect(r.assignmentCashAfter).toBe(60000);
    expect(r.submit).toBe('allowed');
  });
  it('a roll subtracts the closed leg and adds the new leg', () => {
    const r = evaluateAssignmentCash(base({
      positions: [shortPut(50, 2)], // 10,000
      proposed: { opens: [{ strike: 55, contracts: 2 }], closes: [{ strike: 50, contracts: 2 }] },
    }));
    expect(r.assignmentCashBefore).toBe(10000);
    expect(r.assignmentCashAfter).toBe(11000);
    expect(r.reducesObligation).toBe(false);
  });
  it('a roll to a lower strike that stays over 100% is allowed because it reduces the obligation', () => {
    const r = evaluateAssignmentCash(base({
      positions: [shortPut(650, 2)], // 130,000
      proposed: { opens: [{ strike: 600, contracts: 2 }], closes: [{ strike: 650, contracts: 2 }] }, // 120,000
    }));
    expect(r.utilization).toBeGreaterThan(1);
    expect(r.submit).toBe('allowed');
  });
});

describe('zero or negative usable cash', () => {
  it('blocks any new short put', () => {
    const r = evaluateAssignmentCash(base({ cashBalance: 0, proposed: { opens: [{ strike: 10, contracts: 1 }], closes: [] } }));
    expect(r.utilization).toBeNull();
    expect(r.tier).toBe('blocked');
    expect(r.submit).toBe('blocked');
    expect(r.surplusShortfall).toBe(-1000);
  });
  it('blocks when cash is negative', () => {
    const r = evaluateAssignmentCash(base({ cashBalance: -500, proposed: { opens: [{ strike: 10, contracts: 1 }], closes: [] } }));
    expect(r.submit).toBe('blocked');
  });
  it('lets a close through', () => {
    const r = evaluateAssignmentCash(base({ cashBalance: 0, positions: [shortPut(10, 1)], proposed: { opens: [], closes: [{ strike: 10, contracts: 1 }] } }));
    expect(r.submit).toBe('allowed');
  });
});

describe('cannot verify (fail closed)', () => {
  it.each([
    ['cash balance', { cashBalance: null }],
    ['positions', { positions: null }],
    ['working orders', { pendingOrders: null }],
  ])('blocks when %s fail to load', (_name, over) => {
    const r = evaluateAssignmentCash(base(over as Partial<AssignmentCashInput>));
    expect(r.tier).toBe('cannot_verify');
    expect(r.submit).toBe('cannot_verify');
    expect(guardAssignmentCash(r, { acknowledged: true, borrowingConfirmed: true }).allowed).toBe(false);
  });
  it('never treats a missing working-order quantity as 1', () => {
    const pendingOrders = [{ id: 'o1', legs: [{ symbol: 'P', action: 'Sell to Open', optionType: 'P' as const, strikePrice: 20, quantity: undefined as unknown as number }] }];
    expect(evaluateAssignmentCash(base({ pendingOrders })).submit).toBe('cannot_verify');
  });
  it('blocks on an invalid reserve setting', () => {
    expect(evaluateAssignmentCash(base({ reserve: { kind: 'percent', value: -5 } })).submit).toBe('cannot_verify');
  });
  it('blocks on an invalid proposed quantity', () => {
    expect(evaluateAssignmentCash(base({ proposed: { opens: [{ strike: 50, contracts: 0 }], closes: [] } })).submit).toBe('cannot_verify');
  });
  it('margin-backed does not override cannot_verify', () => {
    expect(evaluateAssignmentCash(base({ cashBalance: null, marginBackedEnabled: true })).submit).toBe('cannot_verify');
  });
});

describe('reserve interaction', () => {
  it('uses cash minus the 5% default reserve as the denominator', () => {
    const r = evaluateAssignmentCash(base({ reserve: { kind: 'percent', value: 5 }, proposed: opening(95000) }));
    expect(r.usableCash).toBe(95000);
    expect(r.utilization).toBe(1);
    expect(r.tier).toBe('acknowledge');
  });
});
