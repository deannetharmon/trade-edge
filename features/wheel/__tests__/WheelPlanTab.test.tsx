// features/wheel/__tests__/WheelPlanTab.test.tsx
//
// WHEEL-SYSTEM-0001 (W1) -- the Plan tab: empty, loading, error and token-expired states, honest row states, overrides.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WheelChainLeg, WheelChainResult } from '@/lib/wheel/chainSearch';
import { currentNewYorkDate } from '@/lib/scans/earningsPrecheck';
import type { WheelPlan } from '@/lib/wheel/planSchema';
import WheelPlanTab, { type WheelPlanDeps } from '../WheelPlanTab';

// The market clock is controlled so no test depends on the day or hour it runs.
const clock = vi.hoisted(() => ({ open: true }));
vi.mock('@/lib/wheel/marketHours', () => ({ isMarketOpen: () => clock.open }));
beforeEach(() => { clock.open = true; });

// Expiries are relative to today (New York), so these tests never age out.
const inDays = (n: number): string => {
  const [y, m, d] = currentNewYorkDate().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (n: number): string => { const [, m, d] = inDays(n).split('-').map(Number); return `${MONTHS[m - 1]} ${d}`; };
const EXP = inDays(41);
const put = (strike: number, delta = -0.27, bid = 0.5): WheelChainLeg => ({
  strikePrice: strike, expirationDate: EXP, optionType: 'P', delta, openInterest: 500, bid, ask: bid + 0.1, mid: bid + 0.05, occSymbol: `P${strike}`,
});
const chain = (strike: number | null, failedBatches = 0): WheelChainResult =>
  strike == null
    ? { expirations: [], chains: {}, failedBatches }
    : { expirations: [EXP], chains: { [EXP]: [put(strike)] }, failedBatches };

const STRIKES: Record<string, number> = { XLF: 51, XLE: 58, XLU: 37, XLP: 76, XLV: 159, BIG: 250, NVDA: 205 };
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
    fetchKind: async () => null,
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
    expect(within(xlf).getByText('7.0%')).toBeInTheDocument(); // strike 51 against a price of 54.84 is 7.0% below
    expect(within(xlf).getByText('$50')).toBeInTheDocument(); // credit: bid 0.50 x 100 shares
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
    expect(await screen.findByText(/No put found with delta 0.25 to 0.30 in 30 to 45 days/)).toBeInTheDocument();
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

describe('starter ETFs and zero stress', () => {
  it('the starter button stays while any starter is missing, and adds only the missing ones', async () => {
    const { deps, posts } = makeDeps({ wheelList: [{ symbol: 'XLV' }] });
    render(<WheelPlanTab deps={deps} />);
    const button = await screen.findByRole('button', { name: /Add remaining starter ETFs \(XLU, XLF, XLE, XLP\)/ });
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByTestId('ladder-row-XLU')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /starter ETFs/ })).not.toBeInTheDocument();
    await waitFor(() => expect(posts.length).toBeGreaterThan(0), { timeout: 3000 });
    expect((posts[posts.length - 1] as { wheelList: { symbol: string }[] }).wheelList.map((e) => e.symbol)).toEqual(['XLV', 'XLU', 'XLF', 'XLE', 'XLP']);
  });

  it('shows plain $0, not -$0, when nothing is deployed', async () => {
    const { deps } = makeDeps({});
    render(<WheelPlanTab deps={deps} />);
    expect(await screen.findByText('$0 (0.0%)')).toBeInTheDocument();
  });
});

