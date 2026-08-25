import { buildSnapshotCapacityReport } from '@/lib/portfolio-snapshot/capacity';
import type { Position } from '@/lib/portfolio-data/types';
import type { PositionsWorkspaceInput, PositionsWorkspaceModel, SymbolGroupViewModel } from './types';
import { aggregateFinancialValues, aggregatePnlPercentage, buildOptionInstrumentViewModel, classifySymbolComposition, compositionLabel, optionMidpointValue } from './valuation';

function finiteSum(values: Array<number | null | undefined>): number | null {
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

function optionMarketValue(position: Position): number | null {
  return optionMidpointValue(position);
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
    const optionInstruments = options.map(buildOptionInstrumentViewModel);
    const composition = classifySymbolComposition(symbolEquities, optionInstruments);
    const asOf = snapshot?.quoteAsOf ?? snapshot?.asOf ?? null;
    const equityMarketValueAggregate = aggregateFinancialValues(symbolEquities.map((item, index) => ({ key: `equity-${symbol}-${index}`, value: item.marketValue, reason: 'Equity quote unavailable' })), 'mark-mid', asOf);
    const longOptions = optionInstruments.filter(item => item.role === 'long-call' || item.role === 'long-put' || item.role === 'multi-leg-option-structure' && item.position.entryPriceEffect === 'Debit');
    const obligationOptions = optionInstruments.filter(item => item.role === 'short-call' || item.role === 'short-put' || item.role === 'multi-leg-option-structure' && item.position.entryPriceEffect === 'Credit');
    const longOptionValueMid = aggregateFinancialValues(longOptions.map(item => ({ key: item.key, value: item.position.currentValue, reason: 'Option midpoint quote missing' })), 'mark-mid', asOf);
    const optionBuybackMid = aggregateFinancialValues(obligationOptions.map(item => ({ key: item.key, value: item.position.currentValue, reason: 'Option midpoint quote missing' })), 'mark-mid', asOf);
    const optionMarketableClose = aggregateFinancialValues(optionInstruments.map(item => ({ key: item.key, value: item.position.closeValue, reason: item.role === 'long-call' || item.role === 'long-put' ? 'Marketable bid unavailable' : 'Marketable close quote unavailable' })), 'marketable-close', asOf);
    const unrealizedPnlMid = aggregateFinancialValues([
      ...symbolEquities.map((item, index) => ({ key: `equity-${symbol}-${index}`, value: item.unrealizedPnl, reason: item.basisComplete ? 'Equity quote unavailable' : 'Equity basis missing' })),
      ...options.map(item => ({ key: item.key, value: item.pnl, reason: item.entryEconomicsComplete ? 'Option midpoint quote missing' : 'Option entry economics unavailable' })),
    ], 'mark-mid', asOf);
    const optionCloseNowPnl = aggregateFinancialValues(options.map(item => ({ key: item.key, value: item.closeNowPnl, reason: 'Marketable close quote or entry economics unavailable' })), 'marketable-close', asOf);
    const pnlPct = aggregatePnlPercentage(symbolEquities, options);
    const unallocatedShares = Math.max(0, (capacity?.sharesOwned ?? Math.max(0, longHolding?.quantity ?? 0)) - ((capacity?.existingShortCallContracts ?? 0) + (capacity?.workingShortCallContracts ?? 0)) * 100);
    return {
      symbol,
      underlyingPrice: longHolding?.currentPrice ?? options.find(item => item.stockPrice != null)?.stockPrice ?? null,
      equityMarketValue: finiteSum(symbolEquities.map(item => item.marketValue)),
      optionMarketValue: finiteSum(options.map(optionMarketValue)),
      symbolUnrealizedPnl: unrealizedPnlMid.completeness === 'complete' ? unrealizedPnlMid.value : null,
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
        remainderShares: unallocatedShares % 100,
        basisComplete: capacity?.costBasisComplete ?? longHolding?.basisComplete ?? false,
        blockingReason: capacityReport?.status === 'unavailable' ? capacityReport.unavailableReason ?? 'Coverage evidence unavailable' : null,
        unallocatedShares,
      },
      needsAttention,
      contextualAction: capacityReport?.status === 'ok' && availableContracts > 0 ? 'covered-call' : null,
      composition,
      compositionLabel: compositionLabel(composition, symbolEquities, optionInstruments),
      equityMarketValueAggregate, longOptionValueMid, optionBuybackMid, optionMarketableClose,
      unrealizedPnlMid, optionCloseNowPnl,
      unrealizedPnlPct: pnlPct.value, unrealizedPnlPctReason: pnlPct.reason,
      optionInstruments,
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
