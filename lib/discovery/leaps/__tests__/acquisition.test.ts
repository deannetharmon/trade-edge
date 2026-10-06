// lib/discovery/leaps/__tests__/acquisition.test.ts

// LEAPS-QV-0001 Gate 4a -- acquisition: staged retrieval, completeness reporting, determinism, and the Q9 run budget
// (budget exhausted, 429 retry then give up, 401 mid-run, retries counted). The real-row fixture is a sanitized slice of
// the 2026-10-05 regular-hours provider audit capture (UBER).

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { fingerprint, stableStringify } from '../../util';
import { marketSessionState, sessionOpenEpochSeconds } from '../../normalized/exchangeCalendar';
import { daysFromCivil } from '../../normalized/dates';
import {
  acquireLeapsChain, acquireLeapsRun, createBudgetedTransport, LeapsRunStop, type ProviderGet,
} from '../acquisition';
import { QV_LEAPS_ACQUISITION_V1 } from '../acquisitionPolicy';

const P = QV_LEAPS_ACQUISITION_V1;
const UBER = JSON.parse(readFileSync(join(__dirname, '..', '__fixtures__', 'uber-regular-hours-2026-10-05.json'), 'utf8'));
const sec = (iso: string) => Date.parse(iso) / 1000;
const noSleep = async () => undefined;
const never = () => new Promise<void>(() => undefined);
/** Backoff sleeps resolve at once; the per-underlying timeout never fires. */
const runSleep = (ms: number) => (ms === QV_LEAPS_ACQUISITION_V1.perUnderlyingTimeoutMs ? never() : Promise.resolve());

/** A provider stub that answers the three endpoint shapes from a fixture; `log` records every path requested. */
function provider(fx: { underlyingQuote: unknown; nestedChain: unknown; optionQuoteRows: Record<string, unknown>[] }, opts: {
  chunkStatus?: (index: number) => number;
  chainStatus?: number;
} = {}) {
  const log: string[] = [];
  let chunk = 0;
  const get: ProviderGet = async (path) => {
    log.push(path);
    if (path.indexOf('/market-data/by-type?equity=') === 0) return { status: 200, body: fx.underlyingQuote };
    if (path.indexOf('/option-chains/') === 0) return { status: opts.chainStatus ?? 200, body: fx.nestedChain };
    const index = chunk;
    chunk += 1;
    const status = opts.chainStatus === undefined && opts.chunkStatus ? opts.chunkStatus(index) : 200;
    if (status !== 200) return { status, body: null };
    const asked = path.split('&').map((p) => decodeURIComponent(p.split('=')[1]));
    return { status: 200, body: { data: { items: fx.optionQuoteRows.filter((r) => asked.indexOf(String(r.symbol)) >= 0) } } };
  };
  return { get, log };
}

/** Synthetic chain: `perExp` calls per expiration at strikes spread over 30%-130% of spot 100. */
function synthetic(expirationDates: string[], perExp: number, spot = 100) {
  const strikes = (date: string) => Array.from({ length: perExp }, (_, i) => {
    const k = 30 + (100 * i) / perExp;
    const ymd = date.slice(2).replace(/-/g, '');
    const occ = `SYN   ${ymd}C${String(Math.round(k * 1000)).padStart(8, '0')}`;
    return { 'strike-price': k.toFixed(3), call: occ, put: occ.replace('C', 'P') };
  });
  const nestedChain = { data: { items: [{ 'underlying-symbol': 'SYN', 'root-symbol': 'SYN', 'option-chain-type': 'Standard', 'shares-per-contract': 100,
    deliverables: [{ amount: '100.0', 'deliverable-type': 'Shares', symbol: 'SYN' }],
    expirations: expirationDates.map((d) => ({ 'expiration-date': d, strikes: strikes(d) })) }] } };
  const optionQuoteRows = nestedChain.data.items[0].expirations.flatMap((e) => e.strikes.map((s) => ({ symbol: s.call, bid: '1.00', ask: '1.10', delta: '0.8', 'open-interest': 10, 'updated-at': '2026-10-05T16:48:00.000Z' })));
  const underlyingQuote = { data: { items: [{ symbol: 'SYN', last: String(spot), close: String(spot), 'updated-at': '2026-10-05T16:48:00.000Z' }] } };
  return { underlyingQuote, nestedChain, optionQuoteRows };
}

