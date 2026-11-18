// lib/scans/savedRules.ts
//
// The scan criteria a trader saved in the screener (localStorage), moved here verbatim from app/screener/page.tsx so
// Trade Map's Send checks read the same saved values. Defaults fill anything not saved. Browser-only; on the server or
// with storage unavailable it returns the defaults.

import { DEFAULT_ETF_RULES, DEFAULT_RULES, type RulesType } from './constants';
import type { RankConfig } from './types';

export const LS_RULES = 'hunter-rules';
export const LS_RULES_ETF = 'hunter-rules-etf';
export const LS_RULES_VERSION = 'hunter-rules-v3'; // bump this when defaults change

export function getSavedRules(): RulesType {
  try {
    if (!localStorage.getItem(LS_RULES_VERSION)) {
      localStorage.removeItem(LS_RULES);
      localStorage.removeItem(LS_RULES_ETF);
      localStorage.setItem(LS_RULES_VERSION, '1');
    }
    const saved = localStorage.getItem(LS_RULES);
    return saved ? { ...DEFAULT_RULES, ...JSON.parse(saved) } : { ...DEFAULT_RULES };
  } catch { return { ...DEFAULT_RULES }; }
}

export function getSavedEtfRules(): RulesType {
  try {
    const saved = localStorage.getItem(LS_RULES_ETF);
    return saved ? { ...DEFAULT_ETF_RULES, ...JSON.parse(saved) } : { ...DEFAULT_ETF_RULES };
  } catch { return { ...DEFAULT_ETF_RULES }; }
}

/** True when any saved value differs from the built-in defaults for that kind of underlying. */
export function hasCustomRules(rules: RulesType, etfOrIndex: boolean): boolean {
  const base = etfOrIndex ? DEFAULT_ETF_RULES : DEFAULT_RULES;
  return (Object.keys(base) as Array<keyof RulesType>).some(k => rules[k] !== base[k]);
}

export const LS_RANK_CONFIG = 'hunter-rank-config';

export const DEFAULT_RANK_CONFIG: RankConfig = {
  weightMomentum: 25, weightIvr: 15, weightEmClearance: 15, weightRange: 15, weightTechnical: 10, weightLiquidity: 10, weightBuffer: 10,
  dteSweetSpot: 38, dteRange: 7,
  thresholdGreen: 75, thresholdYellow: 55, thresholdOrange: 35,
  weightCredit: 25, weightRoc: 20, weightPop: 15, weightDte: 15,
};

/** The ranking weights a trader saved in the screener (localStorage); defaults fill anything not saved. */
export function getSavedRankConfig(): RankConfig {
  try { const s = localStorage.getItem(LS_RANK_CONFIG); return s ? { ...DEFAULT_RANK_CONFIG, ...JSON.parse(s) } : { ...DEFAULT_RANK_CONFIG }; }
  catch { return { ...DEFAULT_RANK_CONFIG }; }
}