describe('putting a name that does not fit on the wheel anyway', () => {
  it('places the contracts asked for, tags them, warns about the cost, and never blocks', async () => {
    const { deps, posts } = makeDeps({ wheelList: [{ symbol: 'NVDA' }] });
    render(<WheelPlanTab deps={deps} />);
    const row = await screen.findByTestId('ladder-row-NVDA');
    await waitFor(() => expect(within(row).getByText('$20,500')).toBeInTheDocument());
    expect(within(row).getByText(/Unlocks in/)).toBeInTheDocument(); // does not fit, so nothing in the plan yet
    expect(screen.getByText(/Today \(\$0 in the plan\)/)).toBeInTheDocument();

    const input = within(row).getByLabelText('Contracts for NVDA');
    await userEvent.type(input, '1{Enter}');

    await waitFor(() => expect(within(screen.getByTestId('ladder-row-NVDA')).getByText('Yours')).toBeInTheDocument());
    expect(within(screen.getByTestId('ladder-row-NVDA')).getByText(/Unlocks in/)).toBeInTheDocument(); // the plan's own verdict is still shown
    expect(screen.getByText(/Today \(\$20,500 in the plan\)/)).toBeInTheDocument();
    expect(screen.getByText(/NVDA: 1 contract ties up \$20,500 \(41.0% of the account\), above your \$15,000 limit for one name/)).toBeInTheDocument();
    expect(screen.getByText(/A 30% fall would cost \$6,150 \(12.3% of the account\), above your 9% budget/)).toBeInTheDocument();
    await waitFor(() => expect(posts.length).toBeGreaterThan(0), { timeout: 3000 });
    expect((posts[posts.length - 1] as { wheelList: unknown[] }).wheelList).toEqual([{ symbol: 'NVDA', contracts: 1 }]);
  });

  it('an invalid count is ignored and clearing it returns the name to the plan\'s own sizing', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'NVDA', contracts: 1 }] });
    render(<WheelPlanTab deps={deps} />);
    const input = await screen.findByLabelText('Contracts for NVDA');
    await userEvent.clear(input);
    await userEvent.type(input, '0{Enter}');
    await waitFor(() => expect(screen.getByLabelText('Contracts for NVDA')).toHaveValue('1')); // 0 refused, value restored
    await userEvent.clear(screen.getByLabelText('Contracts for NVDA'));
    await userEvent.tab();
    await waitFor(() => expect(screen.queryByText('Yours')).not.toBeInTheDocument());
  });

  it('warns when the plan uses more than the wheel cash', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'NVDA', contracts: 2 }] });
    render(<WheelPlanTab deps={deps} />);
    expect(await screen.findByText(/The plan uses \$41,000, \$1,000 more than your \$40,000 of wheel cash/)).toBeInTheDocument();
  });
});

describe('per-name drop override (WHEEL-SYSTEM-0003 Slice A)', () => {
  it('typing a percent stores it, tags the row Custom, changes the per-name limit, and saves it', async () => {
    const { deps, posts } = makeDeps({ wheelList: [{ symbol: 'NVDA' }] });
    render(<WheelPlanTab deps={deps} />);
    const row = await screen.findByTestId('ladder-row-NVDA');
    expect(within(row).queryByTestId('drop-custom-NVDA')).not.toBeInTheDocument();
    const dropInput = within(row).getByLabelText('Drop percent for NVDA');
    expect(dropInput).toHaveAttribute('placeholder', '30'); // the plan-wide default, shown as ghost text

    await userEvent.type(dropInput, '50{Enter}');
    await waitFor(() => expect(within(screen.getByTestId('ladder-row-NVDA')).getByTestId('drop-custom-NVDA')).toBeInTheDocument());

    // A 50% assumed drop halves the per-name limit from the 30%-default $15,000 to $9,000.
    const contractsInput = within(screen.getByTestId('ladder-row-NVDA')).getByLabelText('Contracts for NVDA');
    await userEvent.type(contractsInput, '1{Enter}');
    expect(await screen.findByText(/NVDA: 1 contract ties up \$20,500 \(41\.0% of the account\), above your \$9,000 limit for one name/)).toBeInTheDocument();
    expect(screen.getByText(/A 50% fall would cost \$10,250 \(20\.5% of the account\), above your 9% budget/)).toBeInTheDocument();

    await waitFor(() => expect(posts.length).toBeGreaterThan(0), { timeout: 3000 });
    expect((posts[posts.length - 1] as { wheelList: unknown[] }).wheelList).toEqual([{ symbol: 'NVDA', dropBps: 5000, contracts: 1 }]);
  });

  it('an out-of-range or non-numeric percent is refused and the field reverts', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'NVDA', dropBps: 4000 }] });
    render(<WheelPlanTab deps={deps} />);
    const input = await screen.findByLabelText('Drop percent for NVDA');
    expect(input).toHaveValue('40');

    await userEvent.clear(input);
    await userEvent.type(input, '0{Enter}'); // below the 1% floor
    await waitFor(() => expect(screen.getByLabelText('Drop percent for NVDA')).toHaveValue('40'));

    await userEvent.clear(screen.getByLabelText('Drop percent for NVDA'));
    await userEvent.type(screen.getByLabelText('Drop percent for NVDA'), '96{Enter}'); // above the 95% ceiling
    await waitFor(() => expect(screen.getByLabelText('Drop percent for NVDA')).toHaveValue('40'));

    await userEvent.clear(screen.getByLabelText('Drop percent for NVDA'));
    await userEvent.type(screen.getByLabelText('Drop percent for NVDA'), 'abc{Enter}');
    await waitFor(() => expect(screen.getByLabelText('Drop percent for NVDA')).toHaveValue('40'));
  });

  it('clearing the box returns the name to the plan-wide drop and removes the Custom tag', async () => {
    const { deps, posts } = makeDeps({ wheelList: [{ symbol: 'NVDA', dropBps: 4000 }] });
    render(<WheelPlanTab deps={deps} />);
    expect(await screen.findByTestId('drop-custom-NVDA')).toBeInTheDocument();
    const input = screen.getByLabelText('Drop percent for NVDA');
    await userEvent.clear(input);
    await userEvent.tab();
    await waitFor(() => expect(screen.queryByTestId('drop-custom-NVDA')).not.toBeInTheDocument());
    await waitFor(() => expect(posts.length).toBeGreaterThan(0), { timeout: 3000 });
    expect((posts[posts.length - 1] as { wheelList: unknown[] }).wheelList).toEqual([{ symbol: 'NVDA' }]);
  });
});

