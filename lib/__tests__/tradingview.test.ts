// lib/__tests__/tradingview.test.ts

import { describe, expect, it } from 'vitest';
import { TRADINGVIEW_LAYOUT_URL, buildTradingViewChartUrl, tradingViewSymbol } from '../tradingview';

describe('TV-LAYOUT-0001 TradingView links', () => {
  it('opens the saved layout with the ticker filled in', () => {
    expect(buildTradingViewChartUrl('mrna')).toBe('https://www.tradingview.com/chart/sdDzRlqf/?symbol=MRNA');
  });
  it('maps index underlyings to their TradingView symbols and passes explicit exchanges through', () => {
    expect(tradingViewSymbol('SPXW')).toBe('CBOE:SPX');
    expect(buildTradingViewChartUrl('NDX')).toBe('https://www.tradingview.com/chart/sdDzRlqf/?symbol=NASDAQ%3ANDX');
    expect(tradingViewSymbol('NASDAQ:AAPL')).toBe('NASDAQ:AAPL');
  });
  it('the header link opens the layout itself', () => {
    expect(TRADINGVIEW_LAYOUT_URL).toBe('https://www.tradingview.com/chart/sdDzRlqf/');
  });
});
