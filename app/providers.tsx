// app/providers.tsx
'use client';

import { SessionProvider } from 'next-auth/react';
import { TaskProvider } from '@/components/tasks/TaskProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TaskProvider>{children}</TaskProvider>
    </SessionProvider>
  );
}

