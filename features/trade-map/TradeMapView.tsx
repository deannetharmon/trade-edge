// features/trade-map/TradeMapView.tsx
//
// OPTMAP-0001 S2: read-only Trade Map. Pick a symbol, strategy, expiry and
// strikes from the live TastyTrade chain, see a price x date P/L grid, chance
// of profit and max profit / max loss. Polls quotes every 5s and shows the
// real-time gate status. Planning only: there is no Send button and no order
// path in this slice. Stale data is labelled, controls stay enabled so the
// tool works after hours.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ttFetch } from '@/lib/tastytrade/client';
import type { Theme } from '@/lib/theme';
import { THEMES } from '@/lib/theme';
import {
  fetchMetrics, fetchNestedChain, fetchOptionQuotes, fetchUnderlyingQuote, symbolKey,
  type ChainExpiration, type OptionQuote, type UnderlyingMetrics, type UnderlyingQuote,
} from '@/lib/trademap/chain';
import { chanceOfProfit } from '@/lib/trademap/pop';
import { cellDetail } from '@/lib/trademap/cellDetail';
import CellDetailPanel from './CellDetailPanel';
import OptimizePanel from './OptimizePanel';
import { candidateToMap, runOptimize, type OptimizeResult } from '@/lib/trademap/optimize';
import { classifyUnderlying } from '@/lib/scans/tastytrade-client';
import { getSavedEtfRules, getSavedRules } from '@/lib/scans/savedRules';
import { getAccessToken } from '@/lib/auth/tastytradeToken';
import type { SpreadCandidate } from '@/lib/scans/types';
import { evaluateGate, type GateQuote } from '@/lib/trademap/realtimeGate';
import { DEFAULT_PRICING_PARAMS, buildDateAxis, buildDisplayPriceAxis, computeGrid } from '@/lib/trademap/gridModel';
import { DISPLAY_MODES, PRIMARY_MODES, formatModeValue, modeValue, type DisplayMode } from '@/lib/trademap/displayModes';
import TradeGraph from './TradeGraph';
import SendDialog from './SendDialog';
import StrikeStrip, { type StripLegInfo } from './StrikeStrip';
import { barRight, dragLeg, markersFor, stepStrike, stripWindow, THIN_OI } from '@/lib/trademap/stripModel';
import { netCreditAtMid, sendBlockers, sendSupported } from '@/lib/orders/tradeMapEntry';
import type { LegQuote, Wing } from '@/lib/trademap/ruleChecks';
import { parseTradeMapParams, type TradeMapPrefill } from '@/lib/trademap/deepLink';
import { buildCurve } from '@/lib/trademap/graphModel';
import { expiryMetrics } from '@/lib/trademap/strategyLegs';
import {
  STRATEGIES, buildTradeLegs, defaultAnchorStrike, defaultWidthSteps, legSpecs, type StrategyId,
} from '@/lib/trademap/strategies';

const POLL_MS = 5000;
const ROWS = 11;
const COLS = 5;

const fetcher = (path: string) => ttFetch(path, '');

function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m) - 1]} ${Number(d)}`;
}

function money(v: number | null): string {
  if (v == null) return '—';
  return `${v < 0 ? '-' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
}

