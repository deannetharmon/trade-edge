// features/screener/types.ts
//
// Narrow types for the Ranked Scan feature module (RF-0001). These are
// deliberately structural/minimal rather than importing page.tsx's local
// (unexported) types — keeps the feature module decoupled from the route
// file per ADR-0004 ("app -> features -> lib", not the reverse).

import type { RulesType } from '@/lib/scans/constants';
import type { RankConfig, ScreenResult, RawScanEntry } from '@/lib/scans/types';
// SCREENER-RESULTS-0001 — canonical scan-session lifecycle entry points.
// This is a lib import (features -> lib), not a page.tsx-local type, so it
// doesn't violate ADR-0004's "app -> features -> lib" direction.
import type { ScreenerScanScope, ScreenerScanSession } from '@/lib/screener/scanSession';

/** Structurally compatible with app/screener/page.tsx's WatchlistTicker. */
export interface RankedScanTickerInput {
  symbol: string;
  active: boolean;
}

export interface UseRankedScanParams {
  /** Only reconnects/mirrors task state while this is 'rank'. */
  // LEAPS-0003: widened to include 'leaps' -- this hook only ever checks
  // `screenMode !== 'rank'` (confirmed directly in useRankedScan.ts), never
  // assumes anything about the other specific values, so passing 'leaps'
  // through is inert. Narrower type wasn't wrong before, just incomplete
  // once a fourth mode value exists at the call site.
  screenMode: 'filter' | 'rank' | 'targeted' | 'leaps';
  tickers: RankedScanTickerInput[];
  rankConfig: RankConfig;
  // TE-0007D corrective — lets startRankedScan distinguish a refresh
  // (prior valid results are visible and must stay visible for the whole
  // refresh window, per the real Ranked Scan orchestration test) from a
  // genuine first scan, without needing the whole results array passed
  // in -- only whether one is currently non-empty.
  hasPriorResults: boolean;
  setResults: (results: ScreenResult[]) => void;
  setRawScanCache: (cache: RawScanEntry[]) => void;
  setResultsCachedAt: (timestamp: number | null) => void;
  setLoading: (loading: boolean) => void;
  setStatus: (status: string) => void;
  setError: (error: string) => void;
  // SCREENER-RESULTS-0001 — same pattern as runTargetedScan in page.tsx:
  // this hook cannot close over Home()'s activeSession state/ref directly,
  // so the two lifecycle entry points it needs are passed in.
  beginSession: (scope: ScreenerScanScope) => ScreenerScanSession;
  commitSession: (session: ScreenerScanSession, onCommit?: () => void) => boolean;
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
