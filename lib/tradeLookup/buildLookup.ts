// lib/tradeLookup/buildLookup.ts

// TRADE-LOOKUP-0001B: the lookup itself. Given the parsed post and the real chain rows, it finds the posted
// contract, picks its neighbors and prices every row. Pure: no network, no clock (today is passed in).
//
// Every number that also exists in Portfolio comes from lib/portfolio/positionMetrics.ts, so a looked-up
// trade can never show a different POP, breakeven or buy price than the same trade once it is held:
//   POP        calcPositionPop('PUT' | 'CALL', ...)
//   breakeven  computeSingleLegBreakeven
//   max risk   computeCspEffectiveBuyPrice (CSP only)
//
// Quote rule (Ian): a row with no usable bid/ask is "no quote". Its credit, POP and breakeven are null and it is
// never priced from a last price. Usable means ask above 0, bid at or above 0, and bid not above ask.

import { calcPositionPop, computeCspEffectiveBuyPrice, computeSingleLegBreakeven, CONTRACT_MULTIPLIER } from '@/lib/portfolio/positionMetrics';
import { daysBetween, parseIsoDate } from './resolveExpiry';
import type { ChainRow, Classification, CoverageResult, LookupResult, LookupRow, PostedComparison } from './lookupTypes';
import type { DateParts, IsoDate, ParsedContract } from './types';

const STRIKE_EPSILON = 1e-9;
export const NEIGHBOR_STRIKES_EACH_SIDE = 2;

export interface BuildLookupInput {
  contract: ParsedContract;
  /** The resolved expiration of the posted contract. */
  expiration: IsoDate;
  /** The next listed expiration after it, or null when there is none. */
  nextExpiration: IsoDate | null;
  contracts: number;
  /** Rows for the posted expiration and (when loaded) the next one. Either right; the lookup filters. */
  rows: ChainRow[];
  underlyingPrice: number | null;
  classification: Classification | null;
  today: DateParts;
  coverage: CoverageResult;
}

function isUsableQuote(bid: number | null, ask: number | null): boolean {
  return bid !== null && ask !== null && ask > 0 && bid >= 0 && bid <= ask;
}

function strikeMatches(a: number, b: number): boolean {
  return Math.abs(a - b) < STRIKE_EPSILON;
}

function dteOf(expiration: IsoDate, today: DateParts): number {
  const parts = parseIsoDate(expiration);
  return parts ? daysBetween(today, parts) : 0;
}

function priceRow(
  row: ChainRow,
  input: BuildLookupInput,
  flags: { isPick: boolean; isNextExpiration: boolean },
): LookupRow {
  const dte = dteOf(row.expiration, input.today);
  const base: LookupRow = {
    strike: row.strike,
    right: row.right,
    expiration: row.expiration,
    dte,
    isPick: flags.isPick,
    isNextExpiration: flags.isNextExpiration,
    noQuote: true,
    bid: row.bid,
    ask: row.ask,
    mid: null,
    natural: null,
    delta: row.delta,
    pop: null,
    credit: null,
    breakeven: null,
    maxRisk: null,
    openInterest: row.openInterest,
    spreadPct: null,
    creditVsPick: null,
    popVsPick: null,
    occSymbol: row.occSymbol,
  };
  if (!isUsableQuote(row.bid, row.ask)) {
    // No quote: keep the strike and open interest, blank everything that depends on a price.
    return Object.assign({}, base, { delta: null });
  }

  const bid = row.bid as number;
  const ask = row.ask as number;
  const mid = (bid + ask) / 2;
  const contracts = input.contracts;
  const strategy = row.right === 'P' ? 'PUT' : 'CALL';
  const pop = calcPositionPop(
    strategy,
    [{ optionType: row.right, strikePrice: row.strike, direction: 'Short' }],
    input.underlyingPrice,
    mid * CONTRACT_MULTIPLIER * contracts,
    contracts,
    dte,
    row.iv,
  );
  const effectiveBuy = row.right === 'P' ? computeCspEffectiveBuyPrice(row.strike, mid) : null;

  return Object.assign({}, base, {
    noQuote: false,
    mid,
    natural: bid,
    pop,
    credit: mid,
    breakeven: computeSingleLegBreakeven(row.strike, mid, row.right),
    maxRisk: effectiveBuy === null ? null : effectiveBuy * CONTRACT_MULTIPLIER * contracts,
    spreadPct: mid > 0 ? ((ask - bid) / mid) * 100 : null,
  });
}

