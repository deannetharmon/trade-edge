// features/screener/types.ts
//
// Narrow types for the Ranked Scan feature module (RF-0001). These are
// deliberately structural/minimal rather than importing page.tsx's local
// (unexported) types — keeps the feature module decoupled from the route
// file per ADR-0004 ("app -> features -> lib", not the reverse).

import type { RulesType } from '@/lib/scans/constants';
import type { RankConfig, ScreenResult, RawScanEntry } from '@/lib/scans/types';

/** Structurally compatible with app/screener/page.tsx's WatchlistTicker. */
export interface RankedScanTickerInput {
  symbol: string;
  active: boolean;
}

export interface UseRankedScanParams {
  /** Only reconnects/mirrors task state while this is 'rank'. */
  screenMode: 'filter' | 'rank' | 'targeted';
  tickers: RankedScanTickerInput[];
  rankConfig: RankConfig;
  setResults: (results: ScreenResult[]) => void;
  setRawScanCache: (cache: RawScanEntry[]) => void;
  setResultsCachedAt: (timestamp: number | null) => void;
  setLoading: (loading: boolean) => void;
  setStatus: (status: string) => void;
  setError: (error: string) => void;
}

export interface UseRankedScanResult {
  /** Dispatches START_RANKED_SCAN and tracks the resulting task. */
  startRankedScan: (
    sRules: RulesType,
    eRules: RulesType,
    sLabel?: string,
    eLabel?: string
  ) => Promise<void>;
}

