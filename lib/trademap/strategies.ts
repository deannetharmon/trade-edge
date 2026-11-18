// lib/trademap/strategies.ts
//
// OPTMAP-0001 S2 (Ian: v1 strategies): turns a strategy choice plus an anchor
// strike into the option legs to quote, and turns live quotes into the
// TradeLeg model (entry price = mid, IV = that leg's own IV). Pure functions.
// Covered call: only the short call is quoted here; the share leg (cost basis) is added by shareLeg(). Fail closed: a leg with no two-sided
// quote or no IV makes the whole strategy unusable, never a guess.

import { symbolKey, type ChainExpiration, type OptionQuote } from './chain';
import type { OptionRight } from './pricing';
import type { LegSide, TradeLeg } from './strategyLegs';

export type StrategyId = 'long-call' | 'long-put' | 'csp' | 'bps' | 'bcs' | 'ic' | 'cc';

export interface StrategyOption {
  id: StrategyId;
  label: string;
  /** True when the strategy has a second strike (the width control applies). */
  hasWidth: boolean;
}

export const STRATEGIES: StrategyOption[] = [
  { id: 'long-call', label: 'Long call', hasWidth: false },
  { id: 'long-put', label: 'Long put', hasWidth: false },
  { id: 'csp', label: 'Cash-secured put', hasWidth: false },
  { id: 'bps', label: 'Bull put spread', hasWidth: true },
  { id: 'bcs', label: 'Bear call spread', hasWidth: true },
  { id: 'ic', label: 'Iron condor', hasWidth: true },
  { id: 'cc', label: 'Covered call', hasWidth: false },
];

export interface LegSpec {
  right: OptionRight;
  side: LegSide;
  strike: number;
  /** OCC symbol exactly as the broker sends it. */
  symbol: string;
}

export function nearestIndex(strikes: number[], target: number): number {
  let best = 0;
  for (let i = 1; i < strikes.length; i += 1) {
    if (Math.abs(strikes[i] - target) < Math.abs(strikes[best] - target)) best = i;
  }
  return best;
}

/** Strike steps to use as the default spread width: about 5% of the stock price, at least one step. */
export function defaultWidthSteps(strikes: number[], spot: number): number {
  if (strikes.length < 2) return 1;
  const i = nearestIndex(strikes, spot);
  const lo = Math.max(0, i - 1);
  const hi = Math.min(strikes.length - 1, i + 1);
  const gap = (strikes[hi] - strikes[lo]) / (hi - lo);
  if (!(gap > 0)) return 1;
  return Math.min(10, Math.max(1, Math.ceil((0.05 * spot) / gap)));
}

/**
 * Default anchor strike: at the money for long options; for the premium-selling
 * structures, half the expected move away from the stock (below for put-based,
 * above for the bear call spread), or 8% when no expected move is known.
 */
export function defaultAnchorStrike(id: StrategyId, strikes: number[], spot: number, expectedMove: number | null): number {
  const away = expectedMove != null && expectedMove > 0 ? expectedMove / 2 : 0.08;
  let target = spot;
  if (id === 'csp' || id === 'bps' || id === 'ic') target = spot * (1 - away);
  if (id === 'bcs' || id === 'cc') target = spot * (1 + away);
  return strikes[nearestIndex(strikes, target)];
}

function legAt(chain: ChainExpiration, index: number, right: OptionRight, side: LegSide): LegSpec | null {
  const s = chain.strikes[index];
  if (!s) return null;
  const symbol = right === 'C' ? s.call : s.put;
  return symbol ? { right, side, strike: s.strike, symbol } : null;
}

export function legSpecs(
  id: StrategyId,
  chain: ChainExpiration,
  anchorStrike: number,
  spot: number,
  widthSteps: number,
): LegSpec[] | null {
  const strikes = chain.strikes.map(s => s.strike);
  const i = strikes.indexOf(anchorStrike);
  if (i < 0 || !Number.isInteger(widthSteps) || widthSteps < 1) return null;
  const specs: Array<LegSpec | null> = [];
  switch (id) {
    case 'long-call': specs.push(legAt(chain, i, 'C', 'long')); break;
    case 'long-put': specs.push(legAt(chain, i, 'P', 'long')); break;
    case 'csp': specs.push(legAt(chain, i, 'P', 'short')); break;
    case 'cc': specs.push(legAt(chain, i, 'C', 'short')); break;
    case 'bps':
      specs.push(legAt(chain, i, 'P', 'short'), legAt(chain, i - widthSteps, 'P', 'long'));
      break;
    case 'bcs':
      specs.push(legAt(chain, i, 'C', 'short'), legAt(chain, i + widthSteps, 'C', 'long'));
      break;
    case 'ic': {
      // Call side mirrors the put side's distance from the stock.
      const j = nearestIndex(strikes, spot + (spot - strikes[i]));
      if (j <= i) return null;
      specs.push(
        legAt(chain, i, 'P', 'short'), legAt(chain, i - widthSteps, 'P', 'long'),
        legAt(chain, j, 'C', 'short'), legAt(chain, j + widthSteps, 'C', 'long'),
      );
      break;
    }
    default: return null;
  }
  const out: LegSpec[] = [];
  for (const s of specs) {
    if (s == null) return null;
    out.push(s);
  }
  return out;
}

export type BuildResult = { legs: TradeLeg[]; error: null } | { legs: null; error: string };

/** Live quotes (keyed by whitespace-free symbol) to TradeLegs: entry = mid, iv = the leg's own IV. */
export function buildTradeLegs(specs: LegSpec[], expiration: string, quotes: Record<string, OptionQuote>): BuildResult {
  const legs: TradeLeg[] = [];
  for (const spec of specs) {
    const q = quotes[symbolKey(spec.symbol)];
    const name = `${spec.strike}${spec.right}`;
    if (!q) return { legs: null, error: `No quote yet for the ${name}` };
    if (q.mid == null) return { legs: null, error: `The ${name} has a one-sided or crossed market` };
    if (q.iv == null) return { legs: null, error: `The ${name} has no implied volatility` };
    legs.push({ right: spec.right, side: spec.side, strike: spec.strike, expiration, quantity: 1, entryPrice: q.mid, iv: q.iv });
  }
  return { legs, error: null };
}
