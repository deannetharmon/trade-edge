// lib/scans/__tests__/getCspCapitalContext.test.ts
// CSP-WORKFLOW-0001 core-correction (BLOCKER-02) — focused tests over the
// minimum safe production capital bridge. Mocks global.fetch directly
// (the same boundary ttFetch() calls) rather than mocking the module
// itself, so these tests exercise the real account-resolution logic:
// "never use accounts[0] without validating it against an explicit/
// current selected-account source" must hold even when a real multi-
// account API response is returned.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCspCapitalContext } from '../tastytrade-client';

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('getCspCapitalContext — BLOCKER-02 fail-closed production capital bridge', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('exactly one account: resolves the real account identifier and min-eligible optionBuyingPower/cashBalance', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(jsonResponse({ data: { items: [{ account: { 'account-number': 'ACCT-1' } }] } }))
      .mockResolvedValueOnce(jsonResponse({ data: { 'derivative-buying-power': '12000', 'cash-available-to-withdraw': '4800' } }));

    const result = await getCspCapitalContext('token');
    expect(result).toEqual({ accountSelected: true, accountId: 'ACCT-1', optionBuyingPower: 12000, cashBalance: 4800 });
  });

  it('zero accounts: fails closed to accountSelected: false with every capital figure null, never a fallback constant', async () => {
    (global.fetch as any).mockResolvedValueOnce(jsonResponse({ data: { items: [] } }));

    const result = await getCspCapitalContext('token');
    expect(result).toEqual({ accountSelected: false, accountId: null, optionBuyingPower: null, cashBalance: null });
  });

  it('multiple accounts with no trader-driven selection mechanism: never guesses accounts[0] -- fails closed exactly like zero accounts', async () => {
    (global.fetch as any).mockResolvedValueOnce(jsonResponse({
      data: { items: [{ account: { 'account-number': 'ACCT-A' } }, { account: { 'account-number': 'ACCT-B' } }] },
    }));

    const result = await getCspCapitalContext('token');
    expect(result.accountSelected).toBe(false);
    expect(result.accountId).toBeNull();
    // This is the exact scenario a naive accounts[0] implementation would
    // have silently resolved to ACCT-A -- proving that never happens here.
    expect(result.accountId).not.toBe('ACCT-A');
  });

  it('reordering the same two accounts in the API response does not change the (fail-closed) outcome -- order can never influence which account gets chosen', async () => {
    (global.fetch as any).mockResolvedValueOnce(jsonResponse({
      data: { items: [{ account: { 'account-number': 'ACCT-B' } }, { account: { 'account-number': 'ACCT-A' } }] },
    }));

    const result = await getCspCapitalContext('token');
    expect(result.accountSelected).toBe(false);
    expect(result.accountId).toBeNull();
  });

  it('accounts fetch throws: fails closed, never propagates the error as a crash', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('network unavailable'));

    const result = await getCspCapitalContext('token');
    expect(result).toEqual({ accountSelected: false, accountId: null, optionBuyingPower: null, cashBalance: null });
  });

  it('balances fetch throws after a valid single-account resolution: still fails closed for capital, never partially trusts the account', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(jsonResponse({ data: { items: [{ account: { 'account-number': 'ACCT-1' } }] } }))
      .mockRejectedValueOnce(new Error('balances endpoint down'));

    const result = await getCspCapitalContext('token');
    expect(result).toEqual({ accountSelected: false, accountId: null, optionBuyingPower: null, cashBalance: null });
  });

  it('missing/non-numeric buying-power or cash fields resolve to null for that figure, not zero or a fallback', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(jsonResponse({ data: { items: [{ account: { 'account-number': 'ACCT-1' } }] } }))
      .mockResolvedValueOnce(jsonResponse({ data: {} }));

    const result = await getCspCapitalContext('token');
    expect(result.accountSelected).toBe(true);
    expect(result.accountId).toBe('ACCT-1');
    expect(result.optionBuyingPower).toBeNull();
    expect(result.cashBalance).toBeNull();
  });
});
