'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ActiveBrokerAccountIndicator } from '@/components/account/ActiveBrokerAccountProvider';
import { PortfolioModeIndicator, PortfolioModeSafetyOverlay } from '@/components/portfolio-mode/PortfolioModeIndicator';

const HEADER_CONTEXT_SELECTOR = '[data-global-header-context]';

export function GlobalHeaderContextControls() {
  const pathname = usePathname();
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    setTarget(document.querySelector(HEADER_CONTEXT_SELECTOR));
  }, [pathname]);

  return (
    <>
      <PortfolioModeSafetyOverlay />
      {target && createPortal(
        <div className="flex shrink-0 items-center gap-2" aria-label="Application context controls">
          <PortfolioModeIndicator />
          <ActiveBrokerAccountIndicator />
          {/* NAV-HIDE-0001: always-visible entry to the user's profile (tab visibility settings). */}
          <Link
            href="/profile"
            className="text-[10px] font-bold px-3 py-1.5 rounded-lg border border-white/20 text-white/70 hover:text-white hover:border-[#00d4aa] transition-colors tracking-wider"
            style={pathname === '/profile' ? { color: '#00d4aa', borderColor: '#00d4aa' } : undefined}
          >
            PROFILE
          </Link>
        </div>,
        target,
      )}
    </>
  );
}
