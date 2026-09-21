// lib/ai-policy/builders/testing/scanSessionFixture.ts
//
// Builds real, valid ScreenerScanSession objects with the screener's own constructors (so they pass validateSessionData),
// plus deep-freeze and a canonical model output for the frozen payload. Synthetic data only. Test-only. It lives under builders/ because it uses the screener's constructors, and only builders/ may import scan code.

import {
  completeSession, createScanSession, errorSession, recordSymbolEvaluated, recordSymbolFailed, stopSession,
} from '@/lib/screener/scanSession';
import type { ScreenerScanSession, TargetedScanLaunchSnapshot } from '@/lib/screener/scanSession';
import type { CheckResult, ScreenResult } from '@/lib/scans/types';
import { buildCspRuleSnapshot } from '@/lib/scans/cspRuleSnapshot';
import { DEFAULT_CSP_RULES } from '@/lib/scans/constants';
import type { ModelOutput } from '../../types';

const PENDING: CheckResult = { status: 'pending', value: '--', reason: '--' };
const CHECKS = { ivr: PENDING, earnings: PENDING, oi: PENDING, delta: PENDING, credit: PENDING, roc: PENDING, pop: PENDING, iv: PENDING, emClearance: PENDING };

/** ISO date `days` from now, in UTC, the same way the scan's DTE helper counts. */
export function isoDateFromNow(days: number, nowMs = Date.now()): string {
  const d = new Date(nowMs + days * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function makeSpreadResult(symbol: string, over: { dte?: number; publishedRank?: number; qualified?: boolean; extra?: Record<string, unknown> } = {}): ScreenResult {
  const dte = over.dte ?? 45;
  return {
    symbol, strategy: 'BPS', price: 101.5, ivr: 42, qualified: over.qualified ?? true, failReasons: [], checks: CHECKS,
    earningsDate: isoDateFromNow(90),
    ...(over.publishedRank !== undefined ? { publishedRank: over.publishedRank } : {}),
    bestCandidate: {
      strategy: 'BPS', expiration: isoDateFromNow(45), dte, shortStrike: 95, longStrike: 90, shortDelta: 0.22, credit: 1.25, spreadWidth: 5,
      creditRatio: 0.25, roc: 0.33, pop: 78, shortOI: 500, longOI: 400, capitalRequired: 375,
      ...(over.extra ?? {}),
    },
  } as unknown as ScreenResult;
}

export interface FixtureOptions {
  symbols?: string[];
  /** Symbols that produce a candidate (default: all but the last two). */
  withCandidates?: string[];
  status?: 'complete' | 'error' | 'stopped' | 'running';
  resultOver?: (symbol: string, index: number) => Parameters<typeof makeSpreadResult>[1];
  /** A Targeted-mode spreads session carrying this launch snapshot. */
  targeted?: TargetedScanLaunchSnapshot;
  /** A CSP session (with its rule snapshot) in which every symbol is evaluated with no candidates. */
  csp?: boolean;
}

/**
 * A spreads/filter session: candidates for most symbols, one evaluated-with-no-candidate symbol, one failed symbol.
 * Status defaults to 'complete'.
 */
export function makeSession(options: FixtureOptions = {}): ScreenerScanSession {
  const symbols = options.symbols ?? ['AAA', 'BBB', 'CCC', 'DDD'];
  const noCandidate = symbols[symbols.length - 2];
  const failed = symbols[symbols.length - 1];
  const withCandidates = options.withCandidates ?? symbols.slice(0, symbols.length - 2);
  let s = createScanSession(
    options.csp
      ? { mode: 'filter', requestedStrategy: 'csp', scope: { universeSymbols: symbols, eligibleSymbols: symbols }, ruleSnapshot: buildCspRuleSnapshot(DEFAULT_CSP_RULES) }
      : options.targeted
        ? { mode: 'targeted', requestedStrategy: 'spreads', scope: { universeSymbols: symbols, eligibleSymbols: symbols }, targetedSnapshot: options.targeted }
        : { mode: 'filter', requestedStrategy: 'spreads', scope: { universeSymbols: symbols, eligibleSymbols: symbols } },
  );
  if (options.csp) {
    for (const symbol of symbols) s = recordSymbolEvaluated(s, symbol, [], { reasonCode: 'NO_QUALIFYING_CANDIDATE' });
    return completeSession(s);
  }
  symbols.forEach((symbol, index) => {
    if (withCandidates.includes(symbol)) s = recordSymbolEvaluated(s, symbol, [makeSpreadResult(symbol, options.resultOver?.(symbol, index))]);
    else if (symbol === failed) s = recordSymbolFailed(s, symbol, 'MARKET_DATA_REQUEST_FAILED');
    else if (symbol === noCandidate) s = recordSymbolEvaluated(s, symbol, [], { reasonCode: 'NO_QUALIFYING_CANDIDATE' });
    else s = recordSymbolEvaluated(s, symbol, [], { reasonCode: 'NO_QUALIFYING_CANDIDATE' });
  });
  const status = options.status ?? 'complete';
  if (status === 'complete') return completeSession(s);
  if (status === 'error') return errorSession(s, 'UNKNOWN_ERROR');
  if (status === 'stopped') return stopSession(s, 'CANCELLED');
  return s;
}

/** Deep clone, so tests can tamper with a session without touching the original. */
export const cloneSession = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** A model output that cites only real pointers of a frozen fixture payload. */
export const SCAN_OUTPUT: ModelOutput = {
  summary: 'The scan evaluated {{c:1}} symbols and found {{c:2}} candidates.',
  observations: [{ text: 'The first candidate is {{c:3}} with {{c:4}} days to expiration.', citationIds: [3, 4] }],
  tradeoffs: [],
  missingOrStaleData: [],
  questionsForTrader: [],
  limitations: [{ text: 'This explanation covers only the frozen snapshot.' }],
  citations: [
    { id: 1, pointer: '/scan/symbolsEvaluated' },
    { id: 2, pointer: '/scan/candidatesFound' },
    { id: 3, pointer: '/candidates/0/symbol' },
    { id: 4, pointer: '/candidates/0/dte' },
  ],
};
export const scanOutputJson = (mutate?: (o: ModelOutput) => void): string => {
  const copy = JSON.parse(JSON.stringify(SCAN_OUTPUT)) as ModelOutput;
  mutate?.(copy);
  return JSON.stringify(copy);
};
