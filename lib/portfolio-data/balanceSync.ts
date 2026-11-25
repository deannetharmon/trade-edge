// lib/portfolio-data/balanceSync.ts

// SPARKLINES-0001A: the broker balance-snapshot sync used to live inside the Balances tab, so history only filled in when
// that tab was opened (the cause of the gaps RECON-0003 found). It now lives here and runs from both the Balances tab and
// the Portfolio page. Behavior is the same as before: completed days only, saved through /api/balance-history, and the
// reason is returned (not thrown) when the sync cannot finish.

import { closedDaysOnly, todayNewYork } from './balancePerformance';
import { addDays } from './nlvSparkline';

export interface BalanceDayRecord {
  date: string;
  netLiquidatingValue: number;
  cashBalance: number;
  netOptionsValue: number;
}

export interface BalanceSyncDeps {
  ttFetch: (path: string, token: string) => Promise<any>;
  token: string;
  accountNumber: string;
  /** Defaults to the real fetch. Posts the completed days to /api/balance-history. */
  save?: (days: BalanceDayRecord[]) => Promise<{ ok: boolean; status: number }>;
  nowMs?: number;
  /** How far back to ask the broker for end-of-day snapshots. Default 400 (what the Performance page uses). */
  lookbackDays?: number;
}

async function defaultSave(days: BalanceDayRecord[]): Promise<{ ok: boolean; status: number }> {
  const res = await fetch('/api/balance-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days }),
  });
  return { ok: res.ok, status: res.status };
}

/**
 * SPARKLINES-0001A3 (Dean's live check, 2026-11-24): a call with no date range returns only the latest snapshot (broker docs),
 * which is why this sync, as the Balances tab ran it, filled history one stray day at a time and left the 10-06 gap. Ask for
 * a dated range of end-of-day snapshots, paged, as the Performance page already does (PERF-BALANCE-LOAD-0001); fall back to
 * the plain call if the ranged one returns nothing or is rejected.
 */
async function fetchSnapshotItems(ttFetch: BalanceSyncDeps['ttFetch'], token: string, accountNumber: string, todayNy: string, lookbackDays: number): Promise<any[]> {
  const items: any[] = [];
  try {
    const start = addDays(todayNy, -lookbackDays);
    for (let page = 0; page < 6; page += 1) {
      const snap = await ttFetch(`/accounts/${accountNumber}/balance-snapshots?time-of-day=EOD&start-date=${start}&end-date=${todayNy}&per-page=250&page-offset=${page}`, token);
      const pageItems: any[] = snap?.data?.items ?? [];
      items.push(...pageItems);
      if (pageItems.length === 0 || page + 1 >= Number(snap?.pagination?.['total-pages'] ?? 1)) break;
    }
  } catch {
    // fall through to the plain call
  }
  if (items.length === 0) {
    const plain = await ttFetch(`/accounts/${accountNumber}/balance-snapshots`, token);
    items.push(...(plain?.data?.items ?? []));
  }
  return items;
}

/** Returns null when the sync worked, otherwise the reason to show. */
export async function syncBalanceSnapshots({ ttFetch, token, accountNumber, save = defaultSave, nowMs = Date.now(), lookbackDays = 400 }: BalanceSyncDeps): Promise<string | null> {
  try {
    const items = await fetchSnapshotItems(ttFetch, token, accountNumber, todayNewYork(nowMs), lookbackDays);
    const days: BalanceDayRecord[] = items
      .map((item: any) => ({
        date: item['snapshot-date'],
        netLiquidatingValue: parseFloat(item['net-liquidating-value'] ?? '0'),
        cashBalance: parseFloat(item['cash-balance'] ?? '0'),
        netOptionsValue: parseFloat(item['long-derivative-value'] ?? '0') - parseFloat(item['short-derivative-value'] ?? '0'),
      }))
      .filter((d: BalanceDayRecord) => d.date && d.netLiquidatingValue !== 0);
    // BALANCE-CHART-0001: only completed days are stored; today's figure keeps changing and is drawn live instead.
    const closed = closedDaysOnly(days, todayNewYork(nowMs));
    if (closed.length === 0) return 'The broker returned no completed balance days.';
    const saved = await save(closed);
    return saved.ok ? null : `Saving balance history failed (${saved.status}).`;
  } catch (e) {
    return e instanceof Error ? `Balance history sync failed: ${e.message.slice(0, 160)}` : 'Balance history sync failed.';
  }
}
