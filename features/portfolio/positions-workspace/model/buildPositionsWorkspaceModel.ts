import { buildSnapshotCapacityReport } from '@/lib/portfolio-snapshot/capacity';
import type { Position } from '@/lib/portfolio-data/types';
import type { PositionsWorkspaceInput, PositionsWorkspaceModel, SymbolGroupViewModel } from './types';

function finiteSum(values: Array<number | null | undefined>): number | null {
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

function optionMarketValue(position: Position): number | null {
  const value = position.currentValue;
  return value == null ? null : value * 100 * Math.max(1, position.quantity);
}

export function buildPositionsWorkspaceModel(input: PositionsWorkspaceInput): PositionsWorkspaceModel {
  const snapshot = input.snapshot;
  const equities = snapshot?.equities ?? [];
  const capacityReport = snapshot ? buildSnapshotCapacityReport(snapshot) : null;
  const symbols = new Set([...equities.map(item => item.symbol), ...input.positions.map(item => item.symbol)]);
  const symbolGroups: SymbolGroupViewModel[] = Array.from(symbols).sort().map(symbol => {
    const symbolEquities = equities.filter(item => item.symbol === symbol);
    const options = input.positions.filter(item => item.symbol === symbol);
    const longHolding = symbolEquities.find(item => item.direction === 'Long');
    const capacity = capacityReport?.status === 'ok' ? capacityReport.bySymbol[symbol] : undefined;
    const availableContracts = capacity?.availableCoveredContracts ?? 0;
    const needsAttention = options.some(position => Boolean(position.needsClose || position.structureAmbiguous || position.recommendation && position.recommendation.kind !== 'hold'));
    return {
      symbol,
      underlyingPrice: longHolding?.currentPrice ?? options.find(item => item.stockPrice != null)?.stockPrice ?? null,
      equityMarketValue: finiteSum(symbolEquities.map(item => item.marketValue)),
      optionMarketValue: finiteSum(options.map(optionMarketValue)),
      symbolUnrealizedPnl: finiteSum([...symbolEquities.map(item => item.unrealizedPnl), ...options.map(item => item.closeNowPnl ?? item.pnl)]),
      equities: symbolEquities,
      options,
      instrumentCount: symbolEquities.length + options.length,
      strategies: Array.from(new Set(options.map(item => item.strategy))),
      capacity: {
        status: capacityReport?.status === 'ok' && capacity ? 'ok' : 'unavailable',
        sharesOwned: capacity?.sharesOwned ?? Math.max(0, longHolding?.quantity ?? 0),
        allocatedContracts: capacity?.existingShortCallContracts ?? 0,
        reservedContracts: capacity?.workingShortCallContracts ?? 0,
        availableContracts,
        remainderShares: capacity ? capacity.sharesOwned % 100 : 0,
        basisComplete: capacity?.costBasisComplete ?? longHolding?.basisComplete ?? false,
        blockingReason: capacityReport?.status === 'unavailable' ? capacityReport.unavailableReason ?? 'Coverage evidence unavailable' : null,
      },
      needsAttention,
      contextualAction: capacityReport?.status === 'ok' && availableContracts > 0 ? 'covered-call' : null,
    };
  });
  return {
    snapshotAsOf: snapshot?.asOf ?? null,
    quoteAsOf: snapshot?.quoteAsOf ?? null,
    dataQuality: snapshot?.dataQuality ?? input.snapshotDataQuality,
    symbolGroups,
    analysisRows: input.positions.map(position => ({ id: position.key, position, symbol: position.symbol, strategy: position.strategy, needsAttention: Boolean(position.needsClose || position.structureAmbiguous || position.recommendation && position.recommendation.kind !== 'hold') })),
  };
}
