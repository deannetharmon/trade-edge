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

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TaskProvider>
        <CommandProvider>
          <PortfolioDataProvider>
            {children}
            <RankedScanTaskMirror />
            <ScreenerCardPolish />
            <ScreenerJobStatus />
          </PortfolioDataProvider>
        </CommandProvider>
      </TaskProvider>
    </SessionProvider>
  );
}
