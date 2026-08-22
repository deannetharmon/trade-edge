import type { PmccChainLeg } from './pmccTypes';

export interface RawPmccChain {
  shortExpirations: string[];
  longExpirations: string[];
  /** Listed expirations retained without quote fan-out for runway planning. */
  cycleExpirations?: string[];
  chains: Record<string, Array<Record<string, unknown>>>;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function toLeg(symbol: string, expiration: string, raw: Record<string, unknown>): PmccChainLeg {
  const optionType = raw.optionType === 'C' || raw.optionType === 'P' ? raw.optionType : null;
  const delayedValue = raw.delayed ?? raw.isDelayed ?? raw['is-delayed'];
  return {
    underlyingSymbol: String(raw.underlyingSymbol ?? raw['underlying-symbol'] ?? symbol).trim().toUpperCase(),
    optionType,
    expiration: String(raw.expirationDate ?? expiration),
    strike: finiteNumber(raw.strikePrice) ?? Number.NaN,
    delta: finiteNumber(raw.delta),
    openInterest: integer(raw.openInterest ?? raw['open-interest']),
    bid: finiteNumber(raw.bid),
    ask: finiteNumber(raw.ask),
    occSymbol: typeof raw.occSymbol === 'string' ? raw.occSymbol : typeof raw.symbol === 'string' ? raw.symbol : null,
    quoteTimestamp: (raw.quoteTimestamp ?? raw['quote-time'] ?? raw['updated-at'] ?? raw.timestamp ?? null) as PmccChainLeg['quoteTimestamp'],
    delayed: typeof delayedValue === 'boolean' ? delayedValue : delayedValue == null ? null : String(delayedValue).toLowerCase() === 'true',
  };
}

function collect(symbol: string, expirations: string[], chains: RawPmccChain['chains']): PmccChainLeg[] {
  return expirations.flatMap(expiration => (chains[expiration] ?? []).map(raw => toLeg(symbol, expiration, raw)));
}

export function adaptPmccChain(symbol: string, chain: RawPmccChain): {
  longLegs: PmccChainLeg[];
  shortLegs: PmccChainLeg[];
} {
  const normalized = symbol.trim().toUpperCase();
  return {
    longLegs: collect(normalized, chain.longExpirations, chain.chains),
    shortLegs: collect(normalized, chain.shortExpirations, chain.chains),
  };
}
