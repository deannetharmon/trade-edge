// components/command-center/CommandCenterNav.tsx
//
// TC-0001: navigation into every existing detailed workflow the design spec
// requires (section 3.8). Existing routes remain authoritative -- this is a
// plain link list, no navigation redesign.

import Link from 'next/link';
import type { THEMES, Theme } from '@/lib/theme';

const LINKS: { href: string; label: string }[] = [
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/screener', label: 'Screener / Hunter' },
  // WA-0005 §17: repointed from the in-page /dashboard anchor
  // (#best-opportunity) to /screener's own, genuinely-existing
  // id="ranked-opportunities" anchor -- finally realizing WA-0001 §3/§7's
  // stated (but never implemented, until this sprint) intent to move this
  // link to the canonical Opportunities workspace itself.
  { href: '/screener#ranked-opportunities', label: 'Opportunity Review' },
  { href: '/paper-trading', label: 'Paper Trading' },
  { href: '/performance', label: 'Performance' },
  { href: '/trade-log', label: 'Trade Log' },
];

export interface CommandCenterNavProps {
  th: (typeof THEMES)[Theme];
}

export function CommandCenterNav({ th }: CommandCenterNavProps) {
  return (
    <nav className={`mb-6 flex flex-wrap gap-2`} aria-label="Command Center navigation">
      {LINKS.map(link => (
        <Link
          key={link.href}
          href={link.href}
          className={`rounded-lg border ${th.borderLight} ${th.card} px-3 py-1.5 text-[11px] font-semibold ${th.textMuted} hover:${th.text}`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
