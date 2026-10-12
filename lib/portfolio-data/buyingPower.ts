// lib/portfolio-data/buyingPower.ts

// BAL-0001/0002/0003 shared buying-power model.
// Inputs: Tastytrade /accounts/{a}/balances and /margin/accounts/{a}/requirements payloads (the `data` objects).
// Reg T account: one option buying power figure. There is no cash/margin split, so none is modelled.
// Pure functions only. No fetching, no AI. AI-POLICY-0001: rules choose candidates, AI only explains.

import { isLeveragedEtf } from '@/lib/leveragedEtfs';

export const AMBER_PCT = 15;
export const RED_PCT = 25;

// Cluster membership uses the shared leveraged/inverse ETF list (one list, also used by the Wheel exclusion).

type Raw = Record<string, any>;
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

export type Tier = 'normal' | 'amber' | 'red';
export const tierOf = (pct: number): Tier => (pct >= RED_PCT ? 'red' : pct >= AMBER_PCT ? 'amber' : 'normal');

export interface Leg {
  symbol: string;            // OCC symbol or equity symbol
  kind: 'short-option' | 'long-option' | 'shares';
  quantity: number;          // signed
  strike?: number;
  optionType?: 'P' | 'C';
  expiration?: string;       // YYYY-MM-DD
  dte?: number;
  open: number;              // average open price
  mark: number;              // last close price (may be stale)
  openPL: number;            // dollars, from open vs mark
  premiumLeft: number;       // short options only: mark x 100 x |qty|
}

export interface Holding {   // one broker sub-group (e.g. NAKED_OPTION) inside an underlying
  underlying: string;
  groupType: string;
  requirement: number;
  legs: Leg[];
}

export interface TickerRow {
  symbol: string;
  requirement: number;
  sharePct: number;          // of buying power used
  tier: Tier;
  inCluster: boolean;
  openPL: number;
  holdings: Holding[];
  cashSecured: boolean;      // derived: short put with requirement === strike x 100 x |qty|
}

export interface BpModel {
  asOf: string;
  accountType: string;
  netLiq: number;
  optionBpLeft: number;
  bpUsed: number;
  capacity: number;
  usedPct: number;
  cashBalance: number;
  withdrawable: number;
  marginEquity: number;
  tickers: TickerRow[];      // sorted by requirement desc, requirement-0 tickers last
  otherRequirement: number;  // bpUsed minus per-ticker requirements, never negative
  clusterRequirement: number;
  clusterSharePct: number;
  totalOpenPL: number;
}

function dteFrom(exp: string | undefined, now: Date): number | undefined {
  if (!exp) return undefined;
  const d = Date.parse(exp + 'T00:00:00Z');
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Number.isFinite(d) ? Math.max(0, Math.round((d - today) / 86400000)) : undefined;
}

function parseLeg(e: Raw, now: Date): Leg {
  const qty = num(e['quantity']);
  const open = num(e['average-open-price']);
  const mark = num(e['close-price']);
  const isOpt = String(e['instrument-type'] ?? '').includes('Option');
  const mult = isOpt ? 100 : 1;
  const kind: Leg['kind'] = !isOpt ? 'shares' : qty < 0 ? 'short-option' : 'long-option';
  const pl = qty < 0 ? (open - mark) * mult * Math.abs(qty) : (mark - open) * mult * qty;
  return {
    symbol: String(e['instrument-symbol'] ?? '').trim(),
    kind, quantity: qty,
    strike: isOpt ? num(e['strike-price']) : undefined,
    optionType: isOpt ? (e['option-type'] === 'C' ? 'C' : 'P') : undefined,
    expiration: e['expiration-date'] || undefined,
    dte: dteFrom(e['expiration-date'], now),
    open, mark,
    openPL: pl,
    premiumLeft: kind === 'short-option' ? mark * 100 * Math.abs(qty) : 0,
  };
}

