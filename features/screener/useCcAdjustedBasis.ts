'use client';

// features/screener/useCcAdjustedBasis.ts
// CC-PMCC-GUIDANCE-0001 R3 -- the cost basis after put premium for one holding, proven from the broker's transaction history
// (lib/ccBasis/adjustedBasis.ts), so the stock card shows the same basis the scan judges a call against. The history is
// fetched once per page visit and shared. Null when it cannot be proven (the typed or broker basis then stands).

import { useEffect, useState } from 'react';
import { fetchAndReconstructTrades } from '@/lib/tradeLog/reconstructTrades';
import { computeAdjustedBasis, hasOpenLongCall } from '@/lib/ccBasis/adjustedBasis';

let history: Promise<Array<Record<string, any>> | null> | null = null;
export function loadHistory() {
  if (!history) history = fetchAndReconstructTrades('12m').then(r => r.transactions as Array<Record<string, any>>).catch(() => null);
  return history;
}

export function useCcAdjustedBasis(symbol: string, sharesOwned: number | null, brokerBasis: number | null): number | null {
  const [basis, setBasis] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    if (!sharesOwned || sharesOwned <= 0 || brokerBasis === null) { setBasis(null); return; }
    void loadHistory().then(tx => {
      if (!live || !tx) return;
      const r = computeAdjustedBasis({ transactions: tx, symbol, sharesOwned, brokerBasis, hasLongCallOnSymbol: hasOpenLongCall(tx, symbol) });
      setBasis(r.ok ? r.floorBasis : null); // same number the scan floors on: the highest lot basis after put premium
    });
    return () => { live = false; };
  }, [symbol, sharesOwned, brokerBasis]);
  return basis;
}
