import type { PositionAnalysisFilters, PositionAnalysisRowViewModel } from './types';

export const DEFAULT_FILTERS: PositionAnalysisFilters = { symbol: '', strategy: '', attention: 'all', pnl: 'all' };

/** FILTER-0002: the Symbol filter takes several tickers separated by spaces and/or commas. Upper-cased, de-duplicated, empties dropped. */
export function parseSymbolList(input: string): string[] {
  return Array.from(new Set(input.split(/[\s,]+/).map(token => token.trim().toUpperCase()).filter(Boolean)));
}

/** FILTER-0002: the strategies currently present in the rows, sorted, for the Strategy dropdown. Case-insensitive de-dup; first spelling wins. */
export function strategyOptions(rows: Pick<PositionAnalysisRowViewModel, 'strategy'>[], selected = ''): string[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const label = row.strategy?.trim();
    if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
  }
  // A strategy saved from an earlier session that no longer has any positions stays selectable so the control never shows a value it cannot display.
  const keep = selected.trim();
  if (keep && !seen.has(keep.toLowerCase())) seen.set(keep.toLowerCase(), keep);
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
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
  if (filters.attention === 'attention' && !row.needsAttention) return false;
  if (filters.attention === 'monitoring' && row.needsAttention) return false;
  const pnl = row.position.closeNowPnl ?? row.position.pnl;
  if (filters.pnl === 'unavailable' && pnl != null) return false;
  if (filters.pnl === 'positive' && (pnl == null || pnl < 0)) return false;
  if (filters.pnl === 'negative' && (pnl == null || pnl >= 0)) return false;
  return true;
}
