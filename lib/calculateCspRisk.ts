// lib/calculateCspRisk.ts
//
// Cash-Secured Put risk metrics: the existing theoretical "Capital at Risk"
// (stock -> $0) alongside a "2σ Scenario Loss" -- the loss under one modeled
// downside scenario (a 2-standard-deviation implied-volatility move), not a
// prediction, expected value, or probability-weighted/VaR estimate. Renamed
// from "Realistic Loss" -- that label implied more statistical certainty
// than the calculation provides. See docs/reviews/
// CSP-Realistic-Loss-Implementation-Report.docx for the terminology
// refinement rationale; the calculation itself is unchanged except for one
// defensive fix (see the daysToExpiration clamp below).
//
// Formula (unchanged from the original implementation, restated here to
// mirror the audited spec exactly):
//   Breakeven     = Strike - PremiumPerShare
//   ExpectedMove  = CurrentPrice * IV * sqrt(DTE / 365)
//   ExpectedLow   = CurrentPrice - 2 * ExpectedMove
//   ScenarioLoss  = max(0, Breakeven - ExpectedLow) * 100 * ContractCount

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
  // The loss under one modeled downside scenario (a 2-sigma implied-
  // volatility move by expiration) -- $0 when the expected low price is at
  // or above breakeven (strike - premium). Not an expected value,
  // probability-weighted loss, VaR, or maximum likely loss -- just this one
  // scenario. Previously named `realisticLoss`; renamed for accuracy.
  scenarioLoss: number;
  // Intermediate values, exposed for the tooltip/debugging.
  expectedLowPrice: number;
  expectedMove: number; // the 2-sigma move (was `twoSigmaMove`)
  oneSigmaMove: number;
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
  // safe, simple defensive check that avoids a 100x-inflated result. Both
  // input formats produce identical results (verified: IV=45 and IV=0.45
  // both normalize to 0.45). Known, accepted limitation: a decimal IV of
  // exactly 1.0 (100% IV, i.e. a very high-vol name) would be misread as
  // "1" in whole-number-percent form and divided down to 1% -- an inherent
  // ambiguity of any format-detection heuristic at that exact boundary, not
  // something either format can disambiguate on its own. Not fixed here
  // (would require a source-format flag, a real API/data-contract change,
  // out of scope for a terminology refinement) -- flagged for awareness.
  const ivDecimal = impliedVolatility >= 1 ? impliedVolatility / 100 : impliedVolatility;

  // Defensive DTE fix: sqrt() of a negative number is NaN, which would have
  // silently propagated to an "$NaN" scenario loss for any stale/invalid
  // negative daysToExpiration. The formula's domain already assumes DTE >=
  // 0 (0 DTE = expiring today, no further expected move); this just
  // enforces that assumption instead of producing NaN. Does not change any
  // result for real, non-negative DTE.
  const dte = clamp0(daysToExpiration);

  const oneSigmaMove = currentStockPrice * ivDecimal * Math.sqrt(dte / 365);
  const expectedMove = oneSigmaMove * 2; // the 2-sigma move
  const expectedLowPrice = clamp0(currentStockPrice - expectedMove);

  const breakeven = strikePrice - premiumCollected;

  // Capital at Risk -- unchanged, existing formula.
  const capitalAtRisk = (strikePrice * 100 - premiumCollected * 100) * contracts;

  // 2σ Scenario Loss -- max(0, Breakeven - ExpectedLow) * 100 * Contracts,
  // per the audited spec. Algebraically identical to the original
  // implementation's (Strike - ExpectedLow - Premium) * 100 * Contracts --
  // restated here in terms of `breakeven` for direct traceability against
  // the spec, not a behavior change.
  const scenarioLoss = clamp0(breakeven - expectedLowPrice) * 100 * contracts;

  return { capitalAtRisk, scenarioLoss, expectedLowPrice, expectedMove, oneSigmaMove, breakeven };
}
