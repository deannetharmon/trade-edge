// lib/dashboard/positionToTelemetry.ts
//
// TELEMETRY-METRIC-DIRECTION-0001 -- maps a real Position to
// OptionsTelemetryProps for the 'evolution' column. All "start" values
// come from Position's own *AtEntry fields (a real, true-entry-time
// capture -- see lib/portfolio-data/types.ts), not the daily
// PositionSnapshot history, which doesn't cover every metric this needs.
//
// Short-leg risk callout: PositionLeg.currentDelta now exists (wired
// through from the broker's own per-instrument Greeks in acquisition.ts,
// previously captured but never carried through to PositionLeg -- a real
// gap, fixed as part of this ticket, not worked around). But no per-leg
// ENTRY-time delta exists anywhere in this app's data (checked directly;
// genuinely not captured, not something missed). Position.deltaAtEntry
// (net position delta at entry) reliably equals the short leg's OWN
// entry delta only for single-short-leg strategies (CSP, naked short
// call) -- there's no long leg to net against. For real spreads
// (BPS/BCS/IC), net entry delta is NOT the short leg's own delta, so the
// callout stays honestly omitted there, same principle as everywhere
// else tonight: don't fabricate a number that would be genuinely wrong.

import type { Position } from '@/lib/portfolio-data/types';
import type { OptionsTelemetryProps, OptionStrategyType, ShortLegTelemetry } from '@/types/options';

const SINGLE_SHORT_LEG_STRATEGIES = new Set(['CSP', 'SHORT_CALL']);

function toOptionStrategyType(strategy: string): OptionStrategyType | null {
  // Position.strategy is a plain string; only map values this card
  // actually knows how to label. IC and IRON_CONDOR are the same
  // strategy under different naming conventions (confirmed with Dean).
  if (strategy === 'IC') return 'IRON_CONDOR';
  const known: readonly OptionStrategyType[] = [
    'LONG_CALL', 'SHORT_CALL', 'CSP', 'PMCC', 'LONG_PUT', 'IRON_CONDOR', 'STRADDLE', 'BPS', 'BCS',
  ];
  return (known as readonly string[]).includes(strategy) ? (strategy as OptionStrategyType) : null;
}

function buildShortLeg(position: Position, strategy: OptionStrategyType): ShortLegTelemetry | undefined {
  if (!SINGLE_SHORT_LEG_STRATEGIES.has(strategy)) return undefined; // real spreads: honestly omitted, see module doc
  const shortLeg = position.legs?.find(leg => leg.direction === 'Short');
  if (!shortLeg || shortLeg.currentDelta == null || position.deltaAtEntry == null) return undefined;
  return {
    strike: shortLeg.strikePrice,
    optionType: shortLeg.optionType,
    dte: position.dte,
    deltaStart: Math.abs(position.deltaAtEntry),
    deltaNow: Math.abs(shortLeg.currentDelta),
  };
}

/**
 * Returns null when the position doesn't have enough real data to render
 * the card honestly (unrecognized strategy, or any required Greek/IV
 * value missing at either entry or now) -- never fabricates a value to
 * fill the gap.
 */
export function positionToTelemetry(position: Position): OptionsTelemetryProps | null {
  const strategy = toOptionStrategyType(position.strategy);
  if (!strategy) return null;

  const plNow = position.closeNowPnl ?? position.pnl;
  if (plNow == null) return null;
  if (position.deltaAtEntry == null || position.netDelta == null) return null;
  if (position.thetaAtEntry == null || position.theta == null) return null;
  if (position.gammaAtEntry == null || position.gamma == null) return null;
  if (position.vegaAtEntry == null || position.netVega == null) return null;
  if (position.ivAtEntry == null || position.iv == null) return null;
  if (position.ivrAtEntry == null || position.ivr == null) return null;

  return {
    strategy,
    symbol: position.symbol,
    plStart: 0, // P/L at entry is definitionally zero
    plNow,
    deltaStart: position.deltaAtEntry,
    deltaNow: position.netDelta,
    thetaStart: position.thetaAtEntry,
    thetaNow: position.theta,
    gammaStart: position.gammaAtEntry,
    gammaNow: position.gamma,
    vegaStart: position.vegaAtEntry,
    vegaNow: position.netVega,
    ivStart: position.ivAtEntry,
    ivNow: position.iv,
    ivrStart: position.ivrAtEntry,
    ivrNow: position.ivr,
    shortLeg: buildShortLeg(position, strategy),
  };
}

