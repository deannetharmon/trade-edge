// types/options.ts

// TELEMETRY-METRIC-DIRECTION-0001: widened to include BPS/BCS, which
// Position.strategy (lib/portfolio-data/types.ts) actually uses for the
// two most common real strategies in this app -- this type was built
// against the sandbox mocks, not against what a real position contains.
// IC (Position's own strategy value) maps onto IRON_CONDOR below, same
// underlying strategy, different naming convention (confirmed with Dean).
export type OptionStrategyType = 
  | 'LONG_CALL'
  | 'SHORT_CALL'
  | 'CSP'
  | 'PMCC'
  | 'LONG_PUT'
  | 'IRON_CONDOR'
  | 'STRADDLE'
  | 'BPS'
  | 'BCS';

export interface ShortLegTelemetry {
  strike: number;
  optionType: 'C' | 'P';
  dte: number;
  deltaStart: number;
  deltaNow: number;
}

export interface OptionsTelemetryProps {
  strategy: OptionStrategyType;
  symbol: string;
  plStart: number;
  plNow: number;
  deltaStart: number;
  deltaNow: number;
  thetaStart: number;
  thetaNow: number;
  gammaStart: number;
  gammaNow: number;
  vegaStart: number;
  vegaNow: number;
  ivStart: number;
  ivNow: number;
  ivrStart: number;
  ivrNow: number;
  shortLeg?: ShortLegTelemetry; 
}
