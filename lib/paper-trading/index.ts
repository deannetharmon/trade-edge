// lib/paper-trading/index.ts
//
// PT-0001: public exports for the manual paper-trading domain. API routes
// and UI components should import from here (or from service.ts directly)
// rather than reaching into individual internal modules.

export * from './types';
export { SUPPORTED_STRATEGIES, validateTicket, validateContractMultiplier } from './validation';
export { STALE_QUOTE_THRESHOLD_SECONDS, resolveClosingAction, isStale, oldestQuoteAgeSeconds, buildFillEvidence } from './pricing';
export { computeCapitalRequirement, requireSufficientCapital } from './capital';
export { createInitialLedger, deriveLedgerView, openPosition, closePosition, markPosition, resetLedger } from './ledger';
export {
  openPaperPosition,
  closePaperPosition,
  resetPaperLedger,
  refreshPaperMark,
} from './service';
export type {
  OpenPaperPositionRequest,
  ClosePaperPositionRequest,
  ResetPaperLedgerRequest,
  RefreshMarkRequest,
  PaperMutationResult,
} from './service';
export { getPaperTradingLedger } from './persistence/store';
export { getPaperAuditEvents } from './audit';
