// lib/calculateCspRisk.ts
//
// Cash-Secured Put risk metrics: the existing theoretical "Capital at Risk"
// (stock -> $0) alongside a "Realistic Loss" estimate based on a 2-sigma
// expected downside move derived from the underlying's implied volatility.

export interface CspRiskInput {
  // IV as returned by the data source -- may arrive as a whole-number
  // percent (45) or a decimal fraction (0.45); normalized defensively below.
  impliedVolatility: number;
  daysToExpiration: number;
  currentStockPrice: number;
  strikePrice: number;
  // Per-share premium collected (not multiplied by 100 or by contracts yet).
  premiumCollected: number;
  contracts: number;
}

export interface CspRiskResult {
  // Existing theoretical worst case: stock goes to $0, net of premium,
  // times contracts. Unchanged from the current "Max Loss" calculation.
  capitalAtRisk: number;
  // 2-sigma-based expected loss -- $0 when the expected low price is at or
  // above breakeven (strike - premium).
  realisticLoss: number;
  // Intermediate values, exposed for the tooltip/debugging.
  expectedLowPrice: number;
  oneSigmaMove: number;
  twoSigmaMove: number;
  breakeven: number;
}

function clamp0(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function calculateCspRisk({
  impliedVolatility,
  daysToExpiration,
  currentStockPrice,
  strikePrice,
  premiumCollected,
  contracts,
}: CspRiskInput): CspRiskResult {
  // Defensive IV normalization: some APIs send IV as a whole-number percent
  // (45 meaning 45%), others as a decimal fraction (0.45). Real IV is never
  // >= 100% as a decimal (that would mean >=10,000% annualized vol), so
  // treating anything >= 1 as "whole-number percent, divide by 100" is a
  // safe, simple defensive check that avoids a 100x-inflated result.
  const ivDecimal = impliedVolatility >= 1 ? impliedVolatility / 100 : impliedVolatility;

  const oneSigmaMove = currentStockPrice * ivDecimal * Math.sqrt(daysToExpiration / 365);
  const twoSigmaMove = oneSigmaMove * 2;
  const expectedLowPrice = clamp0(currentStockPrice - twoSigmaMove);

  const breakeven = strikePrice - premiumCollected;

  // Capital at Risk -- unchanged, existing formula.
  const capitalAtRisk = (strikePrice * 100 - premiumCollected * 100) * contracts;

  // Realistic Loss -- same per-contract structure as Capital at Risk
  // (per-contract dollar loss, then scaled by contracts), but measured
  // against the 2-sigma expected low price instead of $0. Clamped to $0:
  // if the expected low is at or above breakeven, the trade isn't expected
  // to lose money, so there's nothing to show here.
  const perContractLoss = (strikePrice - expectedLowPrice) * 100 - premiumCollected * 100;
  const realisticLoss = clamp0(perContractLoss) * contracts;

  return { capitalAtRisk, realisticLoss, expectedLowPrice, oneSigmaMove, twoSigmaMove, breakeven };
}
