// lib/scans/quoteQuality.ts
//
// QUOTE-GUARD-0001: a spread's credit is only a real, fillable price when every leg has a usable
// quote and the markets are not wide. A mid-based credit on a market quoted 1.45 x 5.00 is a number
// nobody can trade at. This module is the one shared definition of "usable quote" and "wide market"
// for the Ranked scan. It never changes a credit; it only describes the quotes behind it.
//
// Rules (fail closed):
//   short leg: needs a bid > 0 (a zero bid means there is nothing to sell into) and ask >= bid
//   long leg:  needs an ask > 0 (a zero ask means the cost of the long is unknown) and ask >= bid
//   every leg: bid and ask must be finite numbers, and (ask - bid) must not exceed maxWidth
// maxWidth defaults to getBidAskMax(price), the same limit the rules-based finders already use.

import type { CheckResult } from './types';

export type MarketStatus = 'ok' | 'wide' | 'invalid';

export interface LegQuoteInput {
  /** Short label such as "63P" or "180C", used in reasons. */
  label: string;
  role: 'short' | 'long';
  bid: number | null | undefined;
  ask: number | null | undefined;
}

export interface LegQuoteAssessment {
  label: string;
  status: MarketStatus;
  /** Plain-language reason; null when the leg is fine. */
  reason: string | null;
  /** Compact "63P 1.45 x 5.00" form for badges. */
  summary: string;
  width: number | null;
}

export interface MarketAssessment {
  status: MarketStatus;
  /** The per-leg bid/ask limit used for this assessment, dollars. */
  maxWidth: number;
  legs: LegQuoteAssessment[];
  /** One reason per leg that is not ok, worst first. */
  reasons: string[];
}

const money = (n: number): string => n.toFixed(2);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function assessLegQuote(leg: LegQuoteInput, maxWidth: number): LegQuoteAssessment {
  const { bid, ask, label } = leg;
  if (!isFiniteNumber(bid) || !isFiniteNumber(ask)) {
    return { label, status: 'invalid', reason: `${label} has no quote`, summary: `${label} no quote`, width: null };
  }
  const summary = `${label} ${money(bid)} x ${money(ask)}`;
  const width = Number((ask - bid).toFixed(4));
  if (ask < bid) {
    return { label, status: 'invalid', reason: `${label} is crossed (bid ${money(bid)}, ask ${money(ask)})`, summary, width };
  }
  if (leg.role === 'short' && !(bid > 0)) {
    return { label, status: 'invalid', reason: `${label} has no bid to sell into (bid ${money(bid)})`, summary, width };
  }
  if (leg.role === 'long' && !(ask > 0)) {
    return { label, status: 'invalid', reason: `${label} has no ask to buy at (ask ${money(ask)})`, summary, width };
  }
  if (width > maxWidth + 1e-9) {
    return {
      label, status: 'wide', width, summary,
      reason: `${label} is quoted ${money(bid)} x ${money(ask)} (${money(width)} wide, limit ${money(maxWidth)})`,
    };
  }
  return { label, status: 'ok', reason: null, summary, width };
}

/** Assess every leg of a spread or iron condor against one per-leg width limit. */
export function assessSpreadMarket(legs: readonly LegQuoteInput[], maxWidth: number): MarketAssessment {
  const assessed = legs.map(leg => assessLegQuote(leg, maxWidth));
  const rank = (s: MarketStatus): number => (s === 'invalid' ? 2 : s === 'wide' ? 1 : 0);
  const problems = assessed.filter(a => a.status !== 'ok').sort((a, b) => rank(b.status) - rank(a.status));
  const status: MarketStatus = problems.length === 0 ? 'ok' : problems[0].status;
  return { status, maxWidth, legs: assessed, reasons: problems.map(p => p.reason as string) };
}

/**
 * The Ranked row's `market` check. A gate: wide or invalid markets disqualify, with the numbers shown.
 * Returned `value` is what the badge shows after "Disqualified:", so it stays short.
 */
export function buildMarketCheck(assessment: MarketAssessment): CheckResult {
  if (assessment.status === 'ok') {
    return {
      status: 'pass',
      value: 'tight markets',
      reason: `Every leg is quoted within the $${money(assessment.maxWidth)} bid/ask limit`,
    };
  }
  const worst = assessment.legs.find(l => l.status === assessment.status) ?? assessment.legs.find(l => l.status !== 'ok');
  const label = assessment.status === 'invalid' ? 'no valid quote' : 'wide market';
  return {
    status: 'fail',
    value: `${label} (${worst?.summary ?? 'quote'})`,
    reason: `${assessment.reasons.join('; ')}. The credit shown is the executable credit (sell at the bid, buy at the ask, blended 25% toward mid), which is unlikely to fill in a market this wide.`,
  };
}
