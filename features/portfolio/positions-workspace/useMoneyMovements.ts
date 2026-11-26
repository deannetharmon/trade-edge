// features/portfolio/positions-workspace/useMoneyMovements.ts

// SPARKLINES-0001E: deposits, withdrawals and transfers from the broker, for the Total tile's account-profit line.
// Read once per page load through the signed-in proxy. Null until read, or if the read fails (the tile then keeps its
// open-positions line rather than drawing a wrong account line).

'use client';

import { useEffect, useState } from 'react';
import { extractMoneyMovements, type MoneyMovement } from '@/lib/portfolio-data/balancePerformance';

export function useMoneyMovements(): MoneyMovement[] | null {
  const [movements, setMovements] = useState<MoneyMovement[] | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const acct = await (await fetch('/api/active-account')).json();
        const accountId: string | undefined = acct?.accountId ?? undefined;
        if (!accountId) return;
        const txs: Record<string, unknown>[] = [];
        for (let page = 0; page < 12; page += 1) {
          const path = `/accounts/${accountId}/transactions?start-date=2020-01-01&type=Money%20Movement&per-page=250&page-offset=${page}`;
          const res = await fetch(`/api/tastytrade/proxy?path=${encodeURIComponent(path)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
          if (!res.ok) return;
          const items: Record<string, unknown>[] = (await res.json())?.data?.items ?? [];
          txs.push(...items);
          if (items.length < 250) break;
        }
        if (alive) setMovements(extractMoneyMovements(txs));
      } catch { /* the tile keeps its open-positions line */ }
    })();
    return () => { alive = false; };
  }, []);
  return movements;
}
