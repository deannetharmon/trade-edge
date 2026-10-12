// components/__tests__/BuyingPowerPanel.test.tsx
//
// BAL-0001/0002: the panel renders the real-account shape (no cash/margin split, "Other" row, tier colours, cluster callout).

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import sample from '@/test/fixtures/tastytradeBuyingPower20261012.json';
import BuyingPowerPanel from '@/components/BuyingPowerPanel';
import { buildBpModel } from '@/lib/portfolio-data/buyingPower';

const html = renderToStaticMarkup(
  <BuyingPowerPanel model={buildBpModel(sample.balances.data, sample.requirements.data, new Date('2026-10-12T17:20:00Z'))} />,
);

describe('BuyingPowerPanel', () => {
  it('shows the four account tiles', () => {
    expect(html).toContain('$44,479');
    expect(html).toContain('$13,911');
    expect(html).toContain('$30,657');
    expect(html).toContain('$40,652');
  });
  it('has no cash/margin split', () => {
    expect(html).not.toMatch(/Cash portion|Margin portion/i);
  });
  it('lists tickers, the Other row and a reconciled total', () => {
    expect(html).toContain('GGLL');
    expect(html).toContain('31.3%');
    expect(html).toContain('Other');
    expect(html).toContain('$920');
    expect(html).toContain('9 tickers');
  });
  it('uses red for 25%+ and warns about the cluster', () => {
    expect(html).toContain('text-red-400 font-semibold');
    expect(html).toContain('Leveraged ETFs hold 94% of buying power used.');
  });
});
