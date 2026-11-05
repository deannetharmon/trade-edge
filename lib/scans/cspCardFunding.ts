// lib/scans/cspCardFunding.ts

// CSP-CAP-BASIS-0001A -- the funding figures a CSP result card shows. Same basis and same module as the order dialog
// (ASSIGN-CASH-0001): usable cash after the reserve, minus the assignment obligation of every open short put and every
// working sell-to-open put, against this put's strike x 100 x contracts. Pure and deterministic: no fetching, no React.
//
// Display only. This never changes market qualification, scores, ranking or account eligibility
// (cspAccountEligibility still uses the old basis until CSP-CAP-BASIS-0001B). The order dialog re-reads everything at
// submit time and stays the authority; a card's figures are a snapshot taken when the scan started.

import { evaluateAssignmentCash, type ReserveSetting } from './assignmentCash';
import type { PendingOrder, Position } from '@/lib/portfolio-data/types';

export type CspFundingStatus = 'funded' | 'not_fundable' | 'cannot_verify';

export interface CspCardFunding {
  status: CspFundingStatus;
  /** Strike x 100 x contracts for this candidate. */
  requiredCash: number;
  assignmentCashBefore: number | null;
  assignmentCashAfter: number | null;
  usableCash: number | null;
  /** usableCash - assignmentCashAfter. Positive = surplus, negative = shortfall. */
  surplusShortfall: number | null;
  /** assignmentCashAfter / usableCash as a fraction; null when usable cash is zero or negative. */
  utilization: number | null;
  /** Usable cash left for a new put before this one: max(0, usable - obligation already open or working). */
  room: number | null;
  /** Why the status is cannot_verify; empty otherwise. */
  reasons: string[];
  /** When the cash, positions and working orders were read (epoch ms). */
  asOfMs: number;
  /** True when the scan's manual capital limit was lower than usable cash and replaced it. */
  manualLimitApplied: boolean;
  /** Advisory only: broker buying power is below the cash this put ties up. Never a qualification gate. */
  buyingPowerAdvisory: string | null;
}

export interface CspCardFundingInput {
  strike: number;
  contracts: number;
  cashBalance: number | null | undefined;
  reserve: ReserveSetting;
  positions: Position[] | null | undefined;
  pendingOrders: PendingOrder[] | null | undefined;
  /** Broker option buying power, for the advisory line only. */
  optionBuyingPower?: number | null;
  /** The scan's manual capital limit. It can only lower the funding figure, never raise it above usable cash. */
  manualLimit?: number | null;
  asOfMs: number;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export const fundingMoney = (n: number): string =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildCspCardFunding(input: CspCardFundingInput): CspCardFunding {
  const requiredCash = input.strike * 100 * input.contracts;
  const advisory = finite(input.optionBuyingPower) && input.optionBuyingPower < requiredCash
    ? `Broker buying power ${fundingMoney(Math.max(0, input.optionBuyingPower))}; the broker may not accept this order.`
    : null;

  const result = evaluateAssignmentCash({
    cashBalance: input.cashBalance,
    reserve: input.reserve,
    positions: input.positions,
    pendingOrders: input.pendingOrders,
    proposed: { opens: [{ strike: input.strike, contracts: input.contracts }], closes: [] },
  });

  if (result.tier === 'cannot_verify') {
    return {
      status: 'cannot_verify', requiredCash,
      assignmentCashBefore: null, assignmentCashAfter: null, usableCash: null, surplusShortfall: null,
      utilization: null, room: null, reasons: result.reasons, asOfMs: input.asOfMs, manualLimitApplied: false,
      buyingPowerAdvisory: advisory,
    };
  }

  const before = result.assignmentCashBefore as number;
  const after = result.assignmentCashAfter as number;
  let usable = result.usableCash as number;
  const manualLimitApplied = finite(input.manualLimit) && input.manualLimit >= 0 && input.manualLimit < usable;
  if (manualLimitApplied) usable = input.manualLimit as number;

  const surplusShortfall = usable - after;
  return {
    status: surplusShortfall < 0 ? 'not_fundable' : 'funded',
    requiredCash,
    assignmentCashBefore: before,
    assignmentCashAfter: after,
    usableCash: usable,
    surplusShortfall,
    utilization: usable > 0 ? after / usable : null,
    room: Math.max(0, usable - before),
    reasons: [],
    asOfMs: input.asOfMs,
    manualLimitApplied,
    buyingPowerAdvisory: advisory,
  };
}

const CAPACITY_REASON = /^Insufficient CSP capacity/i;

/**
 * The result row's reasons, with the old-basis capacity sentence replaced by the funding sentence. The funding sentence
 * keeps the "Insufficient CSP capacity - requires $X, $Y available" shape that summarizeFailReason parses, so the row
 * label stays "Needs $X · $Y available" with the new figures. Every other reason is kept in its place.
 */
export function fundingFailReasons(reasons: readonly string[], funding: CspCardFunding | undefined): string[] {
  if (!funding) return [...reasons];
  const at = reasons.findIndex(r => CAPACITY_REASON.test(r));
  const kept = reasons.filter(r => !CAPACITY_REASON.test(r));
  let sentence: string | null = null;
  if (funding.status === 'not_fundable' && funding.surplusShortfall != null && funding.usableCash != null && funding.assignmentCashAfter != null) {
    sentence = `Insufficient CSP capacity — requires ${fundingMoney(funding.requiredCash)}, ${fundingMoney(funding.room ?? 0)} available. `
      + `Shortfall ${fundingMoney(-funding.surplusShortfall)}: assignment cash ${fundingMoney(funding.assignmentCashAfter)} against usable cash ${fundingMoney(funding.usableCash)} `
      + `(cash less reserve, with short puts already open or working counted).`;
  } else if (funding.status === 'cannot_verify') {
    sentence = `Cannot verify funding. ${funding.reasons.join('; ')}`.trim();
  }
  if (!sentence) return kept;
  const insertAt = at >= 0 ? at : kept.length;
  return [...kept.slice(0, insertAt), sentence, ...kept.slice(insertAt)];
}