export default function TradeMapView({ theme }: { theme: Theme }) {
  const th = THEMES[theme];
  const [symbolInput, setSymbolInput] = useState('SPY');
  const [symbol, setSymbol] = useState<string | null>(null);
  const [chain, setChain] = useState<ChainExpiration[]>([]);
  const [metrics, setMetrics] = useState<UnderlyingMetrics | null>(null);
  const [underlying, setUnderlying] = useState<UnderlyingQuote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [strategy, setStrategy] = useState<StrategyId>('bps');
  const [expiry, setExpiry] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [widthSteps, setWidthSteps] = useState(1);
  const [rangePct, setRangePct] = useState<number | null>(null);
  const [ivMult, setIvMult] = useState(1);
  const [mode, setMode] = useState<DisplayMode>('pl-dollar');
  const [view, setView] = useState<'table' | 'graph'>('table');
  const [dateIdx, setDateIdx] = useState<number | null>(null);

  const [quotes, setQuotes] = useState<Record<string, OptionQuote>>({});
  const [lastSuccessMs, setLastSuccessMs] = useState<number | null>(null);
  const [successfulPolls, setSuccessfulPolls] = useState(0);
  const [pollError, setPollError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [axisSpot, setAxisSpot] = useState<number | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  // The grid cell the trader clicked (stock price and date); null shows today at the current price.
  // Optimize (S5): the screener's own pick for this symbol; `prev` is what the map held before it was loaded.
  const [opt, setOpt] = useState<{ result: OptimizeResult; widthDollars: number | null; prev: { anchor: number; widthSteps: number } | null } | null>(null);
  const [optBusy, setOptBusy] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);
  const [selCell, setSelCell] = useState<{ price: number; date: string } | null>(null);
  // Slow-refresh quotes for the strikes on the strip (open interest, and quotes for a leg just moved to). The 5 s poll below
  // stays the only source for the live gate and for Send.
  const [stripQuotes, setStripQuotes] = useState<Record<string, OptionQuote>>({});

  const today = localIso(new Date(nowMs));
  const exp = useMemo(() => chain.find(c => c.date === expiry) ?? null, [chain, expiry]);
  const spot = underlying?.price ?? null;
  const expiryIv = exp && metrics ? metrics.ivByExpiration[exp.date] ?? null : null;
  const expectedMove = expiryIv != null && exp ? expiryIv * Math.sqrt(exp.dte / 365) : null;

  const specs = useMemo(
    () => (exp && anchor != null && spot != null ? legSpecs(strategy, exp, anchor, spot, widthSteps) : null),
    [exp, anchor, spot, strategy, widthSteps],
  );
  const symbolsKey = specs ? specs.map(s => s.symbol).join('|') : '';

  const pendingRef = useRef<TradeMapPrefill | null>(null);
  const load = useCallback(async (prefill?: TradeMapPrefill) => {
    const sym = (prefill?.symbol ?? symbolInput).trim().toUpperCase();
    if (!sym) return;
    setLoading(true); setLoadError(null);
    try {
      const t = localIso(new Date());
      const [c, m, u] = await Promise.all([fetchNestedChain(fetcher, sym, t), fetchMetrics(fetcher, sym), fetchUnderlyingQuote(fetcher, sym)]);
      if (c.length === 0) throw new Error('No listed expirations found for that symbol');
      if (!u) throw new Error('No stock quote available for that symbol');
      const nearest30 = c.reduce((best, e) => (Math.abs(e.dte - 30) < Math.abs(best.dte - 30) ? e : best), c[0]);
      setSymbol(sym); setChain(c); setMetrics(m); setUnderlying(u);
      const wanted = prefill?.expiry ? c.find(e => e.date === prefill.expiry) : null;
      pendingRef.current = prefill ?? null;
      if (prefill?.strategy) setStrategy(prefill.strategy);
      setExpiry((wanted ?? nearest30).date); setRangePct(null); setIvMult(1);
      setQuotes({}); setStripQuotes({}); setLastSuccessMs(null); setSuccessfulPolls(0);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Load failed');
    } finally { setLoading(false); }
  }, [symbolInput]);

  // Choose default strikes when the symbol, expiry or strategy changes (not on every price tick).
  const spotRef = useRef<number | null>(null);
  spotRef.current = spot;
  useEffect(() => {
    if (!exp || spotRef.current == null) return;
    const strikes = exp.strikes.map(s => s.strike);
    const move = metrics && metrics.ivByExpiration[exp.date] != null ? metrics.ivByExpiration[exp.date] * Math.sqrt(exp.dte / 365) : null;
    const pend = pendingRef.current;
    pendingRef.current = null;
    setAnchor(pend?.strike != null && strikes.indexOf(pend.strike) >= 0 ? pend.strike : defaultAnchorStrike(strategy, strikes, spotRef.current, move));
    const idxShort = pend?.strike != null ? strikes.indexOf(pend.strike) : -1;
    const idxLong = pend?.longStrike != null ? strikes.indexOf(pend.longStrike) : -1;
    const derived = idxShort >= 0 && idxLong >= 0 && idxShort !== idxLong ? Math.abs(idxShort - idxLong) : null;
    setWidthSteps(derived != null && derived <= 10 ? derived : pend?.width != null ? pend.width : defaultWidthSteps(strikes, spotRef.current));
    setAxisSpot(spotRef.current);
    setDateIdx(null);
    setRangePct(null);
  }, [exp, strategy, metrics]);

  // Open prefilled from a link (/trade-map?symbol=...).
  useEffect(() => {
    const pre = parseTradeMapParams(window.location.search);
    if (pre.symbol) { setSymbolInput(pre.symbol); load(pre); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll quotes every 5s for the stock and the strategy's legs.
  useEffect(() => {
    if (!symbol || !specs) return;
    let cancelled = false;
    setSuccessfulPolls(0);
    const poll = async () => {
      try {
        const [u, q] = await Promise.all([fetchUnderlyingQuote(fetcher, symbol), fetchOptionQuotes(fetcher, specs.map(s => s.symbol))]);
        if (cancelled) return;
        if (u) setUnderlying(u);
        setQuotes(q);
        setLastSuccessMs(Date.now());
        setSuccessfulPolls(n => n + 1);
        setPollError(null);
      } catch (e) {
        if (!cancelled) setPollError(e instanceof Error ? e.message : 'Poll failed');
      }
    };
    // A short delay, so dragging a marker across many strikes sends one quote request when it stops, not one per strike.
    const first = setTimeout(poll, 250);
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearTimeout(first); clearInterval(id); };
  }, [symbol, symbolsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const allQuotes = useMemo(() => ({ ...stripQuotes, ...quotes }), [stripQuotes, quotes]);
  const built = useMemo(() => (specs && exp ? buildTradeLegs(specs, exp.date, allQuotes) : null), [specs, exp, allQuotes]);
  const legs = built?.legs ?? null;
  const em = legs ? expiryMetrics(legs) : null;
  const params = useMemo(() => ({ ...DEFAULT_PRICING_PARAMS, dividendYield: metrics?.dividendYield ?? 0, ivMultiplier: ivMult }), [metrics, ivMult]);
  const effRange = rangePct ?? (expectedMove != null ? Math.min(0.5, Math.max(0.05, expectedMove)) : 0.2);

  // ── Strike strip (S2i) ──
  const allStrikes = useMemo(() => exp?.strikes.map(k => k.strike) ?? [], [exp]);
  const markers = useMemo(() => (specs ? markersFor(strategy, specs) : []), [specs, strategy]);
  const stripStrikes = useMemo(
    () => (exp && (axisSpot ?? spot) != null ? stripWindow(allStrikes, (axisSpot ?? spot) as number, effRange, markers.map(m => m.strike)) : []),
    [exp, allStrikes, axisSpot, spot, effRange, markers],
  );
  const symbolAt = useCallback((k: number): string | null => {
    const row = exp?.strikes.find(r => r.strike === k);
    if (!row) return null;
    return barRight(strategy, k, (axisSpot ?? spot ?? k)) === 'P' ? row.put : row.call;
  }, [exp, strategy, axisSpot, spot]);
  const stripSymbols = useMemo(() => stripStrikes.map(symbolAt).filter((x): x is string => !!x), [stripStrikes, symbolAt]);
  const stripKey = stripSymbols.join('|');
  useEffect(() => {
    if (!symbol || stripSymbols.length === 0) return;
    let cancelled = false;
    const run = async () => {
      try { const q = await fetchOptionQuotes(fetcher, stripSymbols); if (!cancelled) setStripQuotes(q); } catch { /* the strip is optional: the 5 s poll still drives the gate */ }
    };
    run();
    const id = setInterval(run, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, [symbol, stripKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const stripOi = useMemo(() => {
    const out: Record<number, number | null> = {};
    for (const k of stripStrikes) { const sym = symbolAt(k); out[k] = sym ? allQuotes[symbolKey(sym)]?.openInterest ?? null : null; }
    return out;
  }, [stripStrikes, symbolAt, allQuotes]);
  const legInfo: StripLegInfo[] = (specs ?? []).map(sp => {
    const q = allQuotes[symbolKey(sp.symbol)];
    const oi = q?.openInterest ?? null;
    const fmt = (n: number | null | undefined, d = 2) => (n == null ? '—' : n.toFixed(d));
    return {
      label: `${sp.side === 'long' ? 'Long' : 'Short'} ${sp.strike} ${sp.right === 'P' ? 'put' : 'call'}`,
      text: `bid ${fmt(q?.bid)} / ask ${fmt(q?.ask)} · delta ${fmt(q?.delta)} · OI ${oi == null ? '—' : oi.toLocaleString()}`,
      tone: oi == null ? 'plain' : oi >= THIN_OI ? 'good' : 'thin',
    };
  });
  const moveLeg = useCallback((role: 'anchor' | 'width' | 'slide', strike: number) => {
    if (!exp || spot == null || anchor == null) return;
    const r = dragLeg({ strategy, chain: exp, spot, anchor, widthSteps, role, targetStrike: strike });
    if (!r) return;
    if (r.anchor !== anchor) setAnchor(r.anchor);
    if (r.widthSteps !== widthSteps) setWidthSteps(r.widthSteps);
  }, [exp, spot, anchor, widthSteps, strategy]);
  const stepLeg = useCallback((role: 'anchor' | 'width', dir: -1 | 1) => {
    const from = role === 'anchor' ? anchor : markers.find(m => m.role === 'width')?.strike;
    if (from == null) return;
    moveLeg(role, stepStrike(allStrikes, from, dir));
  }, [anchor, markers, allStrikes, moveLeg]);
  const optimizeSupported = strategy === 'bps' || strategy === 'bcs';
  useEffect(() => { setOpt(null); setOptError(null); }, [symbol, expiry, strategy]);
  const loadCandidate = useCallback((c: SpreadCandidate, keepPrev: { anchor: number; widthSteps: number } | null) => {
    if (!exp) return false;
    const m = candidateToMap(c, exp);
    if (!m) return false;
    setAnchor(m.anchor); setWidthSteps(m.widthSteps);
    setOpt(o => (o ? { ...o, prev: keepPrev ?? o.prev } : o));
    return true;
  }, [exp]);
  const runOptimizeNow = useCallback(async () => {
    if (!exp || spot == null || !symbol || !specs || specs.length < 2 || !optimizeSupported) return;
    setOptBusy(true); setOptError(null);
    try {
      const kind = await classifyUnderlying(symbol, await getAccessToken());
      const rules = kind === 'index' || kind === 'etf' ? getSavedEtfRules() : getSavedRules();
      const side = strategy === 'bps' ? 'put' : 'call';
      const symbols = exp.strikes.map(r => r[side]).filter((x): x is string => !!x);
      const q = await fetchOptionQuotes(fetcher, symbols);
      const widthDollars = Math.abs(specs[0].strike - specs[1].strike);
      const result = runOptimize({ strategy: strategy as 'bps' | 'bcs', exp, quotes: q, price: spot, expirationIv: expiryIv, rules, widthDollars });
      const prev = anchor != null ? { anchor, widthSteps } : null;
      setOpt({ result, widthDollars, prev });
      if (result.pick) {
        const m = candidateToMap(result.pick, exp);
        if (m) { setAnchor(m.anchor); setWidthSteps(m.widthSteps); }
      }
    } catch (e) {
      setOptError(e instanceof Error ? e.message : 'Optimize failed');
    } finally { setOptBusy(false); }
  }, [exp, spot, symbol, specs, strategy, optimizeSupported, expiryIv, anchor, widthSteps]);
  const strikeLabel = (k: number): string => {
    const sym = symbolAt(k);
    const q = sym ? allQuotes[symbolKey(sym)] : undefined;
    if (!q) return String(k);
    return `${k}${q.delta != null ? ` · Δ${Math.abs(q.delta).toFixed(2)}` : ''}${q.openInterest != null ? ` · OI ${q.openInterest.toLocaleString()}` : ''}`;
  };
  const widthOptions = Array.from(new Set([1, 2, 3, 4, 5, 6, 8, 10, widthSteps])).sort((a, b) => a - b);

  const grid = useMemo(() => {
    if (!legs || !exp || axisSpot == null) return null;
    const prices = buildDisplayPriceAxis(axisSpot, effRange, ROWS);
    const dates = buildDateAxis(today, exp.date, COLS);
    return prices && dates ? computeGrid(legs, prices, dates, params) : null;
  }, [legs, exp, axisSpot, effRange, params, today]);

  const sliderDates = useMemo(() => (exp ? buildDateAxis(today, exp.date, 60) : null), [exp, today]);
  const curveDate = sliderDates ? sliderDates[Math.min(dateIdx ?? sliderDates.length - 1, sliderDates.length - 1)] : null;
  const curves = useMemo(() => {
    if (view !== 'graph' || !legs || !exp || axisSpot == null || !curveDate) return null;
    const selected = buildCurve(legs, axisSpot, effRange, curveDate, params);
    const expiryCurve = buildCurve(legs, axisSpot, effRange, exp.date, params);
    return selected && expiryCurve ? { selected, expiry: expiryCurve } : null;
  }, [view, legs, exp, axisSpot, effRange, curveDate, params]);

  const pop = useMemo(
    () => (legs && spot != null && expiryIv != null ? chanceOfProfit(legs, spot, today, expiryIv, params.riskFreeRate, params.dividendYield) : null),
    [legs, spot, expiryIv, today, params],
  );

  const selValid = !!(selCell && grid && grid.prices.indexOf(selCell.price) >= 0 && grid.dates.indexOf(selCell.date) >= 0);
  const detail = useMemo(() => {
    if (!legs || spot == null) return null;
    if (selCell && selValid) return cellDetail(legs, selCell.price, selCell.date, today, params, expiryIv);
    return cellDetail(legs, spot, today, today, params, expiryIv);
  }, [legs, spot, selCell, selValid, today, params, expiryIv]);
  useEffect(() => {
    if (!selCell) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelCell(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selCell]);

  const gate = useMemo(() => {
    const toGate = (q: OptionQuote | undefined, sym: string): GateQuote => ({ symbol: sym, updatedAtMs: q?.updatedAtMs ?? null, halted: q?.halted ?? null, bid: q?.bid ?? null, ask: q?.ask ?? null });
    return evaluateGate({
      nowMs,
      legs: (specs ?? []).map(s => toGate(quotes[symbolKey(s.symbol)], s.symbol)),
      others: underlying ? [{ symbol: underlying.symbol, updatedAtMs: underlying.updatedAtMs, halted: false, bid: null, ask: null }] : [],
      lastSuccessMs, pollIntervalMs: POLL_MS, successfulPolls,
    });
  }, [nowMs, specs, quotes, underlying, lastSuccessMs, successfulPolls]);

  // ORDER-SEND-0001: what the Send step needs, from the same live quotes the grid uses.
  const sendInfo = useMemo(() => {
    if (!specs || !exp) return null;
    const mids: Record<string, number | null> = {};
    for (const sp of specs) mids[symbolKey(sp.symbol)] = quotes[symbolKey(sp.symbol)]?.mid ?? null;
    const credit = netCreditAtMid(specs, mids);
    const shorts = specs.filter(sp => sp.side === 'short');
    const width = Math.max(0, ...specs.filter(sp => sp.side === 'long').map(l => Math.min(...shorts.filter(sh => sh.right === l.right).map(sh => Math.abs(sh.strike - l.strike)))));
    const legQuote = (sym: string): LegQuote => { const q = quotes[symbolKey(sym)]; return { bid: q?.bid ?? null, ask: q?.ask ?? null, mid: q?.mid ?? null, oi: q?.openInterest ?? null }; };
    // Each short leg with the long leg bought against it on the same side (a credit spread), for the rule checks.
    const wings: Wing[] = [];
    for (const sh of shorts) {
      const long = specs.find(sp => sp.side === 'long' && sp.right === sh.right);
      if (!long) continue;
      wings.push({ right: sh.right, shortStrike: sh.strike, longStrike: long.strike, shortDelta: quotes[symbolKey(sh.symbol)]?.delta ?? null, short: legQuote(sh.symbol), long: legQuote(long.symbol) });
    }
    return { credit, width, wings };
  }, [specs, exp, quotes]);
  const blockers = sendBlockers({ gateStatus: gate.status, strategy, hasLegs: sendInfo?.credit != null, quantity: 1 });

  const basis = { netDebit: grid?.netDebit ?? 0, maxLoss: em?.maxLoss ?? null };
  // Two colors only. Strength follows the size of the amount; near breakeven the cell fades to the dark base.
  const mix = (to: [number, number, number], t: number): string => {
    const base = [12, 17, 30];
    return `rgb(${base.map((b, i) => Math.round(b + (to[i] - b) * t)).join(',')})`;
  };
  const gainScale = Math.max(1, em?.maxProfit ?? em?.maxLoss ?? Math.abs(grid?.netDebit ?? 1));
  const lossScale = Math.max(1, em?.maxLoss ?? Math.abs(grid?.netDebit ?? 1));
  const cellStyle = (pl: number | null): React.CSSProperties => {
    if (pl == null) return {};
    return pl > 0
      ? { background: mix([0, 168, 70], Math.min(1, pl / gainScale)) }
      : { background: mix([176, 0, 45], Math.min(1, -pl / lossScale)) };
  };
  const spotRowPrice = grid && axisSpot != null ? grid.prices.reduce((best, x) => (Math.abs(x - axisSpot) < Math.abs(best - axisSpot) ? x : best), grid.prices[0]) : null;
  const priceLabel = (p: number) => (p % 1 === 0 ? p.toFixed(0) : p.toFixed(2));

  const statusColor = gate.status === 'live' ? 'bg-emerald-500' : gate.status === 'warming' ? 'bg-amber-500' : 'bg-rose-500';
  const statusLabel = gate.status === 'live' ? 'LIVE' : gate.status === 'warming' ? 'WARMING UP' : 'STALE';
  const ageSec = lastSuccessMs != null ? Math.max(0, Math.round((nowMs - lastSuccessMs) / 1000)) : null;
  const strikesList = exp?.strikes.map(s => s.strike) ?? [];
  const sel = `${th.input} ${th.inputBorder} ${th.text} border rounded px-2 py-1 text-xs`;
  const chip = (on: boolean) => `px-2.5 py-1 text-xs rounded border ${on ? 'border-[var(--accent,#3b82f6)] text-[var(--accent,#3b82f6)]' : `${th.border} ${th.textFaint}`}`;
  const money2 = (v: number | null | undefined, unbounded: boolean | undefined) => (unbounded ? 'Unlimited' : money(v ?? null));

  return (
    <div className="flex flex-col gap-4">
      <div className={`${th.card} ${th.border} border rounded-lg p-3 flex flex-wrap items-center gap-3`}>
        <input value={symbolInput} onChange={e => setSymbolInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }} className={`${sel} w-24 uppercase`} aria-label="Symbol" />
        <button onClick={() => load()} disabled={loading} className={chip(true)}>{loading ? 'Loading…' : 'Load'}</button>
        {symbol && underlying && <span className={`text-sm font-semibold ${th.text}`}>{symbol} ${underlying.price.toFixed(2)}</span>}
        {symbol && (
          <span className={`ml-auto flex items-center gap-2 text-xs ${th.textFaint}`} title={gate.reasons.join('; ')}>
            <span className={`inline-block w-2 h-2 rounded-full ${statusColor}`} />
            {statusLabel}{ageSec != null ? ` · updated ${ageSec}s ago` : ''}
          </span>
        )}
      </div>
      {loadError && <div className="text-xs text-rose-400">{loadError}</div>}

      {symbol && exp && (
        <>
          <div className={`${th.card} ${th.border} border rounded-lg p-3 flex flex-col gap-3`}>
            <div className="flex flex-wrap gap-2">
              {STRATEGIES.map(s => <button key={s.id} onClick={() => setStrategy(s.id)} className={chip(strategy === s.id)}>{s.label}</button>)}
            </div>
            <div className="flex flex-wrap gap-2">
              {chain.slice(0, 24).map(c => <button key={c.date} onClick={() => setExpiry(c.date)} className={chip(c.date === expiry)}>{shortDate(c.date)} · {c.dte}d</button>)}
            </div>
            {spot != null && stripStrikes.length >= 2 && markers.length > 0 && (
              <StrikeStrip th={th} strikes={stripStrikes} spot={spot} markers={markers} oi={stripOi} legInfo={legInfo} onMove={moveLeg} onStep={stepLeg} />
            )}
            {optimizeSupported && specs && specs.length >= 2 && (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={runOptimizeNow} disabled={optBusy} className={`${chip(false)} font-semibold`}>{optBusy ? 'Optimizing…' : 'Optimize'}</button>
                <span className={`text-xs ${th.textFaint}`}>Loads the screener&apos;s own pick at your width, using your saved scan criteria.</span>
                {optError && <span className="text-xs text-rose-400">{optError}</span>}
              </div>
            )}
            {opt && (
              <OptimizePanel
                th={th}
                widthDollars={opt.widthDollars}
                pick={opt.result.pick}
                atEachWidth={opt.result.atEachWidth}
                noQuotes={opt.result.noQuotes}
                loadedShort={specs && specs.length >= 2 ? specs[0].strike : null}
                loadedLong={specs && specs.length >= 2 ? specs[1].strike : null}
                canUndo={opt.prev != null && (opt.prev.anchor !== anchor || opt.prev.widthSteps !== widthSteps)}
                onLoad={c => { loadCandidate(c, null); }}
                onUndo={() => { if (opt.prev) { setAnchor(opt.prev.anchor); setWidthSteps(opt.prev.widthSteps); } }}
                onClose={() => setOpt(null)}
              />
            )}
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <details className="text-xs">
                <summary className={`cursor-pointer ${th.textFaint}`}>Edit as numbers</summary>
                <div className="flex flex-wrap items-center gap-3 mt-2">
              <label className={th.textFaint}>Strike{' '}
                <select className={sel} value={anchor ?? ''} onChange={e => setAnchor(Number(e.target.value))}>
                  {strikesList.map(k => <option key={k} value={k}>{strikeLabel(k)}</option>)}
                </select>
              </label>
              {STRATEGIES.find(s => s.id === strategy)?.hasWidth && (
                <label className={th.textFaint}>Width (strikes){' '}
                  <select className={sel} value={widthSteps} onChange={e => setWidthSteps(Number(e.target.value))}>
                    {widthOptions.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              )}
                </div>
              </details>
              <label className={th.textFaint} title="How far above and below today's stock price the table and graph reach.">Range ±{Math.round(effRange * 100)}%{' '}
                <input type="range" min={5} max={90} value={Math.round(effRange * 100)} onChange={e => { setRangePct(Number(e.target.value) / 100); }} />
              </label>
              <label className={th.textFaint} title="What-if on implied volatility: 1.00 = today's IV, 1.50 = IV rises 50%, 0.70 = IV falls 30%. Changes the dates before expiration only.">IV ×{ivMult.toFixed(2)}{' '}
                <input type="range" min={50} max={300} step={5} value={Math.round(ivMult * 100)} onChange={e => setIvMult(Number(e.target.value) / 100)} />
              </label>
            </div>
            {specs && <div className={`text-xs ${th.textFaint}`}>{specs.map(s => `${s.side === 'long' ? '+' : '−'}${s.strike}${s.right}`).join('  ')}</div>}
          </div>

          {gate.status !== 'live' && (
            <div className="text-xs text-amber-400">
              {gate.status === 'warming' ? 'Waiting for fresh quotes. ' : 'Quotes are not live: '}
              {gate.reasons.slice(0, 2).join('; ')}. Planning only; nothing here can place an order.
            </div>
          )}
          {pollError && <div className="text-xs text-rose-400">Quote refresh failed: {pollError}</div>}
          {built?.error && <div className="text-xs text-rose-400">{built.error}</div>}

          {legs && em && grid && (
            <>
              <div className={`${th.card} ${th.border} border rounded-lg p-3 grid grid-cols-2 md:grid-cols-5 gap-3 text-center`}>
                {[
                  { k: grid.netDebit > 0 ? 'NET DEBIT' : 'NET CREDIT', v: money(Math.abs(grid.netDebit)) },
                  { k: 'MAX LOSS', v: money2(em.maxLoss, em.maxLossUnbounded) },
                  { k: 'MAX PROFIT', v: money2(em.maxProfit, em.maxProfitUnbounded) },
                  { k: 'CHANCE OF PROFIT', v: pop == null ? '—' : `${Math.round(pop * 100)}%` },
                  { k: 'BREAKEVEN', v: em.breakevens.length ? em.breakevens.map(b => `$${b.toFixed(2)}`).join(' / ') : '—' },
                ].map(m => (
                  <div key={m.k} title={m.k === 'CHANCE OF PROFIT' ? 'Model estimate of finishing beyond breakeven at expiry. Differs from the screener POP, which is measured at the strike.' : undefined}><div className={`text-[10px] tracking-wider ${th.textFaint}`}>{m.k}</div><div className={`text-sm font-semibold ${th.text}`}>{m.v}</div></div>
                ))}
              </div>
              <div className={`text-[11px] ${th.textFaint}`}>
                {em.maxProfit != null && em.maxLoss != null && em.maxLoss > 0 ? `Profit to loss ${(em.maxProfit / em.maxLoss).toFixed(2)}× · ` : ''}
                Earnings: {metrics?.earningsDate && metrics.earningsDate <= exp.date ? `${shortDate(metrics.earningsDate)} (before expiry)` : metrics?.earningsDate ? `${shortDate(metrics.earningsDate)} (after expiry)` : 'none listed'}
                {' · '}Based on Black-Scholes{expiryIv != null ? ` · IV ${Math.round(expiryIv * 100 * ivMult)}%` : ''} (early exercise ignored; dividends approximate). Not an order price.
              </div>

              <div className="flex flex-wrap gap-2">
                <button onClick={() => setView('table')} className={chip(view === 'table')}>Table</button>
                <button onClick={() => setView('graph')} className={chip(view === 'graph')}>Graph</button>
                <span className="w-3" />
                {DISPLAY_MODES.filter(m => PRIMARY_MODES.indexOf(m.id) >= 0).map(m => <button key={m.id} onClick={() => setMode(m.id)} className={chip(mode === m.id)}>{m.label}</button>)}
                {sendSupported(strategy) && (
                  <button onClick={() => setSendOpen(true)} disabled={blockers.length > 0} title={blockers.join(' ') || 'Review, validate with the broker, then place'} className={`${chip(true)} ml-auto disabled:opacity-40`}>Send…</button>
                )}
              </div>
              {view === 'graph' ? (
                <div className={`${th.card} ${th.border} border rounded-lg p-3 flex flex-col gap-2`}>
                  {curves && axisSpot != null ? (
                    <TradeGraph selected={curves.selected} expiry={curves.expiry} mode={mode} basis={basis} spot={axisSpot} breakevens={em.breakevens} mutedColor="#808080" />
                  ) : <div className="text-xs text-rose-400">Graph unavailable: a leg could not be priced.</div>}
                  {sliderDates && curveDate && (
                    <label className={`text-xs ${th.textFaint} flex items-center gap-3`}>
                      Date: {shortDate(curveDate)} {curveDate === exp.date ? '(at expiration)' : `(${Math.round((Date.parse(curveDate) - Date.parse(today)) / 86400000)}d from today)`}
                      <input type="range" className="flex-1" min={0} max={sliderDates.length - 1} value={Math.min(dateIdx ?? sliderDates.length - 1, sliderDates.length - 1)} onChange={e => setDateIdx(Number(e.target.value))} />
                    </label>
                  )}
                  <div className={`text-[11px] ${th.textFaint}`}>Solid line: selected date. Dashed line: expiration. Dotted line: current price.</div>
                </div>
              ) : (
              <div className={`${th.card} ${th.border} border rounded-lg overflow-x-auto`}>
                <table className="w-full text-xs text-center">
                  <thead>
                    <tr className={th.textFaint}>
                      <th className="p-1.5 text-left">Price</th>
                      {grid.dates.map(d => (
                        <th key={d} className="p-1.5 font-normal">{shortDate(d)}<div className="text-[10px]">{d === grid.earliestExpiration ? 'Exp' : `${Math.round((Date.parse(d) - Date.parse(today)) / 86400000)}D`}</div></th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.prices.map((p, i) => (
                      <tr key={p} style={p === spotRowPrice ? { borderBottom: '1px dashed rgba(255,255,255,0.7)' } : undefined}>
                        <td className={`p-1.5 text-left ${axisSpot != null && Math.abs(p - axisSpot) === Math.min.apply(null, grid.prices.map(x => Math.abs(x - axisSpot))) ? 'font-bold text-[var(--accent,#3b82f6)]' : th.textMuted}`}>${priceLabel(p)} <span className={th.textFaint}>{axisSpot ? `${(((p / axisSpot) - 1) * 100).toFixed(0)}%` : ''}</span></td>
                        {grid.cells[i].map((c, j) => (
                          <td
                            key={j}
                            className={`p-1.5 ${th.text}`}
                            style={{ ...cellStyle(c ? c.pl : null), ...(c ? { cursor: 'pointer' } : {}), ...(selValid && selCell && selCell.price === p && selCell.date === grid.dates[j] ? { boxShadow: 'inset 0 0 0 2px #e8ecf4', fontWeight: 700 } : {}) }}
                            tabIndex={c ? 0 : undefined}
                            aria-label={c ? `If the stock is $${priceLabel(p)} on ${shortDate(grid.dates[j])}: show profit and loss, chance of profit and Greeks` : undefined}
                            onClick={c ? () => setSelCell({ price: p, date: grid.dates[j] }) : undefined}
                            onKeyDown={c ? (e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelCell({ price: p, date: grid.dates[j] }); } }) : undefined}
                          >
                            {formatModeValue(mode, modeValue(mode, c, basis))}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detail && (
                  <CellDetailPanel
                    th={th}
                    detail={detail}
                    selected={selValid}
                    movePct={selValid && axisSpot ? ((detail.price / axisSpot) - 1) * 100 : null}
                    onClear={() => setSelCell(null)}
                  />
                )}
              </div>
              )}
            </>
          )}
        </>
      )}
      {sendOpen && specs && exp && sendInfo && sendInfo.credit != null && sendSupported(strategy) && (
        <SendDialog
          th={th} symbol={symbol ?? ''} strategy={strategy} strategyLabel={STRATEGIES.find(s => s.id === strategy)?.label ?? strategy}
          specs={specs} expiration={exp.date} dte={exp.dte} displayedCredit={sendInfo.credit} width={sendInfo.width}
          ivRankPct={metrics?.ivRankPct ?? null} earningsDate={metrics?.earningsDate ?? null}
          price={spot} expirationIv={expiryIv} wings={sendInfo.wings} onClose={() => setSendOpen(false)}
        />
      )}
    </div>
  );
}
