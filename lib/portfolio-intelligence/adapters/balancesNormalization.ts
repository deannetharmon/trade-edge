// lib/portfolio-intelligence/adapters/balancesNormalization.ts
//
// PI-0003.5: single normalization point for raw account-balance data.
// Pure and deterministic -- no fetching, no React, no browser dependency.
// The Portfolio page (or any other caller) is responsible for fetching the
// raw balance payload; this module only knows how to interpret it.
//
// Missing values stay genuinely missing (`undefined`), never silently
// become `0` -- that distinction matters because `0` is a valid, meaningful
// value for several of these fields (e.g. zero cash is a real state, not an
// "unknown" state), and conflating the two would make objective rules fire
// (or fail to fire) based on data that was never actually observed.

import type { AssignmentPreference, PositionStrategy } from '../types';

export interface PortfolioFinancialContext {
  netLiquidity?: number;
  cashBalance?: number;
  availableBuyingPower?: number;
  maintenanceRequirement?: number;
  // maintenanceRequirement / netLiquidity, only when both are known finite
  // numbers and netLiquidity > 0. NOT independently verified against a live
  // balance payload as of this slice -- see planning/SPRINT3_PI0003_5_PLAN.md
  // "Known remaining gaps". If maintenance-requirement turns out absent from
  // the live response, this simply stays undefined and
  // PRESERVE_BUYING_POWER's utilization branch won't fire (safe, not wrong).
  buyingPowerUsedPct?: number;
  // No canonical income-tracking source exists anywhere in this codebase as
  // of this slice (confirmed by repo search). Always undefined. Do not
  // derive from P/L -- realized/unrealized gain is not the same concept as
  // recurring premium income.
  currentIncome?: number;
  targetIncome?: number;
  // No historical peak-equity tracking exists for the live account as of
  // this slice. Always undefined.
  drawdownPct?: number;
}

// The single normalization point: turns any raw value into a finite number
// or undefined. Never returns 0 for a missing/invalid input -- 0 is only
// ever returned when the source genuinely parses to zero.
export function toFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

// Raw balance payload shape is intentionally loose (Record<string, unknown>)
// -- this is exactly the untyped JSON a broker API returns. Field-name
// fallback chains match precedents already established elsewhere in this
// codebase (app/engine/page.tsx's derivative-buying-power/option-buying-power
// chain), not invented fresh.
export function buildPortfolioFinancialContext(raw: Record<string, unknown> | null | undefined): PortfolioFinancialContext {
  const source = raw ?? {};

  const netLiquidity = toFiniteNumber(source['net-liquidating-value'] ?? source['net-liq'] ?? source['net-liquidation-value']);
  const cashBalance = toFiniteNumber(source['cash-balance']);
  const availableBuyingPower = toFiniteNumber(source['derivative-buying-power'] ?? source['option-buying-power'] ?? source['equity-buying-power']);
  const maintenanceRequirement = toFiniteNumber(source['maintenance-requirement']);

  const buyingPowerUsedPct =
    maintenanceRequirement !== undefined && netLiquidity !== undefined && netLiquidity > 0
      ? (maintenanceRequirement / netLiquidity) * 100
      : undefined;

  return {
    netLiquidity,
    cashBalance,
    availableBuyingPower,
    maintenanceRequirement,
    buyingPowerUsedPct,
    currentIncome: undefined,
    targetIncome: undefined,
    drawdownPct: undefined,
  };
}

export interface PositionExposureInput {
  symbol: string;
  // Theoretical max loss for the position -- Position.maxRisk on the
  // Portfolio page already provides this for every open position.
  maxRisk: number;
  // PI-0004B: optional, independent fields -- see PositionStrategy /
  // AssignmentPreference in ../types.ts. Absent on legacy/unclassified
  // positions; only used by deriveWheelDominance() below.
  positionStrategy?: PositionStrategy | null;
  assignmentPreference?: AssignmentPreference | null;
}

// Concentration numerator (per-symbol exposure, summed across positions in
// the same symbol) over the balances-derived denominator (net liquidity).
// Returns {} -- not a divide-by-zero, not a fabricated result -- when
// netLiquidity is unavailable, zero, or negative. Never mutates the input
// array.
export function derivePositionConcentration(
  positions: PositionExposureInput[],
  netLiquidity: number | undefined,
): Record<string, number> {
  if (netLiquidity === undefined || !Number.isFinite(netLiquidity) || netLiquidity <= 0) {
    return {};
  }

  const exposureBySymbol: Record<string, number> = {};
  for (const position of positions) {
    const risk = Number.isFinite(position.maxRisk) ? position.maxRisk : 0;
    exposureBySymbol[position.symbol] = (exposureBySymbol[position.symbol] ?? 0) + risk;
  }

  const concentration: Record<string, number> = {};
  for (const [symbol, exposure] of Object.entries(exposureBySymbol)) {
    concentration[symbol] = (exposure / netLiquidity) * 100;
  }
  return concentration;
}

// PI-0004B: per-symbol fraction (0-1) of that symbol's total exposure
// attributable to positions with PositionStrategy WHEEL and
// AssignmentPreference PREFER, feeding PortfolioStateInput.symbolWheelDominance
// (see evaluatePortfolioObjectives.ts's evaluateConcentration() for how it's
// used). Unlike derivePositionConcentration(), this needs no net-liquidity
// denominator -- it's a ratio within a symbol's own exposure, not a share of
// the portfolio. A symbol with no Wheel+Prefer exposure is simply absent
// from the result (not 0), matching this module's "missing stays missing"
// convention. Never mutates the input array.
export function deriveWheelDominance(positions: PositionExposureInput[]): Record<string, number> {
  const totalBySymbol: Record<string, number> = {};
  const wheelBySymbol: Record<string, number> = {};

  for (const position of positions) {
    const risk = Number.isFinite(position.maxRisk) ? position.maxRisk : 0;
    totalBySymbol[position.symbol] = (totalBySymbol[position.symbol] ?? 0) + risk;
    if (position.positionStrategy === 'WHEEL' && position.assignmentPreference === 'PREFER') {
      wheelBySymbol[position.symbol] = (wheelBySymbol[position.symbol] ?? 0) + risk;
    }
  }

  const dominance: Record<string, number> = {};
  for (const [symbol, wheelExposure] of Object.entries(wheelBySymbol)) {
    const total = totalBySymbol[symbol];
    if (total > 0) {
      dominance[symbol] = wheelExposure / total;
    }
  }
  return dominance;
}