describe('own-history check (WHEEL-SYSTEM-0003 Slice B)', () => {
  // 23 closes: flat at 100 for 21 days, then a sharp fall -- worst month -44%, matching a
  // plan-default 30% drop by 14 points (Ian's relative-margin threshold: warns).
  const fallingHistory = [...Array(21).fill(100), 56, 60];
  // 23 closes with only a mild fall -- worst month -10%, well within the 30% plan default (quiet).
  const mildHistory = [...Array(21).fill(100), 90, 92];

  it('shows the history line, a warning and a Use button when the worst month is well past the effective drop', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'NVDA' }] }, { fetchHistory: async () => fallingHistory });
    render(<WheelPlanTab deps={deps} />);
    const row = await screen.findByTestId('ladder-row-NVDA');
    expect(await within(row).findByText(/History: worst month -44%, peak-to-trough -44%, 0\.1 years/)).toBeInTheDocument();
    expect(within(row).getByText('Short history')).toBeInTheDocument();
    expect(within(row).getByText(/14 pts worse than your 30% drop/)).toBeInTheDocument();

    await userEvent.click(within(row).getByRole('button', { name: 'Use 45%' }));
    await waitFor(() => expect(within(screen.getByTestId('ladder-row-NVDA')).getByLabelText('Drop percent for NVDA')).toHaveValue('45'));
    expect(within(screen.getByTestId('ladder-row-NVDA')).getByTestId('drop-custom-NVDA')).toBeInTheDocument();
  });

  it('goes quiet (no warning, no Use button) when the worst month is within the effective drop\'s margin', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'NVDA' }] }, { fetchHistory: async () => mildHistory });
    render(<WheelPlanTab deps={deps} />);
    const row = await screen.findByTestId('ladder-row-NVDA');
    expect(await within(row).findByText(/History: worst month -10%/)).toBeInTheDocument();
    expect(within(row).queryByText(/pts worse than/)).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /^Use \d+%$/ })).not.toBeInTheDocument();
  });

  it('a name already sized conservatively (its own Drop covers its history) reads calm, not alarmed', async () => {
    // Same falling history (worst month -44%), but the trader already set this name's own Drop to 45% --
    // only 1 point short, well inside the 10-point margin -- so Ian's relative threshold goes quiet.
    const { deps } = makeDeps({ wheelList: [{ symbol: 'NVDA', dropBps: 4500 }] }, { fetchHistory: async () => fallingHistory });
    render(<WheelPlanTab deps={deps} />);
    const row = await screen.findByTestId('ladder-row-NVDA');
    expect(await within(row).findByText(/History: worst month -44%/)).toBeInTheDocument();
    expect(within(row).queryByText(/pts worse than/)).not.toBeInTheDocument();
  });

  it('shows "History unavailable" with a retry when the fetch fails, and never blocks the row', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'NVDA' }] }, { fetchHistory: async () => null });
    render(<WheelPlanTab deps={deps} />);
    const row = await screen.findByTestId('ladder-row-NVDA');
    expect(await within(row).findByText('History unavailable')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Retry history for NVDA' })).toBeInTheDocument();
    // The row itself still renders normally -- history is information only, never a gate.
    expect(within(row).getByText('$20,500')).toBeInTheDocument();
  });

  it('too few closes for even one 21-day window reads as unavailable, not a guess', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'NVDA' }] }, { fetchHistory: async () => [100, 99, 98] });
    render(<WheelPlanTab deps={deps} />);
    const row = await screen.findByTestId('ladder-row-NVDA');
    expect(await within(row).findByText('History unavailable')).toBeInTheDocument();
  });
});

