// lib/trademap/ruleChecks.ts
//
// ORDER-SEND-0001 S3b (Ian: option 1): the Prosper rule checks shown at Send, computed from Trade Map data
// with the screener's own constants (DEFAULT_RULES, DEFAULT_ETF_RULES, INDEX_IVR_MIN) and its own earnings
// check (buildRankEarningsCheck), so the criteria live in one place. They use the default rules; a trader's
// custom scan settings are not known here, and the dialog says so. Badges inform: a failed check needs an
// acknowledgement at Send, a warning does not. Pure; no I/O.

import { DEFAULT_ETF_RULES, DEFAULT_RULES, INDEX_IVR_MIN, type RulesType } from '@/lib/scans/constants';
import { buildRankEarningsCheck } from '@/lib/scans/rankChecks';

export type RuleStatus = 'pass' | 'fail' | 'warn';

export interface RuleCheck {
  key: 'ivr' | 'dte' | 'delta' | 'earnings' | 'roc' | 'oi';
  label: string;
  status: RuleStatus;
  /** What the trade has, for example "IV rank 38". */
  value: string;
  /** The rule, for example "rule: at least 30". */
  rule: string;
}

export interface RuleCheckInput {
  strategy: 'bps' | 'bcs' | 'ic';
  symbol: string;
  dte: number;
  ivRankPct: number | null;
  /** Absolute delta of each short leg. */
  shortDeltas: Array<number | null>;
  /** Open interest of each short leg. */
  shortOis: Array<number | null>;
  earningsDate: string | null;
  expiration: string;
  /** Net credit per share and the widest wing per share. */
  credit: number;
  width: number;
}

const INDEX_SYMBOLS = ['SPX', 'SPXW', 'XSP', 'NDX', 'RUT', 'DJX', 'VIX'];

export function isIndexSymbol(symbol: string): boolean {
  return INDEX_SYMBOLS.indexOf(symbol.toUpperCase()) >= 0;
}

export function rulesFor(symbol: string): RulesType {
  return isIndexSymbol(symbol) ? DEFAULT_ETF_RULES : DEFAULT_RULES;
}

const f0 = (n: number) => n.toFixed(0);
const f2 = (n: number) => n.toFixed(2);

export function evaluateRuleChecks(i: RuleCheckInput): RuleCheck[] {
  const index = isIndexSymbol(i.symbol);
  const rules = rulesFor(i.symbol);
  const ic = i.strategy === 'ic';
  const out: RuleCheck[] = [];

  // IV rank (fail closed when missing)
  const ivrMin = index ? INDEX_IVR_MIN : rules.IVR_MIN;
  const ivrRule = ic ? `rule: ${ivrMin} to ${rules.IVR_IC_MAX}` : `rule: at least ${ivrMin}`;
  if (i.ivRankPct == null) out.push({ key: 'ivr', label: 'IV rank', status: 'fail', value: 'IV rank unavailable', rule: ivrRule });
  else {
    const ok = i.ivRankPct >= ivrMin && (!ic || i.ivRankPct <= rules.IVR_IC_MAX);
    out.push({ key: 'ivr', label: 'IV rank', status: ok ? 'pass' : 'fail', value: `IV rank ${f0(i.ivRankPct)}`, rule: ivrRule });
  }

  // DTE window
  const dteOk = i.dte >= rules.DTE_MIN && i.dte <= rules.DTE_MAX;
  out.push({ key: 'dte', label: 'Days to expiry', status: dteOk ? 'pass' : 'fail', value: `${i.dte} DTE`, rule: `rule: ${rules.DTE_MIN} to ${rules.DTE_MAX}` });

  // Short delta band (every short leg)
  const dMin = ic ? rules.IC_DELTA_MIN : rules.SPREAD_DELTA_MIN;
  const dMax = ic ? rules.IC_DELTA_MAX : rules.SPREAD_DELTA_MAX;
  const deltas = i.shortDeltas.map(d => (d == null ? null : Math.abs(d)));
  const deltaKnown = deltas.length > 0 && deltas.every(d => d != null);
  const deltaOk = deltaKnown && deltas.every(d => (d as number) >= dMin - 1e-9 && (d as number) <= dMax + 1e-9);
  out.push({
    key: 'delta', label: 'Short delta', status: deltaOk ? 'pass' : 'fail',
    value: deltaKnown ? `delta ${deltas.map(d => f2(d as number)).join(' / ')}` : 'delta unavailable',
    rule: `rule: ${f2(dMin)} to ${f2(dMax)}`,
  });

  // Earnings (the screener's own check; no listed date passes)
  const earn = buildRankEarningsCheck(i.earningsDate, i.expiration, false, { status: 'pass', value: 'No earnings date listed', reason: '' });
  out.push({
    key: 'earnings', label: 'Earnings',
    status: earn.check.status === 'fail' ? 'fail' : 'pass',
    value: earn.check.status === 'fail' ? `earnings ${earn.check.value}` : i.earningsDate ? `earnings ${i.earningsDate}` : 'no earnings listed',
    rule: 'rule: none before expiry or in the 10 days after',
  });

  // Return on risk
  const maxLoss = i.width - i.credit;
  const roc = maxLoss > 0 ? (i.credit / maxLoss) * 100 : 0;
  const rocMin = ic ? rules.ROC_MIN_IC : rules.ROC_MIN_SPREAD;
  out.push({ key: 'roc', label: 'Return on risk', status: roc >= rocMin ? 'pass' : 'fail', value: `return ${f0(roc)}%`, rule: `rule: at least ${rocMin}%` });

  // Open interest (a warning, never a fail: the screener's own treatment)
  const ois = i.shortOis;
  const oiKnown = ois.length > 0 && ois.every(o => o != null);
  const oiOk = oiKnown && ois.every(o => (o as number) >= rules.OI_MIN);
  out.push({
    key: 'oi', label: 'Open interest', status: oiOk ? 'pass' : 'warn',
    value: oiKnown ? `OI ${ois.map(o => o as number).join(' / ')}` : 'OI unavailable',
    rule: `rule: at least ${rules.OI_MIN} on each short leg`,
  });
  return out;
}

export function failedChecks(checks: RuleCheck[]): RuleCheck[] {
  return checks.filter(c => c.status === 'fail');
}

/** A failed check needs the trader's acknowledgement before Validate; warnings do not. */
export function needsAcknowledgement(checks: RuleCheck[]): boolean {
  return failedChecks(checks).length > 0;
}
