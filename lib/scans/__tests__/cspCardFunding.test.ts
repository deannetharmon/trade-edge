// lib/scans/__tests__/cspCardFunding.test.ts

// CSP-CAP-BASIS-0001A -- golden fixtures (Alan) and stale-data / manual-limit cases (Quinn) for the funding figures a CSP
// result card shows. The live case is Dean's 2026-11-05 account: cash $25,197.86, five short puts = $24,250 obligation,
// USO 140P (cash required $14,000) -> shortfall $14,312.03, 159.8% of usable cash.

import { describe, expect, it } from 'vitest';
import type { PendingOrder, Position } from '@/lib/portfolio-data/types';
import { buildCspCardFunding, fundingFailReasons, fundingMoney, type CspCardFundingInput } from '../cspCardFunding';
import { evaluateAssignmentCash } from '../assignmentCash';
import { summarizeFailReason } from '@/lib/screener/failReasonSummary';

const shortPut = (strike: number, quantity = 1) =>
  ({ legs: [{ symbol: 'X', optionType: 'P', strikePrice: strike, direction: 'Short', quantity, avgOpenPrice: 1, currentPrice: 1 }] }) as unknown as Position;
const working = (id: string, action: string, strike: number, quantity: number | undefined) =>
  ({ id, legs: [{ symbol: 'P', action, optionType: 'P', strikePrice: strike, quantity }] }) as unknown as PendingOrder;

const LIVE_POSITIONS = [shortPut(28.5), shortPut(90), shortPut(75), shortPut(28), shortPut(21)]; // 24,250 total

const input = (over: Partial<CspCardFundingInput> = {}): CspCardFundingInput => ({
  strike: 140, contracts: 1, cashBalance: 25197.86, reserve: { kind: 'percent', value: 5 },
  positions: LIVE_POSITIONS, pendingOrders: [], optionBuyingPower: 5767.89, manualLimit: null, asOfMs: 1_000, ...over,
});

describe('live case (2026-11-05)', () => {
  const f = buildCspCardFunding(input());
  it('matches the order dialog to the cent', () => {
    expect(f.status).toBe('not_fundable');
    expect(f.requiredCash).toBe(14000);
    expect(f.assignmentCashBefore).toBe(24250);
    expect(f.assignmentCashAfter).toBe(38250);
    expect(fundingMoney(f.usableCash as number)).toBe('$23,937.97');
    expect(fundingMoney(Math.abs(f.surplusShortfall as number))).toBe('$14,312.03');
    expect(((f.utilization as number) * 100).toFixed(1)).toBe('159.8');
  });
  it('has no room left for a new put when obligation already exceeds usable cash', () => {
    expect(f.room).toBe(0);
  });
  it('keeps the broker buying power as an advisory line only', () => {
    expect(f.buyingPowerAdvisory).toBe('Broker buying power $5,767.89; the broker may not accept this order.');
  });
});

describe('same numbers as the dialog (one module, same inputs)', () => {
  it.each([
    ['live case', input()],
    ['cash only', input({ positions: [], strike: 50 })],
    ['working order counted', input({ positions: [shortPut(20)], pendingOrders: [working('o1', 'Sell to Open', 30, 2)], strike: 40 })],
  ])('%s', (_name, i) => {
    const f = buildCspCardFunding(i);
    const d = evaluateAssignmentCash({
      cashBalance: i.cashBalance, reserve: i.reserve, positions: i.positions, pendingOrders: i.pendingOrders,
      proposed: { opens: [{ strike: i.strike, contracts: i.contracts }], closes: [] },
    });
    expect(f.surplusShortfall).toBe(d.surplusShortfall);
    expect(f.assignmentCashAfter).toBe(d.assignmentCashAfter);
    expect(f.usableCash).toBe(d.usableCash);
  });
});

describe('funded cases', () => {
  it('cash only, surplus', () => {
    const f = buildCspCardFunding(input({ positions: [], strike: 50 }));
    expect(f.status).toBe('funded');
    expect(f.assignmentCashAfter).toBe(5000);
    expect(f.surplusShortfall).toBeCloseTo(23937.967 - 5000, 3);
    expect(f.room).toBeCloseTo(23937.967, 3);
  });
  it('cash plus short puts, under 70% and between 70% and 90% of usable cash', () => {
    const low = buildCspCardFunding(input({ positions: [shortPut(50)], strike: 50 })); // 10,000 / 23,937.97 = 41.8%
    const mid = buildCspCardFunding(input({ positions: [shortPut(80)], strike: 80 })); // 16,000 / 23,937.97 = 66.8%
    const high = buildCspCardFunding(input({ positions: [shortPut(90)], strike: 80 })); // 17,000 / 23,937.97 = 71.0%
    expect(low.status).toBe('funded');
    expect(mid.status).toBe('funded');
    expect(high.status).toBe('funded');
    expect((high.utilization as number)).toBeGreaterThan(0.7);
    expect((mid.utilization as number)).toBeLessThan(0.7);
  });
  it('exactly 100% of usable cash is still funded (the dialog treats 100% as the acknowledgment band, not blocked)', () => {
    const f = buildCspCardFunding(input({ cashBalance: 10000, reserve: { kind: 'fixed', value: 0 }, positions: [], strike: 100 }));
    expect(f.status).toBe('funded');
    expect(f.utilization).toBe(1);
  });
});

