// components/nav/AppNav.tsx
'use client';

// NAV-HIDE-0001: the one tab bar used by every page. Tabs wrap onto a second
// line instead of scrolling sideways, so every tab is always reachable, and
// Profile is pinned to the right end.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useNavConfig } from '@/components/nav/NavConfigProvider';
import { TabId, visibleTabs } from '@/lib/nav/tabs';

const ACTIVE_STYLE = { color: '#00d4aa', borderBottom: '2px solid #00d4aa' } as const;
const BASE = 'text-[10px] font-bold px-3 py-2 tracking-wider whitespace-nowrap';

export function AppNav({ active }: { active?: TabId }) {
  const { hiddenTabs } = useNavConfig();
  const tabs = visibleTabs(hiddenTabs);
  const profileActive = usePathname() === '/profile';

  return (
    <nav aria-label="Primary" className="flex flex-wrap items-stretch w-full border-t border-white/10">
      {tabs.map((t) =>
        t.id === active ? (
          <span key={t.id} className={BASE} style={ACTIVE_STYLE} aria-current="page">
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
      {profileActive ? (
        <span className={`${BASE} ml-auto`} style={ACTIVE_STYLE} aria-current="page">
          👤 PROFILE
        </span>
      ) : (
        <Link href="/profile" className={`${BASE} ml-auto text-white/70 hover:text-[#00d4aa] transition-colors`}>
          👤 PROFILE
        </Link>
      )}
    </nav>
  );
}
