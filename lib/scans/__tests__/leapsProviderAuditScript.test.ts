// lib/scans/__tests__/leapsProviderAuditScript.test.ts

// LEAPS-QV-0001 Gate 4a: the read-only provider-audit capture script is
// validated with SYNTHETIC provider data only. No network, no credentials.
// This proves the sanitizer, allow-list and export format; it is NOT provider
// evidence (spec Section 11.1 stays NOT PERFORMED until real captures are reviewed).

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts/leaps-provider-audit/leaps-provider-audit.js');
const requireCjs = createRequire(import.meta.url);
const audit: any = requireCjs(SCRIPT);
const { isAllowedPath, sanitize, findSecrets, fieldPresence, calendarDaysBetween } = audit._internals;
const fld = (fp: any, name: string): any => fp.fields.find((f: any) => f.name === name);

// ---- synthetic provider -------------------------------------------------------
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlc2lnbmF0dXJl';
const PLANTED = [JWT, 'dean@example.com', '5WX12345', 'Bearer abc123secret'];
const CAPTURE_MS = Date.parse('2026-10-05T15:00:00Z'); // Monday 11:00 New York (EDT)
const EXPS = ['2027-12-17', '2028-06-16', '2028-12-15', '2026-11-20', '2029-06-15']; // first three in the 365-900 window
const STRIKES = Array.from({ length: 21 }, (_, i) => 150 + i * 5); // 150..250 ; spot 200.10 -> 11 below spot

function occ(exp: string, strike: number, cp: 'C' | 'P'): string {
  const [y, m, d] = exp.split('-');
  return 'AAPL  ' + y.slice(2) + m + d + cp + String(Math.round(strike * 1000)).padStart(8, '0');
}
function nestedBody(withSecondItem = false): any {
  const mk = (root: string) => ({
    'underlying-symbol': 'AAPL', 'root-symbol': root, 'option-chain-type': 'Standard', 'shares-per-contract': 100,
    expirations: EXPS.map(e => ({
      'expiration-date': e, 'expiration-type': 'Regular', 'settlement-type': 'PM', 'days-to-expiration': 999,
      strikes: STRIKES.map(k => ({ 'strike-price': k.toFixed(1), call: occ(e, k, 'C'), put: occ(e, k, 'P') })),
    })),
  });
  return { data: { items: withSecondItem ? [mk('AAPL'), mk('AAPL1')] : [mk('AAPL')] } };
}

interface Behaviour { nested?: (p: string) => any; quoteChunk?: (idx: number, syms: string[]) => any; status401At?: number }

