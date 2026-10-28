// features/research/ResearchView.tsx
'use client';

// RESEARCH-0001 slice 1 (Diane): look up any ticker without adding it to the screener. Price, day change, a range chart with a hover
// price, a short stats strip, and the actions that follow a look (add to the screener list, open on TradingView). Read-only.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RESEARCH_RANGE_ORDER, chartGeometry, chartLevelLines, dayChange, normalizeResearchSymbol, rangeChange,
  type ChartLevel, type ResearchChart, type ResearchRange,
} from '@/lib/research/yahooChart';
import type { THEMES, Theme } from '@/lib/theme';
import { ResearchFacts, type ResearchFactsDeps } from './ResearchFacts';
import { defaultResearchFactsDeps } from './defaultFactsDeps';

interface Props {
  th: (typeof THEMES)[Theme];
  /** Symbol to show on first render (from ?symbol=). */
  initialSymbol?: string | null;
  fetchImpl?: typeof fetch;
  /** Test seam for the facts panel; the page uses the real loaders. */
  factsDeps?: ResearchFactsDeps;
}

const usd = (v: number | null | undefined) => (v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const signed = (v: number) => `${v >= 0 ? '+' : '-'}${usd(Math.abs(v))}`;
const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
const compact = (v: number | null) => (v == null ? '—' : Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v));
const tone = (v: number) => (v >= 0 ? 'text-emerald-400' : 'text-red-400');

const W = 800;
const H = 260;

