import type { AnalysisColumnId, AnalysisViewId } from './types';

export const ANALYSIS_COLUMNS: ReadonlyArray<{ id: AnalysisColumnId; label: string; group: string }> = [
  { id: 'identity', label: 'Position', group: 'Position' },
  { id: 'dates', label: 'Entry / Expiry / DTE', group: 'Position' },
  { id: 'underlying', label: 'Price / Strike Distance', group: 'Position' },
  { id: 'strike', label: 'Strike Gap', group: 'Position' },
  { id: 'capital', label: 'Capital', group: 'Economics' },
  { id: 'entry', label: 'Credit / Debit', group: 'Economics' },
  { id: 'value', label: 'Buyback / Value', group: 'Economics' },
  { id: 'pnl', label: 'Open P/L / Target', group: 'Economics' },
  { id: 'evolution', label: 'Trade Evolution', group: 'Movement' },
  { id: 'greeks', label: 'Greeks', group: 'Risk & Greeks' },
  { id: 'volatility', label: 'IV / IVR', group: 'Risk & Greeks' },
  { id: 'orders', label: 'GTC / Stop', group: 'Orders' },
  { id: 'notes', label: 'Notes', group: 'Position' },
  { id: 'recommendation', label: 'Suggested action', group: 'Recommendation' },
] as const;

const MANAGEMENT: AnalysisColumnId[] = ['identity', 'dates', 'underlying', 'strike', 'capital', 'entry', 'value', 'pnl', 'orders', 'notes', 'recommendation'];
const RISK: AnalysisColumnId[] = ['identity', 'dates', 'underlying', 'strike', 'pnl', 'evolution', 'greeks', 'volatility', 'notes', 'recommendation'];
const FULL = ANALYSIS_COLUMNS.map(column => column.id);

export function columnsForView(view: Exclude<AnalysisViewId, 'custom'>): AnalysisColumnId[] {
  return view === 'management' ? [...MANAGEMENT] : view === 'risk' ? [...RISK] : [...FULL];
}

export function sanitizeColumns(value: unknown): AnalysisColumnId[] {
  if (!Array.isArray(value)) return columnsForView('management');
  const valid = new Set(ANALYSIS_COLUMNS.map(column => column.id));
  const selected = Array.from(new Set(value.filter((id): id is AnalysisColumnId => typeof id === 'string' && valid.has(id as AnalysisColumnId))));
  if (!selected.includes('identity')) selected.unshift('identity');
  return selected.length >= 2 ? selected : columnsForView('management');
}
