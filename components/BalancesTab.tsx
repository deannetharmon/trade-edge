// components/BalancesTab.tsx

'use client';

import { useEffect, useState, useMemo } from 'react';
import { refreshBrowserAccessToken } from '@/lib/tastytrade/browser-token';

const BASE = 'https://api.tastytrade.com';
const CLIENT_ID = '4d4c851b-bdaf-4ac9-b39b-811e604739f2';

async function getAccessToken(): Promise<string> {
  const cached = sessionStorage.getItem('tt_access_token');
  if (cached) return cached;
  let token: string;
  try { token = await refreshBrowserAccessToken(); }
  catch { window.location.href = '/login'; throw new Error('Session expired'); }
  sessionStorage.setItem('tt_access_token', token);
  return token;
}

async function ttFetch(path: string, token: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (res.status === 401) { sessionStorage.removeItem('tt_access_token'); window.location.href = '/login'; throw new Error('Session expired'); }
  if (!res.ok) { const text = await res.text(); throw new Error(`${path} failed (${res.status}): ${text.slice(0, 200)}`); }
  return res.json();
}

interface BalanceDay {
  date: string;
  netLiquidatingValue: number;
  cashBalance: number;
  netOptionsValue: number;
}

interface CurrentBalances {
  netLiquidatingValue: number;
  cashBalance: number;
  netOptionsValue: number;
}

type RangeKey = '1M' | '2M' | '3M' | '4M' | '6M' | '12M' | 'ALL';
const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: '1M', label: '1M', days: 30 },
  { key: '2M', label: '2M', days: 60 },
  { key: '3M', label: '3M', days: 90 },
  { key: '4M', label: '4M', days: 120 },
  { key: '6M', label: '6M', days: 180 },
  { key: '12M', label: '12M', days: 365 },
  { key: 'ALL', label: 'ALL', days: null },
];

function fmtMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtSignedMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function loadCurrentAndSyncHistory(): Promise<{ current: CurrentBalances; accountNumber: string }> {
  const token = await getAccessToken();
  const accountsData = await ttFetch('/customers/me/accounts', token);
  const account = accountsData?.data?.items?.find((a: any) => a.account['account-number'] === '5WI51392')
    ?? accountsData?.data?.items?.[0];
  const accountNumber = account?.account?.['account-number'];
  if (!accountNumber) throw new Error('No account found');

  const balData = await ttFetch(`/accounts/${accountNumber}/balances`, token);
  const b = balData?.data ?? {};
  const current: CurrentBalances = {
    netLiquidatingValue: parseFloat(b['net-liquidating-value'] ?? '0'),
    cashBalance: parseFloat(b['cash-balance'] ?? '0'),
    netOptionsValue: parseFloat(b['long-derivative-value'] ?? '0') - parseFloat(b['short-derivative-value'] ?? '0'),
  };

  try {
    const snapData = await ttFetch(`/accounts/${accountNumber}/balance-snapshots`, token);
    const items = snapData?.data?.items ?? [];
    const days: BalanceDay[] = items
      .map((item: any) => ({
        date: item['snapshot-date'],
        netLiquidatingValue: parseFloat(item['net-liquidating-value'] ?? '0'),
        cashBalance: parseFloat(item['cash-balance'] ?? '0'),
        netOptionsValue: parseFloat(item['long-derivative-value'] ?? '0') - parseFloat(item['short-derivative-value'] ?? '0'),
      }))
      .filter((d: BalanceDay) => d.date && d.netLiquidatingValue !== 0);

    if (days.length > 0) {
      await fetch('/api/balance-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days }),
      });
    }
  } catch {
    // History sync is best-effort -- current balances above already loaded fine.
  }

  return { current, accountNumber };
}

async function fetchHistory(): Promise<BalanceDay[]> {
  try {
    const res = await fetch('/api/balance-history');
    if (!res.ok) return [];
    const data = await res.json();
    return data?.history ?? [];
  } catch {
    return [];
  }
}

function BalanceChart({ history, range }: { history: BalanceDay[]; range: RangeKey }) {
  const rangeConfig = RANGES.find(r => r.key === range)!;
  const filtered = useMemo(() => {
    if (rangeConfig.days == null) return history;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - rangeConfig.days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return history.filter(d => d.date >= cutoffStr);
  }, [history, rangeConfig]);

  if (filtered.length < 2) {
    return (
      <div className="flex items-center justify-center h-64 text-white/40 text-xs">
        Not enough history yet for this range — check back after a few more days of tracked balances.
      </div>
    );
  }

  const width = 900;
  const height = 260;
  const padding = 40;
  const values = filtered.map(d => d.netLiquidatingValue);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const points = filtered.map((d, i) => {
    const x = padding + (i / (filtered.length - 1)) * (width - padding * 2);
    const y = height - padding - ((d.netLiquidatingValue - min) / span) * (height - padding * 2);
    return { x, y, d };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${height - padding} L ${points[0].x.toFixed(1)} ${height - padding} Z`;

  const first = filtered[0].netLiquidatingValue;
  const last = filtered[filtered.length - 1].netLiquidatingValue;
  const isUp = last >= first;
  const lineColor = isUp ? '#00d4aa' : '#f87171';

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-64">
        <defs>
          <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#balanceFill)" />
        <path d={pathD} fill="none" stroke={lineColor} strokeWidth="2" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === points.length - 1 ? 3 : 0} fill={lineColor} />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-white/40 mt-1">
        <span>{filtered[0].date}</span>
        <span>{filtered[filtered.length - 1].date}</span>
      </div>
    </div>
  );
}

export default function BalancesTab() {
  const [current, setCurrent] = useState<CurrentBalances | null>(null);
  const [history, setHistory] = useState<BalanceDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('3M');

  useEffect(() => {
    (async () => {
      try {
        const { current: cur } = await loadCurrentAndSyncHistory();
        setCurrent(cur);
        const hist = await fetchHistory();
        setHistory(hist);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      {loading && <p className="text-white/40 text-sm">Loading balances...</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {!loading && current && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="border border-white/10 rounded-xl p-5">
              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Net Liquidating Value</p>
              <p className="text-2xl font-bold" style={{ fontFamily: "'DM Mono', monospace" }}>{fmtMoney(current.netLiquidatingValue)}</p>
            </div>
            <div className="border border-white/10 rounded-xl p-5">
              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Cash Balance</p>
              <p className="text-2xl font-bold" style={{ fontFamily: "'DM Mono', monospace" }}>{fmtMoney(current.cashBalance)}</p>
            </div>
            <div className="border border-white/10 rounded-xl p-5">
              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Net Options Value</p>
              <p className={`text-2xl font-bold ${current.netOptionsValue >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                {fmtSignedMoney(current.netOptionsValue)}
              </p>
            </div>
          </div>

          <div className="border border-white/10 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] text-white/40 uppercase tracking-widest">Net Liq Over Time</p>
              <div className="flex gap-1">
                {RANGES.map(r => (
                  <button
                    key={r.key}
                    onClick={() => setRange(r.key)}
                    className={`text-[10px] font-bold px-2.5 py-1 rounded transition-colors ${
                      range === r.key ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/70'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <BalanceChart history={history} range={range} />
          </div>
        </>
      )}
    </div>
  );
}
