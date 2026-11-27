// features/screener/components/__tests__/CcAllCallsModal.test.tsx

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CcAllCallsModal, type CcAllCallsDeps } from '../CcAllCallsModal';
import type { ScreenResult } from '@/lib/scans/types';

const th = {
  bg: 'bg-[#0a0a0a]', card: 'bg-[#171717]', border: 'border-[#2c2c2c]', sidebar: 'bg-[#101010]',
  text: 'text-white', textMuted: 'text-[#e0e0e0]', textFaint: 'text-[#808080]',
  input: 'bg-[#141414]', inputBorder: 'border-[#353535]',
} as never;

const iso = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
const E1 = iso(14), E2 = iso(21), E3 = iso(90);

const leg = (strike: number, bid: number, ask: number, delta: number, exp = E1, oi = 500) => ({
  strikePrice: strike, optionType: 'C', expirationDate: exp, bid, ask, delta, openInterest: oi, iv: 0.8, occSymbol: `TQQQ  C${strike}${exp}`,
});

function makeDeps(over: { legs?: ReturnType<typeof leg>[]; lots?: Array<{ shares: number; price: number; day: string }> | null } = {}): CcAllCallsDeps {
  const legs = over.legs ?? [leg(53, 1.4, 1.54, 0.2), leg(55, 0.88, 0.94, 0.15), leg(57, 0.51, 0.55, 0.1)];
  return {
    lookup: {
      getToken: async () => 'tok',
      getListedExpirations: async () => [E1, E2, E3],
      fetchChain: vi.fn(async (_s: string, _t: string, exp: string) => ({ chains: { [exp]: legs.map(l => ({ ...l, expirationDate: exp })) }, classification: 'etf' as const })),
      getUnderlyingPrice: async () => 48.01,
    },
    order: {
      isMarketOpen: () => true,
      fetchQuote: async () => ({ bid: 0.88, ask: 0.94, ageSeconds: 1 }),
      readCoverage: async () => ({ capacity: { status: 'ok', bySymbol: { TQQQ: { sharesOwned: 200, availableCoveredContracts: 2, costBasis: 78.75, costBasisComplete: true } }, warnings: [] } as never, foundations: null }),
      readLots: async () => (over.lots === undefined ? [{ shares: 100, price: 82, day: '2026-01-05' }, { shares: 100, price: 75.5, day: '2026-11-04' }] : over.lots),
      dryRun: vi.fn(async () => ({})), place: vi.fn(async () => ({ orderId: 'x' })), now: () => 1,
    },
  };
}

const result = (rsi: number | null, basis: number | null = 78.75, source: 'broker' | 'typed' = 'broker') => ({
  symbol: 'TQQQ', strategy: 'CC', price: 48.01, underlyingType: 'etf',
  ccBasis: { basis, source }, trendResult: rsi === null ? undefined : { metrics: { rsi14: rsi, rsi14Known: true } },
}) as unknown as ScreenResult;

async function open(deps: CcAllCallsDeps, r = result(40)) {
  render(<CcAllCallsModal result={r} th={th} deps={deps} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByTestId('cc-all-calls-rows')).toBeTruthy());
}