const NOW = sec('2026-10-05T16:49:00Z'); // Monday 12:49 New York, regular hours
const plusDays = (n: number) => {
  const d = new Date(Date.UTC(2026, 9, 5 + n));
  return d.toISOString().slice(0, 10);
};

describe('Gate 4a: acquisition policy and calendar helper', () => {
  it('acquisition policy is frozen and fingerprint-pinned', () => {
    expect(Object.isFrozen(QV_LEAPS_ACQUISITION_V1)).toBe(true);
    expect(fingerprint(stableStringify(QV_LEAPS_ACQUISITION_V1))).toBe('09b0465a0cd88045cc7d689c149cd445621ce5ffbf4406a080d688851b70c3ff');
  });

  it('session state: open 09:30 inclusive, close exclusive, weekend and after-hours closed, early close honoured', () => {
    expect(marketSessionState(sec('2026-10-05T13:30:00Z'))).toBe('REGULAR_HOURS'); // 09:30 EDT
    expect(marketSessionState(sec('2026-10-05T13:29:59Z'))).toBe('MARKET_CLOSED');
    expect(marketSessionState(sec('2026-10-05T20:00:00Z'))).toBe('MARKET_CLOSED'); // 16:00
    expect(marketSessionState(sec('2026-10-04T16:00:00Z'))).toBe('MARKET_CLOSED'); // Sunday
    expect(marketSessionState(sec('2026-11-27T18:30:00Z'))).toBe('MARKET_CLOSED'); // day after Thanksgiving, 13:30 EST
    expect(marketSessionState(sec('2026-11-27T17:30:00Z'))).toBe('REGULAR_HOURS'); // 12:30 EST
    expect(sessionOpenEpochSeconds(daysFromCivil(2026, 10, 4))).toBeNull();
  });
});