describe('the best-paying put in the delta band (0.25 to 0.30)', () => {
  const bandPuts = (): WheelChainResult => ({
    expirations: [EXP],
    chains: { [EXP]: [put(50, -0.2, 0.5), put(49, -0.26, 0.6), put(48, -0.3, 0.75), put(47, -0.33, 1.0)] },
    failedBatches: 0,
  });

  it('shows the highest Annual ROC put whose delta is between 0.25 and 0.30, not the nearest to a target', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLF' }] }, { fetchChain: async () => bandPuts() });
    render(<WheelPlanTab deps={deps} />);
    const row = await screen.findByTestId('ladder-row-XLF');
    await waitFor(() => expect(within(row).getByText(new RegExp(`48P · ${label(41)} · Δ0.30`))).toBeInTheDocument());
    expect(within(row).getByText('$75')).toBeInTheDocument(); // credit: bid 0.75 x 100
    expect(within(row).getByText('13.9%')).toBeInTheDocument(); // Annual ROC: 7,500 x 365 x 10,000 / (480,000 x 41) = 1,390 bps, floored to one decimal
  });

  it('a changed delta range re-prices the rows from the chain already loaded', async () => {
    const fetchChain = vi.fn(async () => bandPuts());
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLF' }], overrides: { deltaMinBps: 2000, deltaMaxBps: 2000 } }, { fetchChain });
    render(<WheelPlanTab deps={deps} />);
    const row = await screen.findByTestId('ladder-row-XLF');
    await waitFor(() => expect(within(row).getByText(new RegExp(`50P · ${label(41)} · Δ0.20`))).toBeInTheDocument());
    expect(fetchChain).toHaveBeenCalledTimes(1);
  });

  it('says so plainly when no put falls in the band', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLF' }], overrides: { deltaMinBps: 4000, deltaMaxBps: 4500 } }, { fetchChain: async () => ({ expirations: [EXP], chains: { [EXP]: [put(50, -0.2)] }, failedBatches: 0 }) });
    render(<WheelPlanTab deps={deps} />);
    expect(await screen.findByText(/No put found with delta 0.40 to 0.45 in 30 to 45 days/)).toBeInTheDocument();
  });

  it('labels each row ETF / index or Stock from the screener\'s detection (information only for now)', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLF' }, { symbol: 'NVDA' }, { symbol: 'XYZ' }] }, { fetchKind: async (s) => (s === 'XLF' ? 'etf' : s === 'NVDA' ? 'stock' : null) });
    render(<WheelPlanTab deps={deps} />);
    await waitFor(() => expect(screen.getByTestId('type-XLF')).toHaveTextContent('ETF / index'));
    expect(screen.getByTestId('type-NVDA')).toHaveTextContent('Stock');
    expect(screen.getByTestId('type-XYZ')).toHaveTextContent('Stock'); // unknown falls back to Stock
  });

  it('the delta range fields are in the adjustable defaults, with the band as the default', async () => {
    const { deps } = makeDeps({});
    render(<WheelPlanTab deps={deps} />);
    await screen.findByText(/Add a symbol/);
    await openAdjust();
    expect(screen.getByLabelText('Delta range, from')).toHaveValue('0.25');
    expect(screen.getByLabelText('Delta range, to')).toHaveValue('0.30');
  });
});

// ── W2: the Next candidate table ─────────────────────────────────────────────────────────────────

const lp = (strike: number, delta: number, bid: number, expirationDate = EXP): WheelChainLeg => ({
  strikePrice: strike, expirationDate, optionType: 'P', delta, openInterest: 500, bid, ask: Math.round((bid + 0.02) * 100) / 100, mid: bid + 0.01, occSymbol: `P${strike}-${expirationDate}`,
});
const chainWith = (...legs: WheelChainLeg[]): WheelChainResult => {
  const chains: Record<string, WheelChainLeg[]> = {};
  for (const l of legs) (chains[l.expirationDate] ??= []).push(l);
  return { expirations: Object.keys(chains).sort(), chains, failedBatches: 0 };
};
const flat = Array.from({ length: 40 }, (_, i) => 100 + (i % 2)); // RSI about 50
const rising = Array.from({ length: 40 }, (_, i) => 100 + i); // RSI 100

