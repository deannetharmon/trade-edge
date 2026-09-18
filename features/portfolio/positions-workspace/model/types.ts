import type { Position, PendingOrder } from '@/lib/portfolio-data/types';
import type { EquityHolding, PortfolioSnapshot, SnapshotDataQuality } from '@/lib/portfolio-snapshot/types';

export type PositionsWorkspaceView = 'portfolio' | 'analysis';
export type AnalysisViewId = 'management' | 'risk' | 'full' | 'custom';
export type AnalysisColumnId =
  | 'identity' | 'dates' | 'underlying' | 'strike' | 'capital' | 'entry'
  | 'value' | 'pnl' | 'evolution' | 'movement' | 'greeks' | 'volatility'
  | 'orders' | 'recommendation';

export interface PositionAnalysisFilters {
  symbol: string;
  strategy: string;
  attention: 'all' | 'attention' | 'monitoring';
  pnl: 'all' | 'positive' | 'negative' | 'unavailable';
}

export interface CapacityViewModel {
  status: 'ok' | 'unavailable';
  sharesOwned: number;
  allocatedContracts: number;
  reservedContracts: number;
  availableContracts: number;
  remainderShares: number;
  basisComplete: boolean;
  blockingReason: string | null;
}

export interface SymbolGroupViewModel {
  symbol: string;
  underlyingPrice: number | null;
  equityMarketValue: number | null;
  optionMarketValue: number | null;
  symbolUnrealizedPnl: number | null;
  equities: EquityHolding[];
  options: Position[];
  instrumentCount: number;
  strategies: string[];
  capacity: CapacityViewModel;
  needsAttention: boolean;
  contextualAction: 'covered-call' | 'short-call' | 'replacement' | null;
}

export interface PositionAnalysisRowViewModel {
  id: string;
  position: Position;
  symbol: string;
  strategy: string;
  needsAttention: boolean;
}

export interface PositionsWorkspaceModel {
  snapshotAsOf: string | null;
  quoteAsOf: string | null;
  dataQuality: SnapshotDataQuality;
  symbolGroups: SymbolGroupViewModel[];
  analysisRows: PositionAnalysisRowViewModel[];
}

export interface PositionsWorkspaceInput {
  snapshot: PortfolioSnapshot | null;
  positions: Position[];
  pendingOrders: PendingOrder[];
  snapshotDataQuality: SnapshotDataQuality;
}
