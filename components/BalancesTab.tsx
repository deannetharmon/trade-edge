// components/BalancesTab.tsx

'use client';

import { useEffect, useState, useMemo } from 'react';
import { getAccessToken } from '@/lib/auth/tastytradeToken';
import { requireActiveBrokerAccount } from '@/lib/tastytrade/accountSelection';
import { closedDaysOnly, extractMoneyMovements, performanceSeries, todayNewYork, withLivePoint, type BalanceDayPoint, type MoneyMovement } from '@/lib/portfolio-data/balancePerformance';

const BASE = 'https://api.tastytrade.com';
const CLIENT_ID = '4d4c851b-bdaf-4ac9-b39b-811e604739f2';

// AUTH-TOKEN-CONSOLIDATION-0001: local copy (no expiry check at all)
// replaced with the shared, correct implementation.

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

async function loadCurrentAndSyncHistory(): Promise<{ current: CurrentBalances; accountNumber: string; movements: MoneyMovement[] }> {
  const token = await getAccessToken();
  const accountNumber = await requireActiveBrokerAccount(token, ttFetch, { forceValidation: true });

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
    // BALANCE-CHART-0001: only completed days are stored; today's figure keeps changing and is drawn live instead.
    const closed = closedDaysOnly(days, todayNewYork(Date.now()));

    if (closed.length > 0) {
      await fetch('/api/balance-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: closed }),
      });
    }
  } catch {
    // History sync is best-effort -- current balances above already loaded fine.
  }

  // BALANCE-CHART-0001: deposits / withdrawals, so the performance line does not treat them as gains or losses.
  let movements: MoneyMovement[] = [];
  try {
    const start = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
    const all: Record<string, unknown>[] = [];
    for (let page = 0; page < 8; page += 1) {
      const tx = await ttFetch(`/accounts/${accountNumber}/transactions?start-date=${start}&type=Money%20Movement&per-page=250&page-offset=${page}`, token);
      const items: Record<string, unknown>[] = tx?.data?.items ?? [];
      all.push(...items);
      const totalPages = Number(tx?.pagination?.['total-pages'] ?? 1);
      if (items.length === 0 || page + 1 >= totalPages) break;
    }
    movements = extractMoneyMovements(all);
  } catch {
    movements = [];
  }

  return { current, accountNumber, movements };
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

type ChartMode = 'PERFORMANCE' | 'NET_LIQ';