type MetricsMap = Record<string, { ivrPercent: number | null; earningsDate: string | null }>;
const withData = (metrics: MetricsMap, kinds: Record<string, 'etf' | 'stock'> = {}, closes: Record<string, number[] | null> = {}): Partial<WheelPlanDeps> => ({
  fetchMetrics: async (symbols: string[]) => ({ items: Object.fromEntries(symbols.filter((s) => metrics[s]).map((s) => [s, metrics[s]])), failed: [] }),
  fetchCloses: async (symbol: string) => (symbol in closes ? closes[symbol] : flat),
  fetchKind: async (symbol: string) => kinds[symbol] ?? null,
});
const rowOf = (symbol: string) => screen.findByTestId(`candidate-row-${symbol}`);
const order = () => screen.getAllByTestId(/^candidate-row-/).map((el) => el.getAttribute('data-testid')!.replace('candidate-row-', ''));

describe('Next candidate: order, verdicts and checks', () => {
  it('ranks a clean ETF candidate above an earnings-flagged stock, shows the Checks, and marks the return as including earnings risk', async () => {
    const chainFor = async (symbol: string) => (symbol === 'XLE' ? chainWith(lp(58, -0.27, 0.85)) : chainWith(lp(205, -0.26, 4.1)));
    const { deps } = makeDeps(
      { wheelList: [{ symbol: 'NVDA', contracts: 1 }, { symbol: 'XLE' }] },
      { fetchChain: chainFor, ...withData({ XLE: { ivrPercent: 38, earningsDate: null }, NVDA: { ivrPercent: 44, earningsDate: inDays(10) } }, { XLE: 'etf', NVDA: 'stock' }) },
    );
    render(<WheelPlanTab deps={deps} />);
    const xle = await rowOf('XLE');
    await waitFor(() => expect(order()).toEqual(['XLE', 'NVDA'])); // clean candidate first, flagged second
    expect(within(xle).getByText('Candidate')).toBeInTheDocument();
    expect(within(xle).getByText('IVR 38')).toBeInTheDocument();
    expect(within(xle).getByText(/ROC 13\.0% clears 10\.0%/)).toBeInTheDocument();
    expect(within(xle).getByText('Fits plan')).toBeInTheDocument();
    expect(within(xle).queryByText(/Earnings/)).not.toBeInTheDocument(); // an ETF has no earnings chip
    const nvda = screen.getByTestId('candidate-row-NVDA');
    expect(within(nvda).getByText(new RegExp(`Earnings ${label(10)}, inside this expiry`))).toBeInTheDocument();
    expect(within(nvda).getAllByText(/includes earnings risk/i).length).toBeGreaterThan(0);
    expect(within(nvda).getByText('Yours')).toBeInTheDocument(); // typed count never replaces the verdict
    expect(within(nvda).getByText('Candidate')).toBeInTheDocument();
    expect(screen.getByText('Candidates with an earnings flag')).toBeInTheDocument();
  });

  it('a put whose Annual ROC is under the hurdle is a Wait with the reason', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLU' }] }, { fetchChain: async () => chainWith(lp(37, -0.27, 0.3)), ...withData({ XLU: { ivrPercent: 40, earningsDate: null } }, { XLU: 'etf' }) });
    render(<WheelPlanTab deps={deps} />);
    const row = await rowOf('XLU');
    expect(within(row).getByText('Wait')).toBeInTheDocument();
    expect(within(row).getByText('Premium too thin')).toBeInTheDocument();
    expect(within(row).getByText(/ROC .*%, under 10\.0%/)).toBeInTheDocument();
  });

  it('a name that does not fit the profile is Not yet, with months to unlock, and a typed count removes that verdict', async () => {
    const setup = (wheelList: { symbol: string; contracts?: number }[]) =>
      makeDeps({ wheelList }, { fetchChain: async () => chainWith(lp(205, -0.26, 4.1)), ...withData({ NVDA: { ivrPercent: 44, earningsDate: inDays(200) } }, { NVDA: 'stock' }) });
    const first = setup([{ symbol: 'NVDA' }]);
    const { unmount } = render(<WheelPlanTab deps={first.deps} />);
    const row = await rowOf('NVDA');
    expect(within(row).getByText('Not yet')).toBeInTheDocument();
    expect(within(row).getByText(/Unlocks in \d+ months/)).toBeInTheDocument();
    unmount();
    const second = setup([{ symbol: 'NVDA', contracts: 1 }]);
    render(<WheelPlanTab deps={second.deps} />);
    expect(within(await rowOf('NVDA')).getByText('Candidate')).toBeInTheDocument();
  });

  it('an illiquid put is a Skip, and a thin high-credit put does not beat a liquid one', async () => {
    const thin: WheelChainLeg = { ...lp(56, -0.29, 1.4), ask: 2.4, openInterest: 500 }; // pays the most, gap is huge
    const good = lp(57, -0.26, 0.8);
    const both = makeDeps({ wheelList: [{ symbol: 'XLE' }] }, { fetchChain: async () => chainWith(thin, good), ...withData({ XLE: { ivrPercent: 38, earningsDate: null } }, { XLE: 'etf' }) });
    const { unmount } = render(<WheelPlanTab deps={both.deps} />);
    expect(await within(await rowOf('XLE')).findByText(/57P/)).toBeInTheDocument();
    unmount();
    const onlyThin = makeDeps({ wheelList: [{ symbol: 'XLE' }] }, { fetchChain: async () => chainWith(thin), ...withData({ XLE: { ivrPercent: 38, earningsDate: null } }, { XLE: 'etf' }) });
    render(<WheelPlanTab deps={onlyThin.deps} />);
    const row = await rowOf('XLE');
    expect(within(row).getByText('Skip')).toBeInTheDocument();
    expect(within(row).getByText('Put is illiquid')).toBeInTheDocument();
  });

  it('a stretched chart says wait for a pullback; the RSI limit is an editable default', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLE' }] }, { fetchChain: async () => chainWith(lp(58, -0.27, 0.85)), ...withData({ XLE: { ivrPercent: 38, earningsDate: null } }, { XLE: 'etf' }, { XLE: rising }) });
    render(<WheelPlanTab deps={deps} />);
    const row = await rowOf('XLE');
    expect(within(row).getByText('Wait for a pullback')).toBeInTheDocument();
    expect(within(row).getByText(/RSI 100, over 70/)).toBeInTheDocument();
  });

  it('the return hurdle is an editable default: lowering it turns a Wait into a Candidate', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLU' }] }, { fetchChain: async () => chainWith(lp(37, -0.27, 0.3)), ...withData({ XLU: { ivrPercent: 40, earningsDate: null } }, { XLU: 'etf' }) });
    render(<WheelPlanTab deps={deps} />);
    expect(within(await rowOf('XLU')).getByText('Wait')).toBeInTheDocument();
    await openAdjust();
    const hurdle = screen.getByLabelText('Return hurdle (Annual ROC)');
    await userEvent.clear(hurdle);
    await userEvent.type(hurdle, '5{Enter}');
    await waitFor(() => expect(within(screen.getByTestId('candidate-row-XLU')).getByText('Candidate')).toBeInTheDocument());
  });
});

