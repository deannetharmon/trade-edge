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

