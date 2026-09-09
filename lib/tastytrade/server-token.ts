import Redis from 'ioredis';
import { decrypt, encrypt } from '@/lib/crypto';

const TOKEN_URL = 'https://api.tastytrade.com/oauth/token';

/** Server-only broker token refresh. The access token never enters a page payload. */
export async function getServerBrokerAccessToken(userId: string): Promise<string> {
  const redis = new Redis(process.env.REDIS_URL!);
  const key = `user:${userId}:tastytrade`;
  const credentials = await redis.hgetall(key);
  if (!credentials.refresh_token || !credentials.client_secret) throw new Error('Tastytrade credentials are not connected');
  const clientId = process.env.TASTYTRADE_CLIENT_ID;
  if (!clientId) throw new Error('Tastytrade client ID is not configured');
  const response = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'trade-edge/1.0' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decrypt(credentials.refresh_token), client_id: clientId, client_secret: decrypt(credentials.client_secret) }), cache: 'no-store',
  });
  const data = await response.json() as { access_token?: string; refresh_token?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description ?? 'Tastytrade token exchange failed');
  if (data.refresh_token) await redis.hset(key, { refresh_token: encrypt(data.refresh_token) });
  return data.access_token;
}

export async function serverBrokerFetch(path: string, token: string): Promise<any> {
  const response = await fetch(`https://api.tastytrade.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'trade-edge/1.0' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Broker read failed (${response.status})`);
  return response.json();
}
