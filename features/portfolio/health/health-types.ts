// features/portfolio/health/health-types.ts

export type PositionHealthGrade = 'excellent' | 'good' | 'watch' | 'action' | 'critical';
export type PositionHealthSeverity = 'positive' | 'neutral' | 'watch' | 'warning' | 'critical';
export type PositionHealthStrategy = 'credit-spread' | 'cash-secured-put' | 'covered-call' | 'short-call' | 'long-shares' | 'other';

export interface PositionHealthFactor {
  key: string;
  label: string;
  scoreImpact: number;
  severity: PositionHealthSeverity;
  message: string;
}

export interface PositionHealthScore {
  positionId: string;
  symbol: string;
  score: number;
  grade: PositionHealthGrade;
  summary: string;
  factors: PositionHealthFactor[];
  computedAt: string;
}

export interface PositionHealthLegInput {
  optionType?: 'P' | 'C' | string;
  direction?: 'Short' | 'Long' | string;
  strikePrice?: number | null;
  quantity?: number | null;
}

export interface PositionHealthInput {
  positionId?: string;
  key?: string;
  symbol: string;
  strategy?: string | null;
  lifecycleType?: string | null;
  dte?: number | null;
  entryDte?: number | null;
  pnlPct?: number | null;
  pnl?: number | null;
  creditReceived?: number | null;
  currentValue?: number | null;
  hitTarget?: boolean | null;
  needsClose?: boolean | null;
  ivr?: number | null;
  iv?: number | null;
  hv30?: number | null;
  netDelta?: number | null;
  delta?: number | null;
  theta?: number | null;
  gamma?: number | null;
  pop?: number | null;
  buffer?: number | null;
  stockPrice?: number | null;
  earningsDate?: string | null;
  expDate?: string | null;
  hasGtc?: boolean | null;
  stopLossStatus?: string | null;
  legs?: PositionHealthLegInput[];
}
