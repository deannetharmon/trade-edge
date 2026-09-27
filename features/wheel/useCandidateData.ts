// features/wheel/useCandidateData.ts
'use client';

// WHEEL-SYSTEM-0002 (W2) -- loads the data the "Next candidate" checks need beyond W1's chain and quote: IVR and the expected
// earnings date (one batched broker call for the whole list) and the daily closes behind RSI (one chart call per symbol,
// one at a time). Failure never blanks the table: a symbol without data is simply unavailable, and Retry loads it again.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MetricsResult } from '@/lib/wheel/candidateData';

export interface CandidateDataDeps {
  getToken: () => Promise<string>;
  fetchMetrics?: (symbols: string[], token: string) => Promise<MetricsResult>;
  fetchCloses?: (symbol: string) => Promise<number[] | null>;
}

export interface CandidateData {
  /** null until the first answer (or after a retry). */
  metrics: MetricsResult | null;
  metricsLoading: boolean;
  /** symbol -> closes (null when they could not be read). A symbol not in the map is still loading. */
  closes: Record<string, number[] | null>;
  retry: () => void;
}

export function useCandidateData(enabled: boolean, symbols: string[], deps: CandidateDataDeps): CandidateData {
  const [metrics, setMetrics] = useState<MetricsResult | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [closes, setCloses] = useState<Record<string, number[] | null>>({});
  const [tick, setTick] = useState(0);
  const closesRef = useRef(closes);
  closesRef.current = closes;
  const symbolsKey = symbols.join(',');

  useEffect(() => {
    if (!enabled || symbols.length === 0) return;
    const run = { cancelled: false };
    setMetricsLoading(true);
    (async () => {
      let result: MetricsResult;
      try {
        const token = await deps.getToken();
        result = deps.fetchMetrics ? await deps.fetchMetrics(symbols, token) : { items: {}, failed: symbols };
      } catch {
        result = { items: {}, failed: symbols };
      }
      if (run.cancelled) return;
      setMetrics(result);
      setMetricsLoading(false);
    })();
    return () => { run.cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, symbolsKey, tick]);

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
          value = deps.fetchCloses ? await deps.fetchCloses(symbol) : null;
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
    setMetrics(null);
    setCloses({});
    closesRef.current = {};
    setTick((t) => t + 1);
  }, []);

  return { metrics, metricsLoading, closes, retry };
}
