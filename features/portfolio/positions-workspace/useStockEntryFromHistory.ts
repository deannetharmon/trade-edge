'use client';

// features/portfolio/positions-workspace/useStockEntryFromHistory.ts
// STOCK-ENTRY-0001 -- the entry date and price of the shares held, read from the broker's transaction history (the same
// 12-month history the cost-basis-after-put-premium proof uses, fetched once per page visit). Null when the history cannot
// explain the shares held; a date the user typed always wins over this one.

import { useEffect, useState } from 'react';
import { loadHistory } from '@/features/screener/useCcAdjustedBasis';
import { deriveStockEntry, type StockEntry } from '@/lib/portfolio/entryFromTransactions';

export function useStockEntryFromHistory(symbol: string, sharesOwned: number | null): StockEntry | null {
  const [entry, setEntry] = useState<StockEntry | null>(null);
  useEffect(() => {
    let live = true;
    if (!sharesOwned || sharesOwned <= 0) { setEntry(null); return; }
    void loadHistory().then(tx => {
      if (!live || !tx) return;
      setEntry(deriveStockEntry({ transactions: tx, symbol, sharesOwned }));
    });
    return () => { live = false; };
  }, [symbol, sharesOwned]);
  return entry;
}
