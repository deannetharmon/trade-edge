// lib/trademap/ruleChecks.ts
//
// ORDER-SEND-0001 S3b/S3d (Ian: option 1): the Prosper rule checks shown at Send, computed from Trade Map data with the
// screener's own rules and helpers so the criteria live in one place. Mirrors lib/scans/checklist.ts and
// lib/scans/spread-finder.ts for BPS, BCS and IC:
//   - the rules in force are passed in: the trader's saved scan criteria for the symbol's kind (ETF/index set or stock set)
//   - IV rank: at least IVR_MIN (ETFs and indexes use the INDEX_IVR_MIN floor); missing is a warning, as in the screener;
//     an iron condor above IVR_IC_MAX is a warning ("verify reason"), as in lib/screener.ts
//   - DTE window; short delta in the spread band (IC band for condors, both sides)
//   - market: every leg has open interest above zero and a bid-ask no wider than getBidAskMax(price)
//   - credit ratio and return on risk use the screener's conservative credit (natural + 25% toward mid), not the mid
//   - POP: spreads use the screener's model (calcSpreadPop on the expiration IV); condors use 1 - both short deltas
//   - earnings (stocks only, via buildRankEarningsCheck); open interest of the short legs at OI_MIN is a warning
//   - spread width no wider than the widest the scan would search (MAX_SPREAD_WIDTH)
// Badges inform: a failed check needs an acknowledgement at Send, a warning does not. Pure; no I/O.

import { INDEX_IVR_MIN, type RulesType } from '@/lib/scans/constants';
import { buildRankEarningsCheck } from '@/lib/scans/rankChecks';
import { calcSpreadPop, getBidAskMax, getWidthSteps, normalizeIv } from '@/lib/scans/scan-utils';
import { calculateTargetedConservativeCredit } from '@/lib/scans/spread-finder';

export type RuleStatus = 'pass' | 'fail' | 'warn';

export interface RuleCheck {
  key: 'ivr' | 'dte' | 'delta' | 'market' | 'credit' | 'roc' | 'pop' | 'earnings' | 'oi' | 'width';
  label: string;
  status: RuleStatus;
  /** What the trade has, for example "IV rank 38". */
  value: string;
  /** The rule, for example "rule: at least 30". */
  rule: string;
}

export interface LegQuote { bid: number | null; ask: number | null; mid: number | null; oi: number | null }
/** One credit spread: a short leg and the long leg bought against it. */
export interface Wing {
  right: 'P' | 'C';
  shortStrike: number;
  longStrike: number;
  /** Short leg delta (sign ignored). */
  shortDelta: number | null;
  short: LegQuote;
  long: LegQuote;
}

export interface RuleCheckInput {
  strategy: 'bps' | 'bcs' | 'ic';
  /** The rules in force (saved scan criteria for this kind of underlying). */
  rules: RulesType;
  /** True for ETFs and indexes (the screener's isEtfOrIndex). */
  etfOrIndex: boolean;
  /** Stock price. */
  price: number | null;
  dte: number;
  ivRankPct: number | null;
  /** Implied volatility for the expiration, as a fraction (0.26 = 26%). */
  expirationIv: number | null;
  earningsDate: string | null;
  expiration: string;
  /** One wing for BPS and BCS, the put wing then the call wing for IC. */
  wings: Wing[];
}

const INDEX_SYMBOLS = ['SPX', 'SPXW', 'XSP', 'NDX', 'RUT', 'DJX', 'VIX'];

/** Cash-settled index symbols: their options use the Index Option instrument type when ordering. */
export function isIndexSymbol(symbol: string): boolean {
  return INDEX_SYMBOLS.indexOf(symbol.toUpperCase()) >= 0;
}

const f0 = (n: number) => n.toFixed(0);
const f2 = (n: number) => n.toFixed(2);
const width = (w: Wing) => Math.abs(w.shortStrike - w.longStrike);

