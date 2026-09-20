// lib/leaps-position-intelligence/mandateGates.ts
//
// LEAPS-MANDATE-0001 -- applies the trader's income rules to the candidate short call on the Positions card. Pure. It mirrors the rules
// (and their order) in evaluateLeapsPositionIntelligence and reuses its policy values (MIN_UPSIDE_PARTICIPATION), so there is one
// source for the thresholds. Ian's amendment: the income floor defaults to the LEAPS breakeven, so a call below breakeven cannot reach
// "Review income call" even when no mandate has been saved.
//
// Order (first failing rule sets the state): reassess-thesis (stock at/below the invalidation price) -> known earnings in the call's
// window -> minimum credit -> income floor -> upside participation. Data that could not be verified is never a gate here: the PMCC
// review itself re-checks events, so an unverified calendar shows as an amber note, not a block.

import type { DashboardCallout } from '@/lib/leaps-analysis/dashboard';
import { money, pct } from '@/lib/leaps-analysis/dashboard';
import { MIN_UPSIDE_PARTICIPATION } from './policy';
import type { LeapsMandate } from './types';

export type GateState = 'review-income-call' | 'monitor' | 'hold-uncovered' | 'reassess-thesis';

export interface MandateGateInput {
  mandate: LeapsMandate | null;
  longStrike: number;
  entryDebitPerShare: number | null;
  stockPrice: number | null;
  /** The live short-call candidate; credit is the executable credit per share. */
  candidate: { strike: number; credit: number } | null;
  /** Earnings date inside the call's window (today..expiry), from the event check; null when none or not verified. */
  earningsInWindow: string | null;
}

export interface MandateGateResult {
  state: GateState;
  /** Why the state is not "review-income-call" (empty when it is). */
  reasonCode: 'invalidated' | 'known-event-blocked' | 'minimum-credit' | 'income-floor' | 'upside-participation' | null;
  /** Green and red callouts for every rule that could be evaluated. */
  callouts: DashboardCallout[];
  floor: { strike: number; source: 'income-cap' | 'breakeven' } | null;
  /** Share of the way from the stock to the target that the short strike reaches (0-100), when a target is set. */
  participationPct: number | null;
  participationRequiredPct: number | null;
}

export function applyMandateGates(input: MandateGateInput): MandateGateResult {
  const { mandate, candidate, stockPrice } = input;
  const breakeven = input.entryDebitPerShare != null ? input.longStrike + input.entryDebitPerShare : null;
  const floor: MandateGateResult['floor'] = mandate?.incomeCapStrike != null
    ? { strike: mandate.incomeCapStrike, source: 'income-cap' }
    : breakeven != null ? { strike: breakeven, source: 'breakeven' } : null;
  const callouts: DashboardCallout[] = [];
  let first: { state: GateState; code: NonNullable<MandateGateResult['reasonCode']> } | null = null;
  const fail = (state: GateState, code: NonNullable<MandateGateResult['reasonCode']>, text: string) => {
    callouts.push({ id: `gate-${code}`, tone: 'bad', text });
    if (!first) first = { state, code };
  };

  // 1. thesis invalidated
  if (mandate?.invalidationPrice != null && stockPrice != null && stockPrice <= mandate.invalidationPrice) {
    fail('reassess-thesis', 'invalidated', `Stock is at or below your invalidation price ${money(mandate.invalidationPrice)}: reassess the thesis before selling calls.`);
  }

  if (candidate) {
    // 2. known earnings in the window
    if (input.earningsInWindow && !mandate?.allowKnownEarningsCycle) {
      fail('monitor', 'known-event-blocked', `Earnings on ${input.earningsInWindow} fall before this call expires, and your rules do not allow selling through earnings.`);
    }
    // 3. minimum credit
    if (mandate?.minimumCycleCredit != null && candidate.credit < mandate.minimumCycleCredit) {
      fail('monitor', 'minimum-credit', `Credit ${money(candidate.credit)} a share is below your minimum of ${money(mandate.minimumCycleCredit)}.`);
    } else if (mandate?.minimumCycleCredit != null) {
      callouts.push({ id: 'gate-minimum-credit', tone: 'good', text: `Credit ${money(candidate.credit)} a share meets your ${money(mandate.minimumCycleCredit)} minimum.` });
    }
    // 4. income floor (defaults to the LEAPS breakeven)
    if (floor) {
      const label = floor.source === 'income-cap' ? 'your income floor' : 'your LEAPS breakeven';
      if (candidate.strike < floor.strike) fail('monitor', 'income-floor', `Short strike ${money(candidate.strike)} is below ${label} ${money(floor.strike)}: an assignment would lock in a loss.`);
      else callouts.push({ id: 'gate-income-floor', tone: 'good', text: `Short strike ${money(candidate.strike)} is at or above ${label} ${money(floor.strike)}.` });
    }
  }

  // 5. upside participation (needs a target above the stock)
  let participationPct: number | null = null;
  const required = mandate ? MIN_UPSIDE_PARTICIPATION[mandate.posture] : null;
  if (candidate && mandate?.thesisTargetHigh != null && stockPrice != null && mandate.thesisTargetHigh > stockPrice) {
    participationPct = Math.max(0, Math.min(100, ((candidate.strike - stockPrice) / (mandate.thesisTargetHigh - stockPrice)) * 100));
    if (required != null && participationPct < required) {
      fail('hold-uncovered', 'upside-participation', `The call leaves ${pct(participationPct, 0)} of the way to your ${money(mandate.thesisTargetHigh)} target; your ${mandate.posture} posture needs ${required}%.`);
    } else if (required != null) {
      callouts.push({ id: 'gate-upside-participation', tone: 'good', text: `The call keeps ${pct(participationPct, 0)} of the way to your ${money(mandate.thesisTargetHigh)} target (needs ${required}%).` });
    }
  }

  const failure = first as { state: GateState; code: NonNullable<MandateGateResult['reasonCode']> } | null;
  return {
    state: failure ? failure.state : 'review-income-call',
    reasonCode: failure ? failure.code : null,
    callouts,
    floor,
    participationPct,
    participationRequiredPct: required,
  };
}

/** One line describing the rules in force, shown on the Positions card next to "Edit". */
export function describeIncomeRules(mandate: LeapsMandate | null, breakeven: number | null): string {
  const floor = mandate?.incomeCapStrike != null ? `floor ${money(mandate.incomeCapStrike)}` : breakeven != null ? `floor ${money(Math.round(breakeven * 100) / 100)} (your breakeven)` : 'floor: needs your entry cost';
  if (!mandate) return `No income rules saved: ${floor}, and earnings before expiry block a call.`;
  const parts = [
    mandate.thesisTargetHigh != null ? `target ${money(mandate.thesisTargetHigh)}` : 'no target set',
    floor,
    mandate.posture,
    mandate.allowKnownEarningsCycle ? 'earnings allowed' : 'earnings not allowed',
  ];
  if (mandate.minimumCycleCredit != null && mandate.minimumCycleCredit > 0) parts.push(`min credit ${money(mandate.minimumCycleCredit)}`);
  if (mandate.invalidationPrice != null) parts.push(`invalidation ${money(mandate.invalidationPrice)}`);
  return `Your rules: ${parts.join(' · ')}`;
}
