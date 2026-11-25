// features/portfolio/positions-workspace/useNlvHistory.ts

// SPARKLINES-0001A: stored net-liquidating-value history for the Portfolio Value sparkline. Reads /api/balance-history, then
// runs the broker snapshot sync so gaps close without opening the Balances tab, and reads again.
// SPARKLINES-0001A2: the sync used to check for a cached broker token the moment the tile mounted, before the page had
// fetched one, so it silently never ran. It now waits (up to 20 seconds) for a still-valid cached token, which means it
// never triggers a sign-in redirect from here, and it reports why it could not finish.

'use client';

import { useEffect, useState } from 'react';
import { getAccessToken, ttFetch, LS_ACCESS_TOKEN, LS_ACCESS_TOKEN_EXPIRY } from '@/lib/tastytrade/client';
import { requireActiveBrokerAccount } from '@/lib/tastytrade/accountSelection';
import { syncBalanceSnapshots } from '@/lib/portfolio-data/balanceSync';
import type { BalanceDayPoint } from '@/lib/portfolio-data/balancePerformance';

async function loadStored(): Promise<BalanceDayPoint[] | null> {
  try {
    if (typeof fetch === 'undefined') return null;
    const res = await fetch('/api/balance-history');
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.history) ? data.history : [];
  } catch {
    return null;
  }
}

function hasValidCachedToken(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const expiry = parseInt(window.localStorage.getItem(LS_ACCESS_TOKEN_EXPIRY) ?? '', 10);
    const unexpired = Number.isFinite(expiry) && Date.now() < expiry;
    return unexpired && Boolean(window.sessionStorage.getItem('tt_access_token') || window.localStorage.getItem(LS_ACCESS_TOKEN));
  } catch {
    return false;
  }
}

async function waitForToken(cancelled: () => boolean): Promise<boolean> {
  for (let i = 0; i < 20; i += 1) {
    if (cancelled()) return false;
    if (hasValidCachedToken()) return true;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

export function useNlvHistory(): { history: BalanceDayPoint[]; note: string | null } {
  const [history, setHistory] = useState<BalanceDayPoint[]>([]);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const first = await loadStored();
      if (!cancelled && first) setHistory(first);
      if (!cancelled && first === null) setNote('Stored balance history could not be read.');
      try {
        if (!(await waitForToken(() => cancelled))) {
          if (!cancelled) setNote(current => current ?? 'Waiting for the broker sign-in to refresh balance history.');
          return;
        }
        const token = await getAccessToken();
        const accountNumber = await requireActiveBrokerAccount(token, ttFetch);
        const failure = await syncBalanceSnapshots({ ttFetch, token, accountNumber, lookbackDays: 45 });
        if (cancelled) return;
        if (failure !== null) { setNote(failure); return; }
        setNote(null);
        const again = await loadStored();
        if (!cancelled && again) setHistory(again);
      } catch (e) {
        if (!cancelled) setNote(e instanceof Error ? `Balance history refresh failed: ${e.message.slice(0, 80)}` : 'Balance history refresh failed.');
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return { history, note };
}
