// lib/scans/constants.ts
// Mechanically extracted from app/screener/page.tsx (TE-0005A). Verbatim — not rewritten.

export const INDEX_IVR_MIN = 15;


export const RANK_SCAN_DTE_MIN = 7;
export const RANK_SCAN_DTE_MAX = 60;


export const ESTIMATED_EARNINGS_CYCLE_DAYS = 91; // ~13 weeks / one reporting cycle


export const DEFAULT_RULES = {
  IVR_MIN: 30, IVR_IC_MAX: 70, OI_MIN: 500, BID_ASK_MAX: 0.10,
  CREDIT_RATIO_MIN: 0.33, SPREAD_DELTA_MIN: 0.20, SPREAD_DELTA_MAX: 0.30,
  IC_DELTA_MIN: 0.16, IC_DELTA_MAX: 0.20, DTE_MIN: 30, DTE_MAX: 45,
  MAX_SPREAD_WIDTH: 100, ROC_MIN_SPREAD: 20, ROC_MIN_IC: 30, POP_MIN: 65,
};
export type RulesType = typeof DEFAULT_RULES;


export const DEFAULT_ETF_RULES: RulesType = {
  IVR_MIN: 15, IVR_IC_MAX: 70, OI_MIN: 100, BID_ASK_MAX: 0.25,
  CREDIT_RATIO_MIN: 0.20, SPREAD_DELTA_MIN: 0.15, SPREAD_DELTA_MAX: 0.35,
  IC_DELTA_MIN: 0.15, IC_DELTA_MAX: 0.25, DTE_MIN: 30, DTE_MAX: 45,
  MAX_SPREAD_WIDTH: 500, ROC_MIN_SPREAD: 15, ROC_MIN_IC: 20, POP_MIN: 65,
};


export const YAHOO_INDEX_CHART_MAP: Record<string, string> = { SPX: '^GSPC', SPXW: '^GSPC', NDX: '^NDX', RUT: '^RUT', VIX: '^VIX', DJX: '^DJI' };


export const BASE = 'https://api.tastytrade.com';
export const CLIENT_ID = '4d4c851b-bdaf-4ac9-b39b-811e604739f2';


export const LS_ACCESS_TOKEN = 'tt_access_token_cache';
export const LS_ACCESS_TOKEN_EXPIRY = 'tt_access_token_expiry';


