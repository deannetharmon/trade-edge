// scripts/gtc-replace-dryrun/gtc-replace-dryrun.js
//
// GTC-REPLACE-0001 build step 1: dry-run proof. READ-ONLY.
// Paste into the browser console on the TradeEdge Portfolio page (refresh the
// page first so the TastyTrade token is fresh; tokens last ~15 minutes).
// Every order request goes to TastyTrade's /dry-run endpoint: nothing is
// placed, changed or cancelled. The token is used only in request headers and
// is never printed; the account number is masked in the output.
//
// Cases:
//   A  MULL OCO: Limit GTC + Stop (stop-market) GTC
//   B  MULL OCO: Limit Day + Stop (stop-market) GTC
//   C  MULL OCO: Limit GTC + Stop Limit GTC (what TradeEdge builds today; control)
//   D  TQQQ OCO: Limit GTC + Stop GTC while order #511546370 (BTC 1 @ 1.10 GTC)
//      is still working: does TastyTrade reject a second closing bracket?
(async function gtcReplaceDryRun() {
  var BASE = 'https://api.tastytrade.com';
  var token = sessionStorage.getItem('tt_access_token');
  var expiry = Number(localStorage.getItem('tt_access_token_expiry') || 0);
  if (!token || !expiry || Date.now() >= expiry) {
    console.log('%cToken missing or expired: refresh the Portfolio page, then paste this again.', 'color:#f59e0b;font-weight:bold');
    return 'refresh needed';
  }
  var H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' };
  async function get(path) {
    var r = await fetch(BASE + path, { headers: H });
    return { status: r.status, body: await r.json().catch(function () { return null; }) };
  }
  async function dry(acct, body) {
    var r = await fetch(BASE + '/accounts/' + encodeURIComponent(acct) + '/complex-orders/dry-run', { method: 'POST', headers: H, body: JSON.stringify(body) });
    var b = await r.json().catch(function () { return null; });
    var errs = [];
    var e = b && b.error;
    if (e) {
      if (Array.isArray(e.errors)) e.errors.forEach(function (x) { errs.push((x.code || x.domain || '') + ': ' + (x.message || x.reason || JSON.stringify(x))); });
      if (e.message) errs.push(e.message);
    }
    var warns = ((b && b.data && b.data.warnings) || []).map(function (w) { return (w.code ? w.code + ': ' : '') + (w.message || JSON.stringify(w)); });
    return { http: r.status, accepted: r.ok && errs.length === 0, errors: errs, warnings: warns };
  }
  function tick(v) { return v < 3 ? Math.round(v * 100) / 100 : Math.round(v * 20) / 20; }
  function legs(sym) { return [{ 'instrument-type': 'Equity Option', symbol: sym, quantity: 1, action: 'Buy to Close' }]; }
  function limit(sym, price, tif) { return { 'order-type': 'Limit', 'time-in-force': tif, price: price.toFixed(2), 'price-effect': 'Debit', legs: legs(sym) }; }
  function stopMkt(sym, trig) { return { 'order-type': 'Stop', 'time-in-force': 'GTC', 'stop-trigger': trig.toFixed(2), legs: legs(sym) }; }
  function stopLmt(sym, trig) { return { 'order-type': 'Stop Limit', 'time-in-force': 'GTC', 'stop-trigger': trig.toFixed(2), price: tick(trig * 1.1).toFixed(2), 'price-effect': 'Debit', legs: legs(sym) }; }
  async function mark(sym) {
    var q = await get('/market-data/by-type?equity-option[]=' + encodeURIComponent(sym));
    var it = q.body && q.body.data && q.body.data.items && q.body.data.items[0];
    var m = it && Number(it.mark != null ? it.mark : it.mid);
    return Number.isFinite(m) && m > 0 ? m : null;
  }

  var accts = await get('/customers/me/accounts');
  var items = (accts.body && accts.body.data && accts.body.data.items) || [];
  if (accts.status === 401) { console.log('%cToken rejected: refresh the Portfolio page and paste again.', 'color:#f59e0b'); return 'refresh needed'; }
  var MULL = 'MULL  261120P00021000';
  var TQQQ = 'TQQQ  261030P00075500';
  var acct = null;
  for (var i = 0; i < items.length && !acct; i++) {
    var n = items[i].account && items[i].account['account-number'];
    if (!n) continue;
    var p = await get('/accounts/' + encodeURIComponent(n) + '/positions');
    var syms = ((p.body && p.body.data && p.body.data.items) || []).map(function (x) { return x.symbol; });
    if (syms.indexOf(MULL) >= 0 && syms.indexOf(TQQQ) >= 0) acct = n;
  }
  if (!acct) { console.log('%cCould not find an account holding both MULL Nov 20 21P and TQQQ Oct 30 75.5P.', 'color:#f59e0b'); return 'positions not found'; }

  var mm = await mark(MULL), tm = await mark(TQQQ);
  if (!mm || !tm) { console.log('No quote for MULL or TQQQ option (mark MULL=' + mm + ', TQQQ=' + tm + ').'); return 'no quote'; }
  // Far-from-market prices so nothing could fill even if submitted: target 30% of mark, stop at 3x mark.
  var mT = Math.max(0.01, tick(mm * 0.3)), mS = tick(mm * 3), tT = Math.max(0.01, tick(tm * 0.3)), tS = tick(tm * 3);
  var cases = [
    ['A', 'MULL Limit GTC + Stop (market) GTC', { type: 'OCO', orders: [limit(MULL, mT, 'GTC'), stopMkt(MULL, mS)] }],
    ['B', 'MULL Limit Day + Stop (market) GTC', { type: 'OCO', orders: [limit(MULL, mT, 'Day'), stopMkt(MULL, mS)] }],
    ['C', 'MULL Limit GTC + Stop Limit GTC (control)', { type: 'OCO', orders: [limit(MULL, mT, 'GTC'), stopLmt(MULL, mS)] }],
    ['D', 'TQQQ Limit GTC + Stop (market) GTC, existing GTC still working', { type: 'OCO', orders: [limit(TQQQ, tT, 'GTC'), stopMkt(TQQQ, tS)] }],
  ];
  var out = { tool: 'gtc-replace-dryrun/v1', at: new Date().toISOString(), account: '…' + acct.slice(-3), marks: { MULL: mm, TQQQ: tm }, results: [] };
  for (var c = 0; c < cases.length; c++) {
    var r = await dry(acct, cases[c][2]);
    out.results.push({ case: cases[c][0], what: cases[c][1], http: r.http, accepted: r.accepted, errors: r.errors, warnings: r.warnings });
    console.log('%c' + cases[c][0] + ' ' + (r.accepted ? 'ACCEPTED' : 'REJECTED') + ' — ' + cases[c][1], 'font-weight:bold;color:' + (r.accepted ? '#22c55e' : '#ef4444'));
    r.errors.forEach(function (e) { console.log('   error: ' + e); });
    r.warnings.forEach(function (w) { console.log('   warning: ' + w); });
  }
  console.log('Copy everything below and paste it back to Claude:');
  console.log(JSON.stringify(out, null, 2));
  return 'done (dry-run only, nothing placed)';
})();
