// path: app/performance/page.tsx
'use client';
import { THEMES, ACCENTS, Theme, Accent, LS_THEME, LS_ACCENT, getSavedTheme, getSavedAccent, applyAccent, injectAccentStyle } from '@/lib/theme';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

// ── Constants ─────────────────────────────────────────────────────────────
const LS_PERF_WIDGETS = 'hunter-perf-widgets';
const SCRATCH_PCT = 5;

// PI-0008E: reconstruction (fetch, transaction matching, partial-close and
// assignment/exercise handling, caching) now lives in one shared module used
// by both this page and app/trade-log/page.tsx -- previously this page held
// its own independently-drifted copy (it matched on a `tx.action` field
// TastyTrade doesn't return, so its own reconstruction silently matched
// nothing, and its cache had no version field at all). See
// lib/tradeLog/reconstructTrades.ts.
import type { ExitType } from '@/lib/classifyExit';
import type { TimeRange, ClosedTrade } from '@/lib/tradeLog/reconstructTrades';
import {
  fetchAndReconstructTrades, readCache, writeCache, getDeviceId,
} from '@/lib/tradeLog/reconstructTrades';

interface ChatMessage { role: 'user' | 'assistant'; content: string; }

// ── Widget config ─────────────────────────────────────────────────────────
type WidgetId =
  | 'overview'
  | 'monthly_pnl'
  | 'by_strategy'
  | 'by_symbol'
  | 'hold_time'
  | 'best_worst'
  | 'streak'
  | 'dte_analysis'
  | 'exit_analysis';

interface WidgetConfig {
  id: WidgetId;
  label: string;
  enabled: boolean;
  order: number;
}

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'overview',    label: 'Overview Stats',      enabled: true,  order: 0 },
  { id: 'monthly_pnl', label: 'Monthly P&L',         enabled: true,  order: 1 },
  { id: 'by_strategy', label: 'P&L by Strategy',     enabled: true,  order: 2 },
  { id: 'by_symbol',   label: 'P&L by Symbol',       enabled: true,  order: 3 },
  { id: 'hold_time',   label: 'Hold Time Analysis',  enabled: true,  order: 4 },
  { id: 'best_worst',  label: 'Best & Worst Trades', enabled: true,  order: 5 },
  { id: 'streak',      label: 'Win/Loss Streak',     enabled: false, order: 6 },
  { id: 'dte_analysis',   label: 'DTE at Entry',        enabled: false, order: 7 },
  { id: 'exit_analysis',  label: 'Exit Analysis',       enabled: true,  order: 8 },
];

function getSavedWidgets(): WidgetConfig[] {
  try {
    const saved = localStorage.getItem(LS_PERF_WIDGETS);
    if (!saved) return DEFAULT_WIDGETS;
    const parsed: WidgetConfig[] = JSON.parse(saved);
    // Merge — keep any new defaults not yet in saved config
    const savedIds = new Set(parsed.map(w => w.id));
    const merged = [...parsed, ...DEFAULT_WIDGETS.filter(w => !savedIds.has(w.id))];
    return merged.sort((a, b) => a.order - b.order);
  } catch { return DEFAULT_WIDGETS; }
}

// ── AI ────────────────────────────────────────────────────────────────────
const AI_SYSTEM_PROMPT = `You are a brutally honest options trading coach reviewing a trader's actual closed trade history. Your job is to find real patterns, call out mistakes without softening them, and give specific actionable advice.

Do not hedge. Do not add disclaimers. If the data shows a clear problem, say so directly. If a pattern is costing money, name it explicitly. Be direct like a mentor who respects the trader enough to tell them the truth.

Respond in clear conversational prose. No JSON. No markdown headers. Use short paragraphs. When you cite a stat, be specific with numbers.`;

function buildPerformanceAnalysisPrompt(trades: ClosedTrade[], range: TimeRange): string {
  const total = trades.length;
  if (total === 0) return 'No closed trades found in this period.';
  const wins    = trades.filter(t => t.outcome === 'WIN');
  const losses  = trades.filter(t => t.outcome === 'LOSS');
  const winRate = Math.round((wins.length / total) * 100);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgWin  = wins.length   > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
  const avgHold = Math.round(trades.reduce((s, t) => s + t.holdDays, 0) / total);
  const strategies = ['BPS','BCS','IC','SPREAD','OTHER'] as const;
  const byStrategy = strategies.map(s => {
    const g = trades.filter(t => t.strategy === s);
    if (g.length === 0) return null;
    const w = g.filter(t => t.outcome === 'WIN').length;
    const pnl = g.reduce((sum, t) => sum + t.pnl, 0);
    return `${s}: ${g.length} trades, ${Math.round(w/g.length*100)}% win, $${pnl.toFixed(0)} total, avg ${(g.reduce((sum, t) => sum + t.pnlPct, 0)/g.length).toFixed(1)}%`;
  }).filter(Boolean);
  const symMap: Record<string, { count: number; wins: number; pnl: number }> = {};
  for (const t of trades) {
    if (!symMap[t.symbol]) symMap[t.symbol] = { count: 0, wins: 0, pnl: 0 };
    symMap[t.symbol].count++; if (t.outcome === 'WIN') symMap[t.symbol].wins++; symMap[t.symbol].pnl += t.pnl;
  }
  const bySymbol = Object.entries(symMap).sort((a, b) => b[1].pnl - a[1].pnl)
    .map(([sym, v]) => `${sym}: ${v.count} trades, ${Math.round(v.wins/v.count*100)}% win, $${v.pnl.toFixed(0)}`);
  const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dowMap: Record<number, { count: number; wins: number; pnl: number }> = {};
  for (const t of trades) {
    if (t.openDow == null || t.openDow < 0) continue;
    if (!dowMap[t.openDow]) dowMap[t.openDow] = { count: 0, wins: 0, pnl: 0 };
    dowMap[t.openDow].count++; if (t.outcome === 'WIN') dowMap[t.openDow].wins++; dowMap[t.openDow].pnl += t.pnl;
  }
  const byDow = Object.entries(dowMap).sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([d, v]) => `${DOW[Number(d)]}: ${v.count} trades, ${Math.round(v.wins/v.count*100)}% win, $${v.pnl.toFixed(0)}`);
  const timeBuckets = [
    { label: 'Open (9:30–10:30)', min: 570, max: 630 },
    { label: 'Morning (10:30–12:00)', min: 630, max: 720 },
    { label: 'Midday (12:00–14:00)', min: 720, max: 840 },
    { label: 'Afternoon (14:00–15:00)', min: 840, max: 900 },
    { label: 'Close (15:00–16:00)', min: 900, max: 960 },
  ];
  const byTime = timeBuckets.map(b => {
    const g = trades.filter(t => {
      if (!t.openTime) return false;
      const [h, m] = t.openTime.split(':').map(Number); const mins = h * 60 + m;
      return mins >= b.min && mins < b.max;
    });
    if (g.length === 0) return null;
    const w = g.filter(t => t.outcome === 'WIN').length;
    return `${b.label}: ${g.length} trades, ${Math.round(w/g.length*100)}% win, $${g.reduce((s,t) => s+t.pnl, 0).toFixed(0)}`;
  }).filter(Boolean);
  const sorted = [...trades].sort((a, b) => a.closeDate.localeCompare(b.closeDate));
  let revengeTrades = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i-1].outcome === 'LOSS' && sorted[i].outcome === 'LOSS') {
      const days = Math.round((new Date(sorted[i].openDate).getTime() - new Date(sorted[i-1].closeDate).getTime()) / 86400000);
      if (days <= 2) revengeTrades++;
    }
  }
  return `Analyze this trader's performance data from the last ${range === '3m' ? '3 months' : range === '6m' ? '6 months' : '12 months'} and give brutally honest coaching feedback.

OVERALL (${total} closed trades):
Win rate: ${winRate}% | Total P&L: $${totalPnl.toFixed(0)} | Avg win: $${avgWin.toFixed(0)} | Avg loss: $${avgLoss.toFixed(0)} | Avg hold: ${avgHold} days

BY STRATEGY:
${byStrategy.join('\n')}

BY SYMBOL (best to worst P&L):
${bySymbol.join('\n')}

ENTRY DAY OF WEEK:
${byDow.length > 0 ? byDow.join('\n') : 'No day data available'}

ENTRY TIME OF DAY:
${byTime.length > 0 ? byTime.join('\n') : 'No time data available'}

BEHAVIORAL FLAGS:
Potential revenge trades: ${revengeTrades}

EXIT TYPE BREAKDOWN:
${(() => {
  const exitLabels: Record<string, string> = {
    TARGET_HIT:     'Target hit (50–75% profit — disciplined)',
    SCRATCH_WIN:    'Partial profit (positive return below target)',
    HELD_TO_EXPIRY: 'Held to expiry (win but gamma-risky)',
    MANAGED_LOSS:   'Managed loss (cut at planned stop — good)',
    TIME_STOP:      'Time stop (closed at ≤21 DTE)',
    FAST_CUT:       'Fast cut (small loss, exit ≤2 days)',
    MAX_LOSS:       'Max loss (>150% or >$400, or held too long)',
  };
  const types = ['TARGET_HIT','SCRATCH_WIN','HELD_TO_EXPIRY','MANAGED_LOSS','TIME_STOP','FAST_CUT','MAX_LOSS'];
  return types.map(et => {
    const g = trades.filter(t => t.exitType === et);
    if (g.length === 0) return null;
    const w = g.filter(t => t.outcome === 'WIN').length;
    const pnl = g.reduce((s, t) => s + t.pnl, 0);
    const avgH = Math.round(g.reduce((s, t) => s + t.holdDays, 0) / g.length);
    return `${exitLabels[et]}: ${g.length} trades, ${Math.round(w/g.length*100)}% win, $${pnl.toFixed(0)} total, avg ${avgH}d hold`;
  }).filter(Boolean).join('\n');
})()}

LOSS DETAIL (each losing trade with context):
${trades.filter(t => t.outcome === 'LOSS').map(t =>
  `${t.symbol} ${t.strategy}: held ${t.holdDays}d, ${t.dteAtClose}DTE remaining at close, loss ${t.pnlPct.toFixed(0)}% of credit [${t.exitType}]`
).join('\n') || 'No losses in this period'}

Lead with exit behavior — were fast cuts disciplined or panic? Which losses came from holding too long? Which were unavoidable? Then cover strategy patterns, entry timing, and finish with 3 concrete changes to make immediately. Be direct. Start with the most important finding.`;
}

