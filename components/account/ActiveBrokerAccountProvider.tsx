'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ACTIVE_BROKER_ACCOUNT_CHANGED_EVENT,
  applyBrokerAccountSwitch,
  resolveActiveBrokerAccount,
  type BrokerAccountOption,
  type BrokerAccountResolutionStatus,
} from '@/lib/tastytrade/accountSelection';

interface ActiveBrokerAccountContextValue {
  status: BrokerAccountResolutionStatus | 'loading';
  accountId: string | null;
  accounts: BrokerAccountOption[];
  refresh: () => Promise<void>;
  selectAccount: (accountId: string) => void;
}

const ActiveBrokerAccountContext = createContext<ActiveBrokerAccountContextValue | null>(null);

export function ActiveBrokerAccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ActiveBrokerAccountContextValue['status']>('loading');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<BrokerAccountOption[]>([]);

  const refresh = useCallback(async () => {
    setStatus('loading');
    const result = await resolveActiveBrokerAccount();
    setStatus(result.status);
    setAccountId(result.accountId);
    setAccounts(result.accounts);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectAccount = useCallback((nextAccountId: string) => {
    if (!accounts.some(account => account.id === nextAccountId)) return;
    applyBrokerAccountSwitch(nextAccountId);
  }, [accounts]);

  const value = useMemo(() => ({ status, accountId, accounts, refresh, selectAccount }), [status, accountId, accounts, refresh, selectAccount]);
  return <ActiveBrokerAccountContext.Provider value={value}>{children}</ActiveBrokerAccountContext.Provider>;
}

export function useActiveBrokerAccount(): ActiveBrokerAccountContextValue {
  const context = useContext(ActiveBrokerAccountContext);
  if (!context) throw new Error('useActiveBrokerAccount must be used within ActiveBrokerAccountProvider');
  return context;
}

export function ActiveBrokerAccountIndicator() {
  const { status, accountId, accounts, refresh, selectAccount } = useActiveBrokerAccount();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener(ACTIVE_BROKER_ACCOUNT_CHANGED_EVENT, close);
    return () => window.removeEventListener(ACTIVE_BROKER_ACCOUNT_CHANGED_EVENT, close);
  }, []);

  if (status === 'authorization_required' || status === 'no_accounts' || status === 'account_fetch_failed') return null;
  const selected = accounts.find(account => account.id === accountId);
  const needsChoice = status === 'selection_required' || status === 'selected_account_missing';
  const choiceMessage = status === 'selected_account_missing'
    ? 'The saved account is no longer available. Choose another account.'
    : status === 'selection_required'
      ? 'Choose the account TradeEdge should use across the app.'
      : null;
  return (
    <div className="relative shrink-0 text-[11px]" data-testid="active-broker-account">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className={`flex max-w-56 items-center gap-1.5 rounded-full border px-2.5 py-1.5 font-semibold shadow-sm backdrop-blur ${needsChoice ? 'border-amber-400 bg-amber-950/95 text-amber-200' : 'border-neutral-700 bg-neutral-950/90 text-neutral-300'}`}
        aria-expanded={open}
        aria-label={status === 'loading' ? 'Loading active broker account' : needsChoice ? 'Choose active broker account' : `Active broker account ${selected?.label ?? 'Account'}, ending ${accountId?.slice(-4) ?? ''}`}
      >
        {status === 'loading' || needsChoice ? (
          status === 'loading' ? 'Account…' : 'Choose account'
        ) : (
          <>
            <span className="hidden max-w-32 truncate xl:inline">{selected?.label ?? 'Account'}</span>
            <span className="font-sans">••••{accountId?.slice(-4) ?? ''}</span>
          </>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-[70] mt-2 w-64 rounded-xl border border-neutral-700 bg-neutral-950 p-2 text-neutral-200 shadow-2xl" role="dialog" aria-label="Active broker account">
          <div className="px-2 py-1 text-[10px] text-neutral-400">Active broker account</div>
          {choiceMessage && <p className="px-2 pb-2 text-[10px] text-amber-300">{choiceMessage}</p>}
          {accounts.map(account => (
            <button key={account.id} type="button" onClick={() => { selectAccount(account.id); setOpen(false); }} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left hover:bg-neutral-800">
              <span>{account.label}</span><span className="font-sans text-neutral-400">••••{account.id.slice(-4)}{account.id === accountId ? ' ✓' : ''}</span>
            </button>
          ))}
          <button type="button" onClick={() => void refresh()} className="mt-1 w-full rounded-lg border border-neutral-800 px-2 py-1.5 text-neutral-400 hover:text-white">Refresh accounts</button>
        </div>
      )}
    </div>
  );
}
