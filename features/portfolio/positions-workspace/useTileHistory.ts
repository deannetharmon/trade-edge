// features/portfolio/positions-workspace/useTileHistory.ts

// SPARKLINES-0001B/C: reads the daily records for the tile lines and writes the two new ones the broker snapshot does not keep:
// one P/L record per stock holding (key EQUITY:SYMBOL) and one Deployed Capital record (key PORTFOLIO:DEPLOYED). The server keeps
// the first record of each day and skips repeats, so posting on every load is safe.

'use client';

import { useEffect, useRef, useState } from 'react';
import { todayNewYork } from '@/lib/portfolio-data/balancePerformance';
import { DEPLOYED_KEY, type SnapStore } from '@/lib/portfolio-data/tileSparkline';
import { addDays } from '@/lib/portfolio-data/nlvSparkline';
import { backfillStockPnl, stockFills, type BrokerTx } from '@/lib/portfolio-data/equityBackfill';
import type { PortfolioSummary } from './model/portfolioSummary';

const nyDate = (unixSeconds: number) => new Date(unixSeconds * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

async function loadStore(): Promise<SnapStore | null> {
  const res = await fetch('/api/position-snapshots');
  if (!res.ok) return null;
  const data = await res.json();
  return data?.snapshots && typeof data.snapshots === 'object' ? data.snapshots : {};
}

/** SPARKLINES-0001D: fills in each held stock's past daily P/L from broker fills and daily closes. Returns true when it saved anything. */
async function backfillEquity(members: PortfolioSummary['total']['members']): Promise<boolean> {
  const todayNy = todayNewYork(Date.now());
  const from = addDays(todayNy, -29);
  const stocks = members.filter(m => m.kind === 'equity' && m.symbol && m.shares != null && m.shares > 0 && m.pnl != null && Number.isFinite(m.pnl));
  if (stocks.length === 0) return false;
  const acct = await (await fetch('/api/active-account')).json();
  const accountId: string | undefined = acct?.accountId ?? undefined;
  if (!accountId) return false;
  const txs: BrokerTx[] = [];
  for (let page = 0; page < 6; page += 1) {
    const path = `/accounts/${accountId}/transactions?start-date=${from}&per-page=250&page-offset=${page}`;
    const res = await fetch(`/api/tastytrade/proxy?path=${encodeURIComponent(path)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return false;
    const items: BrokerTx[] = (await res.json())?.data?.items ?? [];
    txs.push(...items);
    if (items.length < 250) break;
  }
  const empty = { dte: 0, currentValue: null, pnl: null, pnlPct: null, iv: null, theta: null, gamma: null, netDelta: null, stockPrice: null };
  const entries: Array<{ positionKey: string; snapshot: Record<string, unknown> }> = [];
  for (const m of stocks) {
    const res = await fetch(`/api/chart-history?symbol=${encodeURIComponent(m.symbol as string)}&years=1`);
    if (!res.ok) continue;
    const closes = new Map<string, number>();
    for (const c of ((await res.json())?.closes ?? []) as Array<{ t: number; c: number }>) closes.set(nyDate(c.t), c.c);
    const days = backfillStockPnl({ fills: stockFills(txs, m.symbol as string), closes, sharesNow: m.shares as number, pnlNow: m.pnl as number, from, todayNy });
    for (const d of days) entries.push({ positionKey: m.key, snapshot: { ...empty, date: d.date, pnl: d.pnl } });
  }
  if (entries.length === 0) return false;
  // The server keeps the first record of a day, so real readings already saved are never overwritten.
  const post = await fetch('/api/position-snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }) });
  return post.ok;
}

export function useTileHistory(summary: PortfolioSummary): SnapStore | null {
  const [store, setStore] = useState<SnapStore | null>(null);
  const posted = useRef<string>('');
  const backfilled = useRef<string>('');
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (typeof fetch === 'undefined') return;
        const loaded = await loadStore();
        if (alive && loaded) setStore(loaded);
      } catch { /* the lines show their dashed placeholder */ }
    })();
    return () => { alive = false; };
  }, []);

  // Once per day per set of stocks held (re-runs when a new stock appears), then reload the store so the lines redraw.
  const stockSignature = summary.total.members.filter(m => m.kind === 'equity' && m.shares != null && m.pnl != null).map(m => m.key).sort().join(',');
  useEffect(() => {
    if (store == null || !stockSignature) return;
    const signature = `${todayNewYork(Date.now())}|${stockSignature}`;
    if (backfilled.current === signature) return;
    backfilled.current = signature;
    let alive = true;
    (async () => {
      try {
        const saved = await backfillEquity(summary.total.members);
        if (!saved) return;
        const loaded = await loadStore();
        if (alive && loaded) setStore(loaded);
      } catch { /* background; the lines keep what they have */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store == null, stockSignature]);

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
