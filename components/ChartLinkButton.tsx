'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { THEMES, Theme } from '@/lib/theme';

export function ChartLinkButton({ symbol, chartSymbol = symbol, instanceKey, th, showChart, setShowChart, sparkData, setSparkData, sparkLoading, setSparkLoading }: {
  symbol: string;
  chartSymbol?: string;
  instanceKey: string;
  th: typeof THEMES[Theme];
  showChart: boolean;
  setShowChart: (value: boolean) => void;
  sparkData: number[] | null;
  setSparkData: (value: number[] | null) => void;
  sparkLoading: boolean;
  setSparkLoading: (value: boolean) => void;
}) {
  const reactId = useId().replace(/:/g, '');
  const popupId = `quick-chart-${reactId}`;
  const gradientId = `chart-gradient-${reactId}-${instanceKey.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, visible: false });

  useEffect(() => {
    if (!showChart) return;
    const reposition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(280, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const estimatedHeight = 155;
      const top = rect.bottom + 6 + estimatedHeight <= window.innerHeight
        ? rect.bottom + 6
        : Math.max(12, rect.top - estimatedHeight - 6);
      setPosition({ top, left, visible: true });
    };
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !popupRef.current?.contains(target)) setShowChart(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setShowChart(false); buttonRef.current?.focus(); }
    };
    reposition();
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [setShowChart, showChart]);

  const toggle = () => {
    if (showChart) { setShowChart(false); return; }
    setShowChart(true);
    if (sparkData !== null) return;
    setSparkLoading(true);
    fetch(`/api/chart?symbol=${encodeURIComponent(chartSymbol)}`)
      .then(response => response.json())
      .then(payload => setSparkData((payload?.bars ?? []).map((bar: { c?: number }) => bar?.c).filter((value: number | undefined): value is number => value != null).slice(-90)))
      .catch(() => setSparkData([]))
      .finally(() => setSparkLoading(false));
  };

  const popup = showChart && typeof document !== 'undefined' ? createPortal(<div ref={popupRef} id={popupId} role="dialog" aria-label={`Quick chart for ${symbol}`} className={`fixed z-[9999] rounded-xl border p-3 shadow-2xl ${th.sidebar} ${th.border}`} style={{ width: 'min(280px, calc(100vw - 24px))', top: position.top, left: position.left, visibility: position.visible ? 'visible' : 'hidden' }}>
    <div className="mb-2 flex items-center justify-between"><span className={`text-[10px] font-bold tracking-widest ${th.textFaint}`}>{symbol}</span><button type="button" onClick={() => { setShowChart(false); buttonRef.current?.focus(); }} aria-label={`Close quick chart for ${symbol}`} className="min-h-8 min-w-8 text-slate-500 hover:text-white focus:outline-none focus:ring-2 focus:ring-blue-400">✕</button></div>
    {sparkLoading && <div role="status" aria-label={`Loading chart for ${symbol}`} className="flex h-16 items-center justify-center"><div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" /></div>}
    {!sparkLoading && sparkData && sparkData.length > 1 && (() => {
      const min = Math.min(...sparkData), max = Math.max(...sparkData), range = max - min || 1;
      const width = 256, height = 56;
      const points = sparkData.map((value, index) => `${((index / (sparkData.length - 1)) * width).toFixed(1)},${(height - ((value - min) / range) * height).toFixed(1)}`).join(' ');
      const lastPrice = sparkData[sparkData.length - 1], firstPrice = sparkData[0];
      const isUp = lastPrice >= firstPrice, color = isUp ? '#10b981' : '#ef4444';
      const changePct = ((lastPrice - firstPrice) / firstPrice * 100).toFixed(1);
      return <div><div className="mb-1 flex items-center justify-between"><span className={`text-[10px] font-bold ${th.text}`}>{symbol}</span><span className="text-[10px] font-bold" style={{ color }}>${lastPrice.toFixed(2)} <span className="text-[9px]">{isUp ? '+' : ''}{changePct}% 30d</span></span></div><svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 56 }}><defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.3"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs><polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/><polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#${gradientId})`}/></svg></div>;
    })()}
    {!sparkLoading && sparkData && sparkData.length === 0 && <p role="status" className={`py-3 text-center text-[9px] ${th.textFaint}`}>Chart data unavailable</p>}
    <a href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${symbol} in TradingView, opens in new tab`} className="flex w-full min-h-8 items-center justify-center gap-2 rounded-lg border border-blue-500/30 text-[10px] font-bold tracking-wider text-blue-400 transition-colors hover:border-blue-500/60 hover:bg-blue-500/10">Open in TradingView</a>
  </div>, document.body) : null;

  return <><button ref={buttonRef} type="button" onClick={event => { event.stopPropagation(); toggle(); }} aria-label={`Quick chart for ${symbol}`} aria-expanded={showChart} aria-controls={popupId} title="Quick chart" className={`inline-flex min-h-8 items-center gap-0.5 text-[9px] transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 ${showChart ? 'text-blue-400' : 'text-slate-500 hover:text-blue-400'}`}><svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg><span className="tracking-wide">chart</span></button>{popup}</>;
}
