// features/portfolio/positions-workspace/__tests__/portfolioHeadline.test.tsx

// PORT-HEADLINE-0001: Portfolio Value, Cash to deploy and Deployed Capital as headline figures, with the bridge that shows how
// they tie together. Golden fixture: Dean's TastyTrade balances snapshot of 2026-11-02 (NLV 35,871.71; cash 32,829.11;
// option buying power 6,726.12) with TradeEdge's own totals (capital 48,268 over 11 positions, open P&L -13,384).

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Position, PositionLeg } from '@/lib/portfolio-data/types';
import { buildPortfolioHeadline, buildPortfolioSummary, type CashToDeploy, type SummedFigure } from '../model/portfolioSummary';
import { PortfolioSummaryStrip } from '../PortfolioSummaryStrip';

const figure = (value: number | null, included = 11, of = 11): SummedFigure => ({ value, included, of });
const deployOk = (value: number): CashToDeploy => ({ value, usingMargin: value < 0, excluded: 0, reason: null });

const GOLDEN = {
  netLiquidity: 35871.71,
  cashBalance: 32829.11,
  optionBuyingPower: 6726.12,
  cashToDeploy: deployOk(2734.11), // 32,829.11 cash minus 30,095 full CSP collateral
  totalCapital: figure(48268),
  totalPnl: figure(-13384),
};

describe('buildPortfolioHeadline (golden: Dean 2026-11-02)', () => {
  it('ties Deployed + Cash to deploy to Funded, and Funded to Portfolio Value', () => {
    const h = buildPortfolioHeadline(GOLDEN);
    expect(h.portfolioValue).toBe(35871.71);
    expect(h.cashToDeploy).toBe(2734.11);
    expect(h.deployed).toBe(48268);
    expect(h.bridge).toEqual({ funded: 51002.11, portfolioValue: 35871.71, gap: 15130.4, openPnl: -13384, other: 1746.4 });
    // Nothing is rounded away: open P&L plus the remainder equals the gap exactly.
    expect(h.bridge!.openPnl * -1 + h.bridge!.other).toBeCloseTo(h.bridge!.gap, 2);
  });

  it('reserve status comes from option buying power over net liquidating value (18.75%: above the floor, under 20%)', () => {
    const h = buildPortfolioHeadline(GOLDEN);
    expect(h.reserve?.tone).toBe('watch');
    expect(h.reserve?.pct).toBeCloseTo(18.75, 2);
  });

  it('a partial capital sum shows no bridge (incomplete totals never look complete)', () => {
    const h = buildPortfolioHeadline({ ...GOLDEN, totalCapital: figure(40000, 10, 11) });
    expect(h.deployedPartial).toBe(true);
    expect(h.bridge).toBeNull();
  });

  it('partial open P&L shows no bridge', () => {
    expect(buildPortfolioHeadline({ ...GOLDEN, totalPnl: figure(-13000, 9, 11) }).bridge).toBeNull();
  });

  it('missing balances stay null, never zero', () => {
    const h = buildPortfolioHeadline({ ...GOLDEN, netLiquidity: undefined, optionBuyingPower: null, cashBalance: null, cashToDeploy: { value: null, usingMargin: false, excluded: 0, reason: 'Cash balance unavailable' } });
    expect(h.portfolioValue).toBeNull();
    expect(h.cashBalance).toBeNull();
    expect(h.optionBuyingPower).toBeNull();
    expect(h.cashToDeploy).toBeNull();
    expect(h.reserve).toBeNull();
    expect(h.bridge).toBeNull();
  });

  it('cash-secured collateral above cash flags margin use and still ties out', () => {
    const h = buildPortfolioHeadline({ ...GOLDEN, cashToDeploy: deployOk(-500) });
    expect(h.usingMargin).toBe(true);
    expect(h.bridge?.funded).toBe(47768);
  });
});

const NOW = Date.parse('2026-11-02T17:00:00Z');
const leg = (o: Partial<PositionLeg>): PositionLeg => ({
  symbol: 'X     261204P00120000', optionType: 'P', strikePrice: 120, direction: 'Short', quantity: 1,
  avgOpenPrice: 5.4, currentPrice: 5.35, closePrice: 5.84, openedAt: '2026-10-02T15:00:00Z', ...o,
} as PositionLeg);
const csp = (symbol: string): Position => ({
  key: symbol, symbol, strategy: 'CSP', quantity: 1, dte: 31, entryDate: '2026-10-02', entryPriceEffect: 'Credit',
  entryEconomicsComplete: true, entryCredit: 540, pnl: -300, theta: 0.07, maxRisk: 12000, maxRiskReliable: true,
  structureAmbiguous: false, identity: { quantity: 1 }, snapshotHistory: [], legs: [leg({})],
} as unknown as Position);

function strip(over: { netLiquidity?: number | null; cashBalance?: number | null; optionBuyingPower?: number | null } = {}) {
  const summary = buildPortfolioSummary({
    rows: [{ position: csp('AAA'), needsAttention: false }], equities: [], pendingOrders: [],
    cashBalance: 20000, netLiquidity: 25000, optionBuyingPower: 5000, nowMs: NOW, ...over,
  });
  render(<PortfolioSummaryStrip summary={summary} selected={null} onSelect={() => {}} />);
  return summary;
}

describe('PortfolioSummaryStrip headline', () => {
  it('shows the three headline figures, the reserve line and the bridge', () => {
    const s = strip();
    expect(screen.getByTestId('headline-portfolio-value').textContent).toBe('$25,000');
    expect(screen.getByTestId('headline-cash-to-deploy').textContent).toBe(`$${Math.abs(s.headline.cashToDeploy as number).toLocaleString('en-US')}`);
    expect(screen.getByTestId('headline-deployed').textContent).toContain(`$${(s.headline.deployed as number).toLocaleString('en-US')}`);
    expect(screen.getByTestId('headline-reserve').textContent).toContain('Reserve 20%');
    expect(screen.getByTestId('headline-bridge').textContent).toContain('funded');
  });

  it('labels the broker figure as a margin figure and never shows stock buying power', () => {
    strip();
    expect(screen.getByTestId('portfolio-headline').textContent).toContain('Option Buying Power $5,000 (broker margin figure)');
    expect(screen.getByTestId('portfolio-headline').textContent).not.toMatch(/stock buying power/i);
  });

  it('unavailable balances read Unavailable and hide the bridge and reserve', () => {
    strip({ netLiquidity: null, cashBalance: null, optionBuyingPower: null });
    expect(screen.getByTestId('headline-portfolio-value').textContent).toBe('Unavailable');
    expect(screen.getByTestId('headline-cash-to-deploy').textContent).toBe('Unavailable');
    expect(screen.queryByTestId('headline-bridge')).toBeNull();
    expect(screen.queryByTestId('headline-reserve')).toBeNull();
  });

  it('every strategy tile keeps a bold Capital line', () => {
    strip();
    const capital = screen.getAllByTestId('tile-capital');
    expect(capital.length).toBeGreaterThan(0);
    for (const el of capital) expect(el.className).toContain('font-bold');
  });

  it('each headline tile carries a hover definition', () => {
    strip();
    const titled = Array.from(screen.getByTestId('portfolio-headline').querySelectorAll('[title]'));
    expect(titled.length).toBeGreaterThanOrEqual(3);
  });
});