describe('Next candidate: unknown never reads as pass', () => {
  it('a failed metrics call marks IVR unavailable and a stock unverified, keeps every row, and Retry loads it again', async () => {
    let fail = true;
    const fetchMetrics = vi.fn(async (symbols: string[]) => (fail ? { items: {}, failed: symbols } : { items: Object.fromEntries(symbols.map((s) => [s, { ivrPercent: 40, earningsDate: null }])), failed: [] }));
    const { deps } = makeDeps({ wheelList: [{ symbol: 'NVDA', contracts: 1 }, { symbol: 'XLE' }] }, { fetchChain: async (s) => chainWith(s === 'XLE' ? lp(58, -0.27, 0.85) : lp(205, -0.26, 4.1)), ...withData({}, { XLE: 'etf', NVDA: 'stock' }), fetchMetrics });
    render(<WheelPlanTab deps={deps} />);
    const nvda = await rowOf('NVDA');
    expect(within(nvda).getByText('IVR unavailable')).toBeInTheDocument();
    expect(within(nvda).getByText('Earnings unverified: data unavailable')).toBeInTheDocument();
    expect(within(await rowOf('XLE')).getByText('IVR unavailable')).toBeInTheDocument();
    expect(screen.getByText(/IVR and earnings dates could not be loaded/)).toBeInTheDocument();
    fail = false;
    await userEvent.click(within(screen.getByTestId('next-candidate-table')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(screen.getByTestId('candidate-row-XLE')).getByText('IVR 40')).toBeInTheDocument());
    expect(fetchMetrics).toHaveBeenCalledTimes(2);
  });

  it('a stock with no earnings date on file is flagged as unverified and ranks after a clean candidate', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'NVDA', contracts: 1 }, { symbol: 'XLE' }] }, { fetchChain: async (s) => chainWith(s === 'XLE' ? lp(58, -0.27, 0.85) : lp(205, -0.26, 4.1)), ...withData({ XLE: { ivrPercent: 38, earningsDate: null }, NVDA: { ivrPercent: 44, earningsDate: null } }, { XLE: 'etf', NVDA: 'stock' }) });
    render(<WheelPlanTab deps={deps} />);
    const nvda = await rowOf('NVDA');
    expect(within(nvda).getByText('Earnings unverified: no date on file')).toBeInTheDocument();
    expect(order()).toEqual(['XLE', 'NVDA']);
  });

  it('a symbol whose closes cannot be read shows RSI unavailable and is still ranked', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLE' }] }, { fetchChain: async () => chainWith(lp(58, -0.27, 0.85)), ...withData({ XLE: { ivrPercent: 38, earningsDate: null } }, { XLE: 'etf' }, { XLE: null }) });
    render(<WheelPlanTab deps={deps} />);
    const row = await rowOf('XLE');
    expect(within(row).getByText('RSI unavailable')).toBeInTheDocument();
    expect(within(row).getByText('Candidate')).toBeInTheDocument();
  });
});

