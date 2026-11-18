// lib/scans/savedRules.ts
//
// The scan criteria a trader saved in the screener (localStorage), moved here verbatim from app/screener/page.tsx so
// Trade Map's Send checks read the same saved values. Defaults fill anything not saved. Browser-only; on the server or
// with storage unavailable it returns the defaults.

import { DEFAULT_ETF_RULES, DEFAULT_RULES, type RulesType } from './constants';

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
