// app/debug/alphavantage/page.tsx
//
// Same purpose and register as /debug/fundamentals: bare, no scoring
// logic, exists purely to see Alpha Vantage's REAL response field names
// before anything gets built against guessed ones. One real difference
// worth being explicit about in the UI itself: Alpha Vantage's free tier
// is 25 requests/day total, and a single lookup here costs 4 of those --
// this page warns about that cost directly, since it isn't a Screener
// scan a user runs many times a day, it's a precious, rate-limited
// verification tool.

'use client';

import { useState } from 'react';
import type { AlphaVantageBundle } from '@/lib/fundamentals/alphaVantageClient';

export default function AlphaVantageDebugPage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [bundle, setBundle] = useState<AlphaVantageBundle | null>(null);
  const [cached, setCached] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const lookup = async () => {
    if (!symbol.trim()) return;
    setLoading(true); setError(''); setBundle(null); setCached(null);
    try {
      const response = await fetch(`/api/alphavantage-debug?symbol=${encodeURIComponent(symbol.trim())}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
      setBundle(payload.bundle);
      setCached(payload.cached);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: "var(--font-inter), system-ui, sans-serif", fontSize: 12, color: '#ddd', background: '#111', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 14, marginBottom: 12 }}>Alpha Vantage Debug -- candidate free replacement for FMP fundamentals</h1>
      <p style={{ marginBottom: 8, opacity: 0.7, maxWidth: 720 }}>
        Raw Alpha Vantage response for a symbol -- BALANCE_SHEET, INCOME_STATEMENT, CASH_FLOW, OVERVIEW. Being evaluated
        specifically because FMP's balance-sheet-statement/income-statement/cash-flow-statement/ratios all returned 402
        (Premium Query Parameter) on the real account -- confirmed, not assumed. No scoring math here, purely to see the
        real field names before anything gets built against them.
      </p>
      <p style={{ marginBottom: 16, padding: '8px 12px', background: '#2a1a00', border: '1px solid #a55', borderRadius: 4, color: '#fc8' }}>
        ⚠ Alpha Vantage&apos;s free tier is 25 requests/day, total, across everything. Each lookup here costs 4 of those
        (one per data type). Cached for 7 days per symbol so re-checking the same symbol doesn&apos;t cost more calls --
        but a fresh symbol always does. Spend these deliberately.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') void lookup(); }}
          placeholder="Symbol"
          style={{ background: '#000', border: '1px solid #444', borderRadius: 4, padding: '6px 10px', color: '#fff', width: 120 }} />
        <button onClick={() => void lookup()} disabled={loading}
          style={{ background: '#222', border: '1px solid #444', borderRadius: 4, padding: '6px 14px', color: '#fff', cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>
          {loading ? 'Loading…' : 'Look up (costs 4 calls if not cached)'}
        </button>
      </div>
      {error && <p style={{ color: '#f66', marginBottom: 12 }}>Error: {error}</p>}
      {bundle && (
        <div>
          <p style={{ marginBottom: 8, opacity: 0.7 }}>
            {bundle.symbol} · fetched {bundle.fetchedAt} · {cached ? 'served from cache (no calls spent)' : 'live Alpha Vantage call just made (4 of your 25 daily calls)'}
          </p>

          {(['balanceSheet', 'incomeStatement', 'cashFlow', 'overview'] as const).map(field => (
            <div key={field} style={{ marginBottom: 16 }}>
              <p style={{ color: '#6cf', marginBottom: 4, fontWeight: 'bold' }}>{field}</p>
              <pre style={{ background: '#000', border: '1px solid #333', borderRadius: 4, padding: 12, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(bundle[field], null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
