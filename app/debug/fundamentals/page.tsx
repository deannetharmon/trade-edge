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
        Raw FMP response for a symbol -- price-target-consensus, price-target-summary, grades-summary, balance-sheet-statement,
        income-statement, cash-flow-statement, ratios (FUNDAMENTALS-0002), bundled together (one cache entry, per symbol, per
        calendar day). Computed values (Z&quot;-Score, free cash flow, valuation compression) are shown separately below the raw
        fields they're derived from -- check the raw field names actually match what the computation reads before trusting a
        computed value that isn't null.
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

          <div style={{ marginBottom: 20, padding: 12, background: '#0a1f0a', border: '1px solid #2a5', borderRadius: 4 }}>
            <p style={{ color: '#8f8', marginBottom: 8, fontWeight: 'bold' }}>Computed (FUNDAMENTALS-0002) -- no threshold applied, review only</p>
            <p>Z&quot;-Score: {bundle.zDoublePrimeScore ? bundle.zDoublePrimeScore.score.toFixed(2) : 'null (missing required raw field -- check balanceSheetStatement/incomeStatement below)'}</p>
            {bundle.zDoublePrimeScore && (
              <p style={{ opacity: 0.7, fontSize: 11 }}>
                components: WC/TA {bundle.zDoublePrimeScore.components.workingCapitalToAssets.toFixed(3)} ·
                RE/TA {bundle.zDoublePrimeScore.components.retainedEarningsToAssets.toFixed(3)} ·
                EBIT/TA {bundle.zDoublePrimeScore.components.ebitToAssets.toFixed(3)} ·
                Equity/Liab {bundle.zDoublePrimeScore.components.equityToLiabilities.toFixed(3)}
              </p>
            )}
            <p>Free Cash Flow: {bundle.freeCashFlow != null ? `$${bundle.freeCashFlow.toLocaleString()}` : 'null (missing required raw field -- check cashFlowStatement below)'}</p>
            <p>Valuation Compression: {bundle.valuationCompression
              ? `${bundle.valuationCompression.compressionPct.toFixed(1)}% ${bundle.valuationCompression.compressionPct > 0 ? 'cheaper' : 'more expensive'} than its own ${bundle.valuationCompression.periodsUsed}-period P/E median (current ${bundle.valuationCompression.current.toFixed(1)} vs. median ${bundle.valuationCompression.historicalMedian.toFixed(1)})`
              : 'null (fewer than 2 valid P/E periods -- check ratiosHistory below)'}
            </p>
          </div>

          {(['priceTargetConsensus', 'priceTargetSummary', 'gradesSummary', 'balanceSheetStatement', 'incomeStatement', 'cashFlowStatement', 'ratiosHistory'] as const).map(field => (
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
