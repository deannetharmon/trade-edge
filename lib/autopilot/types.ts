// lib/autopilot/types.ts

export type AutopilotStrategy = 'BPS' | 'BCS' | 'IC' | 'CSP' | 'CC';
export type AutopilotGoal = 'conserve' | 'income' | 'acquire' | 'maximize';
export type PortfolioRiskPosture = 'conserve' | 'steady' | 'maximize';
export type PaperPositionStatus = 'open' | 'closed' | 'rolled' | 'blocked' | 'review_required';
export type AutopilotDecisionAction =
  | 'open_paper_position'
  | 'close_paper_position'
  | 'roll_paper_position'
  | 'suppress_entry'
  | 'manage_only'
  | 'unlock_shares'
  | 'no_action'
  | 'manual_review';

export interface AutopilotThresholds {
  perTradeMaxLossPctEquity: number;
  dailyLossPausePct: number;
  monthlyDrawdownDefensivePct: number;
  bpUtilizationMaxPct: number;
  bpUtilizationHighVixPct: number;
  singleTickerMaxPct: number;
  sectorMaxPct: number;
  maxEntriesPerDay: number;
  maxEntriesPerWeek: number;
  correlationSkipThreshold: number;
  ccIvrReplacementYieldPct: number;
  netEdgeFadeOffPeakPct: number;
  decisionConfidenceMinimum: number;
}

export interface AutopilotConfig {
  perStrategyGoal: Record<AutopilotStrategy, AutopilotGoal>;
  portfolioRiskPosture: PortfolioRiskPosture;
  thresholds: AutopilotThresholds;
  ccStockManagement: 'never-sell-escalate-on-thesis-break';
  killSwitchEnabled: boolean;
  updatedAt: string;
}

export interface AutopilotLeg {
  symbol: string;
  optionSymbol?: string;
  underlyingSymbol: string;
  assetType: 'stock' | 'option';
  direction: 'long' | 'short';
  optionType?: 'call' | 'put';
  strike?: number;
  expiration?: string;
  quantity: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  bid?: number;
  ask?: number;
  mid?: number;
  quoteTimestamp?: string; // ISO timestamp of when bid/ask/mid were actually fetched, if known
}

export interface AutopilotDecisionLogEntry {
  id: string;
  timestamp: string;
  strategy?: AutopilotStrategy;
  symbol?: string;
  action: AutopilotDecisionAction;
  opportunityScore?: number;
  decisionConfidence?: number;
  reason: string;
  rulesTriggered: string[];
  rulesBlocked: string[];
  configSnapshot: AutopilotConfig;
  metadata?: Record<string, unknown>;
}

export interface PaperPosition {
  id: string;
  strategy: AutopilotStrategy;
  symbol: string;
  legs: AutopilotLeg[];
  entryDate: string;
  entryCredit: number;
  simulatedFillPrice: number;
  theoreticalMaxLoss: number;
  status: PaperPositionStatus;
  managementLog: AutopilotDecisionLogEntry[];
  closedDate?: string;
  closeCredit?: number;
  realizedPnl?: number;
  goalAtEntry: AutopilotGoal;
  decisionConfidenceAtEntry: number;
  opportunityScoreAtEntry: number;
}

export interface PaperEquityPoint {
  date: string;
  equity: number;
}

export interface PaperAccount {
  userId: string;
  startingBalance: number;
  currentBalance: number;
  peakBalance: number;
  openPositions: PaperPosition[];
  closedPositions: PaperPosition[];
  dailyEquityCurve: PaperEquityPoint[];
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  liveBuyingPowerSnapshot?: number;
}

export interface AutopilotCandidate {
  id: string;
  strategy: AutopilotStrategy;
  symbol: string;
  underlyingPrice: number;
  legs: AutopilotLeg[];
  estimatedCredit: number;
  theoreticalMaxLoss: number;
  pop?: number;
  roc?: number;
  ivr?: number;
  annualizedYield?: number;
  technicalFit?: number;
  goalAlignment?: number;
  correlationPenalty?: number;
  concentrationPenalty?: number;
  betaWeightedDelta?: number;
  sector?: string;
  notes?: string[];
}

export interface ConfidenceInputLeg {
  bidAskSpread: number;
  averageBidAskSpread20: number;
  quoteTimestamp?: string;
}

export interface DecisionConfidenceInput {
  legs: ConfidenceInputLeg[];
  now?: Date;
  nextMacroEventAt?: string | null;
  hardMacroGateHours?: number;
  vixNow?: number;
  vixThirtyMinutesAgo?: number;
  underlyingIvNow?: number;
  underlyingIvThirtyMinutesAgo?: number;
}

export interface DecisionConfidenceBreakdown {
  total: number;
  liquidityScore: number;
  latencyScore: number;
  macroProximityScore: number;
  volatilityStabilityScore: number;
  notes: string[];
}

export interface OpportunityScoreBreakdown {
  total: number;
  edgeScore: number;
  goalAlignmentFactor: number;
  riskContributionPenalty: number;
  postureMultiplier: number;
  notes: string[];
}

export interface AutopilotRunResult {
  runId: string;
  timestamp: string;
  userId: string;
  scannedCandidates: number;
  openedPositions: number;
  suppressedCandidates: number;
  decisions: AutopilotDecisionLogEntry[];
  account: PaperAccount;
}
