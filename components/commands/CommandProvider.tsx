// components/commands/CommandProvider.tsx
'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { CommandBus } from '@/lib/commands/command-bus';
import { registerCommandHandlers } from '@/lib/commands/command-handlers';
import { useTaskManagerContext } from '@/components/tasks/TaskProvider';

const CommandBusContext = createContext<CommandBus | null>(null);

/**
 * Mounts a single CommandBus instance for the lifetime of the app shell.
 * Renders no visible UI. Does not alter existing app behavior.
 *
 * TE-0005A registers the first real handler (START_RANKED_SCAN, plus
 * CANCEL_TASK) — see lib/commands/command-handlers.ts. To do so without
 * merging Command Bus and Task Manager into one abstraction (ADR-0002),
 * this provider reads the same TaskManager instance already provided by
 * the enclosing TaskProvider (see app/providers.tsx — CommandProvider is
 * mounted inside TaskProvider) and passes it into registerCommandHandlers
 * as a plain argument. CommandBus itself still has no import from
 * lib/tasks/ and no awareness of task internals.
 *
 * Screener (Filter/Targeted), Portfolio AI, and Autopilot are NOT wired
 * to dispatch through this bus — deferred to their own tickets.
 */
export function CommandProvider({ children }: { children: React.ReactNode }) {
  const busRef = useRef<CommandBus | null>(null);
  if (!busRef.current) {
    busRef.current = new CommandBus();
  }

  const bus = useMemo(() => busRef.current as CommandBus, []);
  const taskManager = useTaskManagerContext();

  useEffect(() => {
    const teardown = registerCommandHandlers(bus, taskManager);
    return teardown;
  }, [bus, taskManager]);

  return <CommandBusContext.Provider value={bus}>{children}</CommandBusContext.Provider>;
}

export function useCommandBusContext(): CommandBus {
  const bus = useContext(CommandBusContext);
  if (!bus) {
    throw new Error('useCommandBusContext must be used within a CommandProvider');
  }
  return bus;
}

