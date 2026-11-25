// features/portfolio/positions-workspace/useTileHistory.ts

// SPARKLINES-0001B/C: reads the daily records for the tile lines and writes the two new ones the broker snapshot does not keep:
// one P/L record per stock holding (key EQUITY:SYMBOL) and one Deployed Capital record (key PORTFOLIO:DEPLOYED). The server keeps
// the first record of each day and skips repeats, so posting on every load is safe.

'use client';

import { useEffect, useRef, useState } from 'react';
import { todayNewYork } from '@/lib/portfolio-data/balancePerformance';
import { DEPLOYED_KEY, type SnapStore } from '@/lib/portfolio-data/tileSparkline';
import type { PortfolioSummary } from './model/portfolioSummary';

export function useTileHistory(summary: PortfolioSummary): SnapStore | null {
  const [store, setStore] = useState<SnapStore | null>(null);
  const posted = useRef<string>('');
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (typeof fetch === 'undefined') return;
        const res = await fetch('/api/position-snapshots');
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setStore(data?.snapshots && typeof data.snapshots === 'object' ? data.snapshots : {});
      } catch { /* the lines show their dashed placeholder */ }
    })();
    return () => { alive = false; };
  }, []);

  const { headline, total } = summary;
  const deployed = headline.deployedPartial ? null : headline.deployed;
  useEffect(() => {
    const date = todayNewYork(Date.now());
    const empty = { dte: 0, currentValue: null, pnl: null, pnlPct: null, iv: null, theta: null, gamma: null, netDelta: null, stockPrice: null };
    const entries: Array<{ positionKey: string; snapshot: Record<string, unknown> }> = [];
    for (const m of total.members) {
      if (m.kind === 'equity' && m.pnl != null && Number.isFinite(m.pnl)) entries.push({ positionKey: m.key, snapshot: { ...empty, date, pnl: m.pnl } });
    }
    if (deployed != null && Number.isFinite(deployed) && deployed > 0) entries.push({ positionKey: DEPLOYED_KEY, snapshot: { ...empty, date, currentValue: deployed } });
    if (entries.length === 0) return;
    const signature = `${date}|${entries.map(e => e.positionKey).sort().join(',')}`;
    if (posted.current === signature) return;
    posted.current = signature;
    try {
      void Promise.resolve(fetch('/api/position-snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }) })).catch(() => {});
    } catch { /* background record; never blocks the page */ }
  }, [total.members, deployed]);

  return store;
}
