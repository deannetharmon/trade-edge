import { columnsForView, sanitizeColumns } from './columns';
import { DEFAULT_FILTERS } from './filters';
import type { AnalysisViewId, PositionAnalysisFilters, PositionsWorkspaceView } from './types';

export const POSITIONS_WORKSPACE_PREFERENCES_KEY = 'tradeedge:positions-workspace:preferences:v1';

export interface PositionsWorkspacePreferencesV1 {
  version: 1;
  workspaceView: PositionsWorkspaceView;
  analysisView: AnalysisViewId;
  filters: PositionAnalysisFilters;
  customColumnIds: ReturnType<typeof sanitizeColumns>;
}

export const DEFAULT_PREFERENCES: PositionsWorkspacePreferencesV1 = {
  version: 1,
  workspaceView: 'portfolio',
  analysisView: 'management',
  filters: DEFAULT_FILTERS,
  customColumnIds: columnsForView('management'),
};

export function decodePreferences(raw: string | null): PositionsWorkspacePreferencesV1 {
  if (!raw) return DEFAULT_PREFERENCES;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version !== 1) return DEFAULT_PREFERENCES;
    const workspaceView = value.workspaceView === 'analysis' ? 'analysis' : 'portfolio';
    const analysisView: AnalysisViewId = value.analysisView === 'risk' || value.analysisView === 'full' || value.analysisView === 'custom' ? value.analysisView : 'management';
    const source = value.filters && typeof value.filters === 'object' ? value.filters as Record<string, unknown> : {};
    const filters: PositionAnalysisFilters = {
      symbol: typeof source.symbol === 'string' ? source.symbol : '',
      strategy: typeof source.strategy === 'string' ? source.strategy : '',
      attention: source.attention === 'attention' || source.attention === 'monitoring' ? source.attention : 'all',
      pnl: source.pnl === 'positive' || source.pnl === 'negative' || source.pnl === 'unavailable' ? source.pnl : 'all',
    };
    return { version: 1, workspaceView, analysisView, filters, customColumnIds: sanitizeColumns(value.customColumnIds) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function loadPreferences(): PositionsWorkspacePreferencesV1 {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try { return decodePreferences(window.localStorage.getItem(POSITIONS_WORKSPACE_PREFERENCES_KEY)); }
  catch { return DEFAULT_PREFERENCES; }
}

export function savePreferences(value: PositionsWorkspacePreferencesV1): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(POSITIONS_WORKSPACE_PREFERENCES_KEY, JSON.stringify(value)); } catch { /* UI preferences never block holdings. */ }
}
