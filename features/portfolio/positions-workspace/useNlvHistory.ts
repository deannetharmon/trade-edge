// features/portfolio/positions-workspace/useNlvHistory.ts

// SPARKLINES-0001A: stored net-liquidating-value history for the Portfolio Value sparkline. Reads /api/balance-history, then
// (best effort, silent) runs the broker snapshot sync so gaps close without opening the Balances tab, and reads again.
// The sync only runs when a broker token is already cached, so it never triggers a sign-in redirect from here.

'use client';

import { useEffect, useState } from 'react';
import { getAccessToken, ttFetch } from '@/lib/tastytrade/client';
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

export function useNlvHistory(): BalanceDayPoint[] {
  const [history, setHistory] = useState<BalanceDayPoint[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const first = await loadStored();
      if (!cancelled && first) setHistory(first);
      try {
        if (typeof window === 'undefined' || !window.sessionStorage?.getItem('tt_access_token')) return;
        const token = await getAccessToken();
        const accountNumber = await requireActiveBrokerAccount(token, ttFetch);
        const failure = await syncBalanceSnapshots({ ttFetch, token, accountNumber });
        if (failure === null) {
          const again = await loadStored();
          if (!cancelled && again) setHistory(again);
        }
      } catch {
        // Best effort: the stored history above is still shown.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return history;
}
