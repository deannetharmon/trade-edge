// lib/market-movers/types.ts

// MARKET-MOVERS-0001 slice A: pure types. This folder must not import scoring or qualification modules (import-boundary test).

export type GateStatus = 'GO' | 'AMBER' | 'NO_GO';
export type GateId = 'macro' | 'vix' | 'volume';

export interface Gate {
  id: GateId;
  status: GateStatus;
  /** One plain sentence shown on the tile. */
  reason: string;
}

export type MacroEventKind = 'FOMC' | 'CPI' | 'JOBS';

export interface MacroEvent {
  /** Calendar date, YYYY-MM-DD (New York date). */
  date: string;
  kind: MacroEventKind;
}

export interface MarketMoversSettings {
  macroToggles: { FOMC: boolean; CPI: boolean; JOBS: boolean; JOBLESS_CLAIMS: boolean };
  vixNoGoLevel: number;
  vixNoGoDayChangePct: number;
  vixAmberLevel: number;
  volumeNoGoMultiple: number;
  minDropPct: number;
  minIvPct: number;
  targetDte: number;
  targetReturnPct: number;
}

export const DEFAULT_MARKET_MOVERS_SETTINGS: MarketMoversSettings = {
  macroToggles: { FOMC: true, CPI: true, JOBS: true, JOBLESS_CLAIMS: true },
  vixNoGoLevel: 30,
  vixNoGoDayChangePct: 10,
  vixAmberLevel: 20,
  volumeNoGoMultiple: 2,
  minDropPct: 5,
  minIvPct: 50,
  targetDte: 30,
  targetReturnPct: 5,
};

export interface TickerInput {
  symbol: string;
  last: number | null;
  priorClose: number | null;
  /** IV as a percent (62 = 62%). Null when the broker gave none. */
  ivPct: number | null;
  volume: number | null;
  avgVolume20: number | null;
}

export type CandidateStatus = 'PICK_ELIGIBLE' | 'WATCH' | 'EXCLUDED';

export interface Candidate {
  symbol: string;
  dayChangePct: number | null;
  ivPct: number | null;
  volumeMultiple: number | null;
  status: CandidateStatus;
  /** Why a ticker is a watch item or excluded; empty for an eligible pick. */
  reason: string;
}

export interface PutQuote {
  expiration: string; // YYYY-MM-DD
  dte: number; // calendar days
  strike: number;
  bid: number;
  ask: number;
  delta?: number | null;
}

export interface PutPick {
  put: PutQuote;
  capital: number;
  midCredit: number;
  midReturnPct: number;
  bidReturnPct: number;
  /** Absolute gap between the mid return and the target, in percentage points. */
  gapToTargetPct: number;
}
