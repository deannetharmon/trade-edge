'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

const DEFAULT_STUDIES = ['BB@tv-basicstudies', 'RSI@tv-basicstudies', 'Volume@tv-basicstudies'];

export function buildTradingViewWidgetUrl(symbol: string): string {
  const configuration = {
    autosize: true,
    symbol,
    interval: 'D',
    timezone: 'America/New_York',
    theme: 'dark',
    style: '1',
    backgroundColor: 'rgba(13, 17, 23, 1)',
    gridColor: 'rgba(30, 36, 51, 1)',
    withdateranges: true,
    hide_side_toolbar: false,
    allow_symbol_change: false,
    save_image: true,
    studies: DEFAULT_STUDIES,
    show_popup_button: false,
    support_host: 'https://www.tradingview.com',
    width: '100%',
    height: '100%',
  };
  return `https://www.tradingview-widget.com/embed-widget/advanced-chart/?locale=en#${encodeURIComponent(JSON.stringify(configuration))}`;
}

export function TradingViewChartButton({
  symbol,
  className = '',
  onClick,
}: {
  symbol: string;
  className?: string;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const [open, setOpen] = useState(false);
  const widgetUrl = useMemo(() => buildTradingViewWidgetUrl(symbol), [symbol]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return <>
    <button
      type="button"
      onClick={(event) => { onClick?.(event); setOpen(true); }}
      className={className}
      aria-label={`Open ${symbol} chart with Bollinger Bands, RSI, and volume`}
    >
      Open chart
    </button>
    {open && typeof document !== 'undefined' && createPortal(
      <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-3" role="dialog" aria-modal="true" aria-label={`${symbol} technical chart`} onMouseDown={() => setOpen(false)}>
        <div className="flex h-[min(700px,calc(100vh-24px))] w-[min(1200px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-slate-700 bg-[#0d1117] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
            <div><span className="text-sm font-bold text-slate-100">{symbol}</span><span className="ml-2 text-[10px] text-slate-400">Daily · Bollinger Bands · RSI 14 · Volume</span></div>
            <button type="button" onClick={() => setOpen(false)} className="min-h-8 min-w-8 rounded text-slate-400 hover:bg-slate-800 hover:text-white" aria-label={`Close ${symbol} chart`}>✕</button>
          </div>
          <iframe title={`${symbol} TradingView chart`} src={widgetUrl} className="min-h-0 w-full flex-1 border-0" allow="clipboard-write; fullscreen" />
        </div>
      </div>,
      document.body,
    )}
  </>;
}