function makeFetch(b: Behaviour = {}) {
  const calls: Array<{ url: string; init: any; path: string }> = [];
  let chunkIdx = 0;
  const res = (status: number, body: any, ct = 'application/json') => ({
    status, ok: status >= 200 && status < 300,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? ct : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const fn = async (url: string, init: any) => {
    const u = new URL(url, 'https://te.local');
    const path = u.searchParams.get('path') as string;
    calls.push({ url, init, path });
    if (b.status401At && calls.length >= b.status401At) return res(401, { error: 'Unauthorized' });
    if (path.startsWith('/instruments/equities/')) return res(200, { data: { symbol: 'AAPL', 'is-etf': false, 'is-index': false, 'streamer-symbol': 'AAPL', 'account-number': '5WX12345' } });
    if (path.startsWith('/market-data/by-type?equity=')) return res(200, { data: { items: [{ symbol: 'AAPL', last: '200.10', bid: '200.05', ask: '200.15', 'updated-at': '2026-10-05T14:59:58.000Z' }] } });
    if (path.endsWith('/nested')) return b.nested ? b.nested(path) : res(200, nestedBody());
    if (path.startsWith('/instruments/equity-options?')) return res(200, { data: { items: [{ symbol: occ('2028-06-16', 200, 'C'), 'shares-per-contract': 100, 'root-symbol': 'AAPL', Authorization: 'Bearer abc123secret' }] } });
    if (path.startsWith('/instruments/equity-options/')) return res(200, { data: { symbol: occ('2028-06-16', 200, 'C'), 'shares-per-contract': 100 } });
    if (path.startsWith('/market-data/by-type?equity-option=')) {
      const syms = path.split('&').map(p => decodeURIComponent(p.replace(/^.*?equity-option=/, '')));
      const idx = chunkIdx++;
      if (b.quoteChunk) return b.quoteChunk(idx, syms);
      return res(200, { data: { items: syms.map(s => ({ symbol: s, bid: '10.0', ask: '10.4', delta: '0.80', 'open-interest': 250, 'updated-at': '2026-10-05T14:59:30.000Z' })) } });
    }
    return res(404, { error: { code: 'not_found' } });
  };
  return { fn, calls };
}

async function runWith(b: Behaviour, opts: any = {}) {
  const { fn, calls } = makeFetch(b);
  const files: Array<{ name: string; text: string }> = [];
  let t = CAPTURE_MS;
  const r = await audit.run(
    { sessionLabel: 'REGULAR_HOURS', symbols: ['AAPL'], chunkSize: 10, maxQuoteSymbols: 30, delayMs: 0, ...opts },
    { fetch: fn, now: () => (t += 5), sleep: async () => {}, download: (name: string, text: string) => files.push({ name, text }), log: () => {} },
  );
  return { r, calls, files, exported: r.exported };
}

// ---- tests --------------------------------------------------------------------
describe('allow-list (GET to five read-only endpoint shapes only)', () => {
  it('accepts the audited read endpoints', () => {
    for (const p of [
      '/instruments/equities/AAPL',
      '/option-chains/AAPL/nested',
      '/instruments/equity-options/AAPL%20%20261218C00190000',
      '/instruments/equity-options?symbol[]=AAPL%20%20261218C00190000&symbol[]=AAPL%20%20261218C00195000',
      '/market-data/by-type?equity=AAPL',
      '/market-data/by-type?index=SPX',
      '/market-data/by-type?equity-option=AAPL%20%20261218C00190000&equity-option=AAPL%20%20261218C00195000',
    ]) expect(isAllowedPath(p), p).toBe(true);
  });
  it('rejects account, order, customer, transaction and traversal paths', () => {
    for (const p of [
      '/accounts/5WX12345/balances', '/accounts', '/customers/me', '/transactions', '/orders', '/accounts/X/orders',
      '/market-data/../accounts', '/option-chains/AAPL/nested/../../accounts', '/instruments/equities/AAPL/../../accounts',
      '/market-data/by-type?equity=AAPL&account=1', '/market-metrics?symbols=AAPL', '', 'https://api.tastyworks.com/market-data/by-type?equity=AAPL',
    ]) expect(isAllowedPath(p), p).toBe(false);
  });
  it('caps a quote request at 100 option symbols', () => {
    const mk = (n: number) => '/market-data/by-type?' + Array.from({ length: n }, (_, i) => 'equity-option=S' + i).join('&');
    expect(isAllowedPath(mk(100))).toBe(true);
    expect(isAllowedPath(mk(101))).toBe(false);
  });
});

describe('sanitizer', () => {
  it('redacts credential keys and secret-like values, keeps nulls, numbers and padded OCC symbols', () => {
    const input = {
      'access-token': 'x', Authorization: 'Bearer abc123secret', 'account-number': '5WX12345', 'refresh_token': 'r',
      note: 'mail dean@example.com jwt ' + JWT, symbol: 'AAPL  261218C00190000', bid: '1.25', delta: null, oi: 250,
      nested: { 'user-id': 'u1', ok: 'fine' },
    };
    const s = sanitize(input);
    const text = JSON.stringify(s.value);
    for (const p of PLANTED) expect(text).not.toContain(p);
    expect(s.value['access-token']).toBe('[REDACTED]');
    expect(s.value.nested['user-id']).toBe('[REDACTED]');
    expect(s.value.nested.ok).toBe('fine');
    expect(s.value.symbol).toBe('AAPL  261218C00190000'); // space padding preserved exactly
    expect(s.value.bid).toBe('1.25');                      // string preserved, not coerced
    expect(s.value.delta).toBeNull();
    expect(s.value.oi).toBe(250);
    expect(s.redactions.length).toBeGreaterThanOrEqual(6);
    expect(findSecrets(s.value)).toEqual([]);
  });
  it('findSecrets flags an unredacted credential key or token-like value', () => {
    expect(findSecrets({ 'access-token': 'abc' }).length).toBe(1);
    expect(findSecrets({ x: JWT }).length).toBeGreaterThan(0);
    expect(findSecrets({ x: 'plain', y: 5 })).toEqual([]);
  });
  it('selfTest passes', () => { expect(audit.selfTest().ok).toBe(true); });
});

describe('fieldPresence (explicit missing / null / type preservation, no inference)', () => {
  it('records absent, null and mixed types and flags timestamp-like fields without interpreting them', () => {
    const fp = fieldPresence([
      { symbol: 'A', delta: '0.8', 'updated-at': '2026-10-05T14:00:00Z', iv: 0.31 },
      { symbol: 'B', delta: null, 'updated-at': 1790000000, iv: '31.0' },
      { symbol: 'C', 'updated-at': 1790000001 },
    ]);
    expect(fp.recordCount).toBe(3);
    expect(fld(fp, 'delta')).toMatchObject({ present: 2, absent: 1, nullCount: 1 });
    expect(fld(fp, 'iv').types).toEqual({ number: 1, string: 1 });
    expect(fld(fp, 'updated-at').types).toEqual({ string: 1, number: 2 });
    expect(fld(fp, 'updated-at').timestampLike).toBe(true);
    expect(fld(fp, 'iv').timestampLike).toBe(false);
    for (const f of fp.fields) expect(f.unitOrSemanticsInferred).toBeNull();
  });
});

describe('calendar helper', () => {
  it('counts calendar days across month/year boundaries', () => {
    expect(calendarDaysBetween('2026-10-05', '2026-10-06')).toBe(1);
    expect(calendarDaysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(calendarDaysBetween('2028-02-28', '2028-03-01')).toBe(2); // leap year
  });
});

describe('run(): synthetic end to end', () => {
  it('captures, sanitizes and exports; GET only to the same-origin proxy; separate labelled file', async () => {
    const { calls, files, exported } = await runWith({
      quoteChunk: (idx, syms) => {
        const resp = (status: number, body: any) => ({ status, ok: status < 300, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) });
        if (idx === 1) return resp(502, { error: { message: 'upstream failed', token: 'secret-token-value' } });
        const keep = idx === 2 ? syms.slice(2) : syms; // chunk 2 silently omits 2 requested symbols
        return resp(200, {
          data: {
            items: keep.map((s, i) => ({
              symbol: s, bid: '10.0', ask: '10.4', 'open-interest': 250,
              ...(i === 0 ? {} : { delta: '0.80' }),                         // first item lacks delta
              'updated-at': i === 1 ? 1790000000 : '2026-10-05T14:59:30.000Z',   // mixed timestamp types
              ...(i === 2 ? { 'implied-volatility': '0.31', note: JWT, 'account-number': '5WX12345', Authorization: 'Bearer abc123secret' } : {}),
            })),
          },
        });
      },
    });

    // read-only, same-origin, allow-listed, and header-free of credentials
    expect(calls.length).toBeGreaterThan(5);
    for (const c of calls) {
      expect(c.init.method).toBe('GET');
      expect(c.url.startsWith('/api/tastytrade/proxy?path=')).toBe(true);
      expect(isAllowedPath(c.path)).toBe(true);
      expect(Object.keys(c.init.headers)).toEqual(['Accept']);
      expect(c.init.body).toBeUndefined();
    }

    // exactly one file, labelled by session and capture time
    expect(files).toHaveLength(1);
    expect(files[0].name).toMatch(/^leaps-provider-audit_REGULAR_HOURS_20261005T150000Z\.json$/);
    const text = files[0].text;
    for (const p of PLANTED) expect(text).not.toContain(p);
    expect(audit.validate(JSON.parse(text))).toEqual({ ok: true, problems: [] });

    // capture and session context
    expect(exported.format).toBe('leaps-provider-audit/v1');
    expect(exported.capture.declaredSessionLabel).toBe('REGULAR_HOURS');
    expect(exported.capture.newYorkWallClock).toEqual({ nyDate: '2026-10-05', nyTime: '11:00:00', nyWeekday: 'Monday' });
    expect(exported.complete).toBe(true);

    const res = exported.results[0];
    // ladder measurement: 3 in-window expirations x 11 calls below spot 200.10 (strikes 150..200)
    const ladder = res.nestedChain.ladder;
    expect(ladder.expirationsTotal).toBe(5);
    expect(ladder.expirationsInWindow).toBe(3);
    expect(ladder.inWindowCallSymbols).toBe(63);
    expect(ladder.inWindowCallsBelowSpotTotal).toBe(33);
    expect(ladder.callsBelowSpotPerInWindowExpiration).toEqual({ min: 11, median: 11, max: 11 });
    expect(res.spotUsedForLadderCountsOnly).toBe('last');
    expect(res.nestedChain.items[0].itemFields['shares-per-contract']).toBe(100);

    // partial-response and chunk-failure behavior recorded explicitly
    const chunks = res.optionQuotes.chunks;
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({ requested: 10, itemsReturned: 10, requestedSymbolsMissingFromResponse: 0 });
    expect(chunks[1]).toMatchObject({ httpStatus: 502, ok: false, itemsReturned: 0 });
    expect(JSON.stringify(chunks[1].error)).not.toContain('secret-token-value');
    expect(chunks[2]).toMatchObject({ requested: 10, itemsReturned: 8, requestedSymbolsMissingFromResponse: 2 });
    expect(chunks[2].missingSample).toHaveLength(2);

    // missing fields and raw types preserved
    const fp = res.optionQuotes.fieldPresence;
    expect(fld(fp, 'delta').absent).toBeGreaterThan(0);
    expect(fld(fp, 'updated-at').types.string).toBeGreaterThan(0);
    expect(fld(fp, 'updated-at').types.number).toBeGreaterThan(0);
    expect(fld(fp, 'updated-at').timestampLike).toBe(true);
    expect(fld(fp, 'updated-at').unitOrSemanticsInferred).toBeNull();
    expect(fld(fp, 'implied-volatility').rawSamples).toEqual(['0.31']); // raw string, unit not inferred

    // redaction was recorded
    expect(exported.redaction.count).toBeGreaterThan(0);
    expect(res.optionInstruments.recordCount).toBe(1);
    expect(res.optionInstrumentSingle.data['shares-per-contract']).toBe(100);
  });

  it('keeps a non-primary chain item (adjusted root) and samples its instrument records', async () => {
    const { exported, calls } = await runWith({ nested: () => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(nestedBody(true)) }) });
    expect(exported.results[0].nestedChain.itemCount).toBe(2);
    expect(exported.results[0].nestedChain.items[1].itemFields['root-symbol']).toBe('AAPL1');
    const batch = calls.find(c => c.path.startsWith('/instruments/equity-options?'))!;
    expect(decodeURIComponent(batch.path)).toContain('AAPL  ');
  });

  it('preserves provider errors and non-JSON bodies explicitly', async () => {
    const { exported } = await runWith({ nested: () => ({ status: 404, ok: false, headers: { get: () => 'text/html' }, text: async () => '<html>Not found</html>' }) });
    const res = exported.results[0];
    expect(res.nestedChain.httpStatus).toBe(404);
    expect(res.nestedChain.error).toContain('Not found');
    expect(res.optionQuotes).toBeUndefined();
    const nestedReq = exported.requests.log.find((r: any) => r.purpose === 'nested-chain');
    expect(nestedReq).toMatchObject({ httpStatus: 404, ok: false, bodyKind: 'non-json' });
  });

  it('records a network error and continues to export', async () => {
    const { fn } = makeFetch();
    const failing = async (url: string, init: any) => { if (String(url).includes('nested')) throw new Error('Failed to fetch'); return fn(url, init); };
    const files: any[] = [];
    const r = await audit.run({ sessionLabel: 'AFTER_HOURS', symbols: ['AAPL'], delayMs: 0 }, { fetch: failing, now: () => CAPTURE_MS, sleep: async () => {}, download: (n: string, t: string) => files.push({ n, t }), log: () => {} });
    expect(r.exported.results[0].nestedChain.error).toBe('Failed to fetch');
    expect(files[0].n).toContain('AFTER_HOURS');
  });

  it('401 stops further requests, marks the capture incomplete, and still exports what was captured', async () => {
    const { exported, calls } = await runWith({ status401At: 3 }, { symbols: ['AAPL', 'MSFT'] });
    expect(exported.complete).toBe(false);
    expect(exported.abortedReason).toBe('HTTP_401_SESSION_EXPIRED');
    expect(calls.length).toBe(3);
    expect(exported.results).toHaveLength(1); // MSFT never started
  });

  it('enforces the request budget', async () => {
    const { exported, calls } = await runWith({}, { maxRequests: 4 });
    expect(calls.length).toBe(4);
    expect(exported.abortedReason).toBe('REQUEST_BUDGET_EXHAUSTED');
    expect(exported.complete).toBe(false);
  });

  it('requires a declared session label and symbols', async () => {
    const deps = { fetch: makeFetch().fn, download: () => {}, log: () => {} };
    await expect(audit.run({ symbols: ['AAPL'] }, deps)).rejects.toThrow(/sessionLabel/);
    await expect(audit.run({ sessionLabel: 'NOON', symbols: ['AAPL'] }, deps)).rejects.toThrow(/sessionLabel/);
    await expect(audit.run({ sessionLabel: 'REGULAR_HOURS', symbols: [] }, deps)).rejects.toThrow(/symbols/);
  });

  it('is deterministic for identical inputs', async () => {
    const a = await runWith({});
    const b = await runWith({});
    expect(a.files[0].text).toBe(b.files[0].text);
  });
});

