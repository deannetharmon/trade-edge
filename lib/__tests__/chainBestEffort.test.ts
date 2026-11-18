// lib/__tests__/chainBestEffort.test.ts

import { describe, it, expect } from 'vitest';
import { fetchOptionQuotesBestEffort } from '@/lib/trademap/chain';

const item = (sym: string) => ({ symbol: sym, bid: '1.00', ask: '1.20', mark: '1.10', delta: '0.2', volatility: '0.3', 'open-interest': 500 });

describe('fetchOptionQuotesBestEffort', () => {
  it('keeps the batches that worked when one batch fails', async () => {
    const syms = Array.from({ length: 150 }, (_, i) => `SPY   261218C${String(100000 + i * 1000).padStart(8, '0')}`);
    let call = 0;
    const fetcher = async (path: string) => {
      call += 1;
      if (call === 2) throw new Error('429');
      const wanted = decodeURIComponent(path).split('&').map(p => p.split('equity-option=')[1]);
      return { data: { items: wanted.map(item) } };
    };
    const out = await fetchOptionQuotesBestEffort(fetcher as any, syms);
    expect(call).toBeGreaterThan(1);
    expect(Object.keys(out).length).toBeGreaterThan(0);
    expect(Object.keys(out).length).toBeLessThan(syms.length);
  });
});
