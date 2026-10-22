// app/market/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { AppHeader } from '@/components/nav/AppHeader';
import { THEMES, Theme, Accent, getSavedTheme, getSavedAccent, applyAccent, injectAccentStyle } from '@/lib/theme';
import MarketMapPanel from '@/features/market/MarketMapPanel';
import MarketLinksMenu from '@/features/screener/components/MarketLinksMenu';

export default function MarketPage() {
  const [theme, setTheme] = useState<Theme>(getSavedTheme);
  const th = THEMES[theme];
  const [accent, setAccent] = useState<Accent>(getSavedAccent);
  useEffect(() => { applyAccent(accent); }, [accent]);
  useEffect(() => { injectAccentStyle(); applyAccent(getSavedAccent()); }, []);

  return (
    <div className={`min-h-screen ${th.bg} pb-24 transition-colors duration-200`} style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>
      <AppHeader active="market" theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent} />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-4">
        <div className="flex items-center">
          <h1 className={`text-sm font-bold tracking-widest ${th.text}`}>MARKET MAP</h1>
          <MarketLinksMenu />
        </div>
        <MarketMapPanel textClass={th.text} mutedClass={th.textFaint} borderClass={th.border} cardClass={th.card} />
      </main>
    </div>
  );
}
