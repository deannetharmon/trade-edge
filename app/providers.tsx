// app/providers.tsx
'use client';

import { SessionProvider } from 'next-auth/react';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskStatusBar } from '@/components/tasks/TaskStatusBar';
import { RankedScanTaskMirror } from '@/components/tasks/RankedScanTaskMirror';
import { ScreenerJobStatus } from '@/components/ScreenerJobStatus';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TaskProvider>
        <CommandProvider>
          {children}
          <RankedScanTaskMirror />
          <TaskStatusBar />
          <ScreenerJobStatus />
        </CommandProvider>
      </TaskProvider>
    </SessionProvider>
  );
}
