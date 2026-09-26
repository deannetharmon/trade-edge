// features/wheel/__tests__/WheelPlanTab.test.tsx
//
// WHEEL-SYSTEM-0001 (W1) -- the Plan tab: empty, loading, error and token-expired states, honest row states, overrides.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WheelChainLeg, WheelChainResult } from '@/lib/wheel/chainSearch';
import type { WheelPlan } from '@/lib/wheel/planSchema';
import WheelPlanTab, { type WheelPlanDeps } from '../WheelPlanTab';

const put = (strike: number, delta = -0.2): WheelChainLeg => ({
  strikePrice: strike, expirationDate: '2026-11-06', optionType: 'P', delta, openInterest: 500, bid: 0.5, ask: 0.6, mid: 0.55, occSymbol: `P${strike}`,
});
const chain = (strike: number | null, failedBatches = 0): WheelChainResult =>
  strike == null
    ? { expirations: [], chains: {}, failedBatches }
    : { expirations: ['2026-11-06'], chains: { '2026-11-06': [put(strike)] }, failedBatches };

const STRIKES: Record<string, number> = { XLF: 51, XLE: 58, XLU: 37, XLP: 76, XLV: 159, BIG: 250 };
const openAdjust = () => userEvent.click(screen.getByRole('button', { name: /Adjust any default/ }));

function makeDeps(plan: Partial<WheelPlan> | 'error', over: Partial<WheelPlanDeps> = {}) {
  const posts: unknown[] = [];
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    if (plan === 'error') return { ok: false, status: 500, json: async () => ({}) } as Response;
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ plan: { overrides: {}, wheelList: [], updatedAt: '', ...plan } }) } as Response;
  });
  const deps: WheelPlanDeps = {
    getToken: async () => 'token',
    fetchChain: async (symbol) => chain(STRIKES[symbol] ?? null),
    fetchQuote: async () => 54.84,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...over,
  };
  return { deps, posts, fetchImpl };
}

