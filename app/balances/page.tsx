// app/balances/page.tsx
// MINIMAL TEST PAGE — not linked from nav yet. Purpose: confirm the
// TastyTrade balance-history endpoint shape before building the real UI.

'use client';

import { useEffect, useState } from 'react';

interface DebugResult {
  accountNumber?: string;
  current?: any;
  historyAttempts?: Record<string, any>;
  error?: string;
}

export default function BalancesTestPage() {
  const [result, setResult] = useState<DebugResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/balances-test')
      .then(res => res.json())
      .then(setResult)
      .catch(e => setResult({ error: String(e) }))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', fontSize: 12, color: '#eee', background: '#111', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 16, marginBottom: 16 }}>Balances Test (temporary)</h1>
      {loading && <p>Loading...</p>}
      {!loading && result && (
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
