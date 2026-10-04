// scripts/leaps-provider-audit/leaps-provider-audit.js
//
// LEAPS-QV-0001 Gate 4a: READ-ONLY provider data-audit capture (spec Section 11.1).
//
// WHAT IT IS: a browser-console script. Paste it into the DevTools console of a
// logged-in TradeEdge tab. It calls the app's own same-origin read proxy
// (/api/tastytrade/proxy), which already holds the broker credential server-side.
// This script never reads, sees or asks for a token, cookie or header.
//
// SAFETY (each point is enforced in code and asserted by tests):
//   * GET only, to one same-origin URL (/api/tastytrade/proxy) with a path
//     allow-list of five read-only endpoint shapes. No orders, no account paths.
//   * Option instrument records are captured ONE SYMBOL AT A TIME via
//     GET /instruments/equity-options/{url-encoded OCC symbol}. The bulk form
//     (/instruments/equity-options?symbol[]=...) returns HTTP 403 "Token has
//     insufficient scopes for this request." for this OAuth client; it is probed
//     at most ONCE per run so the 403 is preserved as evidence (bulkProbe: false skips it).
//   * No localStorage / sessionStorage / document.cookie / Authorization access.
//   * Output is sanitized (credential-like keys and values redacted) and then
//     re-scanned; if anything secret-like survives, NOTHING is downloaded.
//   * Raw provider values are preserved. Missing fields and provider errors are
//     recorded explicitly. No unit or timestamp meaning is inferred from magnitude.
//   * Not part of the production bundle: nothing in app/ or lib/ imports this file.
//
// USAGE (see docs/analysis/LEAPS-QV-0001-gate4a-provider-audit-runbook.md):
//   await TE_LEAPS_AUDIT.run({ sessionLabel: 'REGULAR_HOURS', symbols: ['SPY', 'AAPL'] });

