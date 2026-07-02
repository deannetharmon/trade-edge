// app/providers.tsx
'use client';

import { SessionProvider } from 'next-auth/react';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import { CommandProvider } from '@/components/commands/CommandProvider';
import { TaskStatusBar } from '@/components/tasks/TaskStatusBar';
import { TaskNotifications } from '@/components/tasks/TaskNotifications';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TaskProvider>
        <CommandProvider>
          {children}
          <TaskStatusBar />
          <TaskNotifications />
          <TaskDrawer />
        </CommandProvider>
      </TaskProvider>
    </SessionProvider>
  );
}



