// components/nav/ToolLinks.tsx

// TOOL-LINKS-0001: quick links to the tools Dean uses next to TradeEdge. Rendered by AppHeader under the theme selector, so every page has them.
export const TOOL_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: 'TradingView', href: 'https://www.tradingview.com/' },
  { label: 'GuacTracker', href: 'https://guactracker.com/' },
  { label: 'Discord', href: 'https://discord.com/' },
  { label: 'Yahoo Finance', href: 'https://finance.yahoo.com/' },
];

export function ToolLinks() {
  return (
    <nav aria-label="Tools" data-testid="tool-links" className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[11px]">
      {TOOL_LINKS.map(link => (
        <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className="text-white/60 underline decoration-dotted underline-offset-2 hover:text-white focus:text-white focus:outline-none focus:ring-1 focus:ring-white/40">
          {link.label}
        </a>
      ))}
    </nav>
  );
}
