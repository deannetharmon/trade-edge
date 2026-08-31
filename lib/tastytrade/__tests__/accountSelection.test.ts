import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyBrokerAccountSwitch, extractBrokerAccounts, persistValidatedBrokerAccountId, requireActiveBrokerAccount, resolveBrokerAccounts } from '../accountSelection';

const accounts = [
  { id: 'ACCT-A', label: 'IRA' },
  { id: 'ACCT-B', label: 'Individual' },
];

describe('broker account selection', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('auto-selects only a sole account', () => {
    expect(resolveBrokerAccounts([accounts[0]], null)).toMatchObject({ status: 'ready', accountId: 'ACCT-A' });
  });

  it('requires an explicit choice for multiple accounts and ignores API order', () => {
    expect(resolveBrokerAccounts(accounts, null)).toMatchObject({ status: 'selection_required', accountId: null });
    expect(resolveBrokerAccounts([...accounts].reverse(), null)).toMatchObject({ status: 'selection_required', accountId: null });
  });

  it('restores an exact persisted account', () => {
    expect(resolveBrokerAccounts(accounts, 'ACCT-B')).toMatchObject({ status: 'ready', accountId: 'ACCT-B' });
  });

  it('fails closed when a persisted account disappears', () => {
    expect(resolveBrokerAccounts(accounts, 'ACCT-Z')).toMatchObject({ status: 'selected_account_missing', accountId: null });
  });

  it('extracts valid unique accounts and useful labels from broker payloads', () => {
    expect(extractBrokerAccounts({ data: { items: [
      { account: { 'account-number': 'ACCT-A', nickname: 'Retirement' } },
      { account: { 'account-number': 'ACCT-A' } },
      { account: { 'account-number': 'ACCT-B', 'account-type-name': 'Individual' } },
      { account: {} },
    ] } })).toEqual([
      { id: 'ACCT-A', label: 'Retirement' },
      { id: 'ACCT-B', label: 'Individual' },
    ]);
  });

  it('reuses a validated account normally but force-validates capital/order calls', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('CustomEvent', class { constructor(public type: string, public init?: unknown) {} });
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
      dispatchEvent: vi.fn(),
    });
    persistValidatedBrokerAccountId('ACCT-A');
    const fetcher = vi.fn().mockResolvedValue({ data: { items: [{ account: { 'account-number': 'ACCT-A' } }] } });

    await expect(requireActiveBrokerAccount('token', fetcher)).resolves.toBe('ACCT-A');
    expect(fetcher).not.toHaveBeenCalled();
    await expect(requireActiveBrokerAccount('token', fetcher, { forceValidation: true })).resolves.toBe('ACCT-A');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('persists a switch and invokes the centralized full-reload boundary', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('CustomEvent', class { constructor(public type: string, public init?: unknown) {} });
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
      dispatchEvent: vi.fn(),
    });
    const reload = vi.fn();
    applyBrokerAccountSwitch('ACCT-B', reload);
    expect(reload).toHaveBeenCalledOnce();
    expect(Array.from(values.values())).toContain('ACCT-B');
  });
});
