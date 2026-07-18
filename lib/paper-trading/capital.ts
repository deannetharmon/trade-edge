// lib/paper-trading/capital.ts
//
// PT-0001: capital reservation and max-loss formulas (section 8). Pure,
// deterministic. Strike/width math mirrors the existing convention in
// app/portfolio/page.tsx's calculateMaxRisk()/sideGrossRisk() (larger-wing
// IC treatment, gross-width-minus-credit for verticals) but is written
// standalone here rather than imported, since that function is page-local
// (not exported) and operates on a different PositionLeg shape.

import { PaperTradingError } from './types';
import type { PaperLeg, PaperStrategy } from './types';

export interface CapitalRequirement {
  reservedCapital: number;
  theoreticalMaxLoss: number;
}

function strikeOf(legs: PaperLeg[], openAction: PaperLeg['openAction']): number {
  const leg = legs.find((l) => l.openAction === openAction);
  if (!leg) throw new PaperTradingError('VALIDATION_ERROR', 'Expected leg not found while computing capital requirement.');
  return leg.strike;
}

/**
 * CSP: reserved capital is the full cash-secured obligation (strike x
 * multiplier x quantity), independent of credit received — this is
 * deliberately conservative and NOT a naked-put margin formula (section 8:
 * "Do not use naked-put margin formulas"). Max loss (for P/L purposes) is
 * the same obligation minus the credit already collected, since the credit
 * offsets the loss if assigned and the stock goes to zero.
 */
function computeCsp(legs: PaperLeg[], quantity: number, contractMultiplier: number, entryCredit: number): CapitalRequirement {
  const strike = strikeOf(legs, 'sell_to_open');
  const reservedCapital = strike * contractMultiplier * quantity;
  const theoreticalMaxLoss = Math.max(0, reservedCapital - entryCredit);
  return { reservedCapital, theoreticalMaxLoss };
}

function verticalWidth(legs: PaperLeg[]): number {
  const short = legs.find((l) => l.openAction === 'sell_to_open');
  const long = legs.find((l) => l.openAction === 'buy_to_open');
  if (!short || !long) throw new PaperTradingError('VALIDATION_ERROR', 'Vertical spread requires one short and one long leg.');
  return Math.abs(short.strike - long.strike);
}

function computeVertical(legs: PaperLeg[], quantity: number, contractMultiplier: number, entryCredit: number): CapitalRequirement {
  const width = verticalWidth(legs);
  const grossMaxLoss = width * contractMultiplier * quantity;
  const theoreticalMaxLoss = Math.max(0, grossMaxLoss - entryCredit);
  // Section 8: "Reserved capital must equal the defined maximum loss under
  // the paper-account model."
  return { reservedCapital: theoreticalMaxLoss, theoreticalMaxLoss };
}

function computeIronCondor(legs: PaperLeg[], quantity: number, contractMultiplier: number, entryCredit: number): CapitalRequirement {
  const puts = legs.filter((l) => l.optionType === 'put');
  const calls = legs.filter((l) => l.optionType === 'call');
  const putWidth = verticalWidth(puts);
  const callWidth = verticalWidth(calls);
  // "Do not add both wing maximum losses as if both can simultaneously
  // realize full loss" — an IC can only lose on one side at expiration.
  const largerWidth = Math.max(putWidth, callWidth);
  const grossMaxLoss = largerWidth * contractMultiplier * quantity;
  const theoreticalMaxLoss = Math.max(0, grossMaxLoss - entryCredit);
  return { reservedCapital: theoreticalMaxLoss, theoreticalMaxLoss };
}

export function computeCapitalRequirement(
  strategy: PaperStrategy,
  legs: PaperLeg[],
  quantity: number,
  contractMultiplier: number,
  entryCredit: number,
): CapitalRequirement {
  switch (strategy) {
    case 'CSP':
      return computeCsp(legs, quantity, contractMultiplier, entryCredit);
    case 'BPS':
    case 'BCS':
      return computeVertical(legs, quantity, contractMultiplier, entryCredit);
    case 'IC':
      return computeIronCondor(legs, quantity, contractMultiplier, entryCredit);
    default: {
      const exhaustive: never = strategy;
      throw new PaperTradingError('VALIDATION_ERROR', `Unsupported strategy for capital calculation: ${exhaustive}`);
    }
  }
}

export function requireSufficientCapital(availableCapital: number, reservedCapital: number): void {
  if (reservedCapital > availableCapital) {
    throw new PaperTradingError('INSUFFICIENT_CAPITAL', 'Insufficient available paper capital for this position.', {
      availableCapital,
      reservedCapital,
    });
  }
}
