import type { EquityHolding } from '@/lib/portfolio-snapshot/types';
import type { Position } from '@/lib/portfolio-data/types';
import { buildLeapsEconomics } from '@/lib/portfolio/leapsPositionIntelligence';
import type { FinancialAggregate, InstrumentRole, OptionInstrumentViewModel, SymbolAssetComposition } from './types';

export interface AggregateContributor { key: string; value: number | null | undefined; reason: string }

export function aggregateFinancialValues(contributors: readonly AggregateContributor[], basis: FinancialAggregate['basis'], asOf: string | null): FinancialAggregate {
  if (contributors.length === 0) return { value: null, completeness: 'not-applicable', includedCount: 0, expectedCount: 0, excludedInstrumentKeys: [], reasons: [], basis: null, asOf };
  const included = contributors.filter(item => item.value != null && Number.isFinite(item.value));
  const excluded = contributors.filter(item => item.value == null || !Number.isFinite(item.value));
  return {
    value: included.length ? included.reduce((sum, item) => sum + item.value!, 0) : null,
    completeness: excluded.length === 0 ? 'complete' : included.length ? 'partial' : 'unavailable',
    includedCount: included.length, expectedCount: contributors.length,
    excludedInstrumentKeys: excluded.map(item => item.key), reasons: Array.from(new Set(excluded.map(item => item.reason))), basis, asOf,
  };
}

function identityIsConsistent(position: Position): boolean {
  return position.identity != null && !position.structureAmbiguous && position.legs.length > 0
    && position.legs.every(leg => leg.quantity === position.identity!.quantity);
}

export function optionInstrumentRole(position: Position): InstrumentRole {
  if (!identityIsConsistent(position)) return 'ambiguous-option-structure';
  if (position.legs.length > 1) return 'multi-leg-option-structure';
  const leg = position.legs[0];
  return `${leg.direction.toLowerCase()}-${leg.optionType === 'C' ? 'call' : 'put'}` as InstrumentRole;
}

export function roleLabel(role: InstrumentRole, position?: Position): string {
  const labels: Record<InstrumentRole, string> = {
    'long-equity': 'Long equity', 'short-equity': 'Short equity', 'long-call': 'Long call', 'long-put': 'Long put',
    'short-call': 'Short call', 'short-put': 'Short put', 'multi-leg-option-structure': position?.strategy ?? 'Multi-leg option structure',
    'ambiguous-option-structure': 'Structure unresolved',
  };
  if (role === 'long-call' && position && buildLeapsEconomics(position) != null) return 'LEAPS';
  return labels[role];
}

export function buildOptionInstrumentViewModel(position: Position): OptionInstrumentViewModel {
  const role = optionInstrumentRole(position);
  const isLong = role === 'long-call' || role === 'long-put' || (role === 'multi-leg-option-structure' && position.entryPriceEffect === 'Debit');
  const leapsEconomics = role === 'long-call' ? buildLeapsEconomics(position) : null;
  return {
    key: position.key, position, role, roleLabel: roleLabel(role, position),
    midpointLabel: role === 'ambiguous-option-structure'
      ? 'Option midpoint value unavailable'
      : leapsEconomics
        ? 'Estimated Value Now — Mid'
        : isLong
          ? (role === 'multi-leg-option-structure' ? 'Net option value (mid)' : 'Liquidation value (mid)')
          : (role === 'multi-leg-option-structure' ? 'Net buyback obligation (mid)' : 'Buyback obligation (mid)'),
    marketableLabel: leapsEconomics ? 'Estimated Sell-Now Value' : isLong ? 'Marketable sell value' : 'Marketable buyback cost',
    leapsEconomics,
  };
}

export function classifySymbolComposition(equities: readonly EquityHolding[], options: readonly OptionInstrumentViewModel[]): SymbolAssetComposition {
  if (options.some(option => option.role === 'ambiguous-option-structure')) return 'ambiguous';
  if (equities.length > 0 && options.length > 0) return 'equity-and-options';
  if (equities.length > 0) return 'equity-only';
  const long = options.some(option => option.role === 'long-call' || option.role === 'long-put' || option.position.entryPriceEffect === 'Debit');
  const short = options.some(option => option.role === 'short-call' || option.role === 'short-put' || option.position.entryPriceEffect === 'Credit');
  return long && short ? 'mixed-options' : long ? 'long-option-only' : short ? 'short-option-only' : 'ambiguous';
}

export function compositionLabel(composition: SymbolAssetComposition, equities: readonly EquityHolding[], options: readonly OptionInstrumentViewModel[]): string {
  if (composition === 'equity-only') return equities.length === 1 ? (equities[0].direction === 'Long' ? 'Equity' : 'Short equity') : 'Equity holdings';
  if (composition === 'long-option-only' && options.length === 1) return options[0].roleLabel;
  if (composition === 'short-option-only' && options.length === 1) return options[0].roleLabel;
  if (composition === 'equity-and-options') return `Equity + ${options.map(option => option.roleLabel.toLowerCase()).join(', ')}`;
  return composition === 'ambiguous' ? 'Structure unresolved' : 'Mixed instruments';
}

export function optionMidpointValue(position: Position): number | null { return position.currentValue != null && Number.isFinite(position.currentValue) ? position.currentValue : null; }

export function aggregatePnlPercentage(equities: readonly EquityHolding[], options: readonly Position[]): { value: number | null; reason: string | null } {
  const hasEquity = equities.length > 0; const effects = new Set(options.map(option => option.entryPriceEffect));
  if ((hasEquity && options.length > 0) || effects.size > 1) return { value: null, reason: 'Percentage not comparable across mixed structures' };
  if (hasEquity) {
    if (equities.some(item => !item.basisComplete || item.basis == null || item.unrealizedPnl == null)) return { value: null, reason: 'Complete equity basis and P/L required' };
    const numerator = equities.reduce((sum, item) => sum + item.unrealizedPnl!, 0);
    const denominator = equities.reduce((sum, item) => sum + Math.abs(item.basis! * item.quantity), 0);
    return denominator > 0 ? { value: numerator / denominator * 100, reason: null } : { value: null, reason: 'Positive equity basis required' };
  }
  if (options.some(item => item.pnl == null || item.entryEconomicsComplete !== true || item.entryCredit == null || item.entryCredit <= 0)) return { value: null, reason: 'Complete option entry economics and midpoint P/L required' };
  const numerator = options.reduce((sum, item) => sum + item.pnl!, 0); const denominator = options.reduce((sum, item) => sum + item.entryCredit!, 0);
  return denominator > 0 ? { value: numerator / denominator * 100, reason: null } : { value: null, reason: 'Positive opening premium required' };
}