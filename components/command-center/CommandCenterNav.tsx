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
  // "Opportunity review destination" (design doc section 3.8): no dedicated
  // review route exists elsewhere in the app yet -- the Best Opportunity
  // card below IS that destination on this page, so this links to it
  // in-page rather than inventing a route that doesn't exist.
  { href: '#best-opportunity', label: 'Opportunity Review' },
  { href: '/paper-trading', label: 'Paper Trading' },
  { href: '/performance', label: 'Performance' },
  { href: '/trade-log', label: 'Trade Log' },
];

export interface CommandCenterNavProps {
  th: (typeof THEMES)[Theme];
}

export function CommandCenterNav({ th }: CommandCenterNavProps) {
  // Header-placement corrective pass: /dashboard (the only route this nav
  // renders on) has no top header band of its own -- this nav is the very
  // first thing in the page, starting close to the top of the viewport.
  // The globally-mounted, viewport-centered PortfolioModeIndicator floats
  // in that same top band on every route. On routes with a real header
  // (Screener, Portfolio, Help, ...) that header's own layout leaves the
  // horizontal center empty by construction, so there's nothing to clear.
  // This route has no such header, and this left-packed link row's
  // horizontal extent can reach the viewport's horizontal center -- so a
  // small top margin (not present before this pass) is added here,
  // specifically to clear the indicator's vertical footprint. This is a
  // minimal, targeted spacing correction to one small shared component,
  // not a redesign of the page.
  return (
    <nav className={`mt-10 mb-6 flex flex-wrap gap-2`} aria-label="Command Center navigation">
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