(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.TE_LEAPS_AUDIT = api;
})(this, function () {
  'use strict';

  var FORMAT = 'leaps-provider-audit/v2';
  var ACCEPTED_FORMATS = ['leaps-provider-audit/v1', FORMAT];
  var TOOL_VERSION = '1.1.0';
  var PROXY = '/api/tastytrade/proxy';
  var SESSION_LABELS = ['REGULAR_HOURS', 'AFTER_HOURS', 'WEEKEND_CLOSED'];

  // ------------------------------------------------------------------ allow-list
  var SYM = '[A-Za-z0-9._-]{1,15}';
  var ENC = '[A-Za-z0-9%._-]{1,60}'; // url-encoded OCC symbol
  var PATH_ALLOW = [
    new RegExp('^/instruments/equities/' + SYM + '$'),
    new RegExp('^/instruments/equity-options/' + ENC + '$'),
    new RegExp('^/instruments/equity-options\\?symbol\\[\\]=' + ENC + '(?:&symbol\\[\\]=' + ENC + '){0,24}$'),
    new RegExp('^/option-chains/' + SYM + '/nested$'),
    new RegExp('^/market-data/by-type\\?(?:equity|index|equity-option)=' + ENC + '(?:&equity-option=' + ENC + '){0,99}$'),
  ];

  function isAllowedPath(path) {
    return typeof path === 'string' && PATH_ALLOW.some(function (re) { return re.test(path); });
  }

  // ------------------------------------------------------------------ sanitizer
  var DENY_KEY = /token|secret|password|passwd|authorization|cookie|session[-_ ]?(id|token|key)|account|customer|e-?mail|phone|address|ssn|tax[-_ ]?id|api[-_]?key|bearer|credential|refresh|login|user[-_ ]?(id|name)/i;
  var VALUE_PATTERNS = [
    ['JWT', /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/],
    ['BEARER', /Bearer\s+\S+/i],
    ['EMAIL', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
    ['OPAQUE_TOKEN', /[A-Za-z0-9_-]{40,}/],
    ['ACCOUNT_NUMBER', /\b\d[A-Z]{2}\d{5}\b/],
  ];
  var REDACTED = '[REDACTED]';

  function redactString(s, path, out) {
    var result = s;
    VALUE_PATTERNS.forEach(function (p) {
      var re = new RegExp(p[1].source, p[1].flags.indexOf('g') >= 0 ? p[1].flags : p[1].flags + 'g');
      if (re.test(result)) {
        out.push({ path: path, reason: 'VALUE_' + p[0] });
        result = result.replace(re, REDACTED);
      }
    });
    return result;
  }

  // Returns { value, redactions }. undefined is dropped (JSON cannot carry it);
  // null is preserved. Numbers and booleans are untouched.
  function sanitize(value, path, redactions) {
    var reds = redactions || [];
    var p = path || '$';
    function walk(v, vp) {
      if (v === null) return null;
      if (typeof v === 'string') return redactString(v, vp, reds);
      if (typeof v === 'number' || typeof v === 'boolean') return v;
      if (Array.isArray(v)) return v.map(function (x, i) { return walk(x, vp + '[' + i + ']'); });
      if (typeof v === 'object') {
        var o = {};
        Object.keys(v).forEach(function (k) {
          if (v[k] === undefined) return;
          if (DENY_KEY.test(k)) { o[k] = REDACTED; reds.push({ path: vp + '.' + k, reason: 'KEY_DENYLIST' }); return; }
          o[k] = walk(v[k], vp + '.' + k);
        });
        return o;
      }
      return String(v);
    }
    return { value: walk(value, p), redactions: reds };
  }

  // Defence in depth: scan an assembled export. Returns offending paths.
  function findSecrets(obj) {
    var hits = [];
    (function walk(v, path) {
      if (typeof v === 'string') {
        if (v === REDACTED) return;
        VALUE_PATTERNS.forEach(function (p) { if (p[1].test(v)) hits.push(path + ' (' + p[0] + ')'); });
      } else if (Array.isArray(v)) {
        v.forEach(function (x, i) { walk(x, path + '[' + i + ']'); });
      } else if (v && typeof v === 'object') {
        Object.keys(v).forEach(function (k) {
          if (DENY_KEY.test(k) && v[k] !== REDACTED) hits.push(path + '.' + k + ' (KEY_NOT_REDACTED)');
          walk(v[k], path + '.' + k);
        });
      }
    })(obj, '$');
    return hits;
  }

  // ------------------------------------------------------------------ field presence
  var TIMESTAMP_LIKE = /time|date|updated|timestamp|stamp/i;

  function typeOfValue(v) { return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v; }

  // Per-field presence across records. Raw sample values are kept as received.
  // timestampLike fields are flagged for human review; NO unit/semantics is inferred.
  function fieldPresence(records) {
    var list = (records || []).filter(function (r) { return r && typeof r === 'object'; });
    var keys = [];
    list.forEach(function (r) { Object.keys(r).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
    keys.sort();
    // An array of {name,...} (not a map keyed by field name) so that a credential-like
    // FIELD NAME (kept as evidence that the field exists) is never confused with a leaked secret.
    var fields = [];
    keys.forEach(function (k) {
      var present = 0, nulls = 0, types = {}, samples = [];
      list.forEach(function (r) {
        if (!Object.prototype.hasOwnProperty.call(r, k)) return;
        present += 1;
        var v = r[k];
        if (v === null) nulls += 1;
        var t = typeOfValue(v);
        types[t] = (types[t] || 0) + 1;
        if (samples.length < 3 && v !== null && typeof v !== 'object' && samples.indexOf(v) < 0) samples.push(v);
      });
      fields.push({
        name: k,
        present: present,
        absent: list.length - present,
        nullCount: nulls,
        types: types,
        rawSamples: samples,
        timestampLike: TIMESTAMP_LIKE.test(k),
        unitOrSemanticsInferred: null,
      });
    });
    return { recordCount: list.length, fields: fields };
  }

  // ------------------------------------------------------------------ helpers
  function nyContext(epochMs) {
    var parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour12: false, weekday: 'long',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(epochMs)).forEach(function (x) { parts[x.type] = x.value; });
    var hour = parts.hour === '24' ? '00' : parts.hour;
    return {
      nyDate: parts.year + '-' + parts.month + '-' + parts.day,
      nyTime: hour + ':' + parts.minute + ':' + parts.second,
      nyWeekday: parts.weekday,
    };
  }

  function calendarDaysBetween(fromYmd, toYmd) {
    var a = fromYmd.split('-').map(Number), b = toYmd.split('-').map(Number);
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
  }

  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'string' && v.trim() !== '') { var n = Number(v); return isFinite(n) ? n : null; }
    return null;
  }

  function median(nums) {
    if (!nums.length) return null;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function extractRecords(json) {
    var d = json && json.data;
    if (d && Array.isArray(d.items)) return { shape: 'data.items[]', records: d.items };
    if (d && typeof d === 'object') return { shape: 'data{}', records: [d] };
    return { shape: 'none', records: [] };
  }

  function compactStamp(epochMs) { return new Date(epochMs).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); }

  // ------------------------------------------------------------------ capture
  function defaultDownload(filename, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  async function run(opts, deps) {
    var o = opts || {};
    var d = deps || {};
    var doFetch = d.fetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    var now = d.now || function () { return Date.now(); };
    var sleep = d.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var download = d.download || defaultDownload;
    var log = d.log || function (m) { if (typeof console !== 'undefined') console.log(m); };
    if (!doFetch) throw new Error('fetch is not available');

    if (SESSION_LABELS.indexOf(o.sessionLabel) < 0) {
      throw new Error('sessionLabel is required and must be one of ' + SESSION_LABELS.join(', '));
    }
    var symbols = (o.symbols || []).map(function (s) { return String(s).toUpperCase().trim(); }).filter(Boolean);
    if (!symbols.length) throw new Error('symbols is required (for example ["SPY","AAPL"])');
    var cfg = {
      sessionLabel: o.sessionLabel,
      notes: o.notes || null,
      symbols: symbols,
      indexSymbols: (o.indexSymbols || []).map(function (s) { return String(s).toUpperCase(); }),
      dteMin: o.dteMin != null ? o.dteMin : 365,   // spec-proposed window; audit sampling only, not a policy decision
      dteMax: o.dteMax != null ? o.dteMax : 900,
      chunkSize: Math.min(100, o.chunkSize || 100),
      maxQuoteSymbols: o.maxQuoteSymbols != null ? o.maxQuoteSymbols : 300,
      optionInstrumentSample: o.optionInstrumentSample != null ? o.optionInstrumentSample : 6,
      bulkProbe: o.bulkProbe !== false,           // one bulk-endpoint call per run, kept only as 403 evidence
      maxRequests: o.maxRequests != null ? o.maxRequests : 150,
      delayMs: o.delayMs != null ? o.delayMs : 200,
    };

    var startedMs = now();
    var capture = {
      captureStartedAtUtc: new Date(startedMs).toISOString(),
      captureStartedEpochMs: startedMs,
      timeZoneOffsetMinutes: new Date(startedMs).getTimezoneOffset(),
      newYorkWallClock: nyContext(startedMs),
      declaredSessionLabel: cfg.sessionLabel,
      sessionContextNote: 'Declared by the operator plus a New York wall-clock observation. This tool makes no market-state, holiday or early-close inference.',
      clockNote: 'Browser clock; provider timestamps are recorded raw and are not reconciled with it.',
    };

    var redactions = [];
    var requestLog = [];
    var state = { aborted: null, count: 0 };

    // The ONLY network call in this file.
    async function get(logicalPath, purpose) {
      if (!isAllowedPath(logicalPath)) throw new Error('Path not allowed by audit allow-list: ' + logicalPath);
      if (state.aborted) return { skipped: true };
      if (state.count >= cfg.maxRequests) { state.aborted = 'REQUEST_BUDGET_EXHAUSTED'; return { skipped: true }; }
      state.count += 1;
      if (state.count > 1 && cfg.delayMs) await sleep(cfg.delayMs);
      var t0 = now();
      var rec = { n: state.count, purpose: purpose, path: logicalPath, startedEpochMs: t0 };
      var json = null;
      try {
        var res = await doFetch(PROXY + '?path=' + encodeURIComponent(logicalPath), {
          method: 'GET', cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' },
        });
        rec.httpStatus = res.status;
        rec.ok = !!res.ok;
        rec.contentType = (res.headers && res.headers.get && res.headers.get('content-type')) || null;
        var text = await res.text();
        if (text === '') rec.bodyKind = 'empty';
        else {
          try { json = JSON.parse(text); rec.bodyKind = 'json'; }
          catch (e) {
            rec.bodyKind = 'non-json';
            rec.bodySnippet = sanitize(text.slice(0, 500), '$.requests[' + state.count + '].bodySnippet', redactions).value;
          }
        }
        if (!res.ok && json !== null) rec.errorBody = sanitize(json, '$.requests[' + state.count + '].errorBody', redactions).value;
        if (res.status === 401) state.aborted = 'HTTP_401_SESSION_EXPIRED';
        if (res.status === 429) state.aborted = 'HTTP_429_RATE_LIMITED';
      } catch (e) {
        rec.ok = false;
        rec.bodyKind = 'network-error';
        rec.networkError = sanitize(String(e && e.message ? e.message : e).slice(0, 300), '$.requests[' + state.count + '].networkError', redactions).value;
      }
      rec.durationMs = now() - t0;
      requestLog.push(rec);
      return { rec: rec, json: rec.ok ? json : null };
    }

    function clean(v, path) { return sanitize(v, path, redactions).value; }

    var results = [];
    var bulkProbedOn = null;
    for (var si = 0; si < symbols.length; si++) {
      var symbol = symbols[si];
      var isIndex = cfg.indexSymbols.indexOf(symbol) >= 0;
      var out = { symbol: symbol, treatedAsIndex: isIndex, errors: [] };
      var base = '$.results[' + si + ']';
      try {
        // 1. equity instrument record
        var inst = await get('/instruments/equities/' + symbol, 'equity-instrument');
        if (!inst.skipped) {
          out.equityInstrument = inst.rec.ok
            ? { recordShape: extractRecords(inst.json).shape, data: clean(inst.json && inst.json.data, base + '.equityInstrument.data'),
                fieldPresence: fieldPresence(clean(extractRecords(inst.json).records, base + '.equityInstrument.fp')) }
            : { httpStatus: inst.rec.httpStatus, error: inst.rec.errorBody || inst.rec.bodySnippet || inst.rec.networkError || null };
        }

        // 2. underlying quote (timestamped fields kept raw)
        var q = await get('/market-data/by-type?' + (isIndex ? 'index' : 'equity') + '=' + encodeURIComponent(symbol), 'underlying-quote');
        var spot = null;
        if (!q.skipped) {
          if (q.rec.ok) {
            var qr = extractRecords(q.json);
            var qItems = clean(qr.records, base + '.underlyingQuote.items');
            out.underlyingQuote = { recordShape: qr.shape, itemCount: qItems.length, items: qItems, fieldPresence: fieldPresence(qItems) };
            var first = qItems[0] || {};
            var last = toNumber(first.last), bid = toNumber(first.bid), ask = toNumber(first.ask);
            if (last != null) { spot = last; out.spotUsedForLadderCountsOnly = 'last'; }
            else if (bid != null && ask != null) { spot = (bid + ask) / 2; out.spotUsedForLadderCountsOnly = 'mid(bid,ask)'; }
            else out.spotUsedForLadderCountsOnly = null;
          } else {
            out.underlyingQuote = { httpStatus: q.rec.httpStatus, error: q.rec.errorBody || q.rec.bodySnippet || q.rec.networkError || null };
          }
        }

        // 3. nested chain -> shape + ladder measurement
        var nested = await get('/option-chains/' + symbol + '/nested', 'nested-chain');
        var windowCalls = [];   // { occ, item, expirationDate, dte, strike }
        if (!nested.skipped) {
          if (!nested.rec.ok) {
            out.nestedChain = { httpStatus: nested.rec.httpStatus, error: nested.rec.errorBody || nested.rec.bodySnippet || nested.rec.networkError || null };
          } else {
            var items = (nested.json && nested.json.data && nested.json.data.items) || [];
            var itemSummaries = [], ladderRows = [], expirationRecords = [], strikeRecords = [];
            items.forEach(function (it, ii) {
              var rest = {}, exps = Array.isArray(it.expirations) ? it.expirations : [];
              Object.keys(it).forEach(function (k) { if (k !== 'expirations') rest[k] = it[k]; });
              itemSummaries.push({ item: ii, itemFields: clean(rest, base + '.nestedChain.items[' + ii + ']'), expirationCount: exps.length, expirationsFieldPresent: Array.isArray(it.expirations) });
              exps.forEach(function (ex, ei) {
                var strikes = Array.isArray(ex.strikes) ? ex.strikes : [];
                var expRest = {};
                Object.keys(ex).forEach(function (k) { if (k !== 'strikes') expRest[k] = ex[k]; });
                var expDate = expRest['expiration-date'];
                var dte = typeof expDate === 'string' ? calendarDaysBetween(capture.newYorkWallClock.nyDate, expDate) : null;
                var inWindow = dte != null && dte >= cfg.dteMin && dte <= cfg.dteMax;
                var calls = 0, puts = 0, below = 0, atOrAbove = 0, unknownStrike = 0;
                strikes.forEach(function (sk) {
                  var kn = toNumber(sk['strike-price']);
                  if (sk.call) {
                    calls += 1;
                    if (kn == null || spot == null) unknownStrike += 1; else if (kn < spot) below += 1; else atOrAbove += 1;
                    if (inWindow) windowCalls.push({ occ: sk.call, item: ii, expirationDate: expDate, dte: dte, strike: kn });
                  }
                  if (sk.put) puts += 1;
                });
                var strikeRef = clean(expRest, base + '.nestedChain.items[' + ii + '].expirations[' + ei + ']');
                expirationRecords.push(strikeRef);
                if (inWindow) strikes.forEach(function (sk) { strikeRecords.push(clean(sk, base + '.nestedChain.strike')); });
                ladderRows.push({
                  item: ii, expirationDate: expDate === undefined ? null : expDate, calendarDaysFromCaptureNyDate: dte, inWindow: inWindow,
                  strikeCount: strikes.length, callCount: calls, putCount: puts,
                  callsBelowSpot: spot == null ? null : below, callsAtOrAboveSpot: spot == null ? null : atOrAbove, callsWithUnparseableStrikeOrNoSpot: unknownStrike,
                });
              });
            });
            var inWin = ladderRows.filter(function (r) { return r.inWindow; });
            var belowCounts = inWin.map(function (r) { return r.callsBelowSpot; }).filter(function (x) { return x != null; });
            out.nestedChain = {
              itemCount: items.length,
              items: itemSummaries,
              expirationFieldPresence: fieldPresence(expirationRecords),
              inWindowStrikeFieldPresence: fieldPresence(strikeRecords),
              inWindowStrikes: strikeRecords,
              ladder: {
                window: { dteMin: cfg.dteMin, dteMax: cfg.dteMax, basis: 'calendar days from capture New York date; audit sampling only' },
                spotAvailable: spot != null,
                expirationsTotal: ladderRows.length,
                expirationsInWindow: inWin.length,
                inWindowCallSymbols: windowCalls.length,
                inWindowCallsBelowSpotTotal: spot == null ? null : belowCounts.reduce(function (a, b) { return a + b; }, 0),
                callsBelowSpotPerInWindowExpiration: belowCounts.length ? { min: Math.min.apply(null, belowCounts), median: median(belowCounts), max: Math.max.apply(null, belowCounts) } : null,
                perExpiration: ladderRows,
              },
            };
          }
        }

        // 4. option instrument records (sample, incl. non-item-0 roots when present)
        if (windowCalls.length) {
          var sample = [];
          var byDte = windowCalls.slice().sort(function (a, b) { return a.expirationDate < b.expirationDate ? -1 : a.expirationDate > b.expirationDate ? 1 : (a.strike || 0) - (b.strike || 0); });
          var step = Math.max(1, Math.floor(byDte.length / Math.max(1, cfg.optionInstrumentSample)));
          for (var k = 0; k < byDte.length && sample.length < cfg.optionInstrumentSample; k += step) sample.push(byDte[k].occ);
          windowCalls.filter(function (c) { return c.item > 0; }).slice(0, 2).forEach(function (c) { if (sample.indexOf(c.occ) < 0) sample.push(c.occ); });
          sample = sample.slice(0, 25);
          // 4a. bulk endpoint: evidence probe only (once per run). Its records are never
          //     used; a 403 here is the expected, documented scope restriction.
          if (cfg.bulkProbe && bulkProbedOn === null) {
            bulkProbedOn = symbol;
            var batchPath = '/instruments/equity-options?' + sample.map(function (s) { return 'symbol[]=' + encodeURIComponent(s); }).join('&');
            var batch = await get(batchPath, 'option-instruments-bulk-probe');
            if (!batch.skipped) {
              out.optionInstrumentsBulkProbe = {
                purpose: 'evidence only; records come from the individual lookups below',
                requestedSymbols: sample, httpStatus: batch.rec.httpStatus, ok: batch.rec.ok,
                error: batch.rec.ok ? null : (batch.rec.errorBody || batch.rec.bodySnippet || batch.rec.networkError || null),
                recordCount: batch.rec.ok ? extractRecords(batch.json).records.length : null,
              };
            }
          } else {
            out.optionInstrumentsBulkProbe = { skipped: true, reason: cfg.bulkProbe ? 'PROBED_ONCE_PER_RUN' : 'BULK_PROBE_DISABLED', probedOnSymbol: bulkProbedOn };
          }

          // 4b. the same sample, one URL-encoded OCC symbol per request
          var lookups = [], instRecs = [];
          for (var li = 0; li < sample.length; li++) {
            var one = await get('/instruments/equity-options/' + encodeURIComponent(sample[li]), 'option-instrument-individual');
            if (one.skipped) { lookups.push({ requestedSymbol: sample[li], skipped: true, reason: state.aborted }); break; }
            if (one.rec.ok) {
              var orr = extractRecords(one.json);
              var oRecs = clean(orr.records, base + '.optionInstruments.lookups[' + li + ']');
              instRecs = instRecs.concat(oRecs);
              lookups.push({ requestedSymbol: sample[li], httpStatus: one.rec.httpStatus, ok: true, recordShape: orr.shape, recordCount: oRecs.length });
            } else {
              lookups.push({ requestedSymbol: sample[li], httpStatus: one.rec.httpStatus, ok: false, error: one.rec.errorBody || one.rec.bodySnippet || one.rec.networkError || null });
            }
          }
          out.optionInstruments = {
            method: 'individual GET /instruments/equity-options/{url-encoded OCC symbol}',
            requestedSymbols: sample,
            attempted: lookups.filter(function (l) { return !l.skipped; }).length,
            succeeded: lookups.filter(function (l) { return l.ok; }).length,
            failed: lookups.filter(function (l) { return l.ok === false; }).length,
            lookups: lookups,
            recordCount: instRecs.length,
            records: instRecs,
            fieldPresence: fieldPresence(instRecs),
          };

          // 5. option quotes in chunks; record partial-response behavior
          var cands = windowCalls.filter(function (c) { return spot == null || (c.strike != null && c.strike < spot); });
          cands.sort(function (a, b) {
            var da = Math.abs(a.dte - 730), db = Math.abs(b.dte - 730);
            return da - db || (a.expirationDate < b.expirationDate ? -1 : a.expirationDate > b.expirationDate ? 1 : 0) || (a.strike || 0) - (b.strike || 0);
          });
          var selected = cands.slice(0, cfg.maxQuoteSymbols).map(function (c) { return c.occ; });
          var chunks = [], allQuoteItems = [];
          for (var ci = 0; ci * cfg.chunkSize < selected.length; ci++) {
            var chunk = selected.slice(ci * cfg.chunkSize, (ci + 1) * cfg.chunkSize);
            var qs = chunk.map(function (s) { return 'equity-option=' + encodeURIComponent(s); }).join('&');
            var cr = await get('/market-data/by-type?' + qs, 'option-quotes-chunk-' + ci);
            if (cr.skipped) { chunks.push({ chunkIndex: ci, requested: chunk.length, skipped: true, reason: state.aborted }); break; }
            var row = { chunkIndex: ci, requested: chunk.length, httpStatus: cr.rec.httpStatus, ok: cr.rec.ok };
            if (cr.rec.ok) {
              var er = extractRecords(cr.json);
              var qi = clean(er.records, base + '.optionQuotes.chunk' + ci);
              var reqSet = {}, reqNorm = {};
              chunk.forEach(function (s) { reqSet[s] = true; reqNorm[s.replace(/\s+/g, '')] = true; });
              var seen = {}, dup = 0, unexpected = 0, retSyms = {}, retNorm = {};
              qi.forEach(function (it) {
                var sy = typeof it.symbol === 'string' ? it.symbol : null;
                if (sy == null) { unexpected += 1; return; }
                if (seen[sy]) dup += 1;
                seen[sy] = true; retSyms[sy] = true; retNorm[sy.replace(/\s+/g, '')] = true;
                if (!reqSet[sy]) unexpected += 1;
              });
              var missing = chunk.filter(function (s) { return !retSyms[s]; });
              var missingNorm = chunk.filter(function (s) { return !retNorm[s.replace(/\s+/g, '')]; });
              row.recordShape = er.shape;
              row.itemsReturned = qi.length;
              row.requestedSymbolsMissingFromResponse = missing.length;
              row.requestedSymbolsMissingAfterWhitespaceNormalization = missingNorm.length;
              row.missingSample = missing.slice(0, 20);
              row.unexpectedOrSymbollessItems = unexpected;
              row.duplicateSymbolsReturned = dup;
              allQuoteItems = allQuoteItems.concat(qi);
            } else {
              row.error = cr.rec.errorBody || cr.rec.bodySnippet || cr.rec.networkError || null;
              row.itemsReturned = 0;
            }
            chunks.push(row);
          }
          out.optionQuotes = {
            selection: { order: 'abs(calendar DTE - 730) asc, expiration asc, strike asc (audit sampling only, not the production priority)', candidates: cands.length, selected: selected.length, truncatedByMaxQuoteSymbols: cands.length > selected.length, spotKnown: spot != null },
            chunkSize: cfg.chunkSize,
            chunks: chunks,
            fieldPresence: fieldPresence(allQuoteItems),
            items: allQuoteItems,
          };
        } else if (out.nestedChain && !out.nestedChain.error) {
          out.optionQuotes = { skipped: true, reason: 'NO_IN_WINDOW_CALLS' };
        }
      } catch (e) {
        out.errors.push(clean(String(e && e.message ? e.message : e).slice(0, 300), base + '.errors'));
      }
      results.push(out);
      log('[leaps-audit] ' + symbol + ' done (' + state.count + ' requests so far)');
      if (state.aborted) { log('[leaps-audit] stopped: ' + state.aborted); break; }
    }

    var byStatus = {};
    requestLog.forEach(function (r) { var k = String(r.httpStatus != null ? r.httpStatus : r.bodyKind); byStatus[k] = (byStatus[k] || 0) + 1; });
    var finishedMs = now();
    var exported = {
      format: FORMAT,
      toolVersion: TOOL_VERSION,
      auditNote: 'Raw provider values are preserved. Units and timestamp semantics are NOT inferred by this tool; fields flagged timestampLike are for human review.',
      capture: Object.assign({}, capture, { captureFinishedAtUtc: new Date(finishedMs).toISOString(), durationMs: finishedMs - startedMs }),
      config: cfg,
      complete: !state.aborted && results.length === symbols.length,
      abortedReason: state.aborted,
      requests: { total: requestLog.length, byStatus: byStatus, log: requestLog },
      results: results,
      redaction: { count: redactions.length, entries: redactions.slice(0, 200) },
    };

    var hits = findSecrets(exported);
    if (hits.length) {
      var msg = 'Sanitizer self-check FAILED; nothing was downloaded. Offending paths: ' + hits.slice(0, 10).join('; ');
      log('[leaps-audit] ' + msg);
      throw new Error(msg);
    }
    var filename = 'leaps-provider-audit_' + cfg.sessionLabel + '_' + compactStamp(startedMs) + '.json';
    download(filename, JSON.stringify(exported, null, 2));
    log('[leaps-audit] saved ' + filename + ' (' + requestLog.length + ' requests, ' + redactions.length + ' redactions, complete=' + exported.complete + ')');
    if (typeof window !== 'undefined') window.__TE_LEAPS_AUDIT_LAST = { filename: filename, summary: { requests: requestLog.length, complete: exported.complete, abortedReason: state.aborted } };
    return { filename: filename, exported: exported };
  }

  // Structural check of an export (also usable on a downloaded file's parsed JSON).
  function validate(exp) {
    var problems = [];
    if (!exp || ACCEPTED_FORMATS.indexOf(exp.format) < 0) problems.push('format must be one of ' + ACCEPTED_FORMATS.join(', '));
    if (!exp || !exp.capture || SESSION_LABELS.indexOf(exp.capture.declaredSessionLabel) < 0) problems.push('capture.declaredSessionLabel missing or invalid');
    if (!exp || !exp.capture || !exp.capture.captureStartedAtUtc) problems.push('capture.captureStartedAtUtc missing');
    if (!exp || !exp.requests || !Array.isArray(exp.requests.log)) problems.push('requests.log missing');
    if (!exp || !Array.isArray(exp.results)) problems.push('results missing');
    if (exp && Array.isArray(exp.requests && exp.requests.log)) {
      exp.requests.log.forEach(function (r, i) { if (r.path && !isAllowedPath(r.path)) problems.push('requests.log[' + i + '] path outside allow-list'); });
    }
    if (exp) findSecrets(exp).forEach(function (h) { problems.push('secret-like content at ' + h); });
    return { ok: problems.length === 0, problems: problems };
  }

  // Quick in-console check that the sanitizer works before any real capture.
  function selfTest() {
    var planted = {
      'access-token': 'abc', Authorization: 'Bearer xyz', 'account-number': '5WX12345',
      note: 'contact dean@example.com token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk',
      symbol: 'AAPL  261218C00190000', bid: '1.25', missing: null,
    };
    var s = sanitize(planted);
    var ok = s.value['access-token'] === REDACTED && s.value.Authorization === REDACTED && s.value['account-number'] === REDACTED &&
      s.value.note.indexOf('@') < 0 && s.value.note.indexOf('eyJ') < 0 && s.value.symbol === planted.symbol && s.value.bid === '1.25' && s.value.missing === null &&
      findSecrets(s.value).length === 0;
    return { ok: ok, redactions: s.redactions.length };
  }

  return {
    FORMAT: FORMAT, TOOL_VERSION: TOOL_VERSION, SESSION_LABELS: SESSION_LABELS,
    run: run, validate: validate, selfTest: selfTest,
    // exported for tests
    _internals: { isAllowedPath: isAllowedPath, sanitize: sanitize, findSecrets: findSecrets, fieldPresence: fieldPresence, calendarDaysBetween: calendarDaysBetween, nyContext: nyContext },
  };
});
