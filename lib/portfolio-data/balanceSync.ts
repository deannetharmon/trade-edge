// lib/portfolio-data/balanceSync.ts

// SPARKLINES-0001A: the broker balance-snapshot sync used to live inside the Balances tab, so history only filled in when
// that tab was opened (the cause of the gaps RECON-0003 found). It now lives here and runs from both the Balances tab and
// the Portfolio page. Behavior is the same as before: completed days only, saved through /api/balance-history, and the
// reason is returned (not thrown) when the sync cannot finish.

import { closedDaysOnly, todayNewYork } from './balancePerformance';

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
}

async function defaultSave(days: BalanceDayRecord[]): Promise<{ ok: boolean; status: number }> {
  const res = await fetch('/api/balance-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days }),
  });
  return { ok: res.ok, status: res.status };
}

/** Returns null when the sync worked, otherwise the reason to show. */
export async function syncBalanceSnapshots({ ttFetch, token, accountNumber, save = defaultSave, nowMs = Date.now() }: BalanceSyncDeps): Promise<string | null> {
  try {
    const snapData = await ttFetch(`/accounts/${accountNumber}/balance-snapshots`, token);
    const items = snapData?.data?.items ?? [];
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
