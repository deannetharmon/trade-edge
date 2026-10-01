export interface StressScenarioSet {
  id: string;
  underlyingMovesPct: number[];
}

export const DEFAULT_LEV_STRESS_SCENARIOS: StressScenarioSet = {
  id: 'lev-standard-stress-v1',
  underlyingMovesPct: [-20, -15, -10, -5, 5, 10, 15, 20],
};

export interface PortfolioStressPosition {
  positionId: string;
  economicUnderlying: string;
  input: import('./types').LongInstrumentExposureInput;
}

export interface PortfolioStressScenarioResult {
  underlyingMovePct: number;
  estimatedPnl: number | null;
  estimatedLoss: number | null;
  normalizedPositionCount: number;
  incompletePositionIds: string[];
  complete: boolean;
}

export interface PortfolioStressReport {
  modelVersion: typeof import('./types').LEVERAGE_RISK_MODEL_VERSION;
  scenarioSetId: string;
  results: PortfolioStressScenarioResult[];
}
