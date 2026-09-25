# Entry distribution query (console)

Purpose: see where your actual spread entries sat relative to the expected move, by strategy, to calibrate the amber highlight (see `EM-AMBER-0001` in `docs/ROADMAP.md`).

Run it after roughly 20-30 new spread entries (entries placed before 2026-09-25 recorded no measurements; see `docs/tickets/EM-CONTEXT-0001-expected-move-is-information-only.md`). Open the Trade Log page once first (it promotes recent fills into snapshots), then on any page of the app, while logged in, open DevTools, go to Console and paste:

```js
(async () => {
  const ev = e => (e && e.state === 'AVAILABLE' ? e.value : null);
  const q = (arr, p) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); const i = (a.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return +(a[lo] + (a[hi] - a[lo]) * (i - lo)).toFixed(2); };

  const accRes = await fetch('/api/tastytrade/proxy?path=' + encodeURIComponent('/customers/me/accounts'), { cache: 'no-store' });
  if (!accRes.ok) { console.error('accounts failed', accRes.status); return; }
  const accounts = ((await accRes.json()).data?.items ?? []).map(i => i.account?.['account-number']).filter(Boolean);

  const rows = [];
  for (const accountId of accounts) {
    const res = await fetch('/api/entry-context/snapshots?accountId=' + encodeURIComponent(accountId), { cache: 'no-store' });
    if (!res.ok) { console.warn('snapshots failed for an account', res.status); continue; }
    for (const s of ((await res.json()).snapshots ?? [])) {
      const price = ev(s.underlyingPrice), em = ev(s.expectedMove), otm = ev(s.analysis?.otmBufferPct);
      const emPct = price && em ? (em / price) * 100 : null;
      const delta = ev(s.shortDelta) ?? ev(s.putShortDelta);
      rows.push({
        strategy: s.strategy, symbol: s.symbol, entered: (s.capturedAt || '').slice(0, 10), expiration: s.expiration,
        dte: Math.round((Date.parse(s.expiration) - Date.parse(s.capturedAt)) / 86400000),
        otm_pct: otm != null ? +otm.toFixed(1) : null,
        em_pct: emPct != null ? +emPct.toFixed(1) : null,
        em_multiple: otm != null && emPct ? +(otm / emPct).toFixed(2) : null,
        abs_delta: delta != null ? +Math.abs(delta).toFixed(2) : null,
        ivr: ev(s.ivr) != null ? Math.round(ev(s.ivr)) : null,
        score: ev(s.scoreComposite) != null ? Math.round(ev(s.scoreComposite)) : null,
        override: s.entryQualification?.overridden ? s.entryQualification.state : '',
      });
    }
  }
  console.log('Entry snapshots found:', rows.length);
  const summary = [];
  for (const strat of [...new Set(rows.map(r => r.strategy))]) {
    const r = rows.filter(x => x.strategy === strat);
    const col = k => r.map(x => x[k]).filter(v => v != null);
    for (const k of ['em_multiple', 'otm_pct', 'abs_delta', 'dte', 'ivr']) {
      const v = col(k);
      summary.push({ strategy: strat, metric: k, n: v.length, min: q(v, 0), p25: q(v, .25), median: q(v, .5), p75: q(v, .75), max: q(v, 1) });
    }
    const inside = col('em_multiple').filter(v => v < 1).length;
    summary.push({ strategy: strat, metric: 'entered inside the expected move', n: col('em_multiple').length, min: inside, p25: '', median: '', p75: '', max: '' });
  }
  console.table(summary);
  console.table(rows.sort((a, b) => a.entered.localeCompare(b.entered)).slice(-150));
  copy(JSON.stringify({ summary, rows }, null, 1));
  console.log('Summary and rows copied to clipboard as JSON');
})();
```

Read-only. Paste the first (summary) table back into a session. `em_multiple` is the cushion divided by the expected move, in percent-of-price terms (1.00 = the 1-SD boundary). Limits: spreads only (BPS, BCS, IC); cash-secured puts have no entry snapshots; no outcomes (win or loss) in a snapshot, so read it beside the Performance page's inside/outside split; iron condor cushions use the snapshot's own figure, unverified as the tighter side.
