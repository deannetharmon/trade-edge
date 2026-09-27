// lib/portfolio/rollExplanation.ts

import type { Position } from '@/lib/portfolio-data/types';
import { computeSingleLegBreakeven } from './positionMetrics';
import { buildOriginalCreditDefaultPolicy } from './stopLossPolicy';

// KEEP-CREDIT-0001 Part A -- fee model (Dane's developer review, item 2: no
// fee model or roll-net code existed anywhere). TastyTrade charges $0
// commission on equity options; the residual cost is regulatory (ORF) and
// clearing/exchange fees, charged per contract on both the opening and
// closing side of a trade. Dean confirmed (2026-09-27) using the published
// per-contract round-trip rate rather than a real fill's exact number:
// $0.14 per contract, per leg, for one full open+close cycle. A roll closes
// both legs of the old spread and opens both legs of the new one -- 4
// leg-transactions per contract.
export const ROLL_FEE_PER_LEG_ROUND_TRIP = 0.14;
const LEGS_PER_SPREAD_ROLL = 4;

function floorToCent(value: number): number {
  // +epsilon guards float noise (e.g. 0.14000000000000001) from flooring
  // down a cent it shouldn't.
  return Math.floor(value * 100 + 1e-9) / 100;
}

function roundToCent(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface RollExplanationInput {
  position: Position;
  newShortStrike: number;
  newLongStrike: number;
  /**
   * The price the new spread will actually be opened at, per share --
   * the 85% limit for a searched candidate (RollCandidate.credit), or
   * Dean's typed price for a manually-entered roll. This is deliberately
   * the tradeable/executable price, not a second mid-to-mid figure, so the
   * displayed math never disagrees with what actually gets submitted.
   */
  newCreditPerShare: number;
}

export interface RollExplanationLines {
  qty: number;
  optionType: 'P' | 'C';
  oldWidth: number;
  newWidth: number;
  oldCreditTotal: number;
  closeCostTotal: number;
  lossAtCloseTotal: number;
  openCreditTotal: number;
  feesTotal: number;
  netRollPerShare: number;
  netRollTotal: number;
  isNetDebit: boolean;
  /** C' -- the accumulated net credit basis carried forward after this roll. */
  newCreditBasisPerShare: number;
  newCreditBasisTotal: number;
  oldMaxLossTotal: number | null;
  newMaxLossTotal: number;
  maxLossChangeTotal: number | null;
  oldBreakeven: number | null;
  newBreakeven: number;
  /** Total loss if the OLD position's stop is hit. Only computed for the common ORIGINAL_CREDIT (2x-credit) stop basis; null otherwise (a manual or current-value-anchored stop isn't a simple credit multiple). */
  oldStopTotalLoss: number | null;
  newStopTriggerPrice: number;
  newStopTotalLoss: number;
  isWiderSpread: boolean;
}

/**
 * KEEP-CREDIT-0001 Part A. Pure roll math: no fetch, no React, no clock.
 * Formulas are DECIDE-0001's "Qualifying roll and roll cost" (rollNet, C',
 * new max loss, new breakeven, new stop), reconciled to the app's actual
 * tradeable prices -- "old" is the closing mid (position.currentValue, what
 * closing now actually costs), "new" is the new spread's own opening price
 * as it will actually be submitted.
 *
 * v1 scope (Dean, 2026-09-27): two-leg vertical spreads only (BPS/BCS).
 * Single-leg CSP/CC (no long leg) and iron condors (4 legs) return null --
 * the roll-explanation box does not show for them, same treatment CSP/CC
 * already got implicitly from the existing roll-candidate search.
 *
 * Golden fixture uses the ticket's own worked-example scenario (put spread,
 * credit $1.65, 570/565, one contract, rolled to 568/563) -- but the exact
 * dollar figures in the ticket text used an illustrative, unsourced $4 fee
 * (Dane's review: no fee model existed yet). With the real $0.14-per-leg
 * constant above, the fee/net/basis/max-loss/breakeven/stop figures differ
 * slightly from the ticket's prose; see rollExplanation.test.ts for the
 * recomputed values and the arithmetic that ties them together.
 */
export function explainRoll({ position, newShortStrike, newLongStrike, newCreditPerShare }: RollExplanationInput): RollExplanationLines | null {
  const qty = position.quantity;
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (position.legs.length !== 2) return null;
  const optType: 'P' | 'C' = position.strategy === 'BCS' ? 'C' : 'P';

  const origShort = position.legs.find(l => l.direction === 'Short');
  const origLong = position.legs.find(l => l.direction === 'Long');
  if (!origShort || !origLong) return null;

  const oldCreditTotal = position.entryCredit ?? position.creditReceived;
  if (oldCreditTotal == null || !Number.isFinite(oldCreditTotal)) return null;

  const oldWidth = Math.abs(origShort.strikePrice - origLong.strikePrice);
  const newWidth = Math.abs(newShortStrike - newLongStrike);
  const perShareDivisor = qty * 100;

  const closeCostTotal = position.currentValue ?? 0;
  const lossAtCloseTotal = roundToCent(closeCostTotal - oldCreditTotal);

  const openCreditTotal = roundToCent(newCreditPerShare * perShareDivisor);
  const feesTotal = roundToCent(ROLL_FEE_PER_LEG_ROUND_TRIP * LEGS_PER_SPREAD_ROLL * qty);

  const closeCostPerShare = closeCostTotal / perShareDivisor;
  const feesPerShare = feesTotal / perShareDivisor;
  // DECIDE-0001: rollNet = floor_to_cent(new − old) − fees.
  const netRollPerShare = roundToCent(floorToCent(newCreditPerShare - closeCostPerShare) - feesPerShare);
  const netRollTotal = roundToCent(netRollPerShare * perShareDivisor);

  const oldCreditPerShare = oldCreditTotal / perShareDivisor;
  const newCreditBasisPerShare = roundToCent(oldCreditPerShare + netRollPerShare);
  const newCreditBasisTotal = roundToCent(newCreditBasisPerShare * perShareDivisor);

  const newMaxLossTotal = roundToCent((newWidth - newCreditBasisPerShare) * perShareDivisor);
  const oldMaxLossTotal = Number.isFinite(position.maxRisk) ? position.maxRisk : null;
  const maxLossChangeTotal = oldMaxLossTotal != null ? roundToCent(newMaxLossTotal - oldMaxLossTotal) : null;

  const oldBreakeven = computeSingleLegBreakeven(origShort.strikePrice, oldCreditPerShare, optType);
  const newBreakeven = computeSingleLegBreakeven(newShortStrike, newCreditBasisPerShare, optType);
  if (newBreakeven == null) return null;

  const newStopPolicy = buildOriginalCreditDefaultPolicy(newCreditBasisPerShare);
  const newStopTotalLoss = roundToCent(newCreditBasisPerShare * perShareDivisor);

  let oldStopTotalLoss: number | null = null;
  const oldPolicy = position.stopLossPolicy;
  if (oldPolicy && oldPolicy.anchorBasis === 'ORIGINAL_CREDIT' && oldPolicy.anchorValue != null) {
    oldStopTotalLoss = roundToCent((oldPolicy.triggerPrice - oldPolicy.anchorValue) * perShareDivisor);
  }

  return {
    qty, optionType: optType, oldWidth, newWidth,
    oldCreditTotal, closeCostTotal, lossAtCloseTotal,
    openCreditTotal, feesTotal, netRollPerShare, netRollTotal, isNetDebit: netRollTotal < 0,
    newCreditBasisPerShare, newCreditBasisTotal,
    oldMaxLossTotal, newMaxLossTotal, maxLossChangeTotal,
    oldBreakeven, newBreakeven,
    oldStopTotalLoss, newStopTriggerPrice: newStopPolicy.triggerPrice, newStopTotalLoss,
    isWiderSpread: newWidth > oldWidth,
  };
}