function latestQuoteTime(rows: ChainRow[]): string | null {
  let best: string | null = null;
  let bestMs = -1;
  for (let i = 0; i < rows.length; i++) {
    const q = rows[i].quoteUpdatedAt;
    if (!q) continue;
    const ms = Date.parse(q);
    if (isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = q;
    }
  }
  return best;
}

export function buildLookup(input: BuildLookupInput): LookupResult {
  const { contract, expiration, nextExpiration } = input;
  const notes: string[] = [];

  const sameExpiration = input.rows
    .filter(function (r) { return r.right === contract.right && r.expiration === expiration; })
    .sort(function (a, b) { return a.strike - b.strike; });

  const emptyPosted: PostedComparison = { postedPrice: contract.postedPrice, mid: null, change: null, changePct: null, postAgeDays: null };
  const postAgeDays = contract.postedAt ? daysBetween(contract.postedAt, input.today) : null;

  const shell = {
    contract,
    expiration,
    contracts: input.contracts,
    underlyingPrice: input.underlyingPrice,
    classification: input.classification,
    coverage: input.coverage,
    quotesAsOf: latestQuoteTime(sameExpiration),
  };

  if (sameExpiration.length === 0) {
    return Object.assign({}, shell, {
      status: 'no_rows' as const,
      rows: [],
      pick: null,
      nearestStrikes: [],
      posted: Object.assign({}, emptyPosted, { postAgeDays }),
      notes: ['The chain has no ' + (contract.right === 'P' ? 'puts' : 'calls') + ' listed for ' + expiration + '.'],
    });
  }

  let pickIndex = -1;
  for (let i = 0; i < sameExpiration.length; i++) {
    if (strikeMatches(sameExpiration[i].strike, contract.strike)) {
      pickIndex = i;
      break;
    }
  }

  if (pickIndex === -1) {
    // Never round to a neighbor. Offer the closest listed strike on each side and stop.
    let below: number | null = null;
    let above: number | null = null;
    for (let i = 0; i < sameExpiration.length; i++) {
      const s = sameExpiration[i].strike;
      if (s < contract.strike) below = s;
      if (s > contract.strike && above === null) above = s;
    }
    const nearest: number[] = [];
    if (below !== null) nearest.push(below);
    if (above !== null) nearest.push(above);
    return Object.assign({}, shell, {
      status: 'strike_not_listed' as const,
      rows: [],
      pick: null,
      nearestStrikes: nearest,
      posted: Object.assign({}, emptyPosted, { postAgeDays }),
      notes: ['Strike ' + contract.strike + ' is not listed for ' + expiration + '.'],
    });
  }

  const from = Math.max(0, pickIndex - NEIGHBOR_STRIKES_EACH_SIDE);
  const to = Math.min(sameExpiration.length - 1, pickIndex + NEIGHBOR_STRIKES_EACH_SIDE);
  const rows: LookupRow[] = [];
  for (let i = from; i <= to; i++) {
    rows.push(priceRow(sameExpiration[i], input, { isPick: i === pickIndex, isNextExpiration: false }));
  }

  // Same strike on the next listed expiration. If that strike is not listed there, nothing is substituted.
  if (nextExpiration) {
    let nextRow: ChainRow | null = null;
    for (let i = 0; i < input.rows.length; i++) {
      const r = input.rows[i];
      if (r.right === contract.right && r.expiration === nextExpiration && strikeMatches(r.strike, contract.strike)) {
        nextRow = r;
        break;
      }
    }
    if (nextRow) rows.push(priceRow(nextRow, input, { isPick: false, isNextExpiration: true }));
    else notes.push('Strike ' + contract.strike + ' is not listed on ' + nextExpiration + '.');
  }

  const pick = rows.filter(function (r) { return r.isPick; })[0];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.isPick) continue;
    r.creditVsPick = r.credit !== null && pick.credit !== null ? r.credit - pick.credit : null;
    r.popVsPick = r.pop !== null && pick.pop !== null ? r.pop - pick.pop : null;
  }

  if (input.underlyingPrice === null) notes.push('No underlying price, so POP is blank.');
  if (pick.noQuote) notes.push('The posted contract has no quote right now.');

  const posted: PostedComparison = {
    postedPrice: contract.postedPrice,
    mid: pick.mid,
    change: contract.postedPrice !== null && pick.mid !== null ? pick.mid - contract.postedPrice : null,
    changePct:
      contract.postedPrice !== null && contract.postedPrice > 0 && pick.mid !== null
        ? ((pick.mid - contract.postedPrice) / contract.postedPrice) * 100
        : null,
    postAgeDays,
  };

  return Object.assign({}, shell, {
    status: 'ok' as const,
    rows,
    pick,
    nearestStrikes: [],
    posted,
    notes,
  });
}
