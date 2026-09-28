// features/wheel/useHistoryData.ts
'use client';

// WHEEL-SYSTEM-0003 Slice B -- loads each wheel-list symbol's own price history for the own-history
// check, one symbol at a time (Quinn, O3: one call per symbol per session is enough; nothing is
// stored). Mirrors useCandidateData.ts's closes-fetching effect exactly. A symbol whose history
// cannot be read shows "history unavailable" and never blocks anything; Retry loads it again.

import { useEffect, useCallback, useRef, useState } from 'react';

export interface HistoryDataDeps {
  fetchHistory?: (symbol: string) => Promise<number[] | null>;
}

export interface HistoryData {
  /** symbol -> closes (null when they could not be read). A symbol not in the map is still loading. */
  closes: Record<string, number[] | null>;
  retry: () => void;
}

export function useHistoryData(enabled: boolean, symbols: string[], deps: HistoryDataDeps): HistoryData {
  const [closes, setCloses] = useState<Record<string, number[] | null>>({});
  const [tick, setTick] = useState(0);
  const closesRef = useRef(closes);
  closesRef.current = closes;
  const symbolsKey = symbols.join(',');

  useEffect(() => {
    if (!enabled || symbols.length === 0) return;
    const run = { cancelled: false };
    const todo = symbols.filter((s) => !(s in closesRef.current));
    if (!todo.length) return;
    (async () => {
      for (const symbol of todo) {
        if (run.cancelled) return;
        let value: number[] | null = null;
        try {
          value = deps.fetchHistory ? await deps.fetchHistory(symbol) : null;
        } catch {
          value = null;
        }
        if (run.cancelled) return; // the symbol stays "loading" and the next run picks it up
        setCloses((prev) => ({ ...prev, [symbol]: value }));
      }
    })();
    return () => { run.cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, symbolsKey, tick]);

  const retry = useCallback(() => {
    setCloses({});
    closesRef.current = {};
    setTick((t) => t + 1);
  }, []);

  return { closes, retry };
}
