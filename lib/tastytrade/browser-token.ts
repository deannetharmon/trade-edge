export async function refreshBrowserAccessToken(): Promise<string> {
  const response = await fetch('/api/auth/tastytrade-token', { method: 'POST', cache: 'no-store' });
  const data = await response.json();
  if (!response.ok || !data.accessToken) throw new Error(data.error ?? 'Session expired');
  return data.accessToken as string;
}
