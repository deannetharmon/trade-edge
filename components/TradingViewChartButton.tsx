// components/TradingViewChartButton.tsx

'use client';

import { buildTradingViewChartUrl } from '@/lib/tradingview';

/** "Open TradingView": a new tab on Dean's saved TradingView layout with this ticker (TV-LAYOUT-0001). */
export function TradingViewChartButton({
  symbol,
  className = '',
  onClick,
}: {
  symbol: string;
  className?: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <a
      href={buildTradingViewChartUrl(symbol)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={className}
      aria-label={`Open ${symbol} in TradingView with your saved layout`}
    >
      Open TradingView
    </a>
  );
}
