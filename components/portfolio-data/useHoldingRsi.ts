// components/portfolio-data/useHoldingRsi.ts

'use client';

// STOCK-RSI-0001 slice A -- daily RSI for each held stock symbol. Reads the same shared daily-bars memo the scans use
// (one /api/chart request per symbol, 60 s memo), then the same completed-bar Wilder RSI as the scan cards.
//  * undefined = still loading; null = could not be computed (shown as "—", never a made-up number).
//  * A failure for one symbol never blocks the others, and never throws into the card.

import { useEffect, useState } from 'react';
import { fetchDailyBars } from '@/lib/scans/dailyBarsMemo';
import { YAHOO_INDEX_CHART_MAP } from '@/lib/scans/constants';
import { stockRsiFromBars, type StockRsi } from '@/lib/portfolio/stockRsi';

export type HoldingRsiMap = Record<string, StockRsi | null | undefined>;

export function useHoldingRsi(symbols: string[]): HoldingRsiMap {
  const [rsiBySymbol, setRsiBySymbol] = useState<HoldingRsiMap>({});
  // A stable key, so a new array with the same symbols does not refetch.
  const key = Array.from(new Set(symbols.map(s => s.trim().toUpperCase()).filter(Boolean))).sort().join(',');

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    for (const symbol of key.split(',')) {
      const chartSymbol = YAHOO_INDEX_CHART_MAP[symbol] ?? symbol;
      fetchDailyBars(chartSymbol, symbol)
        .then(bars => stockRsiFromBars(bars))
        .catch(() => null)
        .then(result => {
          if (!cancelled) setRsiBySymbol(prev => ({ ...prev, [symbol]: result }));
        });
    }
    return () => { cancelled = true; };
  }, [key]);

  return rsiBySymbol;
}