describe('Next candidate: earnings', () => {
  const stock = (earningsInDays: number | null, over: Partial<WheelPlanDeps> = {}, overrides: Record<string, unknown> = {}) =>
    makeDeps({ wheelList: [{ symbol: 'NVDA', contracts: 1 }], overrides: overrides as never }, { fetchChain: async () => chainWith(lp(205, -0.26, 4.1)), ...withData({ NVDA: { ivrPercent: 44, earningsDate: earningsInDays == null ? null : inDays(earningsInDays) } }, { NVDA: 'stock' }), ...over });

  it('earnings a few days AFTER the expiry is a grey "date may move" note that does not flag or re-group the name', async () => {
    const { deps } = stock(47);
    render(<WheelPlanTab deps={deps} />);
    const row = await rowOf('NVDA');
    expect(within(row).getByText(new RegExp(`Earnings ${label(47)}, 6 days after expiry: date may move`))).toBeInTheDocument();
    expect(screen.queryByText('Candidates with an earnings flag')).not.toBeInTheDocument();
    expect(screen.queryByTestId('earnings-note-NVDA')).not.toBeInTheDocument();
  });

  it('with the earnings rule set to wait, a stock with earnings inside the expiry says wait until after the date', async () => {
    const { deps } = stock(10, {}, { earningsRule: 'wait' });
    render(<WheelPlanTab deps={deps} />);
    const row = await rowOf('NVDA');
    expect(within(row).getByText('Wait')).toBeInTheDocument();
    expect(within(row).getByText(new RegExp(`Wait until after earnings ${label(10)}`))).toBeInTheDocument();
  });

  it('"Find a shorter expiry" prices only expirations that end before earnings, outside the normal window', async () => {
    const shortExp = inDays(8);
    const fetchChain = vi.fn(async (_s: string, _t: string, window: { min: number; max: number }) =>
      window.min === 30 ? chainWith(lp(205, -0.26, 4.1)) : chainWith(lp(205, -0.26, 4.1), lp(200, -0.27, 2.15, shortExp), lp(195, -0.27, 3.0, inDays(20))));
    const { deps } = stock(10, { fetchChain });
    render(<WheelPlanTab deps={deps} />);
    await rowOf('NVDA');
    const note = await screen.findByTestId('earnings-note-NVDA');
    await userEvent.click(within(note).getByRole('button', { name: 'Find a shorter expiry' }));
    const result = await screen.findByTestId('shorter-result-NVDA');
    expect(result).toHaveTextContent(`200P · ${label(8)} · 8 days`); // ends before earnings (day 10); the day-20 put is not considered
    expect(result).toHaveTextContent('$215');
    expect(fetchChain).toHaveBeenLastCalledWith('NVDA', 'token', { min: 7, max: 9 });
  });

  it('says so in one line when no expiry ends before earnings far enough out', async () => {
    const { deps } = stock(5);
    render(<WheelPlanTab deps={deps} />);
    await rowOf('NVDA');
    await userEvent.click(within(await screen.findByTestId('earnings-note-NVDA')).getByRole('button', { name: 'Find a shorter expiry' }));
    expect(await screen.findByTestId('shorter-none-NVDA')).toHaveTextContent(/No expiry before .* that is at least 7 days out/);
  });

  it('an ETF never gets the earnings note or the button', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLE' }] }, { fetchChain: async () => chainWith(lp(58, -0.27, 0.85)), ...withData({ XLE: { ivrPercent: 38, earningsDate: inDays(10) } }, { XLE: 'etf' }) });
    render(<WheelPlanTab deps={deps} />);
    await rowOf('XLE');
    expect(screen.queryByRole('button', { name: 'Find a shorter expiry' })).not.toBeInTheDocument();
  });
});

