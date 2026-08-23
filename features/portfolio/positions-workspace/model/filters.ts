import type { PositionAnalysisFilters, PositionAnalysisRowViewModel } from './types';

export const DEFAULT_FILTERS: PositionAnalysisFilters = { symbol: '', strategy: '', attention: 'all', pnl: 'all' };

export function activeFilterCount(filters: PositionAnalysisFilters): number {
  return Number(Boolean(filters.symbol.trim())) + Number(Boolean(filters.strategy.trim())) + Number(filters.attention !== 'all') + Number(filters.pnl !== 'all');
}

export function matchesAnalysisFilters(row: PositionAnalysisRowViewModel, filters: PositionAnalysisFilters): boolean {
  const symbol = filters.symbol.trim().toUpperCase();
  const strategy = filters.strategy.trim().toLowerCase();
  if (symbol && !row.symbol.toUpperCase().includes(symbol)) return false;
  if (strategy && !row.strategy.toLowerCase().includes(strategy)) return false;
  if (filters.attention === 'attention' && !row.needsAttention) return false;
  if (filters.attention === 'monitoring' && row.needsAttention) return false;
  const pnl = row.position.closeNowPnl ?? row.position.pnl;
  if (filters.pnl === 'unavailable' && pnl != null) return false;
  if (filters.pnl === 'positive' && (pnl == null || pnl < 0)) return false;
  if (filters.pnl === 'negative' && (pnl == null || pnl >= 0)) return false;
  return true;
}
