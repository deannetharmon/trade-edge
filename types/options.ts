export type OptionStrategyType = 'LONG_CALL' | 'SHORT_OPTION' | 'CSP' | 'PMCC';

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