describe('Next candidate: leveraged ETFs and the adjustable defaults', () => {
  it('a leveraged ETF is a Skip and triggers no metrics or chart call', async () => {
    const fetchMetrics = vi.fn(async () => ({ items: {}, failed: [] }));
    const fetchCloses = vi.fn(async () => flat);
    const { deps } = makeDeps({ wheelList: [{ symbol: 'TQQQ' }] }, { fetchMetrics, fetchCloses });
    render(<WheelPlanTab deps={deps} />);
    const row = await rowOf('TQQQ');
    expect(within(row).getByText('Skip')).toBeInTheDocument();
    expect(within(row).getByText(/Leveraged or inverse ETF/)).toBeInTheDocument();
    expect(fetchMetrics).not.toHaveBeenCalled();
    expect(fetchCloses).not.toHaveBeenCalled();
  });

  it('the new checks are in the adjustable defaults with the agreed values, including the earnings rule', async () => {
    const { deps } = makeDeps({});
    render(<WheelPlanTab deps={deps} />);
    await screen.findByText(/Add a symbol/);
    await openAdjust();
    expect(screen.getByLabelText('Return hurdle (Annual ROC)')).toHaveValue('10');
    expect(screen.getByLabelText('IVR floor, ETFs')).toHaveValue('20');
    expect(screen.getByLabelText('IVR floor, stocks')).toHaveValue('30');
    expect(screen.getByLabelText('RSI limit')).toHaveValue('70');
    expect(screen.getByLabelText('Bid-ask limit (% of midpoint)')).toHaveValue('10');
    expect(screen.getByLabelText('Minimum open interest')).toHaveValue('100');
    expect(screen.getByLabelText('Opening fee per contract')).toHaveValue('0');
    expect(screen.getByLabelText(/Shortest expiry for/)).toHaveValue('7');
    expect(screen.getByLabelText('Stock with earnings inside the expiry')).toHaveValue('flag');
  });

  it('with an empty list the table shows its empty state and never fetches metrics', async () => {
    const fetchMetrics = vi.fn(async () => ({ items: {}, failed: [] }));
    const { deps } = makeDeps({}, { fetchMetrics });
    render(<WheelPlanTab deps={deps} />);
    expect(await screen.findByTestId('next-candidate-empty')).toBeInTheDocument();
    expect(fetchMetrics).not.toHaveBeenCalled();
  });
});

describe('Next candidate: the market is closed (quotes can be stale or wide)', () => {
  const thin: WheelChainLeg = { ...lp(56, -0.29, 0.38), ask: 1.0, openInterest: 500 }; // a 90%+ gap, as seen after hours

  it('shows a note, does not fail a put on the bid-ask gap, and says the gap is unverified', async () => {
    clock.open = false;
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLE' }] }, { fetchChain: async () => chainWith(thin), ...withData({ XLE: { ivrPercent: 69, earningsDate: null } }, { XLE: 'etf' }) });
    render(<WheelPlanTab deps={deps} />);
    const row = await rowOf('XLE');
    expect(screen.getByTestId('market-closed-note')).toHaveTextContent(/market is closed/i);
    expect(within(row).getByText('Bid-ask unverified (market closed), OI 500')).toBeInTheDocument();
    expect(within(row).queryByText('Skip')).not.toBeInTheDocument();
  });

  it('open interest still fails a put while closed', async () => {
    clock.open = false;
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLF' }] }, { fetchChain: async () => chainWith({ ...thin, openInterest: 0 }), ...withData({ XLF: { ivrPercent: 42, earningsDate: null } }, { XLF: 'etf' }) });
    render(<WheelPlanTab deps={deps} />);
    const row = await rowOf('XLF');
    expect(within(row).getByText('Skip')).toBeInTheDocument();
    expect(within(row).getByText(/OI 0, illiquid/)).toBeInTheDocument();
  });

  it('with the market open there is no note and the bid-ask gap is checked', async () => {
    const { deps } = makeDeps({ wheelList: [{ symbol: 'XLE' }] }, { fetchChain: async () => chainWith(thin), ...withData({ XLE: { ivrPercent: 69, earningsDate: null } }, { XLE: 'etf' }) });
    render(<WheelPlanTab deps={deps} />);
    const row = await rowOf('XLE');
    expect(screen.queryByTestId('market-closed-note')).not.toBeInTheDocument();
    expect(within(row).getByText('Skip')).toBeInTheDocument();
  });
});