describe('WheelPlanTab', () => {
  it('shows a loading line, then the empty state with the profile chooser and a zero worst-case stress', async () => {
    const { deps } = makeDeps({});
    render(<WheelPlanTab deps={deps} />);
    expect(screen.getByText(/Loading your plan/)).toBeInTheDocument();
    expect(await screen.findByText(/Add a symbol to see the cash one put needs/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Balanced/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('$40,000')).toBeInTheDocument(); // wheel cash at the defaults
    expect(screen.getByText(/Today \(\$0 in the plan\)/)).toBeInTheDocument();
    expect(screen.getByText(/Guidance from TradeEdge rules/)).toBeInTheDocument();
  });

  it('a plan that cannot be loaded says so and changes nothing', async () => {
    const { deps, posts } = makeDeps('error');
    render(<WheelPlanTab deps={deps} />);
    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it('renders the ladder from live data: cash for one, contracts that fit, fits-at and months to unlock', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLF' }, { symbol: 'XLV' }, { symbol: 'BIG' }] });
    render(<WheelPlanTab deps={deps} />);
    const xlf = await screen.findByTestId('ladder-row-XLF');
    await waitFor(() => expect(within(xlf).getByText('$5,100')).toBeInTheDocument());
    expect(within(xlf).getByText('$17,000')).toBeInTheDocument(); // fits at account
    expect(within(xlf).getByText('Wheel now')).toBeInTheDocument();
    const xlv = screen.getByTestId('ladder-row-XLV');
    await waitFor(() => expect(within(xlv).getByText('$15,900')).toBeInTheDocument());
    expect(within(xlv).getByText('$53,000')).toBeInTheDocument();
    expect(within(xlv).getByText('Concentrated only')).toBeInTheDocument(); // fits the 12% profile, not Balanced
    const big = screen.getByTestId('ladder-row-BIG');
    await waitFor(() => expect(within(big).getByText('$25,000')).toBeInTheDocument());
    expect(within(big).getByText('$83,333.34')).toBeInTheDocument();
    expect(within(big).getByText('Unlocks in 69 months')).toBeInTheDocument();
  });

  it('a leveraged ETF is flagged and never priced or counted', async () => {
    const fetchChain = vi.fn(async () => chain(75));
    const { deps } = makeDeps({ wheelList: [{ symbol: 'TQQQ' }] }, { fetchChain });
    render(<WheelPlanTab deps={deps} />);
    expect(await screen.findByText(/Not a wheel candidate/)).toBeInTheDocument();
    expect(fetchChain).not.toHaveBeenCalled();
  });

  it('a failed chain shows "chain error" with a retry, never "no put found"', async () => {
    const fetchChain = vi.fn(async () => { throw new Error('boom'); });
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLF' }] }, { fetchChain });
    render(<WheelPlanTab deps={deps} />);
    expect(await screen.findByText(/Chain error: boom/)).toBeInTheDocument();
    expect(screen.queryByText(/No put found/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('a failed quote batch with no put found is a chain error, not "no put"', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLF' }] }, { fetchChain: async () => chain(null, 1) });
    render(<WheelPlanTab deps={deps} />);
    expect(await screen.findByText(/Some option quotes failed to load/)).toBeInTheDocument();
    expect(screen.queryByText(/No put found near delta/)).not.toBeInTheDocument();
  });

  it('"no put found" appears only when the chain loaded cleanly', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLF' }] }, { fetchChain: async () => chain(null, 0) });
    render(<WheelPlanTab deps={deps} />);
    expect(await screen.findByText(/No put found near delta 0.20 in 30 to 45 days/)).toBeInTheDocument();
  });

  it('a missing or expired TastyTrade session shows a reconnect message and retries', async () => {
    let fail = true;
    const getToken = vi.fn(async () => { if (fail) throw new Error('no token'); return 'token'; });
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLF' }] }, { getToken });
    render(<WheelPlanTab deps={deps} />);
    expect(await screen.findByText(/Reconnect TastyTrade/)).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry all' }));
    const row = screen.getByTestId('ladder-row-XLF');
    await waitFor(() => expect(within(row).getByText('$5,100')).toBeInTheDocument());
    expect(screen.queryByText(/Reconnect TastyTrade/)).not.toBeInTheDocument();
  });

  it('one failing symbol does not blank the rest', async () => {
    const fetchChain = vi.fn(async (symbol: string) => { if (symbol === 'XLF') throw new Error('nope'); return chain(STRIKES[symbol]); });
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLF' }, { symbol: 'XLE' }] }, { fetchChain });
    render(<WheelPlanTab deps={deps} />);
    expect(await screen.findByText(/Chain error: nope/)).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByTestId('ladder-row-XLE')).getByText('$5,800')).toBeInTheDocument());
  });

  it('changing a parameter shows it as changed with a reset, recalculates, and saves only the override', async () => {
    const { deps, posts } = makeDeps({});
    render(<WheelPlanTab deps={deps} />);
    await screen.findByText(/Add a symbol/);
    await userEvent.click(screen.getByRole('radio', { name: /Concentrated/ }));
    const limits = screen.getByTestId('wheel-plan-limits');
    await waitFor(() => expect(within(limits).getByText('$20,000')).toBeInTheDocument()); // most cash on one name at 12%
    await waitFor(() => expect(posts.length).toBeGreaterThan(0), { timeout: 3000 });
    expect(posts[posts.length - 1]).toEqual({ overrides: { profile: 'concentrated' }, wheelList: [] });

    await openAdjust();
    const reserve = screen.getByLabelText('Cash reserve');
    await userEvent.clear(reserve);
    await userEvent.type(reserve, '5{Enter}');
    expect(await screen.findByText(/changed \(default 10 %\)/)).toBeInTheDocument();
    expect(screen.queryByText(/A reserve under 5%/)).not.toBeInTheDocument(); // exactly 5% is not under 5%
    await userEvent.clear(reserve);
    await userEvent.type(reserve, '3{Enter}');
    expect(await screen.findByText(/A reserve under 5%/)).toBeInTheDocument(); // a soft warning, shown but not blocking
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a soft warning never blocks; a value that breaks the math shows an error and is not saved', async () => {
    const { deps, posts } = makeDeps({});
    render(<WheelPlanTab deps={deps} />);
    await screen.findByText(/Add a symbol/);
    await openAdjust();
    const cap = screen.getByLabelText('Spread risk cap (total)');
    await userEvent.clear(cap);
    await userEvent.type(cap, '95{Enter}'); // reserve 10% + 95% > 100%
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be more than 100%/);
    await new Promise((r) => setTimeout(r, 800));
    expect(posts).toHaveLength(0);
    expect(screen.getByText(/Not saved: fix the values below first/)).toBeInTheDocument();
  });

  it('Reset all returns every field to its default', async () => {
    const { deps } = makeDeps({ overrides: { reserveBps: 500, profile: 'careful' } });
    render(<WheelPlanTab deps={deps} />);
    await screen.findByText(/Add a symbol/);
    expect(screen.getByRole('radio', { name: /Careful/ })).toHaveAttribute('aria-checked', 'true');
    await openAdjust();
    await userEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
    expect(screen.getByRole('radio', { name: /Balanced/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('adding a symbol validates and de-duplicates', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLF' }] });
    render(<WheelPlanTab deps={deps} />);
    await screen.findByTestId('ladder-row-XLF');
    await userEvent.type(screen.getByLabelText('Add symbol'), 'xlf{Enter}');
    expect(await screen.findByText(/already on the list/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Add symbol'), 'not valid{Enter}');
    expect(await screen.findByText(/is not a valid symbol/)).toBeInTheDocument();
  });
});

describe('WheelPlanTab layout (matches the approved mock)', () => {
  it('leads with the profile cards showing each profile side by side, before any parameter form', async () => {
    const { deps } = makeDeps({});
    render(<WheelPlanTab deps={deps} />);
    await screen.findByText(/Add a symbol/);
    const cards = screen.getAllByRole('radio');
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining('Careful'), expect.stringContaining('Balanced'), expect.stringContaining('Concentrated'), expect.stringContaining('Custom'),
    ]);
    const balanced = screen.getByRole('radio', { name: /Balanced/ });
    expect(balanced).toHaveTextContent('$4,500'); // loss if one name falls 30%
    expect(balanced).toHaveTextContent('$15,000'); // cash on one name
    expect(balanced).toHaveTextContent('$150'); // highest put strike
    expect(balanced).toHaveTextContent('recommended');
    // The parameter form is collapsed until asked for.
    expect(screen.queryByLabelText('Cash reserve')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Adjust any default/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows how many defaults have been changed on the collapsed section', async () => {
    const { deps } = makeDeps({ overrides: { reserveBps: 500, profile: 'careful' } });
    render(<WheelPlanTab deps={deps} />);
    expect(await screen.findByRole('button', { name: /Adjust any default \(2 changed\)/ })).toBeInTheDocument();
  });
});