describe('Gate 4a: real-row acquisition (UBER, regular hours)', () => {
  it('uses the live last as S during the session and acquires every band candidate with instrument evidence', async () => {
    const { get } = provider(UBER);
    const r = await acquireLeapsChain('UBER', get, NOW, P);
    expect(r.status).toBe('ACQUIRED');
    expect(r.spot).toEqual({ price: 69.935, basis: 'LAST' });
    const rep = r.chain!.acquisition;
    expect(rep.coverage).toBe('COMPLETE');
    expect(rep.expirations).toEqual({ inWindow: 5, selected: 5, omittedByCap: 0 });
    expect(rep.contracts.candidatesInSelectedExpirations).toBe(59);
    expect(rep.contracts.selectedForQuote).toBe(59);
    expect(rep.contracts.quoteRowsReceived).toBe(59);
    expect(rep.contracts.quoteRowsMissing).toBe(0);
    r.chain!.contracts.forEach((c) => {
      expect(c.strike!).toBeGreaterThanOrEqual(0.4 * 69.935);
      expect(c.strike!).toBeLessThan(69.935);
      expect(c.dte).toBeGreaterThanOrEqual(365);
      expect(c.dte).toBeLessThanOrEqual(900);
      expect(c.instrument).toMatchObject({ rootSymbol: 'UBER', optionChainType: 'Standard', sharesPerContract: 100 });
      expect((c.instrument.deliverables as Record<string, unknown>[])[0]).toMatchObject({ amount: '100.0', 'deliverable-type': 'Shares', symbol: 'UBER' });
      expect(c.quote).not.toBeNull();
    });
  });

  it('every excluded call is accounted for: candidates + at/above spot + below band = in-window calls', async () => {
    const { get } = provider(UBER);
    const rep = (await acquireLeapsChain('UBER', get, NOW, P)).chain!.acquisition.contracts;
    const inWindowCalls = UBER.nestedChain.data.items[0].expirations
      .filter((e: { strikes: unknown[] }) => e.strikes.length > 0)
      .reduce((n: number, e: { strikes: unknown[] }) => n + e.strikes.length, 0);
    expect(rep.candidatesInSelectedExpirations + rep.excludedProvablyIneligible + rep.excludedOutOfPolicyBand).toBe(inWindowCalls);
  });

  it('outside the session S is the regular-session close; after-hours prints never move it (I6)', async () => {
    const fx = { ...UBER, underlyingQuote: { data: { items: [{ symbol: 'UBER', last: '75.10', close: '69.50', 'close-price-type': 'Regular', 'updated-at': '2026-10-06T00:31:00Z' }] } } };
    const r = await acquireLeapsChain('UBER', provider(fx).get, sec('2026-10-06T02:03:00Z'), P);
    expect(r.sessionState).toBe('MARKET_CLOSED');
    expect(r.spot).toEqual({ price: 69.5, basis: 'REGULAR_SESSION_CLOSE' });
  });

  it('no usable underlying quote: no chain call is made', async () => {
    const fx = { ...UBER, underlyingQuote: { data: { items: [{ symbol: 'UBER', last: '' }] } } };
    const { get, log } = provider(fx);
    const r = await acquireLeapsChain('UBER', get, NOW, P);
    expect(r).toMatchObject({ status: 'UNDERLYING_QUOTE_UNAVAILABLE', reason: 'LEAPS_UNDERLYING_QUOTE_UNAVAILABLE', chain: null });
    expect(log).toHaveLength(1);
  });

  it('chain HTTP failure: coverage FAILED with the provider code, nothing invented', async () => {
    const r = await acquireLeapsChain('UBER', provider(UBER, { chainStatus: 500 }).get, NOW, P);
    expect(r.status).toBe('CHAIN_FAILED');
    expect(r.reason).toBe('LEAPS_CHAIN_PROVIDER_FAILURE:HTTP_500');
    expect(r.chain!.acquisition.coverage).toBe('FAILED');
  });

  it('selection is deterministic: a shuffled chain gives the identical contract order', async () => {
    const shuffled = JSON.parse(JSON.stringify(UBER));
    shuffled.nestedChain.data.items[0].expirations.reverse().forEach((e: { strikes: unknown[] }) => e.strikes.reverse());
    const a = await acquireLeapsChain('UBER', provider(UBER).get, NOW, P);
    const b = await acquireLeapsChain('UBER', provider(shuffled).get, NOW, P);
    expect(b.chain!.contracts.map((c) => c.occSymbol)).toEqual(a.chain!.contracts.map((c) => c.occSymbol));
  });
});