describe('CcAllCallsModal', () => {
  it('lists every call, says "below your cost" once at the top, and never offers an order on a below-cost row', async () => {
    await open(makeDeps());
    expect(screen.getByTestId('cc-all-calls-band').textContent).toBe('All strikes are below your $82.00 cost');
    expect(screen.getByTestId('cc-all-row-53')).toBeTruthy();
    expect(screen.getByTestId('cc-all-row-55')).toBeTruthy();
    expect(screen.getByTestId('cc-all-row-57')).toBeTruthy();
    expect(screen.queryAllByText('Below your cost')).toHaveLength(0);
    await userEvent.click(screen.getByTestId('cc-all-row-55'));
    expect(screen.getByTestId('cc-all-lotloss-55').textContent).toContain('you lose $2,609 on your oldest shares');
    expect(screen.queryByRole('button', { name: 'Review order' })).toBeNull();
    expect(screen.getByTestId('cc-all-calls-summary').textContent).toContain('your cost $82.00 (oldest shares)');
  });

  it('says the RSI wait once and keeps the order off on a pick while it applies', async () => {
    await open(makeDeps({ lots: [{ shares: 200, price: 40, day: '2026-01-05' }] }), result(40, 40));
    expect(screen.getByTestId('cc-all-calls-wait').textContent).toContain('Wait for RSI');
    await userEvent.click(screen.getByTestId('cc-all-row-55'));
    expect(screen.getByTestId('cc-all-detail-55').textContent).toContain('This call passes your rules.');
    expect(screen.queryByTestId('cc-all-order-55')).toBeNull();
    expect(screen.getByTestId('cc-all-detail-55').textContent).toContain('Order is off until the RSI wait is over.');
  });

  it('offers Review order on a pick when the RSI is fine, and opens the normal order screen', async () => {
    await open(makeDeps({ lots: [{ shares: 200, price: 40, day: '2026-01-05' }] }), result(60, 40));
    expect(screen.queryByTestId('cc-all-calls-wait')).toBeNull();
    await userEvent.click(screen.getByTestId('cc-all-row-55'));
    await userEvent.click(screen.getByTestId('cc-all-order-55'));
    expect(await screen.findByTestId('cc-coverage')).toBeTruthy();
  });

  it('turns the order off with no cost basis', async () => {
    await open(makeDeps({ lots: null }), result(60, null));
    expect(document.body.textContent).toContain('Cost basis unknown. No call without one.');
    await userEvent.click(screen.getByTestId('cc-all-row-55'));
    expect(screen.queryByTestId('cc-all-order-55')).toBeNull();
  });

  it('fetches another date only when it is picked', async () => {
    const deps = makeDeps();
    await open(deps);
    expect(deps.lookup.fetchChain).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: new RegExp('21 days') }));
    await waitFor(() => expect(deps.lookup.fetchChain).toHaveBeenCalledTimes(2));
    expect((deps.lookup.fetchChain as any).mock.calls[1][2]).toBe(E2);
  });

  it('shows an error and no rows when the broker session is gone', async () => {
    const deps = makeDeps();
    deps.lookup.getToken = async () => null;
    render(<CcAllCallsModal result={result(60)} th={th} deps={deps} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Broker session expired'));
    expect(screen.queryByTestId('cc-all-calls-rows')).toBeNull();
  });

  it('folds the strikes under the stock price away, shows real premium, and names a balanced pick', async () => {
    const deps = makeDeps({ lots: [{ shares: 200, price: 40, day: '2026-01-05' }], legs: [leg(27, 19.5, 23.55, 0.99, E1, 0), leg(52, 1.5, 1.55, 0.35), leg(54, 1.0, 1.05, 0.27), leg(56, 0.6, 0.65, 0.12)] });
    await open(deps, result(60, 40));
    expect(screen.queryByTestId('cc-all-row-27')).toBeNull();
    expect(screen.getByTestId('cc-all-calls-under').textContent).toContain('Show 1 strike under the stock price');
    expect(screen.getByTestId('cc-all-calls-balanced').textContent).toContain('Balanced pick: the $54C strike collects $102');
    await userEvent.click(screen.getByTestId('cc-all-calls-under'));
    expect(screen.getByTestId('cc-all-row-27').textContent).toContain('of $2152, rest is stock value');
  });

  it('says there is no balanced pick when every strike is below cost', async () => {
    await open(makeDeps());
    expect(screen.getByTestId('cc-all-calls-balanced').textContent).toBe('No balanced pick on this date: every strike is below your cost.');
  });

  it('shows open interest as a column and sorts by a clicked column', async () => {
    const deps = makeDeps({ legs: [leg(53, 1.4, 1.54, 0.2, E1, 10), leg(55, 0.88, 0.94, 0.15, E1, 900), leg(57, 0.51, 0.55, 0.1, E1, 300)] });
    await open(deps);
    expect(screen.getByTestId('cc-all-row-55').textContent).toContain('900');
    expect(screen.queryAllByText('No open interest')).toHaveLength(0);
    const order = () => screen.getAllByTestId(/^cc-all-row-/).map(e => e.getAttribute('data-testid'));
    expect(order()).toEqual(['cc-all-row-53', 'cc-all-row-55', 'cc-all-row-57']);
    await userEvent.click(screen.getByTestId('cc-all-sort-oi'));
    expect(order()).toEqual(['cc-all-row-55', 'cc-all-row-57', 'cc-all-row-53']);
    await userEvent.click(screen.getByTestId('cc-all-sort-oi'));
    expect(order()).toEqual(['cc-all-row-53', 'cc-all-row-57', 'cc-all-row-55']);
  });

  it('shows the price gap in a colour instead of a chip', async () => {
    await open(makeDeps({ legs: [leg(53, 1.4, 1.42, 0.2), leg(55, 0.1, 0.4, 0.15)] }));
    expect(screen.getByTestId('cc-all-gap-53').getAttribute('data-tone')).toBe('green');
    expect(screen.getByTestId('cc-all-gap-55').getAttribute('data-tone')).toBe('red');
    expect(screen.queryAllByText('Price gap too big')).toHaveLength(0);
  });
});
