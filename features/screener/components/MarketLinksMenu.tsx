// features/screener/components/MarketLinksMenu.tsx
//
// MARKET-LINK-0002: "Markets ↗" menu for order screens. Each entry opens the Yahoo Finance page in a new tab.

'use client';

import { MARKET_LINKS, MARKET_MAP_LABEL } from '@/lib/market/marketMapLink';

export default function MarketLinksMenu() {
  return (
    <details className="relative ml-auto mr-3" data-testid="market-links-menu">
      <summary className="list-none cursor-pointer text-[10px] text-sky-400 hover:text-sky-300 underline underline-offset-2 select-none">{MARKET_MAP_LABEL}</summary>
      <div className="absolute right-0 top-full mt-1 z-10 min-w-[140px] rounded-lg border border-slate-600 bg-slate-900 py-1 shadow-lg">
        {MARKET_LINKS.map(link => (
          <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" className="block px-3 py-1 text-xs text-slate-200 hover:bg-slate-800">{link.label} ↗</a>
        ))}
      </div>
    </details>
  );
}