describe('working orders and reserve', () => {
  it('counts a working sell-to-open put and ignores a working closing order', () => {
    const f = buildCspCardFunding(input({
      positions: [], strike: 10,
      pendingOrders: [working('o1', 'Sell to Open', 30, 2), working('o2', 'Buy to Close', 60, 5)],
    }));
    expect(f.assignmentCashBefore).toBe(6000);
    expect(f.assignmentCashAfter).toBe(7000);
  });
  it('reserve as a fixed amount', () => {
    const f = buildCspCardFunding(input({ cashBalance: 30000, reserve: { kind: 'fixed', value: 2500 }, positions: [], strike: 100 }));
    expect(f.usableCash).toBe(27500);
    expect(f.surplusShortfall).toBe(17500);
  });
  it('reserve as a percent', () => {
    const f = buildCspCardFunding(input({ cashBalance: 30000, reserve: { kind: 'percent', value: 10 }, positions: [], strike: 100 }));
    expect(f.usableCash).toBe(27000);
  });
});

describe('fails closed', () => {
  it.each([
    ['cash balance', { cashBalance: null }],
    ['open positions', { positions: null }],
    ['working orders', { pendingOrders: null }],
  ])('a missing %s is cannot_verify, never a number', (_name, over) => {
    const f = buildCspCardFunding(input(over as Partial<CspCardFundingInput>));
    expect(f.status).toBe('cannot_verify');
    expect(f.surplusShortfall).toBeNull();
    expect(f.usableCash).toBeNull();
    expect(f.reasons.length).toBeGreaterThan(0);
  });
  it('a missing working-order quantity is cannot_verify, never read as 1', () => {
    const f = buildCspCardFunding(input({ positions: [], pendingOrders: [working('o1', 'Sell to Open', 20, undefined)] }));
    expect(f.status).toBe('cannot_verify');
  });
  it('usable cash at or below zero is not fundable', () => {
    const f = buildCspCardFunding(input({ cashBalance: 1000, reserve: { kind: 'fixed', value: 2000 }, positions: [], strike: 10 }));
    expect(f.status).toBe('not_fundable');
    expect(f.utilization).toBeNull();
    expect(f.room).toBe(0);
  });
});

describe('manual capital limit (Quinn): can only lower the figure', () => {
  it('a limit below usable cash replaces it', () => {
    const f = buildCspCardFunding(input({ positions: [], strike: 50, manualLimit: 4000 }));
    expect(f.manualLimitApplied).toBe(true);
    expect(f.usableCash).toBe(4000);
    expect(f.status).toBe('not_fundable');
    expect(f.surplusShortfall).toBe(-1000);
  });
  it('a limit above usable cash never raises it', () => {
    const f = buildCspCardFunding(input({ positions: [], strike: 50, manualLimit: 90000 }));
    expect(f.manualLimitApplied).toBe(false);
    expect(fundingMoney(f.usableCash as number)).toBe('$23,937.97');
  });
});

describe('age of the figures (Quinn)', () => {
  it('carries the time the data was read, so the card can show it', () => {
    expect(buildCspCardFunding(input({ asOfMs: 123456 })).asOfMs).toBe(123456);
  });
});

describe('broker buying power advisory', () => {
  it('is absent when buying power covers the cash this put ties up', () => {
    expect(buildCspCardFunding(input({ optionBuyingPower: 20000 })).buyingPowerAdvisory).toBeNull();
  });
  it('is absent when buying power is unknown', () => {
    expect(buildCspCardFunding(input({ optionBuyingPower: null })).buyingPowerAdvisory).toBeNull();
  });
  it('never changes the funding status', () => {
    const lowBp = buildCspCardFunding(input({ positions: [], strike: 50, optionBuyingPower: 100 }));
    expect(lowBp.status).toBe('funded');
    expect(lowBp.buyingPowerAdvisory).not.toBeNull();
  });
});

describe('fundingFailReasons', () => {
  const oldCapacity = 'Insufficient CSP capacity — requires $14,000, $5,767.89 available. CSP capacity uses the lower of the selected account\'s cash balance and option buying power; margin is not used by default.';
  const oi = 'OI 168 is below the preferred minimum of 500.';

  it('replaces the old-basis sentence with the funding sentence, in the same place', () => {
    const f = buildCspCardFunding(input());
    const out = fundingFailReasons(['Delta 0.30 is outside the preferred range', oldCapacity, oi], f);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('Delta 0.30 is outside the preferred range');
    expect(out[2]).toBe(oi);
    expect(out[1]).toContain('Shortfall $14,312.03');
    expect(summarizeFailReason(out[1])).toBe('Needs $14,000.00 · $0.00 available');
  });
  it('drops the old-basis sentence when the account can fund the order', () => {
    const f = buildCspCardFunding(input({ positions: [], strike: 50 }));
    expect(fundingFailReasons([oldCapacity, oi], f)).toEqual([oi]);
  });
  it('adds a funding sentence when the old basis passed but the new one does not', () => {
    const f = buildCspCardFunding(input());
    const out = fundingFailReasons([oi], f);
    expect(out).toHaveLength(2);
    expect(out[1]).toContain('Insufficient CSP capacity');
  });
  it('says "Cannot verify funding" when a source is missing', () => {
    const f = buildCspCardFunding(input({ positions: null }));
    const out = fundingFailReasons([oldCapacity], f);
    expect(out[0]).toMatch(/^Cannot verify funding\./);
  });
  it('keeps account-selection reasons untouched', () => {
    const noAccount = 'No active account selected — capital could not be verified.';
    expect(fundingFailReasons([noAccount], buildCspCardFunding(input({ positions: [], strike: 50 })))).toEqual([noAccount]);
  });
  it('returns the reasons unchanged when no funding was computed', () => {
    expect(fundingFailReasons([oldCapacity, oi], undefined)).toEqual([oldCapacity, oi]);
  });
});
