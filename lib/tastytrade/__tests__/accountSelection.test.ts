import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyBrokerAccountSwitch, extractBrokerAccounts, persistValidatedBrokerAccountId, requireActiveBrokerAccount, resolveActiveBrokerAccount, resolveBrokerAccounts, readPersistedBrokerAccountId } from '../accountSelection';

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

// ACCOUNT-STICKY-0001: server-side copy of the chosen account.
describe('sticky broker account (server copy)', () => {
  const KEY = 'trade-edge.active-broker-account';
  const payload = { data: { items: [{ account: { 'account-number': 'ACCT-A' } }, { account: { 'account-number': 'ACCT-B' } }] } };

  function setup(local: string | null, server: string | null) {
    const values = new Map<string, string>();
    if (local) values.set(KEY, local);
    const dispatchEvent = vi.fn();
    vi.stubGlobal('CustomEvent', class { constructor(public type: string, public init?: unknown) {} });
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
      dispatchEvent,
    });
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({ ok: true }) };
      return { ok: true, json: async () => ({ accountId: server }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    return { values, dispatchEvent, fetchMock };
  }
  const fetcher = async () => payload;
  const posts = (m: ReturnType<typeof setup>['fetchMock']) => m.mock.calls.filter(c => (c[1] as any)?.method === 'POST');

  afterEach(() => { vi.unstubAllGlobals(); });

  it('restores the server copy when localStorage was cleared, without firing a switch event', async () => {
    const { values, dispatchEvent, fetchMock } = setup(null, 'ACCT-B');
    const result = await resolveActiveBrokerAccount('t', fetcher);
    expect(result).toMatchObject({ status: 'ready', accountId: 'ACCT-B' });
    expect(values.get(KEY)).toBe('ACCT-B');
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('prefers the local choice over the server copy', async () => {
    const { fetchMock } = setup('ACCT-A', 'ACCT-B');
    const result = await resolveActiveBrokerAccount('t', fetcher);
    expect(result).toMatchObject({ status: 'ready', accountId: 'ACCT-A' });
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('backfills the server when it has no copy yet', async () => {
    const { fetchMock } = setup('ACCT-A', null);
    await resolveActiveBrokerAccount('t', fetcher);
    const sent = posts(fetchMock);
    expect(sent).toHaveLength(1);
    expect(JSON.parse((sent[0][1] as any).body)).toEqual({ accountId: 'ACCT-A' });
  });

  it('still requires a choice with several accounts and no saved copy anywhere', async () => {
    setup(null, null);
    expect(await resolveActiveBrokerAccount('t', fetcher)).toMatchObject({ status: 'selection_required', accountId: null });
  });

  it('fails closed when the server copy is not one of the live accounts', async () => {
    const { values } = setup(null, 'ACCT-GONE');
    expect(await resolveActiveBrokerAccount('t', fetcher)).toMatchObject({ status: 'selected_account_missing', accountId: null });
    expect(readPersistedBrokerAccountId()).toBeNull();
    expect(values.has(KEY)).toBe(false);
  });

  it('saves an explicit switch on the server', () => {
    const { fetchMock } = setup(null, null);
    applyBrokerAccountSwitch('ACCT-B', vi.fn());
    const sent = posts(fetchMock);
    expect(sent).toHaveLength(1);
    expect(JSON.parse((sent[0][1] as any).body)).toEqual({ accountId: 'ACCT-B' });
    expect((sent[0][1] as any).keepalive).toBe(true);
  });

  it('falls back to local behavior when the server is unreachable', async () => {
    setup('ACCT-A', null);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await resolveActiveBrokerAccount('t', fetcher)).toMatchObject({ status: 'ready', accountId: 'ACCT-A' });
  });
});