async function callAIWithHistory(messages: ChatMessage[], system: string): Promise<string> {
  const res = await fetch('/api/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1800, system, messages }),
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err?.error ?? `API error: ${res.status}`); }
  const data = await res.json();
  return data?.content?.find((b: any) => b.type === 'text')?.text ?? '';
}

// ── AI Chat Panel ─────────────────────────────────────────────────────────
function AIChatPanel({ trades, range, th, onClose }: {
  trades: ClosedTrade[]; range: TimeRange; th: typeof THEMES[Theme]; onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [initializing, setInitializing] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    const runInitial = async () => {
      setInitializing(true);
      const prompt = buildPerformanceAnalysisPrompt(trades, range);
      try {
        const reply = await callAIWithHistory([{ role: 'user', content: prompt }], AI_SYSTEM_PROMPT);
        setMessages([{ role: 'assistant', content: reply }]);
      } catch (e: any) { setError(e.message); }
      finally { setInitializing(false); setTimeout(() => inputRef.current?.focus(), 100); }
    };
    runInitial();
  }, []);

  const send = async () => {
    const text = input.trim(); if (!text || loading) return;
    setInput(''); setError('');
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next); setLoading(true);
    try {
      const reply = await callAIWithHistory(next, AI_SYSTEM_PROMPT);
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); setTimeout(() => inputRef.current?.focus(), 50); }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const suggestions = [
    'Were my fast cuts the right call?',
    'Which losses were avoidable?',
    'Am I holding losers too long?',
    'Which strategy should I drop?',
    'What should I change immediately?',
  ];

  return (
    <div className={`fixed top-0 right-0 h-full w-[480px] max-w-[95vw] ${th.sidebar} border-l ${th.border} flex flex-col z-50 shadow-2xl`}
         style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
      <div className={`flex items-center justify-between px-5 py-4 border-b ${th.border} shrink-0`}>
        <div>
          <p className={`text-sm font-bold ${th.text} tracking-wider`}>◈ AI COACHING</p>
          <p className={`text-[10px] ${th.textFaint} mt-0.5`}>{trades.length} trades · {range === '3m' ? '3 months' : range === '6m' ? '6 months' : '12 months'}</p>
        </div>
        <button onClick={onClose} className={`${th.textFaint} hover:${th.text} text-xl leading-none`}>✕</button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {initializing && (
          <div className="flex items-center gap-3 py-8 justify-center">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className={`text-xs ${th.textFaint}`}>Analyzing your performance data...</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && <span className="text-indigo-400 text-[11px] mt-1 shrink-0 font-bold">◈</span>}
            <div className={`rounded-2xl px-4 py-3 text-[12px] leading-relaxed whitespace-pre-wrap max-w-[92%] ${
              m.role === 'user' ? 'ac-bg-20 border ac-border/30 text-blue-100 ml-auto' : `${th.card} border ${th.border} ${th.textMuted}`
            }`}>{m.content}</div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3 justify-start">
            <span className="text-indigo-400 text-[11px] mt-1 shrink-0 font-bold">◈</span>
            <div className={`${th.card} border ${th.border} rounded-2xl px-4 py-3`}>
              <div className="flex gap-1 items-center h-4">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        {error && <p className="text-[10px] text-red-400 px-1">{error} — <button onClick={send} className="underline">retry</button></p>}
        <div ref={bottomRef} />
      </div>
      {messages.length === 1 && !initializing && (
        <div className="px-5 pb-3 flex flex-wrap gap-1.5 shrink-0">
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => { setInput(s); setTimeout(() => inputRef.current?.focus(), 50); }}
              className={`text-[10px] px-2.5 py-1 rounded-full border ${th.border} ${th.textFaint} hover:border-indigo-500 hover:text-indigo-400 transition-colors`}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div className={`px-5 py-4 border-t ${th.border} shrink-0`}>
        <div className="flex items-end gap-2">
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKey}
            placeholder="Ask a follow-up question..." rows={2}
            className={`flex-1 resize-none text-xs px-3 py-2.5 border ${th.inputBorder} ${th.input} ${th.text} rounded-xl focus:outline-none focus:border-indigo-500`} />
          <button onClick={send} disabled={loading || !input.trim()}
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold tracking-wider transition-colors shrink-0">
            Send
          </button>
        </div>
        <p className={`text-[9px] ${th.textFaint} mt-1.5`}>Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}

// ── Formatting ────────────────────────────────────────────────────────────
function fmtAge(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ── Chart helpers ─────────────────────────────────────────────────────────
function MonthlyPnlChart({ trades, th, range }: { trades: ClosedTrade[]; th: typeof THEMES[Theme]; range?: TimeRange }) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Build per-month stats
  const monthMap: Record<string, { pnl: number; count: number; wins: number }> = {};
  for (const t of trades) {
    const key = t.closeDate.slice(0, 7);
    if (!monthMap[key]) monthMap[key] = { pnl: 0, count: 0, wins: 0 };
    monthMap[key].pnl += t.pnl;
    monthMap[key].count++;
    if (t.outcome === 'WIN') monthMap[key].wins++;
  }
  const entries = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({
      key,
      month: MONTHS[parseInt(key.split('-')[1], 10) - 1],
      year: key.slice(0, 4),
      ...v,
      winRate: v.count > 0 ? Math.round((v.wins / v.count) * 100) : 0,
    }));

  if (entries.length === 0) return <p className={`text-xs ${th.textFaint} text-center py-4`}>No data</p>;

  if (entries.length === 1) {
    const e = entries[0];
    return (
      <div className={`flex items-center gap-6 p-4 rounded-xl border ${th.border}`}>
        <div>
          <p className={`text-[10px] ${th.textFaint} uppercase tracking-widest mb-1`}>{e.month} {e.year}</p>
          <p className={`text-2xl font-bold ${e.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
            {e.pnl >= 0 ? '+' : ''}${e.pnl.toFixed(0)}
          </p>
        </div>
        <div className={`text-center`}>
          <p className={`text-[10px] ${th.textFaint} uppercase tracking-widest mb-1`}>Win Rate</p>
          <p className={`text-2xl font-bold ${e.winRate >= 60 ? 'text-emerald-400' : e.winRate >= 45 ? 'text-yellow-400' : 'text-red-400'}`} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>{e.winRate}%</p>
        </div>
        <div className="text-center">
          <p className={`text-[10px] ${th.textFaint} uppercase tracking-widest mb-1`}>Trades</p>
          <p className={`text-2xl font-bold ${th.text}`} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>{e.count}</p>
        </div>
        <p className={`text-[10px] ${th.textFaint} ml-auto`}>Only 1 month of data — extend range for chart view</p>
      </div>
    );
  }

  // Build cumulative P&L series
  const cumulative: number[] = [];
  let running = 0;
  for (const e of entries) { running += e.pnl; cumulative.push(running); }

  // Unified scale — bars and line share the same y-axis so they're directly comparable
  const allValues = [...entries.map(e => e.pnl), ...cumulative, 0];
  const dataMin = Math.min(...allValues);
  const dataMax = Math.max(...allValues);
  const pad = Math.max((dataMax - dataMin) * 0.15, 50); // 15% padding, min $50
  const yMin = dataMin - pad;
  const yMax = dataMax + pad;
  const yRange = yMax - yMin;

  // Chart dimensions — using a fixed viewBox with a left gutter for y-axis labels
  const GUTTER = 52;  // left gutter for y-axis labels
  const CHART_W = 600; // viewBox chart area width (scales with container)
  const CHART_H = 160; // viewBox chart area height
  const TOTAL_W = GUTTER + CHART_W;
  const COL_W = CHART_W / entries.length;

  // Convert a $ value to a y coordinate (SVG: 0=top, CHART_H=bottom)
  const toY = (val: number) => CHART_H - ((val - yMin) / yRange) * CHART_H;
  const zeroY = toY(0);

  // Nice y-axis ticks — 4-5 labels
  const rawStep = (yMax - yMin) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep) || 1)));
  const niceStep = Math.ceil(rawStep / mag) * mag;
  const tickStart = Math.ceil(yMin / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let v = tickStart; v <= yMax + niceStep * 0.1; v += niceStep) ticks.push(Math.round(v));

  const lastCum = cumulative[cumulative.length - 1];
  const lineColor = lastCum >= 0 ? '#34d399' : '#f87171';
  const linePts = cumulative.map((v, i) => `${GUTTER + i * COL_W + COL_W / 2},${toY(v)}`).join(' ');

  // Hover state
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      <div className="relative select-none">
        <svg
          viewBox={`0 0 ${TOTAL_W} ${CHART_H + 2}`}
          preserveAspectRatio="xMidYMid meet"
          className="w-full overflow-visible"
          style={{ height: '180px' }}
        >
          {/* Y-axis grid lines + labels */}
          {ticks.map(tick => {
            const y = toY(tick);
            if (y < 0 || y > CHART_H) return null;
            const isZero = tick === 0;
            return (
              <g key={tick}>
                <line x1={GUTTER} y1={y} x2={TOTAL_W} y2={y}
                  stroke={isZero ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)'}
                  strokeWidth={isZero ? 1 : 0.5}
                  strokeDasharray={isZero ? '4,3' : undefined}
                />
                <text x={GUTTER - 4} y={y + 3.5} textAnchor="end"
                  fontSize="9" fill="rgba(255,255,255,0.3)" fontFamily="var(--font-inter), system-ui, sans-serif">
                  {tick >= 0 ? `$${tick >= 1000 ? (tick/1000).toFixed(1)+'k' : tick}` : `-$${Math.abs(tick) >= 1000 ? (Math.abs(tick)/1000).toFixed(1)+'k' : Math.abs(tick)}`}
                </text>
              </g>
            );
          })}

          {/* Monthly P&L bars — anchored at zero line */}
          {entries.map((e, i) => {
            const x = GUTTER + i * COL_W + COL_W * 0.1;
            const bw = COL_W * 0.8;
            const isPos = e.pnl >= 0;
            const barTop = isPos ? toY(e.pnl) : zeroY;
            const barBot = isPos ? zeroY : toY(e.pnl);
            const bh = Math.max(barBot - barTop, 1);
            const isHov = hoveredIdx === i;
            return (
              <rect key={e.key} x={x} y={barTop} width={bw} height={bh} rx="1.5"
                fill={isPos
                  ? (isHov ? 'rgba(16,185,129,0.80)' : 'rgba(16,185,129,0.50)')
                  : (isHov ? 'rgba(239,68,68,0.75)' : 'rgba(239,68,68,0.45)')}
              />
            );
          })}

          {/* Cumulative P&L line */}
          {entries.length > 1 && (
            <polyline points={linePts} fill="none" stroke={lineColor}
              strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
          )}

          {/* Dots on cumulative line */}
          {cumulative.map((val, i) => (
            <circle key={entries[i].key}
              cx={GUTTER + i * COL_W + COL_W / 2} cy={toY(val)} r={hoveredIdx === i ? 3.5 : 2.5}
              fill={val >= 0 ? '#34d399' : '#f87171'}
              stroke={hoveredIdx === i ? 'rgba(255,255,255,0.4)' : 'none'} strokeWidth="1"
            />
          ))}

          {/* Hover tooltip */}
          {hoveredIdx !== null && (() => {
            const e = entries[hoveredIdx];
            const cumVal = cumulative[hoveredIdx];
            const isPos = e.pnl >= 0;
            const cx = GUTTER + hoveredIdx * COL_W + COL_W / 2;
            const tipW = 148;
            const tipH = 62;
            const tipX = Math.min(Math.max(cx - tipW / 2, GUTTER), TOTAL_W - tipW);
            const tipY = Math.max(toY(Math.max(e.pnl, cumVal)) - tipH - 10, 2);
            return (
              <g>
                <line x1={cx} y1={0} x2={cx} y2={CHART_H} stroke="rgba(255,255,255,0.08)" strokeWidth="1" strokeDasharray="3,2" />
                <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="6"
                  fill="rgba(15,15,20,0.96)" stroke="rgba(255,255,255,0.12)" strokeWidth="0.75" />
                <text x={tipX + 10} y={tipY + 16} fontSize="9.5" fontWeight="600" fill="rgba(255,255,255,0.85)" fontFamily="var(--font-inter), system-ui, sans-serif">
                  {e.month} {e.year}
                </text>
                <text x={tipX + 10} y={tipY + 30} fontSize="9" fontWeight="700"
                  fill={isPos ? '#34d399' : '#f87171'} fontFamily="var(--font-inter), system-ui, sans-serif">
                  {isPos ? '+' : ''}${e.pnl.toFixed(0)} this month
                </text>
                <text x={tipX + 10} y={tipY + 43} fontSize="9"
                  fill={cumVal >= 0 ? '#34d399' : '#f87171'} fontFamily="var(--font-inter), system-ui, sans-serif">
                  {cumVal >= 0 ? '+' : ''}${cumVal.toFixed(0)} cumulative
                </text>
                <text x={tipX + 10} y={tipY + 56} fontSize="8.5" fill="rgba(255,255,255,0.35)" fontFamily="var(--font-inter), system-ui, sans-serif">
                  {e.count} trades · {e.wins}W/{e.count - e.wins}L · {e.winRate}% win
                </text>
              </g>
            );
          })()}

          {/* Invisible hit areas — one per column */}
          {entries.map((_, i) => (
            <rect key={`hit-${i}`}
              x={GUTTER + i * COL_W} y={0} width={COL_W} height={CHART_H}
              fill="transparent" style={{ cursor: 'crosshair' }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          ))}
        </svg>

        {/* X-axis labels — outside SVG for reliable text rendering */}
        <div className="flex pl-[52px]" style={{ marginTop: '-2px' }}>
          {entries.map(e => (
            <div key={e.key} className="flex flex-col items-center" style={{ width: `${100 / entries.length}%` }}>
              <span className={`text-[9px] ${th.textFaint}`}>{e.month} {entries.length <= 6 ? e.year.slice(2) : ''}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className={`flex items-center gap-5 pt-1.5 border-t ${th.borderLight}`}>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-emerald-500/50" />
          <span className={`text-[9px] ${th.textFaint}`}>Monthly P&L</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-0.5 rounded-full" style={{ backgroundColor: lineColor }} />
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: lineColor }} />
          <span className={`text-[9px] ${th.textFaint}`}>Cumulative P&L</span>
        </div>
      </div>
    </div>
  );
}

function HorizBar({ label, value, max, color, suffix = '' }: { label: string; value: number; max: number; color: string; suffix?: string }) {
  const pct = max > 0 ? Math.min((Math.abs(value) / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] w-16 shrink-0 truncate" title={label}>{label}</span>
      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[10px] font-bold w-16 text-right ${value >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
        {value >= 0 ? '+' : ''}{suffix === '%' ? value.toFixed(1) + '%' : '$' + value.toFixed(0)}
      </span>
    </div>
  );
}

// ── Widget components ─────────────────────────────────────────────────────
function OverviewWidget({ trades, th }: { trades: ClosedTrade[]; th: typeof THEMES[Theme] }) {
  const total    = trades.length;
  const wins     = trades.filter(t => t.outcome === 'WIN').length;
  const losses   = trades.filter(t => t.outcome === 'LOSS').length;
  const scratches = trades.filter(t => t.outcome === 'SCRATCH').length;
  const winRate  = total > 0 ? wins / total : 0;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const avgPnlPct = total > 0 ? trades.reduce((s, t) => s + t.pnlPct, 0) / total : 0;
  const avgHold  = total > 0 ? Math.round(trades.reduce((s, t) => s + t.holdDays, 0) / total) : 0;
  const totalFees = trades.reduce((s, t) => s + t.fees, 0);

  const stats = [
    { label: 'Total Trades',  value: String(total),                                   color: th.text },
    { label: 'Win Rate',      value: `${Math.round(winRate * 100)}%`,                 color: winRate >= 0.6 ? 'text-emerald-400' : winRate >= 0.45 ? 'text-yellow-400' : 'text-red-400' },
    { label: 'W / L / S',     value: `${wins} / ${losses} / ${scratches}`,            color: th.textMuted },
    { label: 'Total P&L',     value: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(0)}`, color: totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Avg P&L %',     value: `${avgPnlPct >= 0 ? '+' : ''}${avgPnlPct.toFixed(1)}%`, color: avgPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Avg Hold',      value: `${avgHold}d`,                                   color: th.textMuted },
    { label: 'Total Fees',    value: `-$${totalFees.toFixed(0)}`,                     color: 'text-orange-400/80' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-0 divide-x divide-y">
      {stats.map(s => (
        <div key={s.label} className={`px-4 py-3 flex flex-col items-center text-center ${th.borderLight}`}>
          <p className={`text-[9px] ${th.textFaint} uppercase tracking-widest mb-1`}>{s.label}</p>
          <p className={`text-xl font-bold ${s.color}`} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

function ByStrategyWidget({ trades, th }: { trades: ClosedTrade[]; th: typeof THEMES[Theme] }) {
  const strategies = ['BPS', 'BCS', 'IC', 'SPREAD', 'OTHER'] as const;
  const rows = strategies.map(s => {
    const group = trades.filter(t => t.strategy === s);
    const wins = group.filter(t => t.outcome === 'WIN').length;
    const total = group.length;
    const pnl = group.reduce((sum, t) => sum + t.pnl, 0);
    const avgPct = total > 0 ? group.reduce((sum, t) => sum + t.pnlPct, 0) / total : 0;
    return { strategy: s, total, wins, winRate: total > 0 ? wins / total : 0, pnl, avgPct };
  }).filter(r => r.total > 0);

  if (rows.length === 0) return <p className={`text-xs ${th.textFaint} text-center py-4`}>No data</p>;
  const maxPnl = Math.max(...rows.map(r => Math.abs(r.pnl)), 1);

  return (
    <div className="space-y-3">
      {rows.map(r => (
        <div key={r.strategy} className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`text-[9px] font-bold px-1.5 py-0.5 border rounded ${
                r.strategy === 'BPS' ? 'border-emerald-600 text-emerald-400'
                : r.strategy === 'BCS' ? 'border-red-600 text-red-400'
                : r.strategy === 'IC' ? 'ac-btn'
                : 'border-slate-600 text-slate-400'
              }`}>{r.strategy}</span>
              <span className={`text-[10px] ${th.textFaint}`}>{r.total} trades · {Math.round(r.winRate * 100)}% win rate</span>
            </div>
            <span className={`text-[10px] font-bold ${r.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
              {r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(0)} avg {r.avgPct >= 0 ? '+' : ''}{r.avgPct.toFixed(1)}%
            </span>
          </div>
          <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${r.pnl >= 0 ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
              style={{ width: `${(Math.abs(r.pnl) / maxPnl) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function BySymbolWidget({ trades, th }: { trades: ClosedTrade[]; th: typeof THEMES[Theme] }) {
  const symbolMap: Record<string, { pnl: number; count: number; winRate: number; wins: number }> = {};
  for (const t of trades) {
    if (!symbolMap[t.symbol]) symbolMap[t.symbol] = { pnl: 0, count: 0, winRate: 0, wins: 0 };
    symbolMap[t.symbol].pnl += t.pnl;
    symbolMap[t.symbol].count++;
    if (t.outcome === 'WIN') symbolMap[t.symbol].wins++;
  }
  const rows = Object.entries(symbolMap)
    .map(([sym, v]) => ({ sym, ...v, winRate: v.count > 0 ? v.wins / v.count : 0 }))
    .sort((a, b) => b.pnl - a.pnl);

  if (rows.length === 0) return <p className={`text-xs ${th.textFaint} text-center py-4`}>No data</p>;
  const maxPnl = Math.max(...rows.map(r => Math.abs(r.pnl)), 1);

  return (
    <div className="space-y-2">
      {rows.map(r => (
        <HorizBar
          key={r.sym}
          label={r.sym}
          value={r.pnl}
          max={maxPnl}
          color={r.pnl >= 0 ? 'bg-emerald-500/60' : 'bg-red-500/60'}
        />
      ))}
    </div>
  );
}

function HoldTimeWidget({ trades, th }: { trades: ClosedTrade[]; th: typeof THEMES[Theme] }) {
  const buckets = [
    { label: '0–7d',  min: 0,  max: 7  },
    { label: '8–14d', min: 8,  max: 14 },
    { label: '15–21d',min: 15, max: 21 },
    { label: '22–30d',min: 22, max: 30 },
    { label: '31d+',  min: 31, max: Infinity },
  ];
  const rows = buckets.map(b => {
    const group = trades.filter(t => t.holdDays >= b.min && t.holdDays <= b.max);
    const wins  = group.filter(t => t.outcome === 'WIN').length;
    const pnl   = group.reduce((s, t) => s + t.pnl, 0);
    return { ...b, count: group.length, wins, winRate: group.length > 0 ? wins / group.length : 0, pnl };
  }).filter(r => r.count > 0);

  if (rows.length === 0) return <p className={`text-xs ${th.textFaint} text-center py-4`}>No data</p>;

  return (
    <div className="space-y-2">
      {rows.map(r => (
        <div key={r.label} className="flex items-center gap-3 text-[10px]">
          <span className={`w-14 shrink-0 ${th.textFaint}`}>{r.label}</span>
          <span className={`w-16 shrink-0 ${th.textMuted}`}>{r.count} trades</span>
          <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${r.winRate >= 0.6 ? 'bg-emerald-500/60' : r.winRate >= 0.45 ? 'bg-yellow-500/60' : 'bg-red-500/60'}`}
              style={{ width: `${r.winRate * 100}%` }} />
          </div>
          <span className={`w-10 text-right font-bold ${r.winRate >= 0.6 ? 'text-emerald-400' : r.winRate >= 0.45 ? 'text-yellow-400' : 'text-red-400'}`}>
            {Math.round(r.winRate * 100)}%
          </span>
          <span className={`w-16 text-right font-bold ${r.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
            {r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(0)}
          </span>
        </div>
      ))}
    </div>
  );
}

function BestWorstWidget({ trades, th }: { trades: ClosedTrade[]; th: typeof THEMES[Theme] }) {
  const sorted = [...trades].sort((a, b) => b.pnl - a.pnl);
  const best  = sorted.slice(0, 3);
  const worst = sorted.slice(-3).reverse();

  const TradeRow = ({ t, label }: { t: ClosedTrade; label: string }) => (
    <div className={`flex items-center justify-between p-2 rounded-lg border ${t.pnl >= 0 ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
      <div>
        <span className={`text-xs font-bold ${th.text}`} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>{t.symbol}</span>
        <span className={`ml-2 text-[9px] ${th.textFaint}`}>{t.strategy} · {t.closeDate}</span>
      </div>
      <span className={`text-xs font-bold ${t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
        {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)} ({t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(1)}%)
      </span>
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <p className="text-[9px] text-emerald-400 uppercase tracking-widest font-bold mb-2">Best Trades</p>
        {best.map(t => <TradeRow key={t.id} t={t} label="best" />)}
      </div>
      <div className="space-y-2">
        <p className="text-[9px] text-red-400 uppercase tracking-widest font-bold mb-2">Worst Trades</p>
        {worst.map(t => <TradeRow key={t.id} t={t} label="worst" />)}
      </div>
    </div>
  );
}

function StreakWidget({ trades, th }: { trades: ClosedTrade[]; th: typeof THEMES[Theme] }) {
  // Chronological order for streak calculation
  const chrono = [...trades].sort((a, b) => a.closeDate.localeCompare(b.closeDate));
  let curStreak = 0, maxWin = 0, maxLoss = 0;
  let curType: 'WIN' | 'LOSS' | null = null;
  for (const t of chrono) {
    if (t.outcome === 'SCRATCH') continue;
    if (t.outcome === curType) { curStreak++; }
    else { curStreak = 1; curType = t.outcome as 'WIN' | 'LOSS'; }
    if (curType === 'WIN')  maxWin  = Math.max(maxWin,  curStreak);
    if (curType === 'LOSS') maxLoss = Math.max(maxLoss, curStreak);
  }
  const lastType = curType;
  const lastStreak = curStreak;

  return (
    <div className="grid grid-cols-3 gap-4 text-center">
      {[
        { label: 'Current Streak', value: `${lastStreak} ${lastType ?? '—'}`, color: lastType === 'WIN' ? 'text-emerald-400' : lastType === 'LOSS' ? 'text-red-400' : 'text-slate-400' },
        { label: 'Best Win Streak',  value: `${maxWin}W`,  color: 'text-emerald-400' },
        { label: 'Worst Loss Streak',value: `${maxLoss}L`, color: 'text-red-400' },
      ].map(s => (
        <div key={s.label} className={`p-4 rounded-xl border ${th.border}`}>
          <p className={`text-[9px] ${th.textFaint} uppercase tracking-widest mb-2`}>{s.label}</p>
          <p className={`text-2xl font-bold ${s.color}`} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

function DteAnalysisWidget({ trades, th }: { trades: ClosedTrade[]; th: typeof THEMES[Theme] }) {
  // We approximate entry DTE as holdDays + (expiry - closeDate) days
  // Since we don't store entry DTE directly, bucket by hold days as proxy
  const buckets = [
    { label: '< 21 DTE', min: 0,  max: 20  },
    { label: '21–30 DTE',min: 21, max: 30  },
    { label: '31–45 DTE',min: 31, max: 45  },
    { label: '45+ DTE',  min: 46, max: Infinity },
  ];
  // Estimate entry DTE from holdDays + remaining DTE at close
  const rows = buckets.map(b => {
    const group = trades.filter(t => {
      const daysToExpiry = Math.max(0, Math.round((new Date(t.expiry).getTime() - new Date(t.closeDate).getTime()) / 86400000));
      const entryDte = t.holdDays + daysToExpiry;
      return entryDte >= b.min && entryDte <= b.max;
    });
    const wins   = group.filter(t => t.outcome === 'WIN').length;
    const avgPct = group.length > 0 ? group.reduce((s, t) => s + t.pnlPct, 0) / group.length : 0;
    return { ...b, count: group.length, winRate: group.length > 0 ? wins / group.length : 0, avgPct };
  }).filter(r => r.count > 0);

  if (rows.length === 0) return <p className={`text-xs ${th.textFaint} text-center py-4`}>No data</p>;

  return (
    <div className="space-y-2">
      {rows.map(r => (
        <div key={r.label} className="flex items-center gap-3 text-[10px]">
          <span className={`w-20 shrink-0 ${th.textFaint}`}>{r.label}</span>
          <span className={`w-16 shrink-0 ${th.textMuted}`}>{r.count} trades</span>
          <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${r.winRate >= 0.6 ? 'bg-emerald-500/60' : r.winRate >= 0.45 ? 'bg-yellow-500/60' : 'bg-red-500/60'}`}
              style={{ width: `${r.winRate * 100}%` }} />
          </div>
          <span className={`w-10 text-right font-bold ${r.winRate >= 0.6 ? 'text-emerald-400' : r.winRate >= 0.45 ? 'text-yellow-400' : 'text-red-400'}`}>
            {Math.round(r.winRate * 100)}%
          </span>
          <span className={`w-16 text-right font-bold ${r.avgPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            avg {r.avgPct >= 0 ? '+' : ''}{r.avgPct.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Exit Analysis Widget ──────────────────────────────────────────────────
function ExitAnalysisWidget({ trades, th }: { trades: ClosedTrade[]; th: typeof THEMES[Theme] }) {
  const exitDefs: { type: ExitType; label: string; desc: string; goodOrBad: 'good' | 'bad' | 'neutral' }[] = [
    { type: 'TARGET_HIT',     label: 'Target Hit',      desc: 'Closed at 50–75% profit — hit the target',        goodOrBad: 'good' },
    { type: 'SCRATCH_WIN',    label: 'Partial Profit',  desc: 'Positive return below the planned profit target',     goodOrBad: 'neutral' },
    { type: 'HELD_TO_EXPIRY', label: 'Held to Expiry',  desc: 'Won but held ≥75% of duration — gamma risk',      goodOrBad: 'neutral' },
    { type: 'MANAGED_LOSS',   label: 'Managed Loss',    desc: 'Cut at planned 2× stop — disciplined loss',       goodOrBad: 'good' },
    { type: 'TIME_STOP',      label: 'Time Stop',       desc: 'Closed at ≤21 DTE — rule followed',               goodOrBad: 'neutral' },
    { type: 'FAST_CUT',       label: 'Fast Cut',        desc: 'Small loss cut quickly — defensive',              goodOrBad: 'neutral' },
    { type: 'MAX_LOSS',       label: 'Max Loss',        desc: '>150% or >$400, or held too long — failure',      goodOrBad: 'bad' },
  ];

  const rows = exitDefs.map(d => {
    const g = trades.filter(t => t.exitType === d.type);
    if (g.length === 0) return null;
    const wins = g.filter(t => t.outcome === 'WIN').length;
    const pnl  = g.reduce((s, t) => s + t.pnl, 0);
    const avgH = Math.round(g.reduce((s, t) => s + t.holdDays, 0) / g.length);
    const winRate = g.length > 0 ? wins / g.length : 0;
    // Color is derived from realized P&L, not a static expectation. A category
    // that has actually lost money is flagged regardless of what we assumed it
    // would be — this is why Fast Cut (a real dollar leak) must not stay grey.
    const realized: 'good' | 'bad' | 'neutral' =
      pnl < 0 ? 'bad' : pnl > 0 ? 'good' : 'neutral';
    return { ...d, count: g.length, winRate, pnl, avgH, realized };
  }).filter(Boolean)
    // Sort by total P&L ascending so the biggest dollar drain is always first.
    .sort((a, b) => a!.pnl - b!.pnl);

  if (rows.length === 0) return <p className={`text-xs ${th.textFaint} text-center py-4`}>No data</p>;

  const netPnl = rows.reduce((s, r) => s + r!.pnl, 0);
  const worst = rows[0]!; // lowest P&L after ascending sort
  const worstIsLeak = worst.pnl < 0;
  const leakShare = netPnl !== 0 ? Math.abs(worst.pnl) / Math.abs(netPnl) : 0;

  return (
    <div className="space-y-3">
      {worstIsLeak && (
        <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/10">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-[10px] font-bold text-red-400 tracking-wider uppercase">Biggest Leak — {worst.label}</span>
            <span className="text-xs font-bold text-red-400" style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>${worst.pnl.toFixed(0)}</span>
          </div>
          <p className={`text-[10px] ${th.textMuted}`}>
            {worst.count} trade{worst.count !== 1 ? 's' : ''} · {Math.round(worst.winRate * 100)}% win ·{' '}
            {netPnl > 0
              ? `this category alone is ${leakShare.toFixed(1)}× your net P&L of $${netPnl.toFixed(0)} — without it you'd be far ahead`
              : `dragging your net P&L to $${netPnl.toFixed(0)}`}
          </p>
        </div>
      )}
      {rows.map(r => (
        <div key={r!.type} className={`p-3 rounded-lg border ${
          r!.realized === 'good'    ? 'border-emerald-500/20 bg-emerald-500/5'
          : r!.realized === 'bad'  ? 'border-red-500/20 bg-red-500/5'
          : `${th.borderLight} bg-white/2`
        }`}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className={`text-[9px] font-bold px-1.5 py-0.5 border rounded ${
                r!.realized === 'good' ? 'border-emerald-600 text-emerald-400'
                : r!.realized === 'bad' ? 'border-red-600 text-red-400'
                : `${th.border} ${th.textFaint}`
              }`}>{r!.label}</span>
              <span className={`text-[10px] ${th.textFaint}`}>{r!.count} trade{r!.count !== 1 ? 's' : ''} · avg {r!.avgH}d hold</span>
            </div>
            <span className={`text-[10px] font-bold ${r!.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>
              {r!.pnl >= 0 ? '+' : ''}${r!.pnl.toFixed(0)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <p className={`text-[9px] ${th.textFaint} flex-1`}>{r!.desc}</p>
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="w-20 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${r!.winRate >= 0.6 ? 'bg-emerald-500/60' : r!.winRate >= 0.4 ? 'bg-yellow-500/60' : 'bg-red-500/60'}`}
                  style={{ width: `${r!.winRate * 100}%` }} />
              </div>
              <span className={`text-[9px] font-bold w-8 ${r!.winRate >= 0.6 ? 'text-emerald-400' : r!.winRate >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                {Math.round(r!.winRate * 100)}%
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Widget shell ──────────────────────────────────────────────────────────
function Widget({ config, trades, range, th, onToggle, onMoveUp, onMoveDown, isFirst, isLast }: {
  config: WidgetConfig;
  trades: ClosedTrade[];
  range: TimeRange;
  th: typeof THEMES[Theme];
  onToggle: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const WIDGET_CONTENT: Record<WidgetId, React.ReactNode> = {
    overview:      <OverviewWidget     trades={trades} th={th} />,
    monthly_pnl:   <MonthlyPnlChart    trades={trades} th={th} range={range} />,
    by_strategy:   <ByStrategyWidget   trades={trades} th={th} />,
    by_symbol:     <BySymbolWidget     trades={trades} th={th} />,
    hold_time:     <HoldTimeWidget     trades={trades} th={th} />,
    best_worst:    <BestWorstWidget    trades={trades} th={th} />,
    streak:        <StreakWidget       trades={trades} th={th} />,
    dte_analysis:  <DteAnalysisWidget  trades={trades} th={th} />,
    exit_analysis: <ExitAnalysisWidget trades={trades} th={th} />,
  };

  return (
    <div className={`${th.card} border ${th.border} rounded-xl overflow-hidden`}>
      <div className={`flex items-center justify-between px-4 py-2.5 border-b ${th.borderLight}`}>
        <p className={`text-[10px] font-bold ${th.textMuted} uppercase tracking-widest`}>
          {config.label}
          {config.id === 'monthly_pnl' && (
            <span className={`ml-2 text-[9px] font-normal ${th.textFaint} normal-case tracking-normal`}>
              — {({ '1w': 'Last Week', '2w': 'Last 2 Weeks', '1m': 'Last Month', '3m': 'Last 3 Months', '6m': 'Last 6 Months', '12m': 'Last 12 Months' } as Record<string,string>)[range]}
            </span>
          )}
        </p>
        <div className="flex items-center gap-1">
          <button onClick={onMoveUp} disabled={isFirst} className={`text-[10px] px-1.5 py-0.5 ${th.textFaint} hover:${th.text} disabled:opacity-20 transition-opacity`}>↑</button>
          <button onClick={onMoveDown} disabled={isLast} className={`text-[10px] px-1.5 py-0.5 ${th.textFaint} hover:${th.text} disabled:opacity-20 transition-opacity`}>↓</button>
          <button onClick={onToggle} className={`text-[9px] px-2 py-0.5 border rounded ml-1 ${th.border} ${th.textFaint} hover:border-red-600 hover:text-red-400 transition-colors`}>Hide</button>
        </div>
      </div>
      <div className="p-4">{WIDGET_CONTENT[config.id]}</div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function PerformancePage() {
  const [theme, setTheme] = useState<Theme>(getSavedTheme);
  const th = THEMES[theme];
  const [accent, setAccent] = useState<Accent>(getSavedAccent);
  useEffect(() => { applyAccent(accent); }, [accent]);
  useEffect(() => { injectAccentStyle(); applyAccent(getSavedAccent()); }, []);

  const [trades, setTrades]       = useState<ClosedTrade[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [status, setStatus]       = useState('');
  const [range, setRange]         = useState<TimeRange>('3m');
  const [cachedAt, setCachedAt]   = useState<number | null>(null);
  const [widgets, setWidgets]     = useState<WidgetConfig[]>(DEFAULT_WIDGETS);
  const [showConfig, setShowConfig] = useState(false);
  const [showAI, setShowAI] = useState(false);

  // Load widget config from localStorage on mount
  useEffect(() => { setWidgets(getSavedWidgets()); }, []);

  const saveWidgets = (w: WidgetConfig[]) => {
    setWidgets(w);
    try { localStorage.setItem(LS_PERF_WIDGETS, JSON.stringify(w)); } catch {}
  };

  const loadTrades = useCallback(async (r: TimeRange, forceRefresh = false) => {
    const deviceId = getDeviceId();
    if (!forceRefresh) {
      const cached = readCache(r);
      if (cached) {
        const sameDevice = cached.deviceId === deviceId;
        const fresh = Date.now() - cached.fetchedAt < 4 * 60 * 60 * 1000;
        if (sameDevice && fresh) { setTrades(cached.trades); setCachedAt(cached.fetchedAt); return; }
        setStatus(sameDevice ? 'Refreshing from TastyTrade...' : 'New device — loading from TastyTrade...');
      } else {
        setStatus('Loading trade history from TastyTrade...');
      }
    } else {
      setStatus('Refreshing from TastyTrade...');
    }
    setLoading(true); setError('');
    try {
      const { trades: fetched, unmatchedClosures } = await fetchAndReconstructTrades(r);
      if (unmatchedClosures.length > 0) {
        // PI-0008E: see the matching note in app/trade-log/page.tsx -- these
        // are closing/assignment/exercise transactions that couldn't be tied
        // to an open lot within this window, not fabricated into rows.
        console.warn(`Performance: ${unmatchedClosures.length} closing transaction(s) could not be matched to an open lot`, unmatchedClosures);
      }
      setTrades(fetched); writeCache(r, fetched); setCachedAt(Date.now());
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); setStatus(''); }
  }, []);

  useEffect(() => { loadTrades('3m'); }, [loadTrades]);

  const handleRangeChange = (r: TimeRange) => { setRange(r); loadTrades(r); };

  const enabledWidgets = widgets.filter(w => w.enabled).sort((a, b) => a.order - b.order);
  const disabledWidgets = widgets.filter(w => !w.enabled);

  const toggleWidget = (id: WidgetId) => {
    saveWidgets(widgets.map(w => w.id === id ? { ...w, enabled: !w.enabled } : w));
  };
  const moveWidget = (id: WidgetId, dir: 'up' | 'down') => {
    const enabled = [...enabledWidgets];
    const idx = enabled.findIndex(w => w.id === id);
    if (dir === 'up' && idx === 0) return;
    if (dir === 'down' && idx === enabled.length - 1) return;
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    [enabled[idx], enabled[swapIdx]] = [enabled[swapIdx], enabled[idx]];
    const reordered = enabled.map((w, i) => ({ ...w, order: i }));
    saveWidgets([...reordered, ...disabledWidgets.map((w, i) => ({ ...w, order: reordered.length + i }))]);
  };

  return (
    <div className={`min-h-screen ${th.bg} pb-24 transition-colors duration-200`} style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>

      {/* Header */}
      <div className={`${th.header} border-b ${th.border} px-6 pb-0 pt-4 flex flex-col sticky top-0 z-50`}>
        <div className="flex items-center justify-between w-full pb-2">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-base font-bold tracking-widest text-white" style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>OPTIONS HUNTER</h1>
              <p className="text-[10px] text-white/50 mt-0.5 tracking-wider" style={{ fontFamily: "var(--font-inter), system-ui, sans-serif" }}>PERFORMANCE</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div data-global-header-context className="shrink-0" />
            {/* Accent swatches */}
            <div className="flex items-center gap-1 mr-1">
              {(Object.entries(ACCENTS) as [Accent, typeof ACCENTS[Accent]][]).map(([key, val]) => (
                <button key={key} onClick={() => { setAccent(key); applyAccent(key); try { localStorage.setItem(LS_ACCENT, key); } catch {} }}
                  title={val.label}
                  className={`w-3.5 h-3.5 rounded-full transition-all ${accent === key ? 'ring-2 ring-white/60 ring-offset-1 ring-offset-black scale-125' : 'opacity-60 hover:opacity-100'}`}
                  style={{ backgroundColor: val.hex }}
                />
              ))}
            </div>
            <div className="w-px h-4 bg-white/20 mr-1" />
            {(['dark','medium','light'] as Theme[]).map(t => (
              <button key={t} onClick={() => { setTheme(t); try { localStorage.setItem(LS_THEME, t); } catch {} }}
                className={`text-[9px] px-2 py-1 border rounded transition-colors ${theme === t ? 'ac-btn' : `${th.border} ${th.textFaint} hover:ac-border-faint`}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-0 w-full border-t border-white/10">
          <Link href="/"             className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">HOME</Link>
          <Link href="/portfolio"    className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">PORTFOLIO</Link>
          <Link href="/screener"     className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">SCREENER</Link>
          <Link href="/engine"       className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">INCOME ENGINE</Link>
          <Link href="/rinse-repeat" className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">REPEAT STRATEGIES</Link>
          <Link href="/trade-log"    className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">TRADE LOG</Link>
          <span                      className="text-[10px] font-bold px-3 py-2 tracking-wider" style={{ color: '#00d4aa', borderBottom: '2px solid #00d4aa' }}>PERFORMANCE</span>
          <Link href="/help"         className="text-[10px] font-bold px-3 py-2 text-white/55 hover:text-white/80 transition-colors tracking-wider">HELP</Link>
        </div>
      </div>

      {/* Sticky controls bar */}
      <div className={`${th.header} border-b ${th.border} px-6 py-3 sticky top-[57px] z-40 transition-all duration-300 ${showAI ? 'mr-[480px]' : ''}`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1">
            {([['1w','1 WK'],['2w','2 WK'],['1m','1 MO'],['3m','3 MO'],['6m','6 MO'],['12m','12 MO']] as [TimeRange,string][]).map(([r,label]) => (
              <button key={r} onClick={() => handleRangeChange(r)} disabled={loading}
                className={`text-[10px] px-2.5 py-1.5 border rounded font-bold tracking-wider transition-colors disabled:opacity-50 ${
                  range === r ? 'ac-btn ac-bg-10' : `${th.border} ${th.textFaint} hover:ac-border-faint ac-hover-text`
                }`}>
                {label}
              </button>
            ))}
            {!loading && trades.length > 0 && (
              <span className={`ml-2 text-[9px] ${th.textFaint}`}>
                {({'1w':'last 7 days','2w':'last 14 days','1m':'last 30 days','3m':'last 3 months','6m':'last 6 months','12m':'last 12 months'} as Record<string,string>)[range]}
                {' · '}{trades.length} trades
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {cachedAt && <span className={`text-[9px] ${th.textFaint}`}>Last synced {fmtAge(Date.now() - cachedAt)}</span>}
            {trades.length > 0 && (
              <button onClick={() => setShowAI(v => !v)}
                className={`text-[10px] px-3 py-1.5 border rounded font-bold tracking-wider transition-colors ${showAI ? 'border-indigo-500 text-indigo-400 bg-indigo-500/10' : 'border-indigo-700 text-indigo-400 hover:border-indigo-500 hover:bg-indigo-500/10'}`}>
                ◈ AI Analysis
              </button>
            )}
            <button onClick={() => setShowConfig(v => !v)}
              className={`text-[10px] px-3 py-1.5 border rounded tracking-wider transition-colors ${showConfig ? 'border-purple-500 text-purple-400 bg-purple-500/10' : `${th.border} ${th.textFaint} hover:border-purple-500 hover:text-purple-400`}`}>
              ⊞ Configure
            </button>
            <button onClick={() => loadTrades(range, true)} disabled={loading}
              className={`text-[10px] px-3 py-1.5 border ${th.border} rounded ${th.textMuted} ac-hover-border ac-hover-text transition-colors disabled:opacity-50 tracking-wider`}>
              {loading ? '↺ Loading...' : '↺ Refresh'}
            </button>
          </div>
        </div>
      </div>{/* end sticky controls */}

      <div className={`px-6 py-4 max-w-[1400px] mx-auto space-y-4 transition-all duration-300 ${showAI ? 'mr-[480px]' : ''}`}>

        {/* Widget configurator panel */}
        {showConfig && (
          <div className={`${th.card} border ${th.border} rounded-xl p-4`}>
            <p className={`text-[10px] font-bold ${th.textMuted} uppercase tracking-widest mb-3`}>Widget Configuration</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {widgets.sort((a, b) => a.order - b.order).map(w => (
                <button key={w.id} onClick={() => toggleWidget(w.id)}
                  className={`text-[10px] px-3 py-2 border rounded text-left transition-colors ${
                    w.enabled
                      ? 'ac-btn ac-bg-10'
                      : `${th.border} ${th.textFaint} ac-hover-border ac-hover-text`
                  }`}>
                  {w.enabled ? '✓ ' : '+ '}{w.label}
                </button>
              ))}
            </div>
            <p className={`text-[9px] ${th.textFaint} mt-3`}>Use ↑↓ buttons on widgets to reorder. Config is saved automatically.</p>
          </div>
        )}

        {/* Status */}
        {(loading || status) && (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-blue-500/20 bg-blue-500/5">
            {loading && <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />}
            <p className={`text-xs ${loading ? 'text-blue-400' : th.textFaint}`}>{status || 'Loading...'}</p>
          </div>
        )}
        {error && (
          <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/8">
            <p className="text-xs text-red-400 font-medium">{error}</p>
          </div>
        )}

        {/* Widgets */}
        {!loading && trades.length > 0 && (
          <div className="space-y-4">
            {enabledWidgets.map((w, i) => (
              <Widget
                key={w.id}
                config={w}
                trades={trades}
                range={range}
                th={th}
                onToggle={() => toggleWidget(w.id)}
                onMoveUp={() => moveWidget(w.id, 'up')}
                onMoveDown={() => moveWidget(w.id, 'down')}
                isFirst={i === 0}
                isLast={i === enabledWidgets.length - 1}
              />
            ))}
          </div>
        )}

        {!loading && !error && trades.length === 0 && (
          <div className={`text-center py-16 ${th.textFaint}`}>
            <div className="text-4xl mb-3 opacity-20">◈</div>
            <p className="text-sm">No closed trades found in this period.</p>
            <p className="text-[10px] mt-2 opacity-60">Try extending the time range or check your TastyTrade authentication.</p>
          </div>
        )}
      </div>

      {showAI && (
        <AIChatPanel trades={trades} range={range} th={th} onClose={() => setShowAI(false)} />
      )}
    </div>
  );
}
