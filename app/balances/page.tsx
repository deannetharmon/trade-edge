// app/balances/page.tsx
// MINIMAL TEST PAGE -- not linked from nav yet. Purpose: confirm the
// TastyTrade balance-history endpoint shape before building the real UI.
// Auth pattern copied from app/portfolio/page.tsx (client-side only --
// TastyTrade blocks Vercel server IPs, so this must run in the browser).

'use client';

import { useEffect, useState } from 'react';

const BASE = 'https://api.tastytrade.com';
const CLIENT_ID = '4d4c851b-bdaf-4ac9-b39b-811e604739f2';

async function getAccessToken(): Promise<string> {
  const cached = sessionStorage.getItem('tt_access_token');
  if (cached) return cached;
  const refreshToken = localStorage.getItem('tt_refresh_token');
  const clientSecret = localStorage.getItem('tt_client_secret') ?? '';
  if (!refreshToken || !clientSecret) throw new Error('Not authenticated -- open /portfolio first to log in');
  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID, client_secret: clientSecret }),
  });
  if (!res.ok) throw new Error('Session expired -- open /portfolio first to log in');
  const data = await res.json();
  const token = data.access_token;
  if (!token) throw new Error('No token returned');
  sessionStorage.setItem('tt_access_token', token);
  if (data.refresh_token && data.refresh_token !== refreshToken) localStorage.setItem('tt_refresh_token', data.refresh_token);
  return token;
}

async function ttFetch(path: string, token: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* leave null */ }
  if (!res.ok) throw new Error(`${path} failed (${res.status}): ${text.slice(0, 300)}`);
  return json;
}

export default function BalancesTestPage() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        const accountsData = await ttFetch('/customers/me/accounts', token);
        const account = accountsData?.data?.items?.find((a: any) => a.account['account-number'] === '5WI51392')
          ?? accountsData?.data?.items?.[0];
        const accountNumber = account?.account?.['account-number'];
        if (!accountNumber) throw new Error('No account found');

        const current = await ttFetch(`/accounts/${accountNumber}/balances`, token);

        const historyPaths = [
          `/accounts/${accountNumber}/balance-snapshots`,
          `/accounts/${accountNumber}/balance-snapshots?time-back=1m`,
          `/accounts/${accountNumber}/net-liquidating-value/history`,
          `/accounts/${accountNumber}/net-liquidating-value/history?time-back=1m`,
        ];

        const historyAttempts: Record<string, any> = {};
        for (const path of historyPaths) {
          try {
            const data = await ttFetch(path, token);
            historyAttempts[path] = { ok: true, sample: data };
          } catch (e: any) {
            historyAttempts[path] = { ok: false, error: e.message };
          }
        }

        setResult({ accountNumber, current: current?.data, historyAttempts });
      } catch (e: any) {
        setResult({ error: e.message });
      } finally {
        setLoading(false);
      }
    })();
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
