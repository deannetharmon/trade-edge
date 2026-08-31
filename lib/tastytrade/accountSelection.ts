import { getAccessToken, ttFetch } from './client';

export const ACTIVE_BROKER_ACCOUNT_STORAGE_KEY = 'trade-edge.active-broker-account';
export const ACTIVE_BROKER_ACCOUNT_CHANGED_EVENT = 'trade-edge:active-broker-account-changed';

export type BrokerAccountResolutionStatus =
  | 'ready'
  | 'selection_required'
  | 'selected_account_missing'
  | 'authorization_required'
  | 'account_fetch_failed'
  | 'no_accounts';

export interface BrokerAccountOption {
  id: string;
  label: string;
}

export interface BrokerAccountResolution {
  status: BrokerAccountResolutionStatus;
  accountId: string | null;
  accounts: BrokerAccountOption[];
}

let validatedAccountId: string | null = null;

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export function readPersistedBrokerAccountId(): string | null {
  const value = storage()?.getItem(ACTIVE_BROKER_ACCOUNT_STORAGE_KEY)?.trim();
  return value || null;
}

export function persistBrokerAccountId(accountId: string): void {
  const value = accountId.trim();
  if (!value) return;
  storage()?.setItem(ACTIVE_BROKER_ACCOUNT_STORAGE_KEY, value);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ACTIVE_BROKER_ACCOUNT_CHANGED_EVENT, { detail: { accountId: value } }));
  }
}

export function persistValidatedBrokerAccountId(accountId: string): void {
  validatedAccountId = accountId.trim() || null;
  if (validatedAccountId) persistBrokerAccountId(validatedAccountId);
}

export function getValidatedBrokerAccountId(): string | null {
  const persistedAccountId = readPersistedBrokerAccountId();
  return persistedAccountId && persistedAccountId === validatedAccountId ? persistedAccountId : null;
}

export function clearPersistedBrokerAccountId(): void {
  validatedAccountId = null;
  storage()?.removeItem(ACTIVE_BROKER_ACCOUNT_STORAGE_KEY);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ACTIVE_BROKER_ACCOUNT_CHANGED_EVENT, { detail: { accountId: null } }));
  }
}

export function extractBrokerAccounts(payload: unknown): BrokerAccountOption[] {
  const items = (payload as any)?.data?.items;
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const accounts: BrokerAccountOption[] = [];
  for (const item of items) {
    const account = item?.account;
    const id = typeof account?.['account-number'] === 'string' ? account['account-number'].trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const nickname = typeof account?.nickname === 'string' ? account.nickname.trim() : '';
    const type = typeof account?.['account-type-name'] === 'string' ? account['account-type-name'].trim() : '';
    accounts.push({ id, label: nickname || type || 'Broker account' });
  }
  return accounts;
}

/** Pure resolver. API ordering never selects an account when several exist. */
export function resolveBrokerAccounts(
  accounts: BrokerAccountOption[],
  preferredAccountId: string | null,
): BrokerAccountResolution {
  if (accounts.length === 0) return { status: 'no_accounts', accountId: null, accounts };
  if (preferredAccountId) {
    const selected = accounts.find(account => account.id === preferredAccountId);
    if (selected) return { status: 'ready', accountId: selected.id, accounts };
    return { status: 'selected_account_missing', accountId: null, accounts };
  }
  if (accounts.length === 1) return { status: 'ready', accountId: accounts[0].id, accounts };
  return { status: 'selection_required', accountId: null, accounts };
}

export async function resolveActiveBrokerAccount(
  token?: string,
  fetcher: (path: string, token: string) => Promise<any> = ttFetch,
): Promise<BrokerAccountResolution> {
  try {
    const accessToken = token ?? await getAccessToken();
    const payload = await fetcher('/customers/me/accounts', accessToken);
    if (!Array.isArray((payload as any)?.data?.items)) {
      return { status: 'account_fetch_failed', accountId: null, accounts: [] };
    }
    const accounts = extractBrokerAccounts(payload);
    const preferred = readPersistedBrokerAccountId();
    const resolution = resolveBrokerAccounts(accounts, preferred);
    if (resolution.status === 'ready' && resolution.accountId) {
      validatedAccountId = resolution.accountId;
      if (!preferred) persistBrokerAccountId(resolution.accountId);
    } else if (resolution.status === 'selected_account_missing') {
      clearPersistedBrokerAccountId();
    }
    return resolution;
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return {
      status: message === 'Not authenticated' || message === 'Session expired'
        ? 'authorization_required'
        : 'account_fetch_failed',
      accountId: null,
      accounts: [],
    };
  }
}

export async function requireActiveBrokerAccount(
  token?: string,
  fetcher?: (path: string, token: string) => Promise<any>,
  options: { forceValidation?: boolean } = {},
): Promise<string> {
  const persistedAccountId = getValidatedBrokerAccountId();
  if (persistedAccountId && !options.forceValidation) return persistedAccountId;
  const resolution = await resolveActiveBrokerAccount(token, fetcher);
  if (resolution.status === 'ready' && resolution.accountId) return resolution.accountId;
  const messages: Record<Exclude<BrokerAccountResolutionStatus, 'ready'>, string> = {
    selection_required: 'Choose an active broker account before continuing.',
    selected_account_missing: 'The saved broker account is no longer available. Choose another account.',
    authorization_required: 'Broker authorization expired. Sign in again.',
    account_fetch_failed: 'Broker accounts are temporarily unavailable.',
    no_accounts: 'No broker accounts were found.',
  };
  throw new Error(messages[resolution.status as Exclude<BrokerAccountResolutionStatus, 'ready'>]);
}

/**
 * Account switching is deliberately a full application boundary. A reload
 * clears every route-local scan result, draft order, quote, and portfolio
 * cache, so no account-scoped state can survive into the newly selected
 * account. The callback seam keeps the policy directly testable.
 */
export function applyBrokerAccountSwitch(
  accountId: string,
  reload: () => void = () => window.location.reload(),
): void {
  persistValidatedBrokerAccountId(accountId);
  reload();
}
