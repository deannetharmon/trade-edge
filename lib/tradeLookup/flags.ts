// lib/tradeLookup/flags.ts

// TRADE-LOOKUP-0001C: advisory flags on lookup rows. Pure. A flag is a heads-up only: it never blocks a row,
// disables Select, or feeds a score ("trust the qualified realm" does not apply here because the lookup
// shows contracts the scans never qualified, so the trader sees where each one sits against their own rules).
//
// No new numbers and no new formulas. Thresholds are the scan defaults (DEFAULT_CSP_RULES / DEFAULT_CC_RULES),
// and the caller can pass the live scan controls instead. The checks are the scans' own:
//   delta band     |delta| outside DELTA_MIN..DELTA_MAX
//   bid/ask        CSP: classifyCspLiquidity (relative policy); CC: evaluateHybridSpread (hybrid width + ceiling)
//   open interest  assessOiLiquidity (low OI is disclosed, never a hard fail)
//   cost basis     CC only: strike below the broker cost basis, when every lot has a basis
// There is no DTE flag: the 21-DTE rule does not apply to CSP and CC (DECIDE-0001).

import { DEFAULT_CC_RULES, DEFAULT_CSP_RULES } from '@/lib/scans/constants';
import { classifyCspLiquidity } from '@/lib/scans/cspQualification';
import { evaluateHybridSpread } from '@/lib/scans/hybridSpread';
import { assessOiLiquidity } from '@/lib/scans/oiLiquidity';
import type { LookupResult, LookupRow, RowFlag } from './lookupTypes';
import type { LookupStrategy } from './types';

export interface FlagRules {
  deltaMin: number;
  deltaMax: number;
  oiMin: number;
  /** Covered calls only: hybrid width rule inputs. */
  ccWidthPctMax: number;
  ccWidthCeiling: number;
}

export function defaultFlagRules(strategy: LookupStrategy): FlagRules {
  if (strategy === 'CSP') {
    return {
      deltaMin: DEFAULT_CSP_RULES.DELTA_MIN,
      deltaMax: DEFAULT_CSP_RULES.DELTA_MAX,
      oiMin: DEFAULT_CSP_RULES.OI_MIN,
      ccWidthPctMax: DEFAULT_CC_RULES.WIDTH_PCT_MAX,
      ccWidthCeiling: DEFAULT_CC_RULES.WIDTH_CEILING,
    };
  }
  return {
    deltaMin: DEFAULT_CC_RULES.DELTA_MIN,
    deltaMax: DEFAULT_CC_RULES.DELTA_MAX,
    oiMin: DEFAULT_CC_RULES.OI_MIN,
    ccWidthPctMax: DEFAULT_CC_RULES.WIDTH_PCT_MAX,
    ccWidthCeiling: DEFAULT_CC_RULES.WIDTH_CEILING,
  };
}

function fmtDelta(n: number): string {
  return n.toFixed(2);
}

export function flagRow(row: LookupRow, strategy: LookupStrategy, rules: FlagRules, costBasis: number | null): RowFlag[] {
  const flags: RowFlag[] = [];

  if (row.delta !== null && isFinite(row.delta)) {
    const abs = Math.abs(row.delta);
    if (abs < rules.deltaMin || abs > rules.deltaMax) {
      flags.push({ code: 'delta_outside_band', label: 'Delta ' + fmtDelta(abs) + ' is outside your ' + fmtDelta(rules.deltaMin) + '-' + fmtDelta(rules.deltaMax) + ' band' });
    }
  }

  if (!row.noQuote && row.bid !== null && row.ask !== null && row.mid !== null) {
    const width = row.ask - row.bid;
    if (strategy === 'CSP') {
      const c = classifyCspLiquidity(width, row.mid);
      if (c.liquidityClass !== 'STRONG') {
        flags.push({ code: 'wide_spread', label: 'Bid/ask is ' + (c.liquidityClass === 'POOR' ? 'poor' : 'borderline') + ': $' + width.toFixed(2) + ' wide' });
      }
    } else {
      const h = evaluateHybridSpread(row.bid, row.ask, { rejectPct: rules.ccWidthPctMax, warnPct: Number.NaN, ceiling: rules.ccWidthCeiling });
      if (h.reject) flags.push({ code: 'wide_spread', label: 'Bid/ask is wider than your covered-call limit: $' + width.toFixed(2) + ' wide' });
    }
  }

  if (row.openInterest !== null && isFinite(row.openInterest)) {
    const oi = assessOiLiquidity({ shortOI: row.openInterest, longOI: row.openInterest, oiMin: rules.oiMin });
    if (oi.status === 'warn') flags.push({ code: 'thin_oi', label: 'Open interest ' + row.openInterest + ' is below ' + rules.oiMin });
  }

  if (strategy === 'CC' && costBasis !== null && isFinite(costBasis) && row.strike < costBasis) {
    flags.push({ code: 'below_cost_basis', label: 'Strike ' + row.strike + ' is below your cost basis of $' + costBasis.toFixed(2) });
  }

  return flags;
}

/** Returns a copy of the result with flags on every row (the pick included). */
export function applyFlags(result: LookupResult, rules?: FlagRules, costBasis: number | null = null): LookupResult {
  const strategy = result.contract.strategy;
  const r = rules || defaultFlagRules(strategy);
  const rows = result.rows.map(function (row) {
    return Object.assign({}, row, { flags: flagRow(row, strategy, r, costBasis) });
  });
  const pick = rows.filter(function (x) { return x.isPick; })[0] || null;
  return Object.assign({}, result, { rows, pick });
}
