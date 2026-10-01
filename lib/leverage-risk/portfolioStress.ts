import { LEVERAGE_RISK_MODEL_VERSION } from './types';
import type { LongInstrumentExposureInput } from './types';
import { stressLongInstrument } from './exposure';
import {
  DEFAULT_LEV_STRESS_SCENARIOS,
  type PortfolioStressPosition,
  type PortfolioStressReport,
  type StressScenarioSet,
} from './stressTypes';

export function evaluateLongInstrumentStressSet(
  input: LongInstrumentExposureInput,
  scenarios: StressScenarioSet = DEFAULT_LEV_STRESS_SCENARIOS,
) {
  return scenarios.underlyingMovesPct.map(underlyingMovePct =>
    stressLongInstrument(input, { underlyingMovePct }),
  );
}

export function aggregatePortfolioStress(
  positions: PortfolioStressPosition[],
  scenarios: StressScenarioSet = DEFAULT_LEV_STRESS_SCENARIOS,
): PortfolioStressReport {
  return {
    modelVersion: LEVERAGE_RISK_MODEL_VERSION,
    scenarioSetId: scenarios.id,
    results: scenarios.underlyingMovesPct.map(underlyingMovePct => {
      let estimatedPnl = 0;
      const incompletePositionIds: string[] = [];
      let normalizedPositionCount = 0;

      for (const position of positions) {
        const stress = stressLongInstrument(position.input, { underlyingMovePct });
        if (!stress.normalizationAuthoritative || stress.estimatedPnl == null) {
          incompletePositionIds.push(position.positionId);
          continue;
        }
        estimatedPnl += stress.estimatedPnl;
        normalizedPositionCount += 1;
      }

      const complete = incompletePositionIds.length === 0;
      return {
        underlyingMovePct,
        estimatedPnl: complete ? estimatedPnl : null,
        estimatedLoss: complete ? Math.max(0, -estimatedPnl) : null,
        normalizedPositionCount,
        incompletePositionIds,
        complete,
      };
    }),
  };
}