describe('Gate 4a: restrictions are counted, never silent', () => {
  it('expiration cap: 8 in window, 6 selected nearest 730 DTE, omitted contracts counted from the nested chain', async () => {
    const dates = [370, 400, 500, 600, 700, 760, 820, 890].map(plusDays);
    const r = await acquireLeapsChain('SYN', provider(synthetic(dates, 20)).get, NOW, P);
    const rep = r.chain!.acquisition;
    expect(rep.coverage).toBe('RESTRICTED');
    expect(rep.expirations).toEqual({ inWindow: 8, selected: 6, omittedByCap: 2 });
    const kept = new Set(r.chain!.contracts.map((c) => c.expiration));
    expect(kept.has(plusDays(370))).toBe(false);
    expect(kept.has(plusDays(400))).toBe(false);
    // strikes 30..125 step 5: band [40, 100) holds 12 per expiration
    expect(rep.contracts.omittedInOmittedExpirations).toBe(24);
    expect(rep.restrictions).toContainEqual({ kind: 'EXPIRATION_CAP', limit: 6, omittedExpirations: 2, omittedContracts: 24 });
  });

  it('omitted expirations without strike lists: omitted contract count is unknown (null), never estimated', async () => {
    const fx = synthetic([370, 400, 500, 600, 700, 760, 820, 890].map(plusDays), 20);
    fx.nestedChain.data.items[0].expirations.forEach((e: Record<string, unknown>) => { if (e['expiration-date'] === plusDays(370)) delete e.strikes; });
    const rep = (await acquireLeapsChain('SYN', provider(fx).get, NOW, P)).chain!.acquisition;
    expect(rep.contracts.omittedInOmittedExpirations).toBeNull();
  });

  it('quote limit: above 1,000 contracts nothing is quoted or truncated; acquisition incomplete', async () => {
    const fx = synthetic([500, 600, 700].map(plusDays), 600); // 360 band candidates per expiration -> 1,080
    const { get, log } = provider(fx);
    const r = await acquireLeapsChain('SYN', get, NOW, P);
    const rep = r.chain!.acquisition;
    expect(rep.quoteLimitExceeded).toBe(true);
    expect(rep.coverage).toBe('RESTRICTED');
    expect(rep.contracts.selectedForQuote).toBe(0);
    expect(rep.contracts.omittedByQuoteLimit).toBe(1080);
    expect(r.chain!.contracts).toHaveLength(0);
    expect(log.filter((p) => p.indexOf('equity-option=') >= 0)).toHaveLength(0);
  });

  it('failed chunk: counted, its contracts become missing rows (not dropped), coverage RESTRICTED', async () => {
    const fx = synthetic([500, 600].map(plusDays), 200); // 120 band candidates each -> 240 -> 3 chunks
    const r = await acquireLeapsChain('SYN', provider(fx, { chunkStatus: (i) => (i === 1 ? 500 : 200) }).get, NOW, P);
    const rep = r.chain!.acquisition;
    expect(rep.contracts.selectedForQuote).toBe(240);
    expect(rep.contracts.quoteChunksFailed).toBe(1);
    expect(rep.contracts.quoteRowsMissing).toBe(100);
    expect(rep.contracts.quoteRowsReceived).toBe(140);
    expect(rep.contracts.quoteRowsMissing + rep.contracts.quoteRowsReceived).toBe(rep.contracts.selectedForQuote);
    expect(rep.restrictions).toContainEqual({ kind: 'CHUNK_FAILURE', failedChunks: 1, contractsInFailedChunks: 100 });
    expect(r.chain!.contracts).toHaveLength(240);
  });

  it('an explicitly non-standard chain (adjusted root) is counted and not quoted (I8)', async () => {
    const fx = synthetic([500].map(plusDays), 20);
    fx.nestedChain.data.items[0]['option-chain-type'] = 'Non-standard';
    const r = await acquireLeapsChain('SYN', provider(fx).get, NOW, P);
    expect(r.chain!.acquisition.contracts.excludedNonStandardRoot).toBe(20);
    expect(r.chain!.contracts).toHaveLength(0);
  });

  it('duplicate quote rows for a symbol: the row is not used', async () => {
    const fx = synthetic([500].map(plusDays), 20);
    fx.optionQuoteRows.push({ ...fx.optionQuoteRows[5] });
    const r = await acquireLeapsChain('SYN', provider(fx).get, NOW, P);
    const dup = r.chain!.contracts.find((c) => c.occSymbol === fx.optionQuoteRows[5].symbol)!;
    expect(dup).toMatchObject({ quote: null, duplicateQuoteRows: true });
  });
});

