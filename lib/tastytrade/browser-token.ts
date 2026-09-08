export interface BrowserTokenResult {
  accessToken: string;
  expiresIn: number;
}

// TT-TOKEN-EXPIRY-FIX-0001 — returns the real TastyTrade expiry alongside
// the token, instead of just the token, so callers can cache it correctly.
export async function refreshBrowserAccessToken(): Promise<BrowserTokenResult> {
  const response = await fetch('/api/auth/tastytrade-token', { method: 'POST', cache: 'no-store' });
  const data = await response.json();
  if (!response.ok || !data.accessToken) throw new Error(data.error ?? 'Session expired');
  return { accessToken: data.accessToken as string, expiresIn: (data.expiresIn as number) ?? 900 };
}
