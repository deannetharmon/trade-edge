// app/debug/fundamentals/page.tsx
//
// FUNDAMENTALS-0001: bare developer/debug view, same register as
// /debug/position-snapshots and /debug/trade-log-validation. Exists
// specifically to let Dean (and this session) see FMP's REAL response
// field names and values before any scoring function gets built against
// them -- Alan's explicit requirement: "I don't want to approve
// thresholds tuned to search-snippet numbers that don't match what FMP's
// own API actually returns." No scoring math lives here, just raw output.

'use client';

import { useState } from 'react';
import type { FundamentalsBundle } from '@/lib/fundamentals/fmpClient';

export default function FundamentalsDebugPage() {
  const [symbol, setSymbol] = useState('NFLX');
  const [bundle, setBundle] = useState<FundamentalsBundle | null>(null);
  const [cached, setCached] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const lookup = async () => {
    if (!symbol.trim()) return;
    setLoading(true); setError(''); setBundle(null); setCached(null);
    try {
      const response = await fetch(`/api/fundamentals?symbol=${encodeURIComponent(symbol.trim())}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
      setBundle(payload.bundle);
      setCached(payload.cached);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', fontSize: 12, color: '#ddd', background: '#111', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 14, marginBottom: 12 }}>Fundamentals Debug (FMP)</h1>
      <p style={{ marginBottom: 12, opacity: 0.7, maxWidth: 720 }}>
        Raw FMP response for a symbol -- price-target-consensus, price-target-summary, grades-summary, bundled together
        (one cache entry, per symbol, per calendar day). No scoring math here -- this exists purely to see the real field
        names before Ian/Alan's thresholds get built against them.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') void lookup(); }}
          placeholder="Symbol"
          style={{ background: '#000', border: '1px solid #444', borderRadius: 4, padding: '6px 10px', color: '#fff', width: 120 }} />
        <button onClick={() => void lookup()} disabled={loading}
          style={{ background: '#222', border: '1px solid #444', borderRadius: 4, padding: '6px 14px', color: '#fff', cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>
          {loading ? 'Loading…' : 'Look up'}
        </button>
      </div>
      {error && <p style={{ color: '#f66', marginBottom: 12 }}>Error: {error}</p>}
      {bundle && (
        <div>
          <p style={{ marginBottom: 8, opacity: 0.7 }}>
            {bundle.symbol} · fetched {bundle.fetchedAt} · {cached ? 'served from cache (already pulled today)' : 'live FMP call just made'}
          </p>
          {(['priceTargetConsensus', 'priceTargetSummary', 'gradesSummary'] as const).map(field => (
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
