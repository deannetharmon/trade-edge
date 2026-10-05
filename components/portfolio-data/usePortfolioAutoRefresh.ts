// components/portfolio-data/usePortfolioAutoRefresh.ts

// PORTFOLIO-AUTOREFRESH-0001: React wiring for lib/portfolio-data/autoRefreshPolicy.ts. Checks every 15 seconds and whenever
// the tab becomes visible again; calls `refresh` only when the policy says one is due. Returns the current time so freshness
// text ("Updated 3 min ago") stays current between refreshes.

'use client';

import { useEffect, useRef, useState } from 'react';
import { isAutoRefreshDue } from '@/lib/portfolio-data/autoRefreshPolicy';
import { acquireAutoRefreshPause, isAutoRefreshPaused } from '@/lib/portfolio-data/autoRefreshPause';

export const AUTO_REFRESH_TICK_MS = 15 * 1000;

export interface PortfolioAutoRefreshOptions {
  refresh: () => Promise<unknown>;
  lastRefresh: Date | null;
  loading: boolean;
  enabled?: boolean;
  now?: () => number;
}

function tabVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function usePortfolioAutoRefresh({ refresh, lastRefresh, loading, enabled = true, now = Date.now }: PortfolioAutoRefreshOptions): number {
  const [nowMs, setNowMs] = useState(() => now());
  const latest = useRef({ refresh, lastRefresh, loading, now });
  latest.current = { refresh, lastRefresh, loading, now };
  const running = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      const current = latest.current;
      const t = current.now();
      setNowMs(t);
      const due = isAutoRefreshDue({
        nowMs: t,
        lastRefreshMs: current.lastRefresh ? current.lastRefresh.getTime() : null,
        visible: tabVisible(),
        paused: isAutoRefreshPaused(),
        inFlight: current.loading || running.current,
      });
      if (!due) return;
      running.current = true;
      void current.refresh().catch(() => undefined).finally(() => { running.current = false; });
    };
    const timer = setInterval(check, AUTO_REFRESH_TICK_MS);
    const onVisibility = () => { if (tabVisible()) check(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);

  return nowMs;
}

/** Holds an auto-refresh pause while `active` (an order dialog is open). */
export function useAutoRefreshPause(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return acquireAutoRefreshPause();
  }, [active]);
}
