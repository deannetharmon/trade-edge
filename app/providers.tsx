// app/providers.tsx
'use client';

import { SessionProvider } from 'next-auth/react';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { RankedScanTaskMirror } from '@/components/tasks/RankedScanTaskMirror';
import { ScreenerJobStatus } from '@/components/ScreenerJobStatus';
import { ScreenerCardPolish } from '@/components/ScreenerCardPolish';
// TC-0001 corrective round: mounted once at the app-shell level (same
// pattern as TaskProvider) so app/portfolio/page.tsx and app/dashboard/
// page.tsx consume the exact same live TastyTrade acquisition + composition
// pipeline instead of each owning a private copy. See
// components/portfolio-data/PortfolioDataProvider.tsx's module doc.
import { PortfolioDataProvider } from '@/components/portfolio-data/PortfolioDataProvider';
// PT-0002A: mounted once at the app-shell level, deliberately independent of
// PortfolioDataProvider (neither depends on the other -- no provider cycle,
// no coupling between mode selection and live data acquisition). Nested
// outside PortfolioDataProvider only to reflect that mode conceptually
// governs which context a future consumer should use; PT-0002A does not
// wire that dependency yet (see PortfolioModeProvider.tsx's module doc).
// PortfolioModeIndicator is the required global, unmistakable indicator/
// selector, mounted once alongside the other global overlays below.
import { PortfolioModeProvider } from '@/components/portfolio-mode/PortfolioModeProvider';
import { PortfolioModeIndicator } from '@/components/portfolio-mode/PortfolioModeIndicator';
import { ActiveBrokerAccountIndicator, ActiveBrokerAccountProvider } from '@/components/account/ActiveBrokerAccountProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TaskProvider>
        <CommandProvider>
          <ActiveBrokerAccountProvider>
            <PortfolioModeProvider>
              <PortfolioDataProvider>
                {children}
                <RankedScanTaskMirror />
                <ScreenerCardPolish />
                <ScreenerJobStatus />
                <PortfolioModeIndicator />
                <ActiveBrokerAccountIndicator />
              </PortfolioDataProvider>
            </PortfolioModeProvider>
          </ActiveBrokerAccountProvider>
        </CommandProvider>
      </TaskProvider>
    </SessionProvider>
  );
}
