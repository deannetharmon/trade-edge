// components/commands/CommandProvider.tsx
'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { CommandBus } from '@/lib/commands/command-bus';
import { registerCommandHandlers } from '@/lib/commands/command-handlers';

const CommandBusContext = createContext<CommandBus | null>(null);

/**
 * Mounts a single CommandBus instance for the lifetime of the app shell.
 * Renders no visible UI. Does not alter existing app behavior.
 *
 * No command handlers are registered against real workflows in TE-0004 —
 * see lib/commands/command-handlers.ts. Migrating Ranked Scan, Screener,
 * Portfolio AI, and Autopilot to dispatch through this bus is explicitly
 * deferred to follow-up tickets.
 */
export function CommandProvider({ children }: { children: React.ReactNode }) {
  const busRef = useRef<CommandBus | null>(null);
  if (!busRef.current) {
    busRef.current = new CommandBus();
  }

  const bus = useMemo(() => busRef.current as CommandBus, []);

  useEffect(() => {
    const teardown = registerCommandHandlers(bus);
    return teardown;
  }, [bus]);

  return <CommandBusContext.Provider value={bus}>{children}</CommandBusContext.Provider>;
}

export function useCommandBusContext(): CommandBus {
  const bus = useContext(CommandBusContext);
  if (!bus) {
    throw new Error('useCommandBusContext must be used within a CommandProvider');
  }
  return bus;
}