export function evaluateRuleChecks(i: RuleCheckInput): RuleCheck[] {
  const rules = i.rules;
  const ic = i.strategy === 'ic';
  const out: RuleCheck[] = [];
  const wings = i.wings;

  // IV rank
  const ivrMin = i.etfOrIndex ? INDEX_IVR_MIN : rules.IVR_MIN;
  const ivrRule = ic ? `rule: at least ${ivrMin}, up to ${rules.IVR_IC_MAX} for condors` : `rule: at least ${ivrMin}`;
  if (i.ivRankPct == null) out.push({ key: 'ivr', label: 'IV rank', status: 'warn', value: 'IV rank unavailable', rule: ivrRule });
  else if (i.ivRankPct < ivrMin) out.push({ key: 'ivr', label: 'IV rank', status: 'fail', value: `IV rank ${f0(i.ivRankPct)}`, rule: ivrRule });
  else if (ic && i.ivRankPct > rules.IVR_IC_MAX) out.push({ key: 'ivr', label: 'IV rank', status: 'warn', value: `IV rank ${f0(i.ivRankPct)}`, rule: ivrRule });
  else out.push({ key: 'ivr', label: 'IV rank', status: 'pass', value: `IV rank ${f0(i.ivRankPct)}`, rule: ivrRule });

  // DTE window
  const dteOk = i.dte >= rules.DTE_MIN && i.dte <= rules.DTE_MAX;
  out.push({ key: 'dte', label: 'Days to expiry', status: dteOk ? 'pass' : 'fail', value: `${i.dte} DTE`, rule: `rule: ${rules.DTE_MIN} to ${rules.DTE_MAX}` });

  // Short delta band (every short leg)
  const dMin = ic ? rules.IC_DELTA_MIN : rules.SPREAD_DELTA_MIN;
  const dMax = ic ? rules.IC_DELTA_MAX : rules.SPREAD_DELTA_MAX;
  const deltas = wings.map(w => (w.shortDelta == null ? null : Math.abs(w.shortDelta)));
  const deltaKnown = deltas.length > 0 && deltas.every(d => d != null);
  const deltaOk = deltaKnown && deltas.every(d => (d as number) >= dMin - 1e-9 && (d as number) <= dMax + 1e-9);
  out.push({
    key: 'delta', label: 'Short delta', status: deltaOk ? 'pass' : 'fail',
    value: deltaKnown ? `delta ${deltas.map(d => f2(d as number)).join(' / ')}` : 'delta unavailable',
    rule: `rule: ${f2(dMin)} to ${f2(dMax)}`,
  });

  // Market: open interest above zero and a tight bid-ask on every leg
  const bidAskMax = getBidAskMax(i.price);
  const legs = wings.flatMap(w => [w.short, w.long]);
  const noOi = legs.some(l => !(typeof l.oi === 'number' && l.oi > 0));
  const spreads = legs.map(l => (l.bid != null && l.ask != null ? l.ask - l.bid : null));
  const spreadUnknown = spreads.some(s => s == null);
  const tooWide = spreads.some(s => s != null && s > bidAskMax + 1e-9);
  const widest = spreads.filter((s): s is number => s != null).reduce((m, s) => Math.max(m, s), 0);
  out.push({
    key: 'market', label: 'Market', status: noOi || spreadUnknown || tooWide ? 'fail' : 'pass',
    value: noOi ? 'a leg has no open interest' : spreadUnknown ? 'a leg has no two-sided quote' : `widest bid-ask $${f2(widest)}`,
    rule: `rule: open interest above 0 and bid-ask at most $${f2(bidAskMax)} on every leg`,
  });

  // Conservative credit per wing (the screener's number for credit ratio and return on risk)
  const credits = wings.map(w => {
    const c = calculateTargetedConservativeCredit(
      { bid: w.short.bid, ask: w.short.ask, mid: w.short.mid }, { bid: w.long.bid, ask: w.long.ask, mid: w.long.mid }, width(w), true,
    );
    return c == null ? null : c.credit;
  });
  const creditsKnown = credits.length > 0 && credits.every(c => c != null);

  // Credit ratio, each wing
  const ratios = wings.map((w, k) => (credits[k] == null ? null : (credits[k] as number) / width(w)));
  const ratioOk = creditsKnown && ratios.every(r => (r as number) >= rules.CREDIT_RATIO_MIN - 1e-9);
  out.push({
    key: 'credit', label: 'Credit', status: ratioOk ? 'pass' : 'fail',
    value: creditsKnown ? `credit ${ratios.map(r => `${f0((r as number) * 100)}%`).join(' / ')} of width` : 'credit unavailable',
    rule: `rule: at least ${f0(rules.CREDIT_RATIO_MIN * 100)}% of width${ic ? ' on each side' : ''}`,
  });

  // Return on risk
  const rocMin = ic ? rules.ROC_MIN_IC : rules.ROC_MIN_SPREAD;
  let roc: number | null = null;
  if (creditsKnown) {
    const total = (credits as number[]).reduce((a, b) => a + b, 0);
    const maxLoss = Math.max(...wings.map(width)) - total;
    roc = maxLoss > 0 ? (total / maxLoss) * 100 : 0;
  }
  out.push({ key: 'roc', label: 'Return on risk', status: roc != null && roc >= rocMin ? 'pass' : 'fail', value: roc == null ? 'return unavailable' : `return ${f0(roc)}%`, rule: `rule: at least ${rocMin}%` });

  // POP
  let pop: number | null = null;
  if (ic) {
    if (deltaKnown) pop = (1 - (deltas as number[]).reduce((a, b) => a + b, 0)) * 100;
  } else if (wings.length === 1 && credits[0] != null) {
    pop = calcSpreadPop(i.strategy === 'bps' ? 'BPS' : 'BCS', i.price, wings[0].shortStrike, credits[0] as number, i.dte, normalizeIv(i.expirationIv));
  }
  const sidePopsOk = !ic || (deltaKnown && (deltas as number[]).every(d => (1 - d) * 100 >= rules.POP_MIN));
  out.push({
    key: 'pop', label: 'Chance of profit', status: pop != null && pop >= rules.POP_MIN && sidePopsOk ? 'pass' : 'fail',
    value: pop == null ? 'POP unavailable' : `POP ${f0(pop)}%`, rule: `rule: at least ${rules.POP_MIN}% (screener POP)`,
  });

  // Earnings (the screener's own check; ETFs and indexes have none)
  const earn = buildRankEarningsCheck(i.earningsDate, i.expiration, i.etfOrIndex, { status: 'pass', value: i.etfOrIndex ? 'N/A (index/ETF)' : 'No earnings date listed', reason: '' });
  out.push({
    key: 'earnings', label: 'Earnings',
    status: earn.check.status === 'fail' ? 'fail' : 'pass',
    value: earn.check.status === 'fail' ? `earnings ${earn.check.value}` : i.etfOrIndex ? 'no earnings (ETF/index)' : i.earningsDate ? `earnings ${i.earningsDate}` : 'no earnings listed',
    rule: 'rule: none before expiry or in the days after',
  });

  // Short-leg open interest at the target (a warning, never a fail: the screener's own treatment)
  const shortOis = wings.map(w => w.short.oi);
  const oiKnown = shortOis.length > 0 && shortOis.every(o => o != null);
  const oiOk = oiKnown && shortOis.every(o => (o as number) >= rules.OI_MIN);
  out.push({
    key: 'oi', label: 'Open interest', status: oiOk ? 'pass' : 'warn',
    value: oiKnown ? `short OI ${shortOis.map(o => o as number).join(' / ')}` : 'OI unavailable',
    rule: `rule: at least ${rules.OI_MIN} on each short leg`,
  });

  // Width no wider than the scan would search
  const steps = getWidthSteps(rules.MAX_SPREAD_WIDTH, i.price);
  const maxW = steps.length ? steps[steps.length - 1] : rules.MAX_SPREAD_WIDTH;
  const widest2 = wings.length ? Math.max(...wings.map(width)) : 0;
  out.push({ key: 'width', label: 'Width', status: widest2 <= maxW + 1e-9 ? 'pass' : 'fail', value: `width $${f2(widest2)}`, rule: `rule: at most $${f2(maxW)}` });
  return out;
}

export function failedChecks(checks: RuleCheck[]): RuleCheck[] {
  return checks.filter(c => c.status === 'fail');
}

/** A failed check needs the trader's acknowledgement before Validate; warnings do not. */
export function needsAcknowledgement(checks: RuleCheck[]): boolean {
  return failedChecks(checks).length > 0;
}
