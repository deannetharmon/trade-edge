// lib/nav/tabs.ts
//
// NAV-HIDE-0001: single source of truth for the application tab bar.
// Every page renders the same tabs (via components/nav/AppNav.tsx); a user can
// hide the tabs marked `hideable` from their profile. Hiding never removes
// code -- it only filters what the user sees.

export type TabId =
  | 'home'
  | 'portfolio'
  | 'screener'
  | 'engine'
  | 'wheel'
  | 'rinse-repeat'
  | 'trade-log'
  | 'pmcc-history'
  | 'performance'
  | 'paper-trading'
  | 'wheel-simulator'
  | 'help';

export interface TabDef {
  id: TabId;
  label: string;
  href: string;
  desc: string;
  /** Can the user hide this tab from their profile? */
  hideable: boolean;
  /** Amber styling used by the paper-trading tab. */
  accent?: 'amber';
}

// Order here is the order shown on every page.
export const TABS: TabDef[] = [
  { id: 'home',            label: 'HOME',              href: '/',                desc: 'Overview',                                         hideable: false },
  { id: 'portfolio',       label: 'PORTFOLIO',         href: '/portfolio',       desc: 'Live positions, Greeks, action buttons',           hideable: false },
  { id: 'screener',        label: 'SCREENER',          href: '/screener',        desc: 'Scan tickers for BPS, BCS, IC setups',             hideable: false },
  { id: 'engine',          label: 'INCOME ENGINE',     href: '/engine',          desc: 'SPX spread suggestions and capital allocation',    hideable: true  },
  { id: 'wheel',           label: 'WHEEL',             href: '/wheel',           desc: 'Wheel candidates and defaults',                    hideable: true  },
  { id: 'rinse-repeat',    label: 'REPEAT', href: '/rinse-repeat',    desc: 'Re-screen past winners and track cycles',          hideable: true  },
  { id: 'trade-log',       label: 'TRADE LOG',         href: '/trade-log',       desc: 'Closed trade history and P&L analysis',            hideable: false },
  { id: 'pmcc-history',    label: 'PMCC HISTORY',      href: '/pmcc-history',    desc: 'Read-only PMCC audit history',                     hideable: true  },
  { id: 'performance',     label: 'PERFORMANCE',       href: '/performance',     desc: 'Monthly P&L charts and win rate stats',            hideable: false },
  { id: 'paper-trading',   label: 'PAPER TRADING',     href: '/paper-trading',   desc: 'Simulated trading',                                hideable: true, accent: 'amber' },
  { id: 'wheel-simulator', label: 'WHEEL SIMULATOR',   href: '/wheel-simulator', desc: 'Wheel strategy simulator',                         hideable: true  },
  { id: 'help',            label: 'HELP',              href: '/help',            desc: 'Guides and strategy reference',                    hideable: false },
];

export const HIDEABLE_TAB_IDS: TabId[] = TABS.filter((t) => t.hideable).map((t) => t.id);

/** Keep only ids that are real, hideable tabs; drop duplicates and junk. */
export function sanitizeHiddenTabs(input: unknown): TabId[] {
  if (!Array.isArray(input)) return [];
  const out: TabId[] = [];
  for (let i = 0; i < input.length; i++) {
    const id = input[i] as TabId;
    if (typeof id === 'string' && HIDEABLE_TAB_IDS.indexOf(id) !== -1 && out.indexOf(id) === -1) {
      out.push(id);
    }
  }
  return out;
}

export function visibleTabs(hidden: TabId[]): TabDef[] {
  return TABS.filter((t) => hidden.indexOf(t.id) === -1);
}

/** Tab that owns a pathname, or null (e.g. /profile, /login). */
export function tabForPath(pathname: string | null | undefined): TabDef | null {
  if (!pathname) return null;
  for (let i = 0; i < TABS.length; i++) {
    const t = TABS[i];
    if (t.href === '/') continue;
    if (pathname === t.href || pathname.indexOf(t.href + '/') === 0) return t;
  }
  return null;
}

/** True when the pathname belongs to a tab the user has hidden. */
export function isPathHidden(pathname: string | null | undefined, hidden: TabId[]): boolean {
  const tab = tabForPath(pathname);
  return !!tab && hidden.indexOf(tab.id) !== -1;
}