function BalanceChart({ history, movements, range, mode }: { history: BalanceDayPoint[]; movements: MoneyMovement[]; range: RangeKey; mode: ChartMode }) {
  const rangeConfig = RANGES.find(r => r.key === range)!;
  const [hover, setHover] = useState<number | null>(null);
  const filtered = useMemo(() => {
    if (rangeConfig.days == null) return history;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - rangeConfig.days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return history.filter(d => d.date >= cutoffStr);
  }, [history, rangeConfig]);
  const series = useMemo(() => (mode === 'PERFORMANCE' ? performanceSeries(filtered, movements) : filtered), [filtered, movements, mode]);

  if (series.length < 2) {
    return (
      <div className="flex items-center justify-center h-64 text-white/40 text-xs">
        Not enough history yet for this range — check back after a few more days of tracked balances.
      </div>
    );
  }

  const width = 900;
  const height = 260;
  const padLeft = 70;
  const pad = 24;
  const values = series.map(d => d.netLiquidatingValue);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const xOf = (i: number) => padLeft + (i / (series.length - 1)) * (width - padLeft - pad);
  const yOf = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const points = series.map((d, i) => ({ x: xOf(i), y: yOf(d.netLiquidatingValue), d }));
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${height - pad} L ${points[0].x.toFixed(1)} ${height - pad} Z`;
  const first = series[0].netLiquidatingValue;
  const last = series[series.length - 1].netLiquidatingValue;
  const isUp = last >= first;
  const lineColor = isUp ? '#00d4aa' : '#f87171';
  // Money movements are marked on the first plotted day on or after their date.
  const marks = movements
    .filter(m => m.date > series[0].date && m.date <= series[series.length - 1].date)
    .map(m => ({ m, index: series.findIndex(d => d.date >= m.date) }))
    .filter(x => x.index >= 0);
  const ticks = [max, (max + min) / 2, min];
  const hovered = hover != null ? series[hover] : null;
  const hoveredRaw = hover != null ? filtered[hover] : null;
  const hoveredMarks = hovered ? marks.filter(x => x.index === hover).map(x => x.m.label) : [];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-64"
        onMouseLeave={() => setHover(null)}
        onMouseMove={e => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * width;
          const i = Math.round(((x - padLeft) / (width - padLeft - pad)) * (series.length - 1));
          setHover(Math.max(0, Math.min(series.length - 1, i)));
        }}
      >
        <defs>
          <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padLeft} x2={width - pad} y1={yOf(t)} y2={yOf(t)} stroke="rgba(255,255,255,0.06)" />
            <text x={padLeft - 8} y={yOf(t) + 4} textAnchor="end" fontSize="11" fill="rgba(255,255,255,0.45)">{fmtMoney(t).replace(/\.\d\d$/, '')}</text>
          </g>
        ))}
        <path d={areaD} fill="url(#balanceFill)" />
        <path d={pathD} fill="none" stroke={lineColor} strokeWidth="2" />
        {marks.map((x, i) => (
          <circle key={`m${i}`} cx={points[x.index].x} cy={points[x.index].y} r={4} fill="#fbbf24" data-testid="money-movement-marker"><title>{x.m.label} ({x.m.date})</title></circle>
        ))}
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={3} fill={lineColor} />
        {hover != null && <line x1={points[hover].x} x2={points[hover].x} y1={pad} y2={height - pad} stroke="rgba(255,255,255,0.25)" />}
      </svg>
      {hovered && (
        <div className="pointer-events-none absolute top-0 right-0 rounded-md border border-white/10 bg-black/80 px-3 py-2 text-[11px]" data-testid="balance-hover">
          <p className="text-white/50">{hovered.date}{hover === series.length - 1 ? ' (live)' : ''}</p>
          <p className="font-bold">{mode === 'PERFORMANCE' ? 'Performance ' : 'Net liq '}{fmtMoney(hovered.netLiquidatingValue)}</p>
          {mode === 'PERFORMANCE' && hoveredRaw && <p className="text-white/50">Net liq {fmtMoney(hoveredRaw.netLiquidatingValue)}</p>}
          {hoveredMarks.map(l => <p key={l} className="text-amber-300">{l}</p>)}
        </div>
      )}
      <div className="flex justify-between text-[10px] text-white/40 mt-1 pl-[8%]">
        <span>{series[0].date}</span>
        <span>{series[series.length - 1].date} (live)</span>
      </div>
    </div>
  );
}

export default function BalancesTab() {
  const [current, setCurrent] = useState<CurrentBalances | null>(null);
  const [history, setHistory] = useState<BalanceDay[]>([]);
  const [movements, setMovements] = useState<MoneyMovement[]>([]);
  const [mode, setMode] = useState<ChartMode>('PERFORMANCE');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('3M');

  useEffect(() => {
    (async () => {
      try {
        const { current: cur, movements: moves } = await loadCurrentAndSyncHistory();
        setCurrent(cur);
        setMovements(moves);
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
              <p className="text-2xl font-bold" style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>{fmtMoney(current.netLiquidatingValue)}</p>
            </div>
            <div className="border border-white/10 rounded-xl p-5">
              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Cash Balance</p>
              <p className="text-2xl font-bold" style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>{fmtMoney(current.cashBalance)}</p>
            </div>
            <div className="border border-white/10 rounded-xl p-5">
              <p className="text-[10px] text-white/40 uppercase tracking-widest mb-1">Net Options Value</p>
              <p className={`text-2xl font-bold ${current.netOptionsValue >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
                {fmtSignedMoney(current.netOptionsValue)}
              </p>
            </div>
          </div>

          <div className="border border-white/10 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex gap-1">
                  {([['PERFORMANCE', 'Performance'], ['NET_LIQ', 'Net liq']] as [ChartMode, string][]).map(([key, label]) => (
                    <button key={key} onClick={() => setMode(key)} className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded transition-colors ${mode === key ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/70'}`}>{label}</button>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-white/40">{mode === 'PERFORMANCE' ? 'Excludes deposits and withdrawals (marked in amber)' : 'Account value, including deposits and withdrawals'}</p>
              </div>
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
            <BalanceChart history={withLivePoint(history, todayNewYork(Date.now()), current.netLiquidatingValue)} movements={movements} range={range} mode={mode} />
          </div>
        </>
      )}
    </div>
  );
}
