export type DecisionHorizon = 'SHORT' | 'CORE' | 'EXTENDED';
export const HORIZON_VERSION = 'sq0001a-horizon-v1' as const;

export interface HorizonResolution {
  horizon: DecisionHorizon;
  version: typeof HORIZON_VERSION;
  dte: number;
}

export function resolveDecisionHorizon(dte: number): HorizonResolution {
  if (!Number.isInteger(dte) || dte < 7 || dte > 60) throw new Error(`Unsupported research DTE: ${dte}`);
  if (dte <= 20) return { horizon: 'SHORT', version: HORIZON_VERSION, dte };
  if (dte <= 45) return { horizon: 'CORE', version: HORIZON_VERSION, dte };
  return { horizon: 'EXTENDED', version: HORIZON_VERSION, dte };
}