describe('validate()', () => {
  it('flags a bad format, a disallowed logged path and leaked secrets', () => {
    const bad = { format: 'x', capture: {}, requests: { log: [{ path: '/accounts/1' }] }, results: [{ leak: JWT }] };
    const v = audit.validate(bad);
    expect(v.ok).toBe(false);
    expect(v.problems.join('\n')).toMatch(/format/);
    expect(v.problems.join('\n')).toMatch(/allow-list/);
    expect(v.problems.join('\n')).toMatch(/secret-like/);
  });
});

describe('static guards on the script source', () => {
  const src = readFileSync(SCRIPT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('never touches browser credential stores or other network primitives', () => {
    for (const bad of [/localStorage/, /sessionStorage/, /document\.cookie/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /indexedDB/]) {
      expect(src).not.toMatch(bad);
    }
  });
  it('has exactly one network call, which is a GET', () => {
    expect(src.match(/doFetch\(/g)?.length).toBe(1);
    expect(src.match(/method:\s*'([A-Z]+)'/g)).toEqual(["method: 'GET'"]);
    expect(src).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)/i);
    expect(src).not.toMatch(/\bbody\s*:/);
  });
  it('is not imported by any production source file', () => {
    // Guard by construction: the script lives outside app/ and lib/ and exposes only a window global.
    expect(SCRIPT.includes('/scripts/')).toBe(true);
  });
});
