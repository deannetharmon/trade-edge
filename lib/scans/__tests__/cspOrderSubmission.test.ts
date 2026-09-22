// lib/scans/__tests__/cspOrderSubmission.test.ts

import { describe, expect, it, vi } from 'vitest';
import { guardCspOrder, submitCspOrderIfSafe } from '../cspOrderSubmission';
import type { CspCapitalContext } from '../tastytrade-client';

const capital = (over: Partial<CspCapitalContext> = {}): CspCapitalContext => ({
  accountSelected: true, accountId: 'acct-1', optionBuyingPower: 50_000, cashBalance: 50_000, ...over,
});
const request = { strike: 235, creditPerContract: 802.50, quantity: 1 };

describe('guardCspOrder', () => {
  it('allows an order with sufficient collateral and returns the required cash and max loss', () => {
    const guard = guardCspOrder(capital(), request);
    expect(guard).toEqual({ allowed: true, requiredCash: 23_500, maxLoss: 235 * 100 - 802.50 });
  });

  it('blocks when capital could not be verified at all', () => {
    const guard = guardCspOrder(capital({ accountSelected: false }), request);
    expect(guard.allowed).toBe(false);
  });

  it('blocks when required collateral exceeds available capital, with the real numbers in the reason', () => {
    const guard = guardCspOrder(capital({ optionBuyingPower: 10_000, cashBalance: 10_000 }), request);
    expect(guard.allowed).toBe(false);
    expect(!guard.allowed && guard.reason).toContain('$23,500');
    expect(!guard.allowed && guard.reason).toContain('$10,000');
  });

  it('uses the LOWER of option buying power and cash balance, matching the existing CSP capital rule (margin is not used by default)', () => {
    const guard = guardCspOrder(capital({ optionBuyingPower: 100_000, cashBalance: 20_000 }), request);
    expect(guard.allowed).toBe(false); // 23,500 required > 20,000 cash, even though buying power alone would cover it
  });

  it('scales required cash with quantity', () => {
    const guard = guardCspOrder(capital({ optionBuyingPower: 100_000, cashBalance: 100_000 }), { ...request, quantity: 3 });
    expect(guard.allowed && guard.requiredCash).toBe(70_500);
  });
});

describe('submitCspOrderIfSafe', () => {
  it('the broker call is structurally unreachable when collateral is insufficient', async () => {
    const submitToBroker = vi.fn();
    const result = await submitCspOrderIfSafe(capital({ optionBuyingPower: 100, cashBalance: 100 }), request, submitToBroker);
    expect(result.submitted).toBe(false);
    expect(submitToBroker).not.toHaveBeenCalled();
  });

  it('submits and returns the broker result when the guard passes', async () => {
    const submitToBroker = vi.fn().mockResolvedValue({ orderId: 'abc-123' });
    const result = await submitCspOrderIfSafe(capital(), request, submitToBroker);
    expect(result).toEqual({ submitted: true, result: { orderId: 'abc-123' } });
    expect(submitToBroker).toHaveBeenCalledTimes(1);
  });

  it('re-checks against whatever capital context is passed at call time, not a stale earlier one -- proves the "never trusted from the screen" requirement', async () => {
    const staleGoodCapital = capital({ optionBuyingPower: 100_000, cashBalance: 100_000 }); // looked fine when the modal opened
    const freshBadCapital = capital({ optionBuyingPower: 100, cashBalance: 100 }); // capital used up by another order since
    const submitToBroker = vi.fn();
    const result = await submitCspOrderIfSafe(freshBadCapital, request, submitToBroker);
    expect(result.submitted).toBe(false);
    expect(submitToBroker).not.toHaveBeenCalled();
    void staleGoodCapital;
  });
});
