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

