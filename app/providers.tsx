// app/providers.tsx
'use client';

import { SessionProvider } from 'next-auth/react';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { RankedScanTaskMirror } from '@/components/tasks/RankedScanTaskMirror';
import { ScreenerJobStatus } from '@/components/ScreenerJobStatus';
import { ScreenerCardPolish } from '@/components/ScreenerCardPolish';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TaskProvider>
        <CommandProvider>
          {children}
          <RankedScanTaskMirror />
          <ScreenerCardPolish />
          <ScreenerJobStatus />
        </CommandProvider>
      </TaskProvider>
    </SessionProvider>
  );
}
