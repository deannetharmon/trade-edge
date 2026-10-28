// features/research/__tests__/ResearchFacts.test.tsx

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResearchFacts, chartLevelsOf, type ResearchFactsDeps } from '../ResearchFacts';
import { THEMES } from '@/lib/theme';

const facts = {
  symbol: 'AAPL', asOf: 1, price: 100, atr14: 2.5, atrPct: 2.5, volumeRatio: 1.25,
  relativeStrength: { stockPct: 20, benchmarkPct: 8, diffPts: 12 },
  returns: { m1: 3.7, m3: -8.1, m6: null },
  extremes: { high20: 112, low20: 94.5, high52w: 130, low52w: null },
  levels: { supports: [{ price: 93, touches: 2, lastTouchT: 1 }], resistances: [{ price: 110, touches: 1, lastTouchT: 1 }] },
};
const broker = { ivRank: 42, ivx30: 31.5, hv30: 25, ivHvDiff: 6.5, earningsExpectedDate: '2099-01-01', liquidityRating: 4 };
const trend = { trend: 'uptrend', strategy: 'BPS', subtype: 'CONTINUATION', confidence: 71, ma20: 98, ma50: 95, ma200: 90, reason: 'because', metrics: { rsi14: 58.2, distFromMa50: 0.052 } };

const deps = (over: Partial<ResearchFactsDeps> = {}): ResearchFactsDeps => ({
  loadFacts: async () => facts as never,
  loadBroker: async () => broker,
  loadTrend: async () => trend as never,
  ...over,
});

describe('RESEARCH-0007 chart levels', () => {
  it('lists support and resistance first, then the highs and lows that have a value', () => {
    expect(chartLevelsOf(facts as never).map(l => `${l.kind}:${l.price}`)).toEqual(['support:93', 'resistance:110', 'extreme:112', 'extreme:94.5', 'extreme:130']);
  });
  it('reports the levels once the facts load', async () => {
    const seen: number[] = [];
    render(<ResearchFacts symbol="AAPL" th={THEMES.dark} deps={deps()} onLevels={l => seen.push(l.length)} />);
    await screen.findByTestId('facts-trend');
    expect(seen[seen.length - 1]).toBe(5);
  });
});

describe('RESEARCH-0002 ResearchFacts', () => {
  it('shows trend, options context and price structure facts', async () => {
    render(<ResearchFacts symbol="AAPL" th={THEMES.dark} deps={deps()} />);
    const t = await screen.findByTestId('facts-trend');
    expect(t).toHaveTextContent('uptrend · 71%');
    expect(t).toHaveTextContent('98.00 / 95.00 / 90.00');
    expect(t).toHaveTextContent('58');
    expect(t).toHaveTextContent('5.2%');
    const o = await screen.findByTestId('facts-options');
    expect(o).toHaveTextContent('42%');
    expect(o).toHaveTextContent('31.5%');
    expect(o).toHaveTextContent('25.0%');
    expect(o).toHaveTextContent('6.5 pts');
    expect(o).toHaveTextContent('4 / 5');
    const s = await screen.findByTestId('facts-structure');
    expect(s).toHaveTextContent('$2.50 (2.5%)');
    expect(s).toHaveTextContent('1.25×');
    expect(s).toHaveTextContent('+12.0 pts');
    expect(s).toHaveTextContent('+3.7% · -8.1% · —');
    const ex = screen.getByTestId('facts-extremes');
    expect(ex).toHaveTextContent('20-day high');
    expect(ex).toHaveTextContent('$112.00');
    expect(ex).toHaveTextContent('$130.00');
    const lv = screen.getByTestId('facts-levels');
    expect(lv).toHaveTextContent('$93.00 · 2 touches · 7.0% below price');
    expect(lv).toHaveTextContent('$110.00 · 1 touch · 10.0% above price');
  });
  it('without a broker connection, says so and still shows the price facts', async () => {
    render(<ResearchFacts symbol="AAPL" th={THEMES.dark} deps={deps({ loadBroker: async () => null })} />);
    expect(await screen.findByText(/Connect TastyTrade/)).toBeInTheDocument();
    expect(await screen.findByTestId('facts-structure')).toBeInTheDocument();
  });
  it('a failed facts load shows the error and leaves the other sections alone', async () => {
    render(<ResearchFacts symbol="AAPL" th={THEMES.dark} deps={deps({ loadFacts: async () => { throw new Error('No data for AAPL'); } })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No data for AAPL');
    expect(await screen.findByTestId('facts-trend')).toBeInTheDocument();
  });
  it('explains the trend with its component scores and the look-back, and shows the pattern type', async () => {
    const withScores = { ...trend, subtype: 'REVERSAL', scores: { momentum: 6, maAlignment: -12, slope: -18, structure: -22, chop: 0, volatility: 0, total: -46 } };
    render(<ResearchFacts symbol="AAPL" th={THEMES.dark} deps={deps({ loadTrend: async () => withScores as never })} />);
    expect(await screen.findByTestId('facts-trend')).toHaveTextContent('Trend (screener read)');
    expect(screen.getByTestId('facts-trend')).toHaveTextContent('uptrend · 71% · reversal');
    const why = screen.getByTestId('facts-trend-why');
    expect(why).toHaveTextContent('momentum +6 · averages -12 · slope -18 · structure -22');
    expect(why).toHaveTextContent('20 to 60 trading days most');
  });
  it('marks an earnings date that has already passed instead of presenting it as upcoming', async () => {
    render(<ResearchFacts symbol="AAPL" th={THEMES.dark} deps={deps({ loadBroker: async () => ({ ...broker, earningsExpectedDate: '2020-10-20' }) })} />);
    expect(await screen.findByTestId('facts-options')).toHaveTextContent('2020-10-20 (passed)');
  });
  it('an unknown trend reads "Trend unavailable"', async () => {
    render(<ResearchFacts symbol="AAPL" th={THEMES.dark} deps={deps({ loadTrend: async () => ({ ...trend, trend: 'unknown' }) as never })} />);
    expect(await screen.findByText('Trend unavailable.')).toBeInTheDocument();
  });
  it('the strike check reports percent, ATRs and the nearest support at or below the strike', async () => {
    render(<ResearchFacts symbol="AAPL" th={THEMES.dark} deps={deps()} />);
    await screen.findByTestId('facts-structure');
    await userEvent.type(screen.getByLabelText('Put strike'), '95');
    const line = screen.getByTestId('strike-context');
    expect(line).toHaveTextContent('$95.00 is 5.0% below the last close (2.0 ATR)');
    expect(line).toHaveTextContent('Nearest support at or below it: $93.00, 2.1% under the strike');
  });
  it('shows no verdict wording anywhere', async () => {
    render(<ResearchFacts symbol="AAPL" th={THEMES.dark} deps={deps()} />);
    await screen.findByTestId('facts-structure');
    const text = within(screen.getByTestId('research-facts')).getByText(/Facts for a premium sale/).closest('section')!.textContent ?? '';
    expect(text).not.toMatch(/buy|sell now|recommend|qualif/i);
  });
});
