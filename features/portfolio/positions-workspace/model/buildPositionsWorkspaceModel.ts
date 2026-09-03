import { buildSnapshotCapacityReport } from '@/lib/portfolio-snapshot/capacity';
import type { Position } from '@/lib/portfolio-data/types';
import type { ExistingIncomeOpportunity, PositionsWorkspaceInput, PositionsWorkspaceModel, SymbolGroupViewModel } from './types';
import { aggregateFinancialValues, aggregatePnlPercentage, buildOptionInstrumentViewModel, classifySymbolComposition, compositionLabel, optionMidpointValue } from './valuation';

function finiteSum(values: Array<number | null | undefined>): number | null {
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

function optionMarketValue(position: Position): number | null {
  return optionMidpointValue(position);
}

function snapshotFreshness(input: PositionsWorkspaceInput): string {
  if (input.snapshot?.freshness === 'current' && input.snapshot.dataQuality.status === 'ok') return 'Current broker evidence';
  return input.snapshot?.dataQuality.unavailableReason ?? input.snapshotDataQuality.unavailableReason ?? 'Broker evidence is unavailable or not current';
}

function buildIncomeOpportunities(input: PositionsWorkspaceInput): ExistingIncomeOpportunity[] {
  const snapshot = input.snapshot;
  const snapshotReady = snapshot?.freshness === 'current' && snapshot.dataQuality.status === 'ok' && Boolean(snapshot.accountNumber);
  const freshness = snapshotFreshness(input);
  const options = snapshot?.options ?? input.positions;

  // PW-0002: this used to map EVERY option position through the PMCC-base
  // check and EVERY equity holding through the covered-call check, so a
  // CSP, a vertical, a long put held for an unrelated strategy -- anything
  // that was never a PMCC/CC candidate in the first place -- still got a
  // card here, explaining in detail why it doesn't qualify. Per Ian/Dean:
  // this section is a heads-up on genuine opportunities, not an audit of
  // the whole portfolio. Filter to plausible candidates BEFORE building a
  // card; structural non-candidates (multi-leg, wrong account, not a long
  // call / not long shares) are skipped entirely rather than shown as
  // "not eligible". `no-capacity` stays -- that's a real constraint on a
  // genuine candidate (you do hold a qualifying long call / long shares),
  // not a structural mismatch, so it's still worth surfacing.
  const opportunities: ExistingIncomeOpportunity[] = [];

  for (const position of options) {
    const legs = Array.isArray(position.legs) ? position.legs : [];
    const leg = legs.length === 1 ? legs[0] : null;
    // Not a single-leg long call at all -- never a PMCC candidate. No card.
    if (!leg || legs.length !== 1 || leg.direction !== 'Long' || leg.optionType !== 'C') continue;

    const exactContract = leg.symbol?.trim() || null;
    const base = {
      id: `pmcc:${position.key}`, kind: 'pmcc-short-call' as const, symbol: position.symbol,
      positionKey: position.key, title: 'PMCC short call', freshness, exactContract,
      sharesOwned: null, allocatedContracts: null, reservedContracts: null, availableContracts: null,
    };
    if (!snapshotReady) { opportunities.push({ ...base, status: 'unavailable', reason: 'Current attributable portfolio evidence is required before a PMCC short-call review.' }); continue; }
    if (position.accountNumber !== snapshot!.accountNumber) { opportunities.push({ ...base, status: 'not-eligible', reason: 'Position account identity does not match the active broker account.' }); continue; }
    if (position.structureAmbiguous || !exactContract) { opportunities.push({ ...base, status: 'not-eligible', reason: 'Position is structurally ambiguous or missing leg evidence.' }); continue; }
    opportunities.push({ ...base, status: 'eligible', reason: 'Exact held long-call identity is verified. Short-call timing has not yet been evaluated.' });
  }

  const capacityReport = snapshot ? buildSnapshotCapacityReport(snapshot) : null;
  for (const holding of snapshot?.equities ?? []) {
    // Not long shares at all -- never a covered-call candidate. No card.
    if (holding.direction !== 'Long' || holding.quantity <= 0) continue;

    const capacity = capacityReport?.status === 'ok' ? capacityReport.bySymbol[holding.symbol] : null;
    const base = {
      id: `covered-call:${holding.symbol}`, kind: 'covered-call' as const, symbol: holding.symbol,
      positionKey: null, title: 'Covered call', freshness, exactContract: null,
      sharesOwned: holding.quantity,
      allocatedContracts: capacity?.existingShortCallContracts ?? null,
      reservedContracts: capacity?.workingShortCallContracts ?? null,
      availableContracts: capacity?.availableCoveredContracts ?? null,
    };
    if (!snapshotReady || capacityReport?.status !== 'ok') {
      opportunities.push({ ...base, status: 'unavailable', reason: 'Current share and short-call commitment evidence is required to verify covered-call capacity.' });
    } else if (!capacity || capacity.availableCoveredContracts <= 0) {
      opportunities.push({ ...base, status: 'no-capacity', reason: 'Fully covered / no available capacity after existing and working short calls.' });
    } else {
      opportunities.push({ ...base, status: 'eligible', reason: 'Share capacity is verified. Short-call timing has not yet been evaluated.' });
    }
  }
  return opportunities;
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
    accountNumber: snapshot?.accountNumber ?? input.positions[0]?.accountNumber ?? null,
    snapshotAsOf: snapshot?.asOf ?? null,
    quoteAsOf: snapshot?.quoteAsOf ?? null,
    dataQuality: snapshot?.dataQuality ?? input.snapshotDataQuality,
    symbolGroups,
    analysisRows: input.positions.map(position => ({ id: position.key, position, symbol: position.symbol, strategy: position.strategy, needsAttention: Boolean(position.needsClose || position.structureAmbiguous || position.recommendation && position.recommendation.kind !== 'hold') })),
    incomeOpportunities: buildIncomeOpportunities(input),
  };
}
