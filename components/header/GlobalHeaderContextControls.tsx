'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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
        </div>,
        target,
      )}
    </>
  );
}
