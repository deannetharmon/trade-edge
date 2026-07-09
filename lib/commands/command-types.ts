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