export function buildBpModel(balances: Raw, requirements: Raw, now: Date = new Date()): BpModel {
  const optionBpLeft = num(balances['derivative-buying-power']);
  const bpUsed = num(balances['used-derivative-buying-power']);
  const used = bpUsed || 1;

  const tickers: TickerRow[] = (requirements['groups'] ?? []).map((g: Raw): TickerRow => {
    const symbol = String(g['underlying-symbol'] ?? g['code'] ?? g['description']);
    const holdings: Holding[] = (g['groups'] ?? []).map((sg: Raw): Holding => ({
      underlying: symbol,
      groupType: String(sg['description'] ?? ''),
      requirement: num(sg['margin-requirement']),
      legs: (sg['position-entries'] ?? []).map((e: Raw) => parseLeg(e, now)),
    }));
    const requirement = num(g['margin-requirement']);
    const sharePct = (requirement / used) * 100;
    const legs = holdings.flatMap(h => h.legs);
    const cashSecured = legs.some(l =>
      l.kind === 'short-option' && l.optionType === 'P' && l.strike !== undefined &&
      Math.abs(requirement - l.strike * 100 * Math.abs(l.quantity)) < 0.01);
    return {
      symbol, requirement, sharePct, tier: tierOf(sharePct),
      inCluster: isLeveragedEtf(symbol),
      openPL: legs.reduce((s, l) => s + l.openPL, 0),
      holdings, cashSecured,
    };
  });
  tickers.sort((a, b) => b.requirement - a.requirement || a.symbol.localeCompare(b.symbol));

  const sumReq = tickers.reduce((s, t) => s + t.requirement, 0);
  const clusterRequirement = tickers.filter(t => t.inCluster).reduce((s, t) => s + t.requirement, 0);
  return {
    asOf: String(balances['updated-at'] ?? ''),
    accountType: String(requirements['margin-calculation-type'] ?? ''),
    netLiq: num(balances['net-liquidating-value']),
    optionBpLeft, bpUsed, capacity: optionBpLeft + bpUsed,
    usedPct: optionBpLeft + bpUsed ? (bpUsed / (optionBpLeft + bpUsed)) * 100 : 0,
    cashBalance: num(balances['cash-balance']),
    withdrawable: num(balances['cash-available-to-withdraw']),
    marginEquity: num(balances['margin-equity']),
    tickers,
    otherRequirement: Math.max(0, bpUsed - sumReq),
    clusterRequirement,
    clusterSharePct: (clusterRequirement / used) * 100,
    totalOpenPL: tickers.reduce((s, t) => s + t.openPL, 0),
  };
}

// ---------------- BAL-0003 free-up plan ----------------

export interface Candidate {
  underlying: string;
  label: string;             // e.g. "105 put Nov 6" or "2 shares"
  holding: Holding;
  freed: number;
  givesUp: number;           // premium still unearned (short options); 0 for shares
  realized: number;          // profit (+) or loss (-) if closed at last close
  realizesLoss: boolean;
  dte?: number;
  bpPerDollar: number | null; // null when it realizes a loss or gives up nothing
  lockedReason?: string;
}

export interface FreeUpPlan {
  target: number;
  picks: Candidate[];
  freed: number;
  givesUp: number;
  realized: number;
  meetsTarget: boolean;
  optionBpLeftAfter: number;
  usedPctAfter: number;
  clusterSharePctAfter: number;
  after: { symbol: string; sharePct: number }[]; // tickers still holding buying power, desc
  warnings: string[];
}

export function candidatesFrom(model: BpModel): Candidate[] {
  const out: Candidate[] = [];
  for (const t of model.tickers) {
    const hasShortCall = t.holdings.some(h => h.legs.some(l => l.kind === 'short-option' && l.optionType === 'C'));
    for (const h of t.holdings) {
      if (h.requirement <= 0) continue;                       // long options free nothing
      const legs = h.legs;
      const shortOpts = legs.filter(l => l.kind === 'short-option');
      const shares = legs.filter(l => l.kind === 'shares');
      if (shortOpts.length) {
        const realized = shortOpts.reduce((s, l) => s + l.openPL, 0);
        const givesUp = shortOpts.reduce((s, l) => s + l.premiumLeft, 0);
        const l0 = shortOpts[0];
        out.push({
          underlying: t.symbol,
          label: `${l0.strike} ${l0.optionType === 'C' ? 'call' : 'put'} ${l0.expiration ?? ''}`.trim(),
          holding: h, freed: h.requirement, givesUp, realized,
          realizesLoss: realized < 0, dte: l0.dte,
          bpPerDollar: realized < 0 || givesUp <= 0 ? null : h.requirement / givesUp,
        });
      } else if (shares.length) {
        const realized = shares.reduce((s, l) => s + l.openPL, 0);
        out.push({
          underlying: t.symbol,
          label: `${shares.reduce((s, l) => s + l.quantity, 0)} shares`,
          holding: h, freed: h.requirement, givesUp: 0, realized,
          realizesLoss: realized < 0,
          bpPerDollar: null,
          lockedReason: hasShortCall ? 'Backs an open covered call' : undefined,
        });
      }
    }
  }
  return out.filter(c => !c.lockedReason);
}

