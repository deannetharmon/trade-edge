// app/research/page.tsx
'use client';

// RESEARCH-0001: look up any ticker (price, chart, key stats) without adding it to the screener.
import { useEffect, useState } from 'react';
import { AppHeader } from '@/components/nav/AppHeader';
import { ResearchView } from '@/features/research/ResearchView';
import { THEMES, applyAccent, getSavedAccent, getSavedTheme, injectAccentStyle, type Accent, type Theme } from '@/lib/theme';

export default function ResearchPage() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [accent, setAccent] = useState<Accent>('electric');
  const [symbol, setSymbol] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTheme(getSavedTheme());
    const saved = getSavedAccent();
    setAccent(saved);
    injectAccentStyle();
    applyAccent(saved);
    setSymbol(new URLSearchParams(window.location.search).get('symbol'));
    setReady(true);
  }, []);

  const th = THEMES[theme];
  return (
    <div className={`min-h-screen ${th.bg} ${th.text}`}>
      <AppHeader active="research" theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent} />
      {ready && <ResearchView th={th} initialSymbol={symbol} />}
    </div>
  );
}
