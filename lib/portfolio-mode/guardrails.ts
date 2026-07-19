// lib/portfolio-mode/guardrails.ts
//
// PT-0002A: pure, framework-independent execution/mutation-boundary
// guardrails. These prove -- and, once wired in a future ticket, enforce --
// that a LIVE-only action can never proceed under PAPER context and a
// PAPER-only action can never proceed under LIVE context.
//
// Scope note (read before wiring these anywhere): per the Implementation
// Directive's Safe Rollout sequencing ("mode-aware contracts/adapters" is
// its own step, separate from "integrate only the explicitly approved
// surfaces"), PT-0002A delivers these guardrails as tested, ready-to-use
// infrastructure only. They are NOT called from app/portfolio/page.tsx's
// broker-submission call sites (ttPost/ttPostComplex/ttValidateOrder/
// ttDelete/cancelOrder) or from lib/paper-trading/service.ts in this round
// -- wiring them into those call sites is explicitly deferred to PT-0002B,
// since no screen currently reads the global PortfolioMode at all (see the
// Implementation Report's Known Limitations). Today, LIVE broker submission
// and PT-0001 paper mutation remain isolated from each other exactly as
// they already were before PT-0002A (see lib/paper-trading's own
// liveIsolation.test.ts, unchanged) -- these guardrails are additive
// infrastructure, not a behavior change to either path.

import type { PortfolioMode } from './types';

export type PortfolioModeGuardCode = 'WRONG_MODE';

/**
 * Thrown by assertLiveContext/assertPaperContext when the active mode does
 * not match what the action requires. Deliberately a distinct, typed error
 * (not a generic Error) so a future caller can branch on `.code` rather
 * than parsing `.message` -- matching this codebase's existing convention
 * for domain errors (see PaperTradingError in lib/paper-trading/types.ts).
 */
export class PortfolioModeGuardError extends Error {
  code: PortfolioModeGuardCode = 'WRONG_MODE';
  expected: PortfolioMode;
  actual: PortfolioMode;
  action: string;

  constructor(expected: PortfolioMode, actual: PortfolioMode, action: string) {
    super(`"${action}" requires ${expected} context, but the active portfolio mode is ${actual}.`);
    this.name = 'PortfolioModeGuardError';
    this.expected = expected;
    this.actual = actual;
    this.action = action;
  }
}

/**
 * Throws PortfolioModeGuardError unless `mode` is 'LIVE'. Intended for a
 * future call site immediately before any live broker submission
 * (ttPost/ttPostComplex/ttValidateOrder/ttDelete) once such a call site is
 * made mode-aware (PT-0002B) -- see this file's module doc for why no call
 * site is wired to this yet.
 */
export function assertLiveContext(mode: PortfolioMode, action: string): void {
  if (mode !== 'LIVE') {
    throw new PortfolioModeGuardError('LIVE', mode, action);
  }
}

/**
 * Throws PortfolioModeGuardError unless `mode` is 'PAPER'. Intended for a
 * future call site immediately before a paper-specific mutation that must
 * never be reachable while LIVE is active (PT-0002B) -- see this file's
 * module doc for why no call site is wired to this yet.
 */
export function assertPaperContext(mode: PortfolioMode, action: string): void {
  if (mode !== 'PAPER') {
    throw new PortfolioModeGuardError('PAPER', mode, action);
  }
}
