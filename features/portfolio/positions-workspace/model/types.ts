import type { Position, PendingOrder } from '@/lib/portfolio-data/types';
import type { EquityHolding, PortfolioSnapshot, SnapshotDataQuality } from '@/lib/portfolio-snapshot/types';

export type PositionsWorkspaceView = 'portfolio' | 'analysis';
export type AnalysisViewId = 'management' | 'risk' | 'full' | 'custom';
export type AnalysisColumnId =
  | 'identity' | 'dates' | 'underlying' | 'strike' | 'capital' | 'entry'
  | 'value' | 'pnl' | 'evolution' | 'greeks' | 'netEdge' | 'volatility'
  | 'orders' | 'notes' | 'recommendation';

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
  unallocatedShares: number;
}

export type SymbolAssetComposition = 'equity-only' | 'long-option-only' | 'short-option-only' | 'mixed-options' | 'equity-and-options' | 'ambiguous';
export type InstrumentRole = 'long-equity' | 'short-equity' | 'long-call' | 'long-put' | 'short-call' | 'short-put' | 'multi-leg-option-structure' | 'ambiguous-option-structure';
export interface FinancialAggregate {
  value: number | null;
  completeness: 'complete' | 'partial' | 'unavailable' | 'not-applicable';
  includedCount: number;
  expectedCount: number;
  excludedInstrumentKeys: string[];
  reasons: string[];
  basis: 'mark-mid' | 'marketable-close' | 'mixed' | null;
  asOf: string | null;
}
export interface OptionInstrumentViewModel {
  key: string;
  position: Position;
  role: InstrumentRole;
  roleLabel: string;
  midpointLabel: string;
  marketableLabel: string;
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
  composition: SymbolAssetComposition;
  compositionLabel: string;
  equityMarketValueAggregate: FinancialAggregate;
  longOptionValueMid: FinancialAggregate;
  optionBuybackMid: FinancialAggregate;
  optionMarketableClose: FinancialAggregate;
  unrealizedPnlMid: FinancialAggregate;
  optionCloseNowPnl: FinancialAggregate;
  unrealizedPnlPct: number | null;
  unrealizedPnlPctReason: string | null;
  optionInstruments: OptionInstrumentViewModel[];
}

export interface PositionAnalysisRowViewModel {
  id: string;
  position: Position;
  symbol: string;
  strategy: string;
  needsAttention: boolean;
}

export type ExistingIncomeOpportunityKind = 'pmcc-short-call' | 'covered-call';
export type ExistingIncomeOpportunityStatus = 'eligible' | 'no-capacity' | 'not-eligible' | 'unavailable';

/**
 * A portfolio-first, review-only income opportunity. This deliberately does
 * not assert that writing a call is attractive; timing policy is evaluated in
 * a later approved slice.
 */
export interface ExistingIncomeOpportunity {
  id: string;
  kind: ExistingIncomeOpportunityKind;
  status: ExistingIncomeOpportunityStatus;
  symbol: string;
  positionKey: string | null;
  title: string;
  reason: string;
  freshness: string;
  exactContract: string | null;
  sharesOwned: number | null;
  allocatedContracts: number | null;
  reservedContracts: number | null;
  availableContracts: number | null;
}

export interface PositionsWorkspaceModel {
  accountNumber: string | null;
  snapshotAsOf: string | null;
  quoteAsOf: string | null;
  dataQuality: SnapshotDataQuality;
  symbolGroups: SymbolGroupViewModel[];
  analysisRows: PositionAnalysisRowViewModel[];
  incomeOpportunities?: ExistingIncomeOpportunity[];
}

export interface PositionsWorkspaceInput {
  snapshot: PortfolioSnapshot | null;
  positions: Position[];
  pendingOrders: PendingOrder[];
  snapshotDataQuality: SnapshotDataQuality;
}
