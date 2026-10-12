// components/nav/AppHeader.tsx
'use client';

// APP-HEADER-0001 (Diane): the one header every page renders.
//
//   Row 1  brand (left)  |  LIVE/PAPER mode, active broker account, theme (right)
//   Row 2  page actions   (optional, wraps -- never scrolls sideways)
//   Row 3  tab bar        (wraps, Profile pinned right)
//
// The mode and account chips portal into the slot in row 1 (their one render
// site stays components/header/GlobalHeaderContextControls.tsx). The slot sits
// in the fixed top row, so a page's own buttons can never push the chips
// off-screen. The header publishes its measured height as --app-header-h so
// sticky bars under it (trade log, performance, ...) stay flush at any width.

import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';
import { AppNav } from '@/components/nav/AppNav';
import { ACCENTS, THEMES, LS_ACCENT, LS_THEME, applyAccent, type Accent, type Theme } from '@/lib/theme';
import type { TabId } from '@/lib/nav/tabs';

interface AppHeaderProps {
  active?: TabId;
  /** Page-specific buttons/status, shown on their own wrapping row. */
  actions?: ReactNode;
  /** Pass all four to show the accent + theme controls (pages that own theme state). */
  theme?: Theme;
  setTheme?: (t: Theme) => void;
  accent?: Accent;
  setAccent?: (a: Accent) => void;
}

function Logo() {
  return (
    <svg width="40" height="40" viewBox="-26 -26 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle r="18" stroke="#00d4aa" strokeWidth="0.8" opacity="0.3" />
      <circle r="12" stroke="#00d4aa" strokeWidth="0.8" opacity="0.6" />
      <line x1="-23" y1="0" x2="-14" y2="0" stroke="#00d4aa" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="14" y1="0" x2="23" y2="0" stroke="#00d4aa" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="0" y1="-23" x2="0" y2="-14" stroke="#00d4aa" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="0" y1="14" x2="0" y2="23" stroke="#00d4aa" strokeWidth="1.1" strokeLinecap="round" />
      <line x1="-6" y1="5" x2="-6" y2="-6" stroke="#ff5566" strokeWidth="1.8" strokeLinecap="round" opacity="0.85" />
      <line x1="-1" y1="3" x2="-1" y2="-9" stroke="#00d4aa" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="4" y1="1" x2="4" y2="-12" stroke="#00d4aa" strokeWidth="1.8" strokeLinecap="round" />
      <circle r="2" fill="#00d4aa" />
    </svg>
  );
}

function ThemeControls({ theme, setTheme, accent, setAccent }: { theme: Theme; setTheme: (t: Theme) => void; accent: Accent; setAccent: (a: Accent) => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {(Object.entries(ACCENTS) as [Accent, (typeof ACCENTS)[Accent]][]).map(([key, val]) => (
          <button
            key={key}
            onClick={() => { setAccent(key); applyAccent(key); try { localStorage.setItem(LS_ACCENT, key); } catch {} }}
            title={val.label}
            aria-label={`${val.label} accent`}
            className={`w-3.5 h-3.5 rounded-full transition-all ${accent === key ? 'ring-2 ring-white/60 ring-offset-1 ring-offset-black scale-125' : 'opacity-60 hover:opacity-100'}`}
            style={{ backgroundColor: val.hex }}
          />
        ))}
      </div>
      <div className="w-px h-4 bg-white/20" />
      <div className="flex items-center gap-1 bg-black/20 rounded-lg p-1">
        {(['light', 'medium', 'dark'] as Theme[]).map((v, i) => (
          <button
            key={v}
            onClick={() => { setTheme(v); try { localStorage.setItem(LS_THEME, v); } catch {} }}
            aria-label={`${v} theme`}
            className={`text-sm px-2 py-1 rounded transition-all ${theme === v ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/80'}`}
          >
            {['☀', '◐', '☾'][i]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AppHeader({ active, actions, theme, setTheme, accent, setAccent }: AppHeaderProps) {
  const rootRef = useRef<HTMLElement>(null);
  const th = THEMES[theme ?? 'dark'];

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty('--app-header-h', `${el.offsetHeight}px`);
    publish();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <header ref={rootRef} className={`${th.header} border-b ${th.border} px-6 pt-3 sticky top-0 z-50`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-2">
        <Link href="/" className="flex items-center gap-3 shrink-0" aria-label="TradeEdge home">
          <Logo />
          <span>
            <span className="block text-lg font-bold tracking-widest text-white leading-tight" style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>
              TRADE<span style={{ color: '#00d4aa' }}>EDGE</span>
            </span>
            <span className="block text-[9px] font-bold tracking-widest leading-tight" style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif', color: '#00d4aa', opacity: 0.75 }}>
              OPTIONS TRADING PLATFORM
            </span>
          </span>
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-3 min-w-0">
          {/* The mode + account chips mount here (single render site: GlobalHeaderContextControls). */}
          <div data-global-header-context className="shrink-0" />
          {theme && setTheme && accent && setAccent && (
            <ThemeControls theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent} />
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 pb-2">{actions}</div>}
      <AppNav active={active} />
    </header>
  );
}
