import type { PositionAnalysisFilters, PositionAnalysisRowViewModel } from './types';
import { matchesStrategyChip } from './strategyChips';

export const DEFAULT_FILTERS: PositionAnalysisFilters = { symbol: '', strategy: '', chip: 'all', attention: 'all', pnl: 'all' };

/** FILTER-0002: the Symbol filter takes several tickers separated by spaces and/or commas. Upper-cased, de-duplicated, empties dropped. */
export function parseSymbolList(input: string): string[] {
  return Array.from(new Set(input.split(/[\s,]+/).map(token => token.trim().toUpperCase()).filter(Boolean)));
}

export function activeFilterCount(filters: PositionAnalysisFilters): number {
  return Number(parseSymbolList(filters.symbol).length > 0) + Number(Boolean(filters.strategy.trim())) + Number(filters.attention !== 'all') + Number(filters.pnl !== 'all');
}

export function matchesAnalysisFilters(row: PositionAnalysisRowViewModel, filters: PositionAnalysisFilters): boolean {
  const symbols = parseSymbolList(filters.symbol);
  const strategy = filters.strategy.trim().toLowerCase();
  // FILTER-0002: exact ticker match against any listed symbol (so "SO" no longer matches SOXL), and exact strategy match (so "CC" no longer matches PMCC).
  if (symbols.length > 0 && !symbols.includes(row.symbol.trim().toUpperCase())) return false;
  if (strategy && row.strategy.trim().toLowerCase() !== strategy) return false;
  if (!matchesStrategyChip(row.position, filters.chip ?? 'all')) return false;
  if (filters.attention === 'attention' && !row.needsAttention) return false;
  if (filters.attention === 'monitoring' && row.needsAttention) return false;
  const pnl = row.position.closeNowPnl ?? row.position.pnl;
  if (filters.pnl === 'unavailable' && pnl != null) return false;
  if (filters.pnl === 'positive' && (pnl == null || pnl < 0)) return false;
  if (filters.pnl === 'negative' && (pnl == null || pnl >= 0)) return false;
  return true;
}
