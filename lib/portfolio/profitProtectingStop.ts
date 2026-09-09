// POSITIONS-0004: deterministic, advisory-only profit protection for
// defined-risk credit spreads. This module intentionally has no React or
// broker dependencies so every management surface uses the same policy.

export const PROFIT_PROTECTING_STOP_POLICY_VERSION = 'credit-spread-profit-protection-v1';
export const PROFIT_PROTECTING_STOP_POLICY_EFFECTIVE_DATE = '2026-09-09';

export type ProfitProtectingStopStage = 'BREAK_EVEN_50' | 'LOCK_25_65' | 'LOCK_50_75';
export type ProfitProtectingStopStatus = 'TIGHTEN_AVAILABLE' | 'ALREADY_PROTECTED' | 'NOT_YET_ELIGIBLE' | 'UNAVAILABLE';

export interface ProfitProtectingStopProposal {
  status: ProfitProtectingStopStatus;
  stage: ProfitProtectingStopStage | null;
  creditPerContract: number | null;
  marketableClosePerContract: number | null;
  profitCapturedPct: number | null;
  currentStopTrigger: number | null;
  proposedStopTrigger: number | null;
  protectedPnlPct: number | null;
  protectedPnlLabel: string | null;
  reason: string;
  policyVersion: typeof PROFIT_PROTECTING_STOP_POLICY_VERSION;
}

const PRICE_EPS = 0.01;

function stageForProfitCaptured(profitCapturedPct: number): {
  stage: ProfitProtectingStopStage;
  stopMultiple: number;
  protectedPnlPct: number;
  protectedPnlLabel: string;
} | null {
  if (profitCapturedPct >= 75) return { stage: 'LOCK_50_75', stopMultiple: 0.5, protectedPnlPct: 50, protectedPnlLabel: 'locks 50% of original credit' };
  if (profitCapturedPct >= 65) return { stage: 'LOCK_25_65', stopMultiple: 0.75, protectedPnlPct: 25, protectedPnlLabel: 'locks 25% of original credit' };
  if (profitCapturedPct >= 50) return { stage: 'BREAK_EVEN_50', stopMultiple: 1, protectedPnlPct: 0, protectedPnlLabel: 'breaks even' };
  return null;
}

/** Evaluates a proposal only; it never submits, cancels, or changes an order. */
export function evaluateProfitProtectingStop(input: {
  creditPerContract: number | null;
  marketableClosePerContract: number | null;
  currentStopTrigger: number | null;
  hasWorkingStop: boolean;
  quoteQuality: 'RELIABLE' | 'DEGRADED' | 'UNKNOWN';
}): ProfitProtectingStopProposal {
  const base = {
    creditPerContract: input.creditPerContract,
    marketableClosePerContract: input.marketableClosePerContract,
    currentStopTrigger: input.currentStopTrigger,
    policyVersion: PROFIT_PROTECTING_STOP_POLICY_VERSION,
  } as const;
  if (!input.hasWorkingStop || input.currentStopTrigger == null || input.currentStopTrigger <= 0) {
    return { ...base, status: 'UNAVAILABLE', stage: null, profitCapturedPct: null, proposedStopTrigger: null, protectedPnlPct: null, protectedPnlLabel: null, reason: 'A broker-recognized working stop is required before protection can be tightened.' };
  }
  if (!Number.isFinite(input.creditPerContract) || input.creditPerContract == null || input.creditPerContract <= 0 || !Number.isFinite(input.marketableClosePerContract) || input.marketableClosePerContract == null || input.marketableClosePerContract < 0) {
    return { ...base, status: 'UNAVAILABLE', stage: null, profitCapturedPct: null, proposedStopTrigger: null, protectedPnlPct: null, protectedPnlLabel: null, reason: 'Complete original-credit and marketable-close evidence is required.' };
  }
  if (input.quoteQuality !== 'RELIABLE') {
    return { ...base, status: 'UNAVAILABLE', stage: null, profitCapturedPct: null, proposedStopTrigger: null, protectedPnlPct: null, protectedPnlLabel: null, reason: 'A reliable marketable quote is required before proposing a stop adjustment.' };
  }

  const profitCapturedPct = ((input.creditPerContract - input.marketableClosePerContract) / input.creditPerContract) * 100;
  const stage = stageForProfitCaptured(profitCapturedPct);
  if (!stage) {
    return { ...base, status: 'NOT_YET_ELIGIBLE', stage: null, profitCapturedPct, proposedStopTrigger: null, protectedPnlPct: null, protectedPnlLabel: null, reason: 'Profit capture has not reached the first 50% protection stage.' };
  }
  const proposedStopTrigger = Number((input.creditPerContract * stage.stopMultiple).toFixed(2));
  if (proposedStopTrigger >= input.currentStopTrigger - PRICE_EPS) {
    return { ...base, status: 'ALREADY_PROTECTED', stage: stage.stage, profitCapturedPct, proposedStopTrigger, protectedPnlPct: stage.protectedPnlPct, protectedPnlLabel: stage.protectedPnlLabel, reason: 'The current working stop already protects the same or more profit.' };
  }
  return { ...base, status: 'TIGHTEN_AVAILABLE', stage: stage.stage, profitCapturedPct, proposedStopTrigger, protectedPnlPct: stage.protectedPnlPct, protectedPnlLabel: stage.protectedPnlLabel, reason: 'This adjustment tightens protection; it does not widen your stop.' };
}
