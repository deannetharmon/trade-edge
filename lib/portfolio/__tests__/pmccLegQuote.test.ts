import { describe, it, expect, vi, beforeEach } from 'vitest';

const ttFetchMock = vi.fn();
vi.mock('@/lib/scans/tastytrade-client', () => ({
  ttFetch: (...args: any[]) => ttFetchMock(...args),
}));

import { getOptionLegQuote } from '../pmccLegQuote';

describe('getOptionLegQuote', () => {
  beforeEach(() => {
    ttFetchMock.mockReset();
  });

  it('resolves a real two-sided quote to its midpoint', async () => {
    ttFetchMock.mockResolvedValue({ data: { items: [{ bid: '3.40', ask: '3.60', mark: '3.50' }] } });
    const price = await getOptionLegQuote('AAPL261016C00200000', 'token');
    expect(price).toBe(3.5);
  });

  it('calls the equity-option market-data endpoint with the OCC symbol', async () => {
    ttFetchMock.mockResolvedValue({ data: { items: [{ bid: '1', ask: '1', mark: '1' }] } });
    await getOptionLegQuote('AAPL261016C00200000', 'token');
    expect(ttFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('equity-option=AAPL261016C00200000'),
      'token',
    );
  });

  it('returns null (never a fabricated value) when no quote item is returned', async () => {
    ttFetchMock.mockResolvedValue({ data: { items: [] } });
    expect(await getOptionLegQuote('AAPL261016C00200000', 'token')).toBeNull();
  });

  it('returns null on a fetch error rather than throwing', async () => {
    ttFetchMock.mockRejectedValue(new Error('network error'));
    await expect(getOptionLegQuote('AAPL261016C00200000', 'token')).resolves.toBeNull();
  });

  it('returns null for an empty OCC symbol without ever calling the network', async () => {
    const price = await getOptionLegQuote('', 'token');
    expect(price).toBeNull();
    expect(ttFetchMock).not.toHaveBeenCalled();
  });

  it('falls back to mark when the market is crossed or one-sided, matching resolveOptionLegPrice\'s existing contract', async () => {
    ttFetchMock.mockResolvedValue({ data: { items: [{ bid: '0', ask: '0', mark: '3.45' }] } });
    expect(await getOptionLegQuote('AAPL261016C00200000', 'token')).toBe(3.45);
  });

  it('returns null when both the two-sided quote and the mark are unusable', async () => {
    ttFetchMock.mockResolvedValue({ data: { items: [{ bid: '0', ask: '0', mark: '0' }] } });
    expect(await getOptionLegQuote('AAPL261016C00200000', 'token')).toBeNull();
  });
});