describe('Gate 4a: run budget and failure paths (Q9)', () => {
  it('retries count against the budget; 429 is retried once after the backoff', async () => {
    const statuses = [429, 200];
    const sleeps: number[] = [];
    const t = createBudgetedTransport(async () => ({ status: statuses.shift()!, body: null }), P, async (ms) => { sleeps.push(ms); });
    await t.get('/x');
    expect(t.requestsUsed()).toBe(2);
    expect(sleeps).toEqual([P.rateLimitBackoffMs]);
  });

  it('429 twice: that underlying is not evaluated (run cap reason); others continue', async () => {
    const fx = synthetic([500].map(plusDays), 20);
    const base = provider(fx).get;
    const get: ProviderGet = async (path) => (path.indexOf('equity=AAA') >= 0 ? { status: 429, body: null } : base(path.replace(/equity=[A-Z]+/, 'equity=SYN')));
    const run = await acquireLeapsRun(['AAA', 'SYN'], { get, nowEpochSeconds: NOW, sleep: runSleep }, { ...P, concurrency: 1 });
    expect(run.results[0]).toMatchObject({ symbol: 'AAA', status: 'NOT_EVALUATED_RUN_CAP', reason: 'LEAPS_NOT_EVALUATED_RUN_CAP' });
    expect(run.results[1].status).toBe('ACQUIRED');
  });

  it('budget exhausted: the in-flight underlying is not evaluated (no partial ladder) and later ones cost nothing', async () => {
    const fx = synthetic([500, 600].map(plusDays), 200); // needs 1 + 1 + 3 = 5 requests
    const { get, log } = provider(fx);
    const run = await acquireLeapsRun(['SYN', 'SYN', 'SYN'], { get, nowEpochSeconds: NOW, sleep: runSleep }, { ...P, concurrency: 1, runRequestBudget: 7 });
    expect(run.results[0].status).toBe('ACQUIRED');
    expect(run.results[1]).toMatchObject({ status: 'NOT_EVALUATED_RUN_CAP', chain: null });
    expect(run.results[2]).toMatchObject({ status: 'NOT_EVALUATED_RUN_CAP', chain: null });
    expect(run.stopped).toBe('RUN_BUDGET_EXHAUSTED');
    expect(run.requestsUsed).toBe(7);
    expect(log).toHaveLength(7);
  });

  it('401 mid-run stops the run: unfinished underlyings are LEAPS_AUTH_EXPIRED, nothing further is requested', async () => {
    const fx = synthetic([500].map(plusDays), 20);
    const base = provider(fx).get;
    let calls = 0;
    const get: ProviderGet = async (path) => {
      calls += 1;
      return calls === 4 ? { status: 401, body: null } : base(path);
    };
    const run = await acquireLeapsRun(['SYN', 'SYN', 'SYN'], { get, nowEpochSeconds: NOW, sleep: runSleep }, { ...P, concurrency: 1 });
    expect(run.results[0].status).toBe('ACQUIRED');
    expect(run.results[1]).toMatchObject({ status: 'AUTH_EXPIRED', reason: 'LEAPS_AUTH_EXPIRED', chain: null });
    expect(run.results[2]).toMatchObject({ status: 'AUTH_EXPIRED', reason: 'LEAPS_AUTH_EXPIRED', chain: null });
    expect(run.stopped).toBe('AUTH_EXPIRED');
    expect(calls).toBe(4);
  });

  it('a stopped transport throws without reaching the provider', async () => {
    let reached = 0;
    const t = createBudgetedTransport(async () => { reached += 1; return { status: 401, body: null }; }, P, noSleep);
    await expect(t.get('/a')).rejects.toBeInstanceOf(LeapsRunStop);
    await expect(t.get('/b')).rejects.toBeInstanceOf(LeapsRunStop);
    expect(reached).toBe(1);
  });

  it('more than 25 underlyings: the excess is not evaluated and costs no request', async () => {
    const fx = synthetic([500].map(plusDays), 4);
    const { get, log } = provider(fx);
    const symbols = Array.from({ length: 27 }, () => 'SYN');
    const run = await acquireLeapsRun(symbols, { get, nowEpochSeconds: NOW, sleep: runSleep }, P);
    expect(run.results.slice(25).every((r) => r.status === 'NOT_EVALUATED_RUN_CAP')).toBe(true);
    expect(run.results.slice(0, 25).every((r) => r.status === 'ACQUIRED')).toBe(true);
    expect(log.length).toBe(25 * 3);
  });

  it('per-underlying timeout: LEAPS_CHAIN_PROVIDER_FAILURE:TIMEOUT for that one only', async () => {
    const fx = synthetic([500].map(plusDays), 4);
    const base = provider(fx).get;
    const get: ProviderGet = (path) => (path.indexOf('equity=SLOW') >= 0 ? new Promise(() => undefined) : base(path.replace(/equity=[A-Z]+/, 'equity=SYN')));
    const timeoutSleep = (ms: number) => (ms === P.perUnderlyingTimeoutMs ? new Promise<void>((r) => setTimeout(r, 30)) : Promise.resolve());
    const run = await acquireLeapsRun(['SLOW', 'SYN'], { get, nowEpochSeconds: NOW, sleep: timeoutSleep }, P);
    expect(run.results[0]).toMatchObject({ symbol: 'SLOW', status: 'CHAIN_FAILED', reason: 'LEAPS_CHAIN_PROVIDER_FAILURE:TIMEOUT' });
    expect(run.results[1].status).toBe('ACQUIRED');
  });
});
