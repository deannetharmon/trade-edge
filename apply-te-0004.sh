#!/usr/bin/env bash
set -euo pipefail

git pull --ff-only

mkdir -p lib/commands components/commands

cat > lib/commands/command-types.ts << 'EOF'
// lib/commands/command-types.ts

export type TradeEdgeCommandType =
  | 'START_RANKED_SCAN'
  | 'START_SCREENER_SCAN'
  | 'RUN_PORTFOLIO_AI_REVIEW'
  | 'START_AUTOPILOT_PAPER_RUN'
  | 'CANCEL_TASK'
  | 'OPEN_TASK_RESULT';

export type TradeEdgeCommandSource = 'user' | 'system' | 'ai' | 'autopilot';

export interface TradeEdgeCommand<TPayload = unknown> {
  id: string;
  type: TradeEdgeCommandType;
  payload?: TPayload;
  source: TradeEdgeCommandSource;
  createdAt: string;
}

export interface TradeEdgeCommandInput<TPayload = unknown> {
  type: TradeEdgeCommandType;
  payload?: TPayload;
  source?: TradeEdgeCommandSource;
}

export interface TradeEdgeCommandResult<TResult = unknown> {
  commandId: string;
  handled: boolean;
  result?: TResult;
  error?: string;
}

export type TradeEdgeCommandHandler<TPayload = unknown, TResult = unknown> = (
  command: TradeEdgeCommand<TPayload>
) => TradeEdgeCommandResult<TResult> | Promise<TradeEdgeCommandResult<TResult>>;

EOF

cat > lib/commands/command-bus.ts << 'EOF'
// lib/commands/command-bus.ts

import type {
  TradeEdgeCommand,
  TradeEdgeCommandHandler,
  TradeEdgeCommandInput,
  TradeEdgeCommandResult,
  TradeEdgeCommandType,
} from './command-types';

function generateCommandId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * CommandBus accepts intent and routes it to a registered handler.
 *
 * It answers "what should happen?" only. It does not own long-running
 * execution state — that belongs to TaskManager (see TE-0003 / ADR-0002).
 * Deliberately dependency-free and independent from React so it can be
 * used outside components (e.g. future AI/autopilot callers).
 */
export class CommandBus {
  private handlers: Map<TradeEdgeCommandType, TradeEdgeCommandHandler> = new Map();

  registerHandler<TPayload = unknown, TResult = unknown>(
    type: TradeEdgeCommandType,
    handler: TradeEdgeCommandHandler<TPayload, TResult>
  ): () => void {
    this.handlers.set(type, handler as TradeEdgeCommandHandler);
    return () => {
      if (this.handlers.get(type) === (handler as TradeEdgeCommandHandler)) {
        this.handlers.delete(type);
      }
    };
  }

  async dispatch<TPayload = unknown, TResult = unknown>(
    input: TradeEdgeCommandInput<TPayload>
  ): Promise<TradeEdgeCommandResult<TResult>> {
    const command: TradeEdgeCommand<TPayload> = {
      id: generateCommandId(),
      type: input.type,
      payload: input.payload,
      source: input.source ?? 'user',
      createdAt: new Date().toISOString(),
    };

    const handler = this.handlers.get(command.type);
    if (!handler) {
      return { commandId: command.id, handled: false };
    }

    try {
      const result = await handler(command);
      return result as TradeEdgeCommandResult<TResult>;
    } catch (err) {
      return {
        commandId: command.id,
        handled: true,
        error: err instanceof Error ? err.message : 'Unknown command handler error',
      };
    }
  }

  getRegisteredCommandTypes(): TradeEdgeCommandType[] {
    return Array.from(this.handlers.keys());
  }
}

EOF

cat > lib/commands/command-handlers.ts << 'EOF'
// lib/commands/command-handlers.ts

import type { CommandBus } from './command-bus';

/**
 * Registers command handlers on the given CommandBus.
 *
 * TE-0004 establishes the Command Bus foundation only. No existing
 * workflow (Ranked Scan, Screener, Portfolio AI, Autopilot) is migrated
 * in this ticket, so no handlers are registered yet. Handlers for
 * START_RANKED_SCAN, START_SCREENER_SCAN, RUN_PORTFOLIO_AI_REVIEW,
 * START_AUTOPILOT_PAPER_RUN, CANCEL_TASK, and OPEN_TASK_RESULT will be
 * added in their own follow-up tickets.
 *
 * Until a handler is registered for a command type, CommandBus.dispatch()
 * safely returns `{ handled: false }` rather than throwing.
 */
export function registerCommandHandlers(_bus: CommandBus): () => void {
  const unsubscribers: Array<() => void> = [];

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
}

EOF

cat > components/commands/CommandProvider.tsx << 'EOF'
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

EOF

cat > hooks/useCommandBus.ts << 'EOF'
// hooks/useCommandBus.ts
'use client';

import { useCallback } from 'react';
import { useCommandBusContext } from '@/components/commands/CommandProvider';
import type {
  TradeEdgeCommandHandler,
  TradeEdgeCommandInput,
  TradeEdgeCommandResult,
  TradeEdgeCommandType,
} from '@/lib/commands/command-types';

export interface UseCommandBusResult {
  dispatch: <TPayload = unknown, TResult = unknown>(
    input: TradeEdgeCommandInput<TPayload>
  ) => Promise<TradeEdgeCommandResult<TResult>>;
  registerHandler: <TPayload = unknown, TResult = unknown>(
    type: TradeEdgeCommandType,
    handler: TradeEdgeCommandHandler<TPayload, TResult>
  ) => () => void;
  getRegisteredCommandTypes: () => TradeEdgeCommandType[];
}

/**
 * Provides access to the app-level CommandBus: dispatch, handler
 * registration, and introspection of registered command types.
 */
export function useCommandBus(): UseCommandBusResult {
  const bus = useCommandBusContext();

  const dispatch = useCallback(
    <TPayload = unknown, TResult = unknown>(input: TradeEdgeCommandInput<TPayload>) =>
      bus.dispatch<TPayload, TResult>(input),
    [bus]
  );

  const registerHandler = useCallback(
    <TPayload = unknown, TResult = unknown>(
      type: TradeEdgeCommandType,
      handler: TradeEdgeCommandHandler<TPayload, TResult>
    ) => bus.registerHandler<TPayload, TResult>(type, handler),
    [bus]
  );

  const getRegisteredCommandTypes = useCallback(() => bus.getRegisteredCommandTypes(), [bus]);

  return { dispatch, registerHandler, getRegisteredCommandTypes };
}

EOF

cat > app/providers.tsx << 'EOF'
// app/providers.tsx
'use client';

import { SessionProvider } from 'next-auth/react';
import { TaskProvider } from '@/components/tasks/TaskProvider';
import { CommandProvider } from '@/components/commands/CommandProvider';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TaskProvider>
        <CommandProvider>{children}</CommandProvider>
      </TaskProvider>
    </SessionProvider>
  );
}


EOF

git add lib/commands components/commands hooks/useCommandBus.ts app/providers.tsx
git commit -m "feat(commands): implement command bus foundation"
git push origin feature/autopilot-paper-mode

echo "Done."