function evaluate(model: BpModel, picks: Candidate[], target: number): FreeUpPlan {
  const freed = picks.reduce((s, c) => s + c.freed, 0);
  const givesUp = picks.reduce((s, c) => s + c.givesUp, 0);
  const realized = picks.reduce((s, c) => s + c.realized, 0);
  const usedAfter = Math.max(model.bpUsed - freed, 0);
  const cut = new Map<string, number>();
  for (const c of picks) cut.set(c.underlying, (cut.get(c.underlying) ?? 0) + c.freed);
  const rows = model.tickers
    .map(t => ({ symbol: t.symbol, req: Math.max(t.requirement - (cut.get(t.symbol) ?? 0), 0), cluster: t.inCluster }))
    .filter(r => r.req > 0);
  const share = (r: number) => (usedAfter ? (r / usedAfter) * 100 : 0);
  const after = rows.map(r => ({ symbol: r.symbol, sharePct: share(r.req) })).sort((a, b) => b.sharePct - a.sharePct);
  const warnings: string[] = [];
  for (const a of after) {
    const before = model.tickers.find(t => t.symbol === a.symbol)!;
    if (a.sharePct >= RED_PCT && a.sharePct > before.sharePct + 0.05) {
      warnings.push(`${a.symbol} rises from ${before.sharePct.toFixed(0)}% to ${a.sharePct.toFixed(0)}% of buying power used`);
    }
  }
  if (picks.some(c => c.realizesLoss)) warnings.push('Plan realizes a loss');
  return {
    target, picks, freed, givesUp, realized,
    meetsTarget: freed >= target,
    optionBpLeftAfter: model.optionBpLeft + freed,
    usedPctAfter: model.capacity ? (usedAfter / model.capacity) * 100 : 0,
    clusterSharePctAfter: usedAfter ? (rows.filter(r => r.cluster).reduce((s, r) => s + r.req, 0) / usedAfter) * 100 : 0,
    after, warnings,
  };
}

// Returns the best-value plan (BP per $1 given up, no-loss candidates first) and, when that plan
// raises a red-tier concentration, a second plan that works down the largest ticker instead.
// Prices are last close and may be stale: the caller re-prices live and dry-runs before review.
export function planFreeUp(model: BpModel, target: number): { primary: FreeUpPlan; alternative?: FreeUpPlan } {
  const cands = candidatesFrom(model);
  const scored = cands.filter(c => !c.realizesLoss && c.bpPerDollar !== null)
    .sort((a, b) => (b.bpPerDollar as number) - (a.bpPerDollar as number));
  const losses = cands.filter(c => c.realizesLoss).sort((a, b) => b.realized - a.realized);

  const build = (order: Candidate[]): FreeUpPlan => {
    const picks: Candidate[] = [];
    let freed = 0;
    for (const c of order) {
      if (freed >= target) break;
      picks.push(c); freed += c.freed;
    }
    return evaluate(model, picks, target);
  };

  const primary = build([...scored, ...losses]);
  if (!primary.warnings.some(w => w.includes('% of buying power'))) return { primary };

  const biggest = model.tickers[0]?.symbol;
  const reduceTop = [...scored, ...losses].sort((a, b) =>
    Number(b.underlying === biggest) - Number(a.underlying === biggest) ||
    (b.bpPerDollar ?? 0) - (a.bpPerDollar ?? 0));
  const alt = build(reduceTop);
  const key = (pl: FreeUpPlan) => pl.picks.map(c => `${c.underlying}:${c.label}`).join('|');
  const same = key(alt) === key(primary);
  return same ? { primary } : { primary, alternative: alt };
}
