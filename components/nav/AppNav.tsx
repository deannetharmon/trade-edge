// components/nav/AppNav.tsx
'use client';

// NAV-HIDE-0001: the one tab bar used by every page. Replaces the per-page
// inline copies so the tabs are identical everywhere and a user's hidden tabs
// apply consistently. Visual styling matches the previous inline bars.

import Link from 'next/link';
import { useNavConfig } from '@/components/nav/NavConfigProvider';
import { TabId, visibleTabs } from '@/lib/nav/tabs';

const ACTIVE_STYLE = { color: '#00d4aa', borderBottom: '2px solid #00d4aa' } as const;
const BASE = 'text-[10px] font-bold px-3 py-2 tracking-wider';

export function AppNav({ active }: { active?: TabId | 'profile' }) {
  const { hiddenTabs } = useNavConfig();
  const tabs = visibleTabs(hiddenTabs);

  return (
    <div className="flex items-center gap-0 w-full border-t border-white/10 overflow-x-auto whitespace-nowrap">
      {tabs.map((t) =>
        t.id === active ? (
          <span key={t.id} className={BASE} style={ACTIVE_STYLE}>
            {t.label}
          </span>
        ) : (
          <Link
            key={t.id}
            href={t.href}
            className={`${BASE} transition-colors ${
              t.accent === 'amber' ? 'text-amber-400/80 hover:text-amber-300' : 'text-white/55 hover:text-white/80'
            }`}
          >
            {t.label}
          </Link>
        ),
      )}
      <span className="flex-1" />
      {active === 'profile' ? (
        <span className={BASE} style={ACTIVE_STYLE}>
          PROFILE
        </span>
      ) : (
        <Link href="/profile" className={`${BASE} transition-colors text-white/55 hover:text-white/80`}>
          PROFILE
        </Link>
      )}
    </div>
  );
}
