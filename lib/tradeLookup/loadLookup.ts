// lib/tradeLookup/loadLookup.ts

// TRADE-LOOKUP-0001B: the flow around buildLookup. It checks the date against the chain's real expirations,
// fetches only what the lookup needs, and returns one of three outcomes: a result, a blocked date, or an error.
// Every broker read comes in through `deps`, so tests run it with fakes and the UI passes defaultDeps.ts.
//
// Order of operations:
//   1. token, then the ticker's real listed expirations (also the expired / weekend / not-listed check)
//   2. far dates (> 180 days) stop here until the caller passes confirmedFar
//   3. the posted expiration and the next listed one, the underlying price, and (calls only) coverage
// A failed next-expiration fetch or price fetch degrades that part only. A failed posted-expiration fetch is an error.

import { buildLookup } from './buildLookup';
import { normalizeChainRows } from './chainRows';
import { evaluateCoverage } from './coverage';
import { resolveExpiry } from './resolveExpiry';
import type { CoveredCallCapacityReport } from '@/lib/scans/covered-call-capacity';
import type { PmccFoundationReport } from '@/lib/scans/pmcc-foundations';
import type { ChainRow, Classification, LoadOutcome } from './lookupTypes';
import type { DateParts, IsoDate, ParsedContract } from './types';

export interface FetchedChain {
  chains: Record<string, unknown[]>;
  classification: Classification | null;
}

export interface CoverageReports {
  capacity: CoveredCallCapacityReport | null;
  foundations: PmccFoundationReport | null;
}

export interface LookupDeps {
  /** Null when the broker session is missing or expired. */
  getToken(): Promise<string | null>;
  /** Every expiration the ticker really lists, 'YYYY-MM-DD'. */
  getListedExpirations(symbol: string, token: string): Promise<IsoDate[]>;
  /** The chain for exactly one expiration, quoted. */
  fetchChain(symbol: string, token: string, expiration: IsoDate): Promise<FetchedChain>;
  getUnderlyingPrice(symbol: string, token: string): Promise<number | null>;
  /** Broker share and LEAP coverage. Only called for covered calls. */
  getCoverageReports(token: string): Promise<CoverageReports>;
  today(): DateParts;
}

export interface LoadOptions {
  contracts?: number;
  /** The user confirmed a date more than 180 days out. */
  confirmedFar?: boolean;
}

function nextListedAfter(listed: IsoDate[], expiration: IsoDate): IsoDate | null {
  let best: IsoDate | null = null;
  for (let i = 0; i < listed.length; i++) {
    // ISO dates compare correctly as strings.
    if (listed[i] > expiration && (best === null || listed[i] < best)) best = listed[i];
  }
  return best;
}

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export async function loadTradeLookup(contract: ParsedContract, deps: LookupDeps, opts: LoadOptions = {}): Promise<LoadOutcome> {
  const contracts = opts.contracts && opts.contracts > 0 ? Math.floor(opts.contracts) : 1;
  const symbol = contract.ticker;

  let token: string | null;
  try {
    token = await deps.getToken();
  } catch (e) {
    return { kind: 'error', message: messageOf(e, 'Could not reach TastyTrade. Sign in again and retry.') };
  }
  if (!token) return { kind: 'error', message: 'Sign in to TastyTrade to look up a trade.' };

  let listed: IsoDate[];
  try {
    listed = await deps.getListedExpirations(symbol, token);
  } catch (e) {
    return { kind: 'error', message: messageOf(e, 'Could not load ' + symbol + ' expirations.') };
  }
  if (!listed || listed.length === 0) {
    return { kind: 'error', message: 'TastyTrade lists no options for ' + symbol + '.' };
  }

  const today = deps.today();
  const resolution = resolveExpiry({ expiry: contract.expiry, postedAt: contract.postedAt, today, listedExpirations: listed });
  if (resolution.status === 'expired' || resolution.status === 'not_listed' || resolution.status === 'invalid_date') {
    return { kind: 'blocked', resolution };
  }
  if (resolution.status === 'confirm_far' && !opts.confirmedFar) {
    return { kind: 'blocked', resolution };
  }
  const expiration = resolution.date;
  const nextExpiration = nextListedAfter(listed, expiration);

  const tok = token;
  const chainPromise = deps.fetchChain(symbol, tok, expiration).then(
    function (c) { return { ok: true as const, value: c }; },
    function (e) { return { ok: false as const, error: e }; },
  );
  const nextPromise: Promise<FetchedChain | null> = nextExpiration
    ? deps.fetchChain(symbol, tok, nextExpiration).catch(function () { return null; })
    : Promise.resolve(null);
  const pricePromise: Promise<number | null> = deps.getUnderlyingPrice(symbol, tok).catch(function () { return null; });
  const coveragePromise: Promise<CoverageReports | null> =
    contract.strategy === 'CC' ? deps.getCoverageReports(tok).catch(function () { return null; }) : Promise.resolve(null);

  const [chainResult, nextChain, underlyingPrice, reports] = await Promise.all([chainPromise, nextPromise, pricePromise, coveragePromise]);

  if (!chainResult.ok) {
    return { kind: 'error', message: messageOf(chainResult.error, 'Could not load the ' + symbol + ' chain.') };
  }

  const rows: ChainRow[] = normalizeChainRows(chainResult.value.chains);
  if (nextChain) {
    const more = normalizeChainRows(nextChain.chains);
    for (let i = 0; i < more.length; i++) rows.push(more[i]);
  }

  const coverage = evaluateCoverage({
    strategy: contract.strategy,
    symbol,
    contracts,
    expiration,
    capacity: reports ? reports.capacity : null,
    foundations: reports ? reports.foundations : null,
  });

  const result = buildLookup({
    contract,
    expiration,
    nextExpiration: nextChain ? nextExpiration : null,
    contracts,
    rows,
    underlyingPrice,
    classification: chainResult.value.classification,
    today,
    coverage,
  });
  return { kind: 'result', result, resolution };
}
