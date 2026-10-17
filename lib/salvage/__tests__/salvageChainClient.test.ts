import { describe, expect, it } from 'vitest';
import { loadSalvageChain } from '../salvageChainClient';

const nested = {
  data: { items: [{ expirations: [
    { 'expiration-date': '2026-11-13', strikes: [{ 'strike-price': '100', put: 'MRNA  261113P00100000' }] },
    { 'expiration-date': '2026-11-20', strikes: [
      { 'strike-price': '140', put: 'MRNA  261120P00140000', call: 'MRNA  261120C00140000' },
      { 'strike-price': '110', put: 'MRNA  261120P00110000', call: 'MRNA  261120C00110000' },
    ] },
  ] }] },
};

const market = {
  data: { items: [
    { symbol: 'MRNA  261120P00140000', bid: '2.08', ask: '2.20', delta: '-0.074', 'quote-time': '2026-10-16T19:00:00Z' },
    { symbol: 'MRNA  261120P00110000', bid: '0.50', ask: '0.55', delta: '-0.02' },
  ] },
};

describe('loadSalvageChain', () => {
  const fetcher = async (path: string) => (path.includes('/nested') ? nested : market);
  it('loads only the requested expiration and right', async () => {
    const c = await loadSalvageChain('MRNA', '2026-11-20', 'P', 't', fetcher, () => 1000);
    expect(c.quotes.map((q) => q.strike).sort()).toEqual([110, 140]);
    expect(c.quotes.every((q) => q.right === 'P')).toBe(true);
  });
  it('keeps a broker quote time; undated quotes take the load time', async () => {
    const c = await loadSalvageChain('MRNA', '2026-11-20', 'P', 't', fetcher, () => 1000);
    expect(c.quotes.find((q) => q.strike === 140)?.asOfMs).toBe(Date.parse('2026-10-16T19:00:00Z'));
    expect(c.quotes.find((q) => q.strike === 110)?.asOfMs).toBe(1000);
  });
  it('fails closed when the expiration or quotes are missing', async () => {
    await expect(loadSalvageChain('MRNA', '2027-01-15', 'P', 't', fetcher)).rejects.toThrow(/expiration/);
    const empty = async (path: string) => (path.includes('/nested') ? nested : { data: { items: [] } });
    await expect(loadSalvageChain('MRNA', '2026-11-20', 'P', 't', empty)).rejects.toThrow(/quotes/);
  });
});
