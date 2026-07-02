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