function formatWhen(t: number, range: ResearchRange): string {
  const d = new Date(t * 1000);
  return range === '1D' || range === '1W'
    ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ResearchView({ th, initialSymbol, fetchImpl, factsDeps }: Props) {
  const doFetch = fetchImpl ?? fetch;
  const deps = useMemo(() => factsDeps ?? defaultResearchFactsDeps(doFetch), [factsDeps, doFetch]);
  const [input, setInput] = useState(initialSymbol ?? '');
  const [symbol, setSymbol] = useState<string | null>(normalizeResearchSymbol(initialSymbol ?? ''));
  const [range, setRange] = useState<ResearchRange>('3M');
  const [chart, setChart] = useState<ResearchChart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [listStatus, setListStatus] = useState<'idle' | 'saving' | 'added' | 'exists' | 'error'>('idle');
  const [levels, setLevels] = useState<ChartLevel[]>([]);
  const [showLevels, setShowLevels] = useState(true);
  const requestId = useRef(0);

  useEffect(() => {
    if (!symbol) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    doFetch(`/api/research-chart?symbol=${encodeURIComponent(symbol)}&range=${range}`)
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (id !== requestId.current) return;
        if (!res.ok) { setChart(null); setError(body?.error ?? `Could not load ${symbol}`); return; }
        setChart(body as ResearchChart);
      })
      .catch(() => { if (id === requestId.current) { setChart(null); setError(`Could not load ${symbol}`); } })
      .finally(() => { if (id === requestId.current) setLoading(false); });
  }, [symbol, range, doFetch]);

  useEffect(() => { setListStatus('idle'); }, [symbol]);

  const submit = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    const next = normalizeResearchSymbol(input);
    if (!next) { setError('Enter a ticker, for example AAPL'); return; }
    setError(null);
    setHover(null);
    setSymbol(next);
    try { window.history.replaceState(null, '', `/research?symbol=${encodeURIComponent(next)}`); } catch {}
  }, [input]);

  const addToScreener = useCallback(async () => {
    if (!symbol) return;
    setListStatus('saving');
    try {
      const res = await doFetch('/api/watchlist');
      if (!res.ok) throw new Error('load');
      const data = await res.json();
      const tickers: { symbol: string; active: boolean }[] = Array.isArray(data?.tickers) ? data.tickers : [];
      if (tickers.some(t => t.symbol.toUpperCase() === symbol)) { setListStatus('exists'); return; }
      const put = await doFetch('/api/watchlist', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers: [...tickers, { symbol, active: true }] }) });
      setListStatus(put.ok ? 'added' : 'error');
    } catch { setListStatus('error'); }
  }, [symbol, doFetch]);

  const geometry = useMemo(() => (chart ? chartGeometry(chart.points, W, H) : null), [chart]);
  const levelLines = useMemo(() => (chart && showLevels ? chartLevelLines(chart.points, levels, H) : []), [chart, levels, showLevels]);
  const meta = chart?.meta ?? null;
  const last = chart && chart.points.length ? chart.points[chart.points.length - 1].c : null;
  const price = meta?.price ?? last;
  const today = dayChange(price, meta?.previousClose ?? null);
  const move = chart ? rangeChange(chart.points) : null;
  const shown = hover != null && chart ? chart.points[hover] : null;
  const lineTone = move ? tone(move.amount) : 'text-white/70';

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
      <form onSubmit={submit} className="flex gap-2" role="search" aria-label="Look up a stock">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Look up a ticker, e.g. NVDA"
          aria-label="Ticker"
          autoCapitalize="characters"
          className={`min-h-10 w-full max-w-xs rounded-lg border px-3 text-sm ${th.input} ${th.inputBorder} ${th.text}`}
        />
        <button type="submit" className="min-h-10 rounded-lg border border-teal-500/60 bg-teal-500/10 px-4 text-sm font-semibold text-teal-300">Look up</button>
      </form>

      {!symbol && !error && <p className={`mt-6 text-sm ${th.textFaint}`}>Search a ticker to see its price, chart and key stats. Nothing here is added to your screener until you choose to.</p>}
      {error && <p role="alert" className="mt-4 text-sm text-amber-300">{error}</p>}

      {symbol && chart && meta && (
        <section aria-label={`${symbol} overview`} className={`mt-5 rounded-xl border ${th.border} ${th.card} p-4 sm:p-5`}>
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className={`text-2xl font-bold ${th.text}`}>{symbol}{meta.name && <span className={`ml-2 text-sm font-normal ${th.textFaint}`}>{meta.name}</span>}</h1>
              <p className={`mt-1 text-3xl font-bold ${th.text}`} data-testid="research-price">{usd(shown ? shown.c : price)}</p>
              {shown
                ? <p className={`text-sm ${th.textFaint}`} data-testid="research-hover-when">{formatWhen(shown.t, range)}</p>
                : today && <p className={`text-sm font-semibold ${tone(today.amount)}`} data-testid="research-day-change">{signed(today.amount)} ({pct(today.pct)}) <span className={`font-normal ${th.textFaint}`}>today</span></p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={addToScreener} disabled={listStatus === 'saving' || listStatus === 'added' || listStatus === 'exists'} className="min-h-9 rounded-lg border border-teal-500/60 px-3 text-xs font-semibold text-teal-300 disabled:opacity-60">
                {listStatus === 'added' ? 'Added to screener list' : listStatus === 'exists' ? 'Already in screener list' : listStatus === 'saving' ? 'Adding…' : 'Add to screener list'}
              </button>
              <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noopener noreferrer" className={`flex min-h-9 items-center rounded-lg border px-3 text-xs ${th.border} ${th.text}`}>TradingView ↗</a>
            </div>
          </header>
          {listStatus === 'error' && <p role="alert" className="mt-2 text-xs text-amber-300">Could not update your screener list. Try again.</p>}

          <div className="relative mt-4">
            {geometry ? (
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-56 w-full touch-none sm:h-64" role="img" aria-label={`${symbol} price, ${range}`}
                onMouseLeave={() => setHover(null)}
                onMouseMove={event => {
                  const box = event.currentTarget.getBoundingClientRect();
                  const x = ((event.clientX - box.left) / box.width) * W;
                  const idx = Math.round((x / W) * (chart.points.length - 1));
                  setHover(Math.max(0, Math.min(chart.points.length - 1, idx)));
                }}>
                <polyline points={geometry.path} fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke" className={`${lineTone} stroke-current`} />
                {levelLines.map(l => (
                  <line key={`${l.kind}-${l.price}`} x1={0} x2={W} y1={l.y} y2={l.y} strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" data-testid="chart-level-line"
                    className={l.kind === 'support' ? 'stroke-emerald-400/70' : l.kind === 'resistance' ? 'stroke-red-400/70' : 'stroke-white/35'} />
                ))}
                {hover != null && <line x1={geometry.xs[hover]} x2={geometry.xs[hover]} y1={0} y2={H} strokeWidth={1} vectorEffect="non-scaling-stroke" className="stroke-white/40" />}
              </svg>
            ) : <p className={`py-10 text-center text-sm ${th.textFaint}`}>Chart data unavailable for this range.</p>}
            {levelLines.length > 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-56 sm:h-64" aria-hidden="true">
                {levelLines.map(l => (
                  <span key={`${l.kind}-${l.price}`} data-testid="chart-level-label" style={{ top: `${(l.y / H) * 100}%` }}
                    className={`absolute right-1 -translate-y-full rounded bg-black/50 px-1 text-[10px] leading-4 ${l.kind === 'support' ? 'text-emerald-300' : l.kind === 'resistance' ? 'text-red-300' : 'text-white/60'}`}>
                    {l.label} {usd(l.price)}
                  </span>
                ))}
              </div>
            )}
            {loading && <p className={`absolute right-2 top-2 text-xs ${th.textFaint}`} role="status">Loading…</p>}
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div role="group" aria-label="Chart range" className="flex gap-1">
              {RESEARCH_RANGE_ORDER.map(r => (
                <button key={r} type="button" aria-pressed={r === range} onClick={() => { setRange(r); setHover(null); }}
                  className={`min-h-8 rounded-md px-3 text-xs font-semibold ${r === range ? 'bg-white/15 text-white' : `${th.textFaint} hover:text-white`}`}>{r}</button>
              ))}
            </div>
            <button type="button" aria-pressed={showLevels} onClick={() => setShowLevels(s => !s)} className={`min-h-8 rounded-md border px-3 text-xs ${th.border} ${showLevels ? 'text-white' : th.textFaint}`}>Levels</button>
            {move && <span className={`text-xs font-semibold ${lineTone}`} data-testid="research-range-change">{signed(move.amount)} ({pct(move.pct)}) {range}</span>}
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="research-stats">
            {[
              ['Previous close', usd(meta.previousClose)],
              ['52-week high', usd(meta.fiftyTwoWeekHigh)],
              ['52-week low', usd(meta.fiftyTwoWeekLow)],
              ['Volume', compact(meta.volume)],
            ].map(([label, value]) => (
              <div key={label} className={`rounded-lg border px-3 py-2 ${th.border}`}>
                <dt className={`text-[10px] uppercase tracking-wider ${th.textFaint}`}>{label}</dt>
                <dd className={`text-sm font-bold ${th.text}`}>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {symbol && chart && meta && <ResearchFacts symbol={symbol} th={th} deps={deps} onLevels={setLevels} />}
    </div>
  );
}
